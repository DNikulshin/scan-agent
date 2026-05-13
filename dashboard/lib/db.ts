import { PrismaClient, type Order as PrismaOrder } from '@prisma/client';

// Singleton — важно для Next.js hot-reload в dev
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export type OrderStatus = 'new' | 'applied' | 'skipped';
export type OrderOutcome = 'pending' | 'won' | 'lost';

// Форма заказа в JSON-ответах API (snake_case — для совместимости с фронтом).
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
  pitch_b: string;
  tags: string;
  employer: string | null;
  city: string | null;
  status: OrderStatus;
  outcome: OrderOutcome;
  applied_at: string | null;
  created_at: string;
  processed_at: string;
  reminded_at: string | null;
  published_at: string | null;
  blacklisted: boolean;
}

export function serializeOrder(o: PrismaOrder): Order {
  return {
    id: o.id,
    order_id: o.orderId,
    source: o.source,
    title: o.title,
    description: o.description,
    price: o.price,
    link: o.link,
    offers_count: o.offersCount,
    score: o.score,
    reason: o.reason,
    hook: o.hook,
    pitch: o.pitch,
    pitch_b: o.pitchB,
    tags: o.tags,
    employer: o.employer,
    city: o.city,
    status: o.status as OrderStatus,
    outcome: o.outcome as OrderOutcome,
    applied_at: o.appliedAt ? o.appliedAt.toISOString() : null,
    created_at: o.createdAt.toISOString(),
    processed_at: o.processedAt.toISOString(),
    reminded_at: o.remindedAt ? o.remindedAt.toISOString() : null,
    published_at: o.publishedAt ? o.publishedAt.toISOString() : null,
    blacklisted: o.blacklisted,
  };
}
