'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function updateStatus(id: string, status: 'applied' | 'skipped' | 'new') {
  await supabase.from('orders').update({ status }).eq('id', id);
  revalidatePath('/');
}
