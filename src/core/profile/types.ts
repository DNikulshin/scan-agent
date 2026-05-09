// Типы payload-ов для ProfileSnapshot (источники, отличные от GitHub).
// Каждый payload — это сериализуемый JSON, который пишется в `profile_snapshots.payload`.

export interface HhExperienceItem {
  /** Период работы, как написано в резюме («Январь 2022 — настоящее время»). */
  period: string;
  /** Название компании. */
  company: string;
  /** Должность. */
  position: string;
  /** Краткое описание (1–2 строки), может быть пустым. */
  summary: string;
}

export interface HhResumePayload {
  url: string;
  /** Имя/титул резюме («Fullstack-разработчик»). */
  title: string;
  /** Город / регион — может быть пустой. */
  area: string;
  /** Желаемая зарплата как написано в резюме. */
  salary: string;
  /** Хронология опыта: новые сверху. */
  experience: HhExperienceItem[];
  /** Список ключевых навыков из блока «Ключевые навыки». */
  skills: string[];
}

export interface FlPortfolioItem {
  title: string;
  /** Может быть пустым — берём из текста, если нет описания. */
  description: string;
  /** Внешняя ссылка на проект внутри FL.ru. */
  link: string;
}

export interface FlProfilePayload {
  url: string;
  /** Численный рейтинг (0..N) — может быть 0, если не отображается. */
  rating: number;
  /** Количество отзывов. */
  reviewsCount: number;
  /** Специализации/категории, под которыми зарегистрирован профиль. */
  specializations: string[];
  /** Превью портфолио (топ-N работ). */
  portfolio: FlPortfolioItem[];
}

export interface KworkGigItem {
  title: string;
  /** Цена «от XXX ₽». */
  price: string;
  /** Кол-во отзывов на этот gig. */
  reviewsCount: number;
  link: string;
}

export interface KworkProfilePayload {
  url: string;
  rating: number;
  reviewsCount: number;
  /** Список услуг продавца. */
  gigs: KworkGigItem[];
}

export interface FreelanceruServiceItem {
  title: string;
  description: string;
}

export interface FreelanceruProfilePayload {
  url: string;
  rating: number;
  /** Названия категорий/услуг. */
  services: FreelanceruServiceItem[];
}

export type ProfileSourceKey = 'github' | 'fl' | 'kwork' | 'hh' | 'freelanceru';

export interface ProfileSnapshotInput {
  source: ProfileSourceKey;
  payload:
    | HhResumePayload
    | FlProfilePayload
    | KworkProfilePayload
    | FreelanceruProfilePayload;
  rawJson?: unknown;
}
