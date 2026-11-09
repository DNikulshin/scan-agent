import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Один общий клиент на процесс агента — переиспользуется в Storage и
// notifications, чтобы enqueue + markProcessed могли быть в одной транзакции.
// Prisma 7: соединение задаётся драйвер-адаптером, а не datasourceUrl.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter });
