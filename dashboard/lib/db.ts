import { Pool } from 'pg';

// Синглтон пула — важно для Next.js hot-reload в dev
const globalForPg = globalThis as unknown as { pgPool: Pool };

export const db = globalForPg.pgPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
});

if (process.env.NODE_ENV !== 'production') {
  globalForPg.pgPool = db;
}

export type OrderStatus = 'new' | 'applied' | 'skipped';

export interface Order {
  id: string;
  order_id: string;
  source: string;
  title: string;
  description: string;
  price: string;
  link: string;
  offers_count: number;
  score: number;
  reason: string;
  hook: string;
  pitch: string;
  tags: string;
  employer: string | null;
  city: string | null;
  status: OrderStatus;
  applied_at: string | null;
  outcome: 'pending' | 'won' | 'lost';
  created_at: string;
}
