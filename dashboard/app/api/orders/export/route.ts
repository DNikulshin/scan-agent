// GET /api/orders/export — выгрузка текущего отфильтрованного списка заказов в .md.
// Те же query-параметры, что у GET /api/orders (status/source/minScore) + tag.
// Без auth (за Authelia).

import { NextRequest, NextResponse } from 'next/server';
import { Prisma, type Order as PrismaOrder } from '@prisma/client';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  new: 'Новый',
  applied: 'Откликнулся',
  skipped: 'Пропущен',
};

const STATUS_HEADING: Record<string, string> = {
  new: '🆕 Новые',
  applied: '✅ Откликнулся',
  skipped: '⏭ Пропущены',
};

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

function host(link: string): string {
  if (!link) return '—';
  try {
    return new URL(link).host;
  } catch {
    return '—';
  }
}

function escapeBrackets(s: string): string {
  // не ломаем markdown-заголовок ### — убираем переносы и обрезаем
  return s.replace(/\s+/g, ' ').trim();
}

function renderOrder(o: PrismaOrder): string {
  const title = escapeBrackets(o.title) || '(без заголовка)';
  const link = o.link || '';
  const linkText = link ? `[${host(link)}](${link})` : '—';
  const price = o.price?.trim() || 'не указана';
  const dateLabel = o.publishedAt ? 'Опубликован' : 'Дата';
  const dateValue = dateFmt.format(o.publishedAt ?? o.createdAt);
  const statusRu = STATUS_LABEL[o.status] ?? o.status;

  return [
    `### ${title}`,
    `- **Ссылка:** ${linkText}`,
    `- **Источник:** ${o.source}`,
    `- **Зарплата:** ${price}`,
    `- **${dateLabel}:** ${dateValue}`,
    `- **Рейтинг совпадения:** ${o.score}/10`,
    `- **Статус:** ${statusRu}`,
    '',
  ].join('\n');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const source = searchParams.get('source');
  const minScore = searchParams.get('minScore');
  const tag = searchParams.get('tag');

  const where: Prisma.OrderWhereInput = {};
  if (status) where.status = status;
  if (source) where.source = source;
  if (minScore) where.score = { gte: Number(minScore) };

  const rowsAll = await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });

  const rows = tag
    ? rowsAll.filter(o => o.tags?.split(',').includes(tag))
    : rowsAll;

  const grouped: Record<string, PrismaOrder[]> = { new: [], applied: [], skipped: [] };
  const other: PrismaOrder[] = [];
  for (const o of rows) {
    if (grouped[o.status]) grouped[o.status].push(o);
    else other.push(o);
  }

  const generatedAt = new Date();
  const dateStr = generatedAt.toISOString().slice(0, 10);

  const filterParts: string[] = [];
  if (status) filterParts.push(`status=${status}`);
  if (source) filterParts.push(`source=${source}`);
  if (minScore) filterParts.push(`minScore=${minScore}`);
  if (tag) filterParts.push(`tag=${tag}`);
  const filterLine = filterParts.length ? `фильтр: ${filterParts.join(', ')} — ` : '';

  const lines: string[] = [];
  lines.push(`# Заказы — ${filterLine}${dateStr}`);
  lines.push(`Всего: ${rows.length}`);
  lines.push('');

  for (const key of ['new', 'applied', 'skipped'] as const) {
    const list = grouped[key];
    if (list.length === 0) continue;
    lines.push(`## ${STATUS_HEADING[key]} (${list.length})`);
    lines.push('');
    for (const o of list) lines.push(renderOrder(o));
  }

  if (other.length > 0) {
    lines.push(`## Прочее (${other.length})`);
    lines.push('');
    for (const o of other) lines.push(renderOrder(o));
  }

  if (rows.length === 0) {
    lines.push('_Нет заказов под фильтр._');
    lines.push('');
  }

  const md = lines.join('\n');
  const filename = `orders-${dateStr}.md`;

  return new NextResponse(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
