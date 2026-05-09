import { ProfileSource } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../../utils/logger';

const KEEP_PER_SOURCE = 30;
const MAX_AGE_DAYS = 90;

const SOURCES: ProfileSource[] = [
  ProfileSource.github,
  ProfileSource.fl,
  ProfileSource.kwork,
  ProfileSource.hh,
  ProfileSource.freelanceru,
];

/**
 * Чистит таблицу `profile_snapshots`:
 * 1. Удаляет всё старше 90 дней (любой source).
 * 2. Per source — оставляет только последние 30 снимков.
 *
 * Best-effort: при ошибке логируется и pipeline продолжает.
 */
export async function cleanupProfileSnapshots(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 3600_000);
    const ageDel = await prisma.profileSnapshot.deleteMany({
      where: { fetchedAt: { lt: cutoff } },
    });

    let perSourceDel = 0;
    for (const source of SOURCES) {
      const stale = await prisma.profileSnapshot.findMany({
        where: { source },
        orderBy: { fetchedAt: 'desc' },
        skip: KEEP_PER_SOURCE,
        select: { id: true },
      });
      if (stale.length > 0) {
        const r = await prisma.profileSnapshot.deleteMany({
          where: { id: { in: stale.map((s) => s.id) } },
        });
        perSourceDel += r.count;
      }
    }

    if (ageDel.count > 0 || perSourceDel > 0) {
      logger.info(
        { byAge: ageDel.count, byCount: perSourceDel },
        '[profile/housekeeping] cleanup выполнен',
      );
    }
  } catch (err) {
    logger.warn({ err }, '[profile/housekeeping] ошибка cleanup — пропускаем');
  }
}
