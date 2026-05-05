import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const [orders, settings, subs, metrics] = await Promise.all([
    prisma.order.count(),
    prisma.setting.count(),
    prisma.pushSubscription.count(),
    prisma.runMetric.count(),
  ]);
  console.log({ orders, settings, push_subscriptions: subs, run_metrics: metrics });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
