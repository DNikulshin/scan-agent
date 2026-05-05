'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';

export async function updateStatus(id: string, status: 'applied' | 'skipped' | 'new') {
  const appliedAt = status === 'applied' ? new Date() : null;
  await prisma.order.update({
    where: { id },
    data: { status, appliedAt },
  });
  revalidatePath('/');
}
