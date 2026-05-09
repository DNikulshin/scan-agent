import { fetchKworkProfile } from '../src/core/profile/kwork';
import { fetchFlProfile } from '../src/core/profile/fl';
import { fetchFreelanceruProfile } from '../src/core/profile/freelanceru';

async function main() {
  const FL = process.env.FL_PROFILE_URL || 'https://www.fl.ru/users/dnikulshindev/portfolio/';
  const KWORK = process.env.KWORK_PROFILE_URL || 'https://kwork.ru/user/dnikulshin';
  const FREELANCERU = process.env.FREELANCERU_PROFILE_URL || 'https://freelance.ru/dnikulshin';

  const sources: Array<[string, () => Promise<unknown>]> = [
    ['Kwork', () => fetchKworkProfile(KWORK)],
    ['FL', () => fetchFlProfile(FL)],
    ['Freelance.ru', () => fetchFreelanceruProfile(FREELANCERU)],
  ];

  for (const [name, fn] of sources) {
    console.log(`\n========= ${name} =========`);
    try {
      const t = Date.now();
      const payload = await fn();
      console.log(`OK in ${Date.now() - t}ms`);
      console.log(JSON.stringify(payload, null, 2));
    } catch (err) {
      console.error(`FAIL:`, err instanceof Error ? err.message : err);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
