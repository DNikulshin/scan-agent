import axios from 'axios';
import { z } from 'zod';
import { config } from '../config';
import { getCachedProfileContext, getCachedStack, getCachedExperienceContext } from './profile-context';
import { logger } from '../utils/logger';
import { withRetry, isRetryableHttpError } from '../utils/retry';
import type { AiUsage, Order, ScoreResult, PitchResult } from '../types';

const ZERO_USAGE: AiUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

function addUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    costUsd: a.costUsd + b.costUsd,
  };
}

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

interface OpenRouterCall {
  text: string;
  usage: AiUsage;
}

/** Безопасный вызов OpenRouter API. Возвращает text + usage (cost — best-effort через /generation). */
async function callOpenRouter(params: {
  model: string;
  prompt: string;
  temperature: number;
  maxTokens?: number;
}): Promise<OpenRouterCall> {
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
  const text = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  const id: string | undefined = res.data.id;
  const inlineUsage = res.data.usage ?? {};
  const tokensIn = Number(inlineUsage.prompt_tokens ?? 0);
  const tokensOut = Number(inlineUsage.completion_tokens ?? 0);
  // total_cost иногда уже есть в ответе chat/completions, но достоверно только в /generation.
  const costUsd = await fetchGenerationCost(id);

  return { text, usage: { tokensIn, tokensOut, costUsd } };
}

/**
 * Тащит финальный cost из OpenRouter Generation API.
 * Ничего не ломает, если API 404'нул, отстал по времени или вернул нечисловой total_cost —
 * в этих случаях возвращает 0. Это одна из метрик, не критичная для pipeline'а.
 */
async function fetchGenerationCost(id: string | undefined): Promise<number> {
  if (!id) return 0;

  try {
    const res = await withRetry(
      () =>
        axios.get('https://openrouter.ai/api/v1/generation', {
          params: { id },
          headers: { Authorization: `Bearer ${config.openrouter.apiKey}` },
          proxy: false,
          timeout: 5000,
        }),
      { maxAttempts: 2, label: 'generation-cost', shouldRetry: isRetryableHttpError },
    );

    const cost = Number(res.data?.data?.total_cost ?? 0);
    return Number.isFinite(cost) && cost >= 0 ? cost : 0;
  } catch {
    return 0;
  }
}

/** Парсинг JSON с Zod-валидацией */
function parseAndValidate<T>(raw: string, schema: z.ZodSchema<T>): T {
  const parsed: unknown = JSON.parse(raw);
  return schema.parse(parsed);
}

// ── Шаг 1: Скоринг (бесплатная модель) ──

export interface ScoreOutcome {
  result: ScoreResult | null;
  usage: AiUsage;
}

export async function scoreOrder(order: Order): Promise<ScoreOutcome> {
  const experience = getCachedExperienceContext();
  const experienceBlock = experience ? `\nОПЫТ РАБОТЫ:\n${experience}\n` : '';

  const prompt = `Ты опытный разработчик. Оцени заказ/вакансию: подходит ли под мой стек?
ВАЖНО: отвечай ТОЛЬКО на русском языке.

МОЙ СТЕК: ${getCachedStack().join(', ')}
${experienceBlock}
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

  let usage: AiUsage = ZERO_USAGE;

  for (const model of models) {
    try {
      const call = await withRetry(
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

      usage = addUsage(usage, call.usage);
      return { result: parseAndValidate(call.text, ScoreSchema), usage };
    } catch (error) {
      const isLast = model === models[models.length - 1];

      if (!isLast) {
        logger.warn({ model, orderId: order.id }, 'Ошибка модели, переключаюсь на fallback');
        continue;
      }

      logger.error({ err: error, orderId: order.id, title: order.title }, 'Скоринг провален');
      return { result: null, usage };
    }
  }

  return { result: null, usage };
}

// ── Шаг 2: Pitch (платная модель, только для высокого score) ──

export interface PitchOutcome {
  result: PitchResult | null;
  usage: AiUsage;
}

export async function generatePitch(order: Order, temperature?: number): Promise<PitchOutcome> {
  const profileCtx = getCachedProfileContext();
  const experience = getCachedExperienceContext();
  const experienceBlock = experience ? `\nОПЫТ РАБОТЫ (для справки — упоминай только релевантное):\n${experience}\n` : '';

  const prompt = `Ты пишешь отклик на заказ с фриланс-биржи от имени разработчика.
ВАЖНО: весь текст ТОЛЬКО на русском языке.

ПРОФИЛЬ РАЗРАБОТЧИКА:
${profileCtx}
${experienceBlock}
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
    const call = await withRetry(
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

    return { result: parseAndValidate(call.text, PitchSchema), usage: call.usage };
  } catch (error) {
    logger.error({ err: error, orderId: order.id, title: order.title }, 'Pitch провален');
    return { result: null, usage: ZERO_USAGE };
  }
}

// ── Полный pipeline: скоринг → фильтр → pitch ──

export interface AnalysisResult {
  score: ScoreResult;
  pitch: PitchResult;
  pitchB: PitchResult | null;
  /** Суммарный usage всех вызовов: 1 score + до 2 pitch'ей. */
  usage: AiUsage;
  /** Сколько pitch-вызовов реально дошло до OpenRouter (для метрики `incPitchCall`). */
  pitchCalls: number;
}

export async function analyzeOrder(order: Order, minScore?: number): Promise<AnalysisResult | null> {
  const { result: score, usage: scoreUsage } = await scoreOrder(order);

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
  const [pitchOutcome, pitchBOutcome] = await Promise.all([
    generatePitch(order, 0.5),
    generatePitch(order, 0.9),
  ]);

  const usage = addUsage(addUsage(scoreUsage, pitchOutcome.usage), pitchBOutcome.usage);

  if (!pitchOutcome.result) {
    logger.warn({ orderId: order.id }, 'Ошибка pitch — повторю позже');
    return null;
  }

  return {
    score,
    pitch: pitchOutcome.result,
    pitchB: pitchBOutcome.result,
    usage,
    pitchCalls: 2,
  };
}


