import "dotenv/config";

export const config = {
  /** OpenRouter */
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    timeout: 30_000,
    scoringModel: "deepseek/deepseek-chat",
    scoringFallback: "deepseek/deepseek-chat",
    scoringTemperature: 0.3,
    pitchModel: "deepseek/deepseek-chat",
    pitchTemperature: 0.7,
  },

  /** Telegram */
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    chatId: process.env.TELEGRAM_CHAT_ID ?? "",
    timeout: 10_000,
  },

  /** Фильтрация */
  filter: {
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
    minPrice: 1_000,
    maxOffers: 10,
    minScore: 7,
  },

  /** Задержки */
  delays: {
    betweenOrders: 10_000,
    retryDelay: 3_000,
  },

  /** Kwork */
  kwork: {
    url: process.env.KWORK_SEARCH_URL ?? "https://kwork.ru/projects",
    selectors: {
      card: ".want-card",
      title: ".wants-card__header-title a",
      description: ".wants-card__description-text",
      price: ".wants-card__price-wrap",
      offersContainer: ".mr8",
    },
    // Kwork не отдаёт дату публикации в DOM (нет JSON-LD JobPosting, нет <time>,
    // нет og:* / itemprop=datePublished — проверено 2026-05-13). Единственный
    // сигнал — счётчик «Осталось», поэтому считаем published ≈ now - (TTL - remaining).
    // TTL зависит от выбора заказчика (1–7 дней), дефолт — 2 дня (типичное наблюдение).
    enrichTtlHours: Number(process.env.KWORK_ENRICH_TTL_HOURS ?? "48"),
  },

  /** FL.ru */
  fl: {
    enabled: process.env.FL_ENABLED === "true",
    /** Генерировать AI-питч? false = только скоринг, отклик пишем вручную */
    generatePitch: process.env.FL_GENERATE_PITCH === "true",
    /**
     * Брать только проекты с бесплатным откликом.
     * По умолчанию true — кликаем фильтр «Не требуется оплата отклика»
     * перед парсингом, чтобы не тратить кворки/деньги на платные отклики.
     * Поставь `FL_ONLY_FREE_RESPONSES=false` если нужны все проекты.
     */
    onlyFreeResponses: process.env.FL_ONLY_FREE_RESPONSES !== "false",
    url: process.env.FL_SEARCH_URL ?? "https://www.fl.ru/projects/",
    /** Сколько страниц парсить (GitHub Actions: не больше 5 чтобы не тратить минуты) */
    maxPages: Number(process.env.FL_MAX_PAGES ?? "5"),
    /** Задержка между страницами: [min, max] мс */
    fetchDelay: [1_000, 1_800] as [number, number],
    /**
     * Стоп-слова FL.ru — заказы содержащие их исключаются до AI.
     * Дополняют общий filter.stopWords.
     */
    hardExclude: [
      "дизайн",
      "иллюстрац",
      "рисунок",
      "рисовать",
      "wordpress",
      "bitrix",
      "битрикс",
      "1с",
      "1c-предприятие",
      "flash",
      "unity",
      "gamedev",
      "игровой движок",
      "автокад",
      "autocad",
      "3d-модел",
      "3d модел",
      "курсовая",
      "реферат",
      "диплом",
      "перевод текст",
      "копирайт",
      "рерайт",
      "seo-текст",
    ],
    /**
     * Веса навыков для предварительного скоринга (до AI).
     * Чем выше — тем важнее для отбора.
     * Заказы с суммарным весом = 0 пропускаются без AI.
     */
    skillsWeight: {
      TypeScript: 5,
      React: 5,
      "Next.js": 5,
      "Node.js": 5,
      NestJS: 4,
      Fastify: 3,
      "Vue.js": 3,
      "Nuxt.js": 3,
      "React Native": 4,
      Expo: 3,
      PostgreSQL: 3,
      Prisma: 3,
      Redis: 2,
      WebSocket: 2,
      "REST API": 2,
      Docker: 2,
      "TanStack Query": 2,
      Zustand: 2,
      OpenAI: 3,
      Anthropic: 3,
      LLM: 3,
      "GitHub Actions": 1,
      Telegram: 2,
      бот: 1,
      парсинг: 1,
    } as Record<string, number>,
    /**
     * User-Agent пул для ротации.
     * Добавляйте новые UA по мере старения.
     */
    userAgents: [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    ] as string[],
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

  /** HH.ru — вакансии */
  hh: {
    enabled: process.env.HH_ENABLED === "true",
    url:
      process.env.HH_SEARCH_URL ??
      "https://hh.ru/search/vacancy?employment=project&schedule=remote&text=TypeScript+OR+React+OR+Node.js+OR+Next.js+OR+разработчик&order_by=publication_time",
    maxPages: Number(process.env.HH_MAX_PAGES || "3"),
    minKeywordScore: Number(process.env.HH_MIN_KEYWORD_SCORE || "10"),
  },

  /** GitHub профиль — источник динамического ProfileSnapshot (Блок 2).
   *  Префикс `GH_` (не `GITHUB_`) — GitHub блокирует пользовательские vars/secrets с GITHUB_*. */
  github: {
    login: process.env.GH_PROFILE_LOGIN ?? "",
    token: process.env.GH_PROFILE_TOKEN || undefined,
    snapshotMaxAgeHours: Number(process.env.GH_PROFILE_MAX_AGE_HOURS ?? "24"),
  },

  /** Profile snapshots: FL.ru / Kwork / Freelance.ru (Блок 2 расширение).
   *  HH-резюме заливается вручную через dashboard `/profile` (Cloudflare Lux SPA
   *  не поддаётся автопарсингу). Все URL'ы опциональны — если пустой, парсер пропускается. */
  profile: {
    flUrl: process.env.FL_PROFILE_URL ?? "",
    kworkUrl: process.env.KWORK_PROFILE_URL ?? "",
    freelanceruUrl: process.env.FREELANCERU_PROFILE_URL ?? "",
    snapshotMaxAgeHours: Number(process.env.PROFILE_SNAPSHOT_MAX_AGE_HOURS ?? "24"),
  },

};

/** Валидация конфига при старте */
export function validateConfig(): void {
  const missing: string[] = [];
  if (!config.openrouter.apiKey) missing.push("OPENROUTER_API_KEY");
  if (!config.telegram.botToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.telegram.chatId) missing.push("TELEGRAM_CHAT_ID");

  if (missing.length > 0) {
    throw new Error(
      `Отсутствуют переменные окружения: ${missing.join(", ")}\n` +
        "Скопируй .env.example в .env и заполни значения.",
    );
  }
}
