// GET /api/health/notifications — счётчики по статусам за 24ч + последние failed.
// Защита через Bearer DASHBOARD_API_KEY (как остальные admin-эндпоинты).

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

function checkAuth(req: NextRequest): boolean {
  const key = process.env.DASHBOARD_API_KEY;
  if (!key) return false;
  return req.headers.get("authorization") === `Bearer ${key}`;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [byStatus, lastFailed, oldestPending] = await Promise.all([
    prisma.notificationJob.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.notificationJob.findMany({
      where: { status: "failed" },
      orderBy: { doneAt: "desc" },
      take: 10,
      select: {
        id: true,
        channel: true,
        orderId: true,
        attempts: true,
        lastError: true,
        doneAt: true,
        createdAt: true,
      },
    }),
    prisma.notificationJob.findFirst({
      where: { status: "pending" },
      orderBy: { nextAttemptAt: "asc" },
      select: { id: true, nextAttemptAt: true, attempts: true, channel: true },
    }),
  ]);

  const counts = byStatus.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  return NextResponse.json({
    window: "24h",
    counts,
    oldest_pending: oldestPending,
    last_failed: lastFailed,
  });
}
