import "dotenv/config";

// ── Конфигурация проекта ──
// Все магические числа и настройки собраны в одном месте.
// Переопределяй через .env или меняй дефолты здесь.

export const config = {
  /** OpenRouter */
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    timeout: 30_000,

    /** Модель для скоринга: дешёвая платная, без rate-limit */
    scoringModel: "deepseek/deepseek-chat",
    scoringFallback: "deepseek/deepseek-chat",
    scoringTemperature: 0.3,

    /** Модель для pitch: дешёвая, но качественная */
    pitchModel: "deepseek/deepseek-chat",
    pitchTemperature: 0.7,
  },

  /** Telegram */
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
    timeout: 10_000,
  },

  /** Supabase (облако, опционально) */
  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    anonKey: process.env.SUPABASE_ANON_KEY ?? "",
  },

  /** Dashboard VPS (опционально) */
  dashboard: {
    url: process.env.DASHBOARD_URL ?? "",
    apiKey: process.env.DASHBOARD_API_KEY ?? "",
  },

  /** Фильтрация */
  filter: {
    /** Заказы с этими словами — мусор (не IT) */
    stopWords: [
      "отзыв",
      "реферат",
      "диплом",
      "курсовая",
      "перевод",
      "копирайт",
      "текст",
      "рерайт",
      "seo текст",
      "статья",
      "контент-план",
    ],
    /** Минимальная цена заказа в рублях */
    minPrice: 1_000,
    /** Максимум предложений — больше значит конкуренция слишком высока */
    maxOffers: 10,
    /** Минимальный score для отправки в Telegram */
    minScore: 7,
  },

  /** Кэш обработанных ID */
  cache: {
    file: process.env.CACHE_FILE ?? "processed_ids.json",
    /** Сколько ID хранить (FIFO) */
    maxSize: 500,
  },

  /** Задержки */
  delays: {
    /** Пауза между AI-вызовами (мс) — чтобы не спамить API */
    betweenOrders: 10_000,
    /** Пауза перед retry при ошибке модели (мс) */
    retryDelay: 3_000,
  },

  /** Kwork */
  kwork: {
    url: process.env.KWORK_SEARCH_URL ?? "https://kwork.ru/projects",
    /** CSS-селекторы — вынесены сюда, чтобы при изменении вёрстки
     *  менять только конфиг, а не логику парсера */
    selectors: {
      card: ".want-card",
      title: ".wants-card__header-title a",
      description: ".wants-card__description-text",
      price: ".wants-card__price-wrap",
      offersContainer: ".mr8",
    },
  },
  /** FL.ru */
  fl: {
    enabled: process.env.FL_ENABLED === "true",
    url: process.env.FL_SEARCH_URL ?? "https://www.fl.ru/projects/",
    /** Категории IT: программирование, сайты, мобайл, AI */
    categories: [
      "https://www.fl.ru/projects/category/programmirovanie/",
      "https://www.fl.ru/projects/category/saity/",
    ],
    selectors: {
      card: '[data-qa="project-item"], .b-post',
      title: '[data-qa="project-item-title"] a, .b-post__title a, h2 a',
      description:
        '[data-qa="project-item-description"], .b-post__body, .b-post__txt',
      price: '[data-qa="project-item-budget"], .b-post__price, .text-6',
      offersText: '[data-qa="project-item-responses"], .b-post__count, .text-5',
      link: '[data-qa="project-item-title"] a, .b-post__title a, h2 a',
    },
  },

  /** Freelance.ru */
  freelanceru: {
    enabled: process.env.FREELANCERU_ENABLED === "true",
    url:
      process.env.FREELANCERU_SEARCH_URL ??
      "https://freelance.ru/project/search/pro/razrabotka-sajtov/",
    selectors: {
      card: '.project, .project-item, [class*="project"]',
      title: ".project__title a, .project-item__title a, h3 a",
      description: ".project__desc, .project-item__desc",
      price: ".project__price, .project-item__price, .cost",
      offersText: ".project__offers, .project-item__offers, .count",
    },
  },

  /** Habr Freelance */
  habr: {
    enabled: process.env.HABR_ENABLED === "true",
    url:
      process.env.HABR_SEARCH_URL ??
      "https://freelance.habr.com/tasks?categories=develop_programming,develop_javascript,develop_python,develop_mobile&type=all",
    selectors: {
      card: ".task",
      title: ".task__title a",
      description: ".task__description, .preview__text",
      price: ".task__price, .price-box__money",
      offersText: ".count-responses, .task__responses-count",
    },
  },

  /** HH.ru — вакансии (keyword-скоринг, без AI) */
  hh: {
    enabled: process.env.HH_ENABLED === 'true',
    url: process.env.HH_SEARCH_URL ??
      'https://hh.ru/search/vacancy?employment=project&schedule=remote&text=TypeScript+OR+React+OR+Node.js+OR+Next.js+OR+разработчик&order_by=publication_time',
    maxPages: Number(process.env.HH_MAX_PAGES || '3'),
    minKeywordScore: Number(process.env.HH_MIN_KEYWORD_SCORE || '10'),
  },

  /** Push notifications */
  push: {
    vapid: {
      subject: "mailto:your-email@example.com", // Замените на ваш email
      publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
      privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    },
  },
} as const;

/** Валидация конфига при старте */
export function validateConfig(): void {
  const missing: string[] = [];
  if (!config.openrouter.apiKey) missing.push("OPENROUTER_API_KEY");
  if (!config.telegram.botToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.telegram.chatId) missing.push("TELEGRAM_CHAT_ID");
  if (!config.push.vapid.publicKey) missing.push("VAPID_PUBLIC_KEY");
  if (!config.push.vapid.privateKey) missing.push("VAPID_PRIVATE_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Отсутствуют переменные окружения: ${missing.join(", ")}\n` +
        "Скопируй .env.example в .env и заполни значения.",
    );
  }
}
