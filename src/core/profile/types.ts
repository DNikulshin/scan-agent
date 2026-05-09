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
  /** Источник: 'manual' для ручной заливки через /profile, либо URL hh.ru/resume/<hash> у legacy-снимков. */
  url: string;
  /** Сырой текст резюме, скопированный пользователем в textarea. Основной источник для новых снимков. */
  rawText?: string;
  /** Имя/титул резюме (legacy, для авто-парсинга). */
  title?: string;
  /** Город / регион (legacy). */
  area?: string;
  /** Желаемая зарплата (legacy). */
  salary?: string;
  /** Хронология опыта (legacy, у ручных снимков пустой). */
  experience?: HhExperienceItem[];
  /** Ключевые навыки (legacy). */
  skills?: string[];
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

export interface KworkProfilePayload {
  url: string;
  rating: number;
  reviewsCount: number;
  /** `userProfileName` из window.stateData. */
  displayName?: string;
  /** `userProfileProfession` — короткая строка-профессия. */
  profession?: string;
  /** `userProfileDescription`, очищенный от HTML, обрезанный до 1000 символов. */
  description?: string;
  /** Имена навыков из `userSkills[].name`. */
  skills: string[];
  /** Бейджи продавца (имена/тайтлы из `userProfileBadges`). */
  badges: string[];
  /** «Был онлайн …» как написано на странице (`lastOnlineAsString`). */
  lastOnline?: string;
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
