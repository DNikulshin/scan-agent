'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';

export async function updateStatus(id: string, status: 'applied' | 'skipped' | 'new') {
  const appliedAt = status === 'applied' ? new Date().toISOString() : null;
  await db.query(
    'UPDATE orders SET status = $1, applied_at = $2 WHERE id = $3',
    [status, appliedAt, id],
  );
  revalidatePath('/');
}
