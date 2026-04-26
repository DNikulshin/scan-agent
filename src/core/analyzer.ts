import axios from 'axios';
import { z } from 'zod';
import { config } from '../config';
import { profile, getProfileContext } from '../profile';
import { logger } from '../utils/logger';
import { withRetry, isRetryableHttpError } from '../utils/retry';
import type { Order, ScoreResult, PitchResult } from '../types';

// ── Zod-схемы для валидации AI-ответов ──

const ScoreSchema = z.object({
  score: z.number().int().min(0).max(10),
  reason: z.string().min(3).max(500),
});

const PitchSchema = z.object({
  hook: z.string().min(5).max(150),
  pitch: z.string().min(20).max(1000),
});

// ── Few-shot примеры для стабильного скоринга ──

const SCORING_EXAMPLES = `
Примеры оценки:

Заказ: "Разработать Telegram-бота на Node.js для автоматизации заявок"
→ {"score": 9, "reason": "Прямое попадание в стек: Node.js + Telegram API, можно сделать быстро и качественно"}

Заказ: "Сделать лендинг на Tilda с анимациями"
→ {"score": 2, "reason": "Tilda — no-code, не наш стек, мало пользы для портфолио"}

Заказ: "Нужен AI-чат-бот для сайта интернет-магазина"
→ {"score": 8, "reason": "AI-интеграция + веб — сильная сторона, хороший кейс для портфолио"}

Заказ: "Нарисовать 10 иллюстраций для книги"
→ {"score": 0, "reason": "Не IT-разработка, дизайн/иллюстрации"}

Заказ: "Написать курсовую по экономике"
→ {"score": 0, "reason": "Не IT, академическая работа"}
`.trim();

// ── Вспомогательные функции ──

/** Безопасный вызов OpenRouter API */
async function callOpenRouter(params: {
  model: string;
  prompt: string;
  temperature: number;
  maxTokens?: number;
}): Promise<string> {
  const { model, prompt, temperature, maxTokens = 800 } = params;

  const res = await axios.post(
    config.openrouter.baseUrl,
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature,
      max_tokens: maxTokens,
    },
    {
      headers: {
        Authorization: `Bearer ${config.openrouter.apiKey}`,
        'Content-Type': 'application/json',
      },
      proxy: false,
      timeout: config.openrouter.timeout,
    },
  );

  const raw: string = res.data.choices[0]?.message?.content ?? '';
  // Очистка от возможных markdown-обёрток
  return raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}

/** Парсинг JSON с Zod-валидацией */
function parseAndValidate<T>(raw: string, schema: z.ZodSchema<T>): T {
  const parsed: unknown = JSON.parse(raw);
  return schema.parse(parsed);
}

// ── Шаг 1: Скоринг (бесплатная модель) ──

export async function scoreOrder(order: Order): Promise<ScoreResult | null> {
  const prompt = `Ты опытный разработчик. Оцени заказ/вакансию: подходит ли под мой стек?
ВАЖНО: отвечай ТОЛЬКО на русском языке.

МОЙ СТЕК: ${profile.stack.join(', ')}

${SCORING_EXAMPLES}

Теперь оцени:
Заказ: "${order.title}"
Описание: ${order.desc || '(не указано)'}
Цена: ${order.price || '(не указана)'}

Ответь СТРОГО JSON: {"score": число 0-10, "reason": "пояснение до 2 предложений на русском"}`;

  const models = [
    config.openrouter.scoringModel,
    config.openrouter.scoringFallback,
  ];

  for (const model of models) {
    try {
      const raw = await withRetry(
        () => callOpenRouter({
          model,
          prompt,
          temperature: config.openrouter.scoringTemperature,
          maxTokens: 200,
        }),
        {
          maxAttempts: 2,
          label: `scoring:${model}`,
          shouldRetry: isRetryableHttpError,
        },
      );

      return parseAndValidate(raw, ScoreSchema);
    } catch (error) {
      const isLast = model === models[models.length - 1];

      if (!isLast) {
        logger.warn({ model, orderId: order.id }, 'Ошибка модели, переключаюсь на fallback');
        continue;
      }

      logger.error({ err: error, orderId: order.id, title: order.title }, 'Скоринг провален');
      return null;
    }
  }

  return null;
}

// ── Шаг 2: Pitch (платная модель, только для высокого score) ──

export async function generatePitch(order: Order, temperature?: number): Promise<PitchResult | null> {
  const profileCtx = getProfileContext();

  const prompt = `Ты пишешь отклик на заказ с фриланс-биржи от имени разработчика.
ВАЖНО: весь текст ТОЛЬКО на русском языке.

ПРОФИЛЬ РАЗРАБОТЧИКА:
${profileCtx}

ЗАКАЗ:
Название: "${order.title}"
Описание: ${order.desc || '(не указано)'}
Цена: ${order.price || '(не указана)'}

ТРЕБОВАНИЯ К ОТКЛИКУ:
1. hook — одна фраза (до 100 символов), показывающая что ты ПОНЯЛ задачу. Не "Здравствуйте", а конкретика: "Делал похожий бот для X — расскажу как решу вашу задачу."
2. pitch — полный отклик (3-5 предложений):
   - Что конкретно сделаешь (не абстрактно "разработаю решение", а "соберу бота на Node.js + Telegram API")
   - Релевантный опыт из портфолио (если есть похожий проект — упомяни)
   - Сроки
   - Без воды, без "я профессионал с большим опытом"

Ответь СТРОГО JSON на русском:
{"hook": "цепляющая фраза на русском", "pitch": "полный отклик на русском"}`;

  try {
    const raw = await withRetry(
      () => callOpenRouter({
        model: config.openrouter.pitchModel,
        prompt,
        temperature: temperature ?? config.openrouter.pitchTemperature,
        maxTokens: 600,
      }),
      {
        maxAttempts: 2,
        label: 'pitch',
        shouldRetry: isRetryableHttpError,
      },
    );

    return parseAndValidate(raw, PitchSchema);
  } catch (error) {
    logger.error({ err: error, orderId: order.id, title: order.title }, 'Pitch провален');
    return null;
  }
}

// ── Полный pipeline: скоринг → фильтр → pitch ──

export interface AnalysisResult {
  score: ScoreResult;
  pitch: PitchResult;
  pitchB: PitchResult | null;
}

export async function analyzeOrder(order: Order, minScore?: number): Promise<AnalysisResult | null> {
  const score = await scoreOrder(order);

  if (!score) {
    logger.warn({ orderId: order.id }, 'Ошибка скоринга — повторю позже');
    return null;
  }

  const threshold = minScore ?? config.filter.minScore;
  if (score.score < threshold) {
    logger.info({ orderId: order.id, score: score.score, reason: score.reason }, 'Не прошёл порог');
    return null;
  }

  logger.info({ orderId: order.id, score: score.score, title: order.title }, 'Прошёл скоринг');

  // Генерируем 2 варианта параллельно: сфокусированный (0.5) и креативный (0.9)
  const [pitch, pitchB] = await Promise.all([
    generatePitch(order, 0.5),
    generatePitch(order, 0.9),
  ]);

  if (!pitch) {
    logger.warn({ orderId: order.id }, 'Ошибка pitch — повторю позже');
    return null;
  }

  return { score, pitch, pitchB };
}


