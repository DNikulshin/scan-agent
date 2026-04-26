export interface KeywordGroup {
  label: string;
  weight: number;
  keywords: string[];
}

export interface KeywordScoringConfig {
  core: KeywordGroup;
  related: KeywordGroup;
  nice: KeywordGroup;
  levelPenalty: KeywordGroup;
  seniorPenalty: KeywordGroup;
  hardExclude: string[];
}

export interface KeywordScoreResult {
  rawScore: number;
  displayScore: number;
  matches: string[];
  excluded: boolean;
}

export function calcKeywordScore(
  title: string,
  desc: string,
  cfg: KeywordScoringConfig,
): KeywordScoreResult {
  const text = `${title} ${desc}`.toLowerCase();

  const excludeMatch = cfg.hardExclude.find(kw => text.includes(kw));
  if (excludeMatch) {
    return { rawScore: -999, displayScore: 0, matches: [`hardExclude: ${excludeMatch}`], excluded: true };
  }

  let rawScore = 0;
  const matches: string[] = [];

  const groups = [cfg.core, cfg.related, cfg.nice, cfg.levelPenalty, cfg.seniorPenalty];

  for (const group of groups) {
    for (const kw of group.keywords) {
      if (text.includes(kw)) {
        rawScore += group.weight;
        const sign = group.weight > 0 ? '+' : '';
        matches.push(`${group.label}: ${kw.trim()} (${sign}${group.weight})`);
      }
    }
  }

  // 10 pts (1 core kw) → ~2-3, 20 pts → ~5, 28 pts → ~7, 40+ → 10
  const displayScore = Math.min(10, Math.max(0, Math.round(rawScore / 4)));

  return { rawScore, displayScore, matches, excluded: false };
}

export const FULLSTACK_SCORING: KeywordScoringConfig = {
  core: {
    label: 'Core',
    weight: 10,
    keywords: [
      'typescript', ' ts ', ' ts,', ' ts/', 'react', 'next.js', 'nextjs', 'next js',
      'node.js', 'nodejs', 'node js', 'nestjs', 'nest.js', 'fastify', 'express',
      'fullstack', 'full-stack', 'full stack',
    ],
  },
  related: {
    label: 'Related',
    weight: 5,
    keywords: [
      'prisma', 'postgresql', 'postgres', 'docker', 'ci/cd', 'github actions',
      'redis', 'websocket', 'tanstack', 'react query', 'vitest', 'jest',
      'pwa', 'expo', 'react native', 'server actions', 'app router',
    ],
  },
  nice: {
    label: 'Nice',
    weight: 2,
    keywords: [
      'caddy', 'nginx', 'cloudflare', 'monorepo', 'turborepo',
      'zod', 'trpc', 'graphql', 'tailwind', 'shadcn', 'middle', 'middle+',
    ],
  },
  levelPenalty: {
    label: 'Junior',
    weight: -3,
    keywords: ['junior', 'стажёр', 'стажер', 'стажировка', 'практикант', 'без опыта'],
  },
  seniorPenalty: {
    label: 'Senior',
    weight: -1,
    keywords: ['senior', 'lead ', 'team lead', 'tech lead', 'архитектор'],
  },
  hardExclude: [
    '1с', '1c', 'битрикс', 'bitrix', 'abap', 'sap ', 'цфт', 'dwh ',
    'wordpress', 'tilda', 'joomla', 'drupal', 'modx',
    'php', 'php-', ' php ',
    'java-', 'java ', 'kotlin', 'swift', 'flutter',
    'golang', 'go-разработчик', 'go разработчик',
    'ruby', 'c#', '.net', 'dotnet', 'delphi', 'pascal', 'lua', 'elixir', 'erlang',
    'stm32', 'схемотехник', 'электроник', 'микроконтроллер',
    'химик', 'прораб', 'сметчик', 'геодезист',
    'unity', 'unreal', 'gamedev',
    ' qa ', 'qa-', 'sdet', 'тестировщик нейросет',
  ],
};

export const DEVOPS_SCORING: KeywordScoringConfig = {
  core: {
    label: 'Core',
    weight: 10,
    keywords: [
      'powershell', 'active directory', 'linux', 'docker', 'kubernetes',
      'devops', 'sysadmin', 'системный администратор', 'инфраструктур',
    ],
  },
  related: {
    label: 'Related',
    weight: 5,
    keywords: [
      'zabbix', 'grafana', 'prometheus', 'ansible', 'terraform',
      'gitlab ci', 'github actions', 'nginx', 'postgresql', 'redis',
    ],
  },
  nice: {
    label: 'Nice',
    weight: 2,
    keywords: [
      'vault', 'consul', 'elk', 'loki', 'helm', 'argocd',
      'windows server', 'hyper-v', 'vmware',
    ],
  },
  levelPenalty: {
    label: 'Junior',
    weight: -3,
    keywords: ['junior', 'стажёр', 'стажер', 'без опыта'],
  },
  seniorPenalty: {
    label: 'Senior',
    weight: -1,
    keywords: ['senior', 'lead ', 'team lead', 'tech lead', 'архитектор'],
  },
  hardExclude: [
    '1с', '1c', 'битрикс', 'react', 'angular', 'vue',
    'php', 'java ', 'python-разработчик',
    'gamedev', 'unity', 'химик', 'прораб',
  ],
};
