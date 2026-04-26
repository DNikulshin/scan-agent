// ── Общие типы проекта ──

/** Сырой заказ, как он приходит от парсера */
export interface Order {
  id: string;
  title: string;
  desc: string;
  price: string;
  link: string;
  offersCount: number;
  source: 'kwork' | 'fl' | 'freelanceru' | 'habr' | 'hh';
  /** HH-специфичные поля для отображения в Telegram */
  meta?: {
    employer?: string;
    city?: string;
  };
}

/** Результат AI-скоринга */
export interface ScoreResult {
  score: number;   // 0–10
  reason: string;  // почему такая оценка
}

/** Результат генерации pitch */
export interface PitchResult {
  hook: string;    // первая цепляющая фраза
  pitch: string;   // полный отклик
}

/** Заказ, прошедший полный анализ */
export interface ScoredOrder {
  order: Order;
  score: ScoreResult;
  pitch: PitchResult;
  pitchB?: PitchResult | null;
  tags?: string[];
}

/** Интерфейс парсера — каждая новая биржа реализует его */
export interface Parser {
  name: string;
  fetchOrders(): Promise<Order[]>;
}

/** Интерфейс уведомителя */
export interface Notifier {
  name: string;
  send(scored: ScoredOrder): Promise<void>;
}
