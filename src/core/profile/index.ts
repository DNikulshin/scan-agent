import { ProfileSource } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../../utils/logger';
import { fetchHhResume } from './hh';
import { fetchFlProfile } from './fl';
import { fetchKworkProfile } from './kwork';
import { fetchFreelanceruProfile } from './freelanceru';
import type { ProfileSnapshotInput, ProfileSourceKey } from './types';

export interface RefreshProfilesOpts {
  flUrl: string;
  kworkUrl: string;
  hhUrl: string;
  freelanceruUrl: string;
  /** Не перепарсивать снимок, если он моложе этого возраста. */
  maxAgeHours: number;
}

interface SourceJob {
  source: Exclude<ProfileSourceKey, 'github'>;
  url: string;
  fetch: () => Promise<ProfileSnapshotInput['payload']>;
}

async function isSnapshotFresh(
  source: ProfileSource,
  maxAgeMs: number,
): Promise<boolean> {
  const last = await prisma.profileSnapshot.findFirst({
    where: { source },
    orderBy: { fetchedAt: 'desc' },
    select: { fetchedAt: true },
  });
  if (!last) return false;
  return Date.now() - last.fetchedAt.getTime() < maxAgeMs;
}

async function saveSnapshot(input: ProfileSnapshotInput): Promise<void> {
  await prisma.profileSnapshot.create({
    data: {
      source: input.source as ProfileSource,
      payload: input.payload as object,
      // legacy GitHub-поля оставляем дефолтами
    },
  });
}

/**
 * Обходит все доступные источники профиля (FL/Kwork/HH/Freelance.ru) и сохраняет
 * новый ProfileSnapshot, если последний свежий снимок старше maxAgeHours
 * либо отсутствует. Источник пропускается если URL пустой.
 *
 * GitHub-снимок в этом фасаде НЕ обновляется — он живёт отдельно
 * через `refreshProfileIfStale` в profile-context.ts (исторический трек Блока 2).
 *
 * Ошибка одного источника не валит остальные (Promise.allSettled).
 */
export async function refreshAllProfiles(opts: RefreshProfilesOpts): Promise<void> {
  const maxAgeMs = opts.maxAgeHours * 3600_000;

  const jobs: SourceJob[] = [];
  if (opts.hhUrl) jobs.push({ source: 'hh', url: opts.hhUrl, fetch: () => fetchHhResume(opts.hhUrl) });
  if (opts.flUrl) jobs.push({ source: 'fl', url: opts.flUrl, fetch: () => fetchFlProfile(opts.flUrl) });
  if (opts.kworkUrl)
    jobs.push({ source: 'kwork', url: opts.kworkUrl, fetch: () => fetchKworkProfile(opts.kworkUrl) });
  if (opts.freelanceruUrl)
    jobs.push({
      source: 'freelanceru',
      url: opts.freelanceruUrl,
      fetch: () => fetchFreelanceruProfile(opts.freelanceruUrl),
    });

  if (jobs.length === 0) {
    logger.debug('[profile/refresh] все URL пустые — пропускаем');
    return;
  }

  await Promise.allSettled(
    jobs.map(async (job) => {
      try {
        if (await isSnapshotFresh(job.source as ProfileSource, maxAgeMs)) {
          logger.debug({ source: job.source }, '[profile/refresh] свежий снимок есть — пропускаем');
          return;
        }
        const payload = await job.fetch();
        await saveSnapshot({ source: job.source, payload });
        logger.info({ source: job.source }, '[profile/refresh] снимок обновлён');
      } catch (err) {
        logger.error({ err, source: job.source, url: job.url }, '[profile/refresh] упал — fallback на старый снимок');
      }
    }),
  );
}

export { cleanupProfileSnapshots } from './housekeeping';
export type { ProfileSnapshotInput, ProfileSourceKey } from './types';
export type {
  HhResumePayload,
  HhExperienceItem,
  FlProfilePayload,
  FlPortfolioItem,
  KworkProfilePayload,
  KworkGigItem,
  FreelanceruProfilePayload,
  FreelanceruServiceItem,
} from './types';
export { summarizeHhExperience } from './hh';
