import { createClient } from '@supabase/supabase-js';

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
  status: OrderStatus;
  created_at: string;
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
