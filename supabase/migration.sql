-- ScanAgent: таблица заказов
-- Выполни этот SQL в Supabase → SQL Editor

CREATE TABLE IF NOT EXISTS orders (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id    TEXT NOT NULL,
  source      TEXT NOT NULL,
  title       TEXT,
  description TEXT,
  price       TEXT,
  link        TEXT,
  offers_count INTEGER DEFAULT 0,
  score       INTEGER DEFAULT 0,
  reason      TEXT,
  hook        TEXT,
  pitch       TEXT,
  status      TEXT DEFAULT 'new', -- new | applied | skipped
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (order_id, source)
);

-- Таблица для push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для быстрой фильтрации в дашборде
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_score      ON orders(score DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_source     ON orders(source);

-- Row Level Security (отключаем — доступ через service_role key в агенте)
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
