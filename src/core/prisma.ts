import { PrismaClient } from "@prisma/client";

// Один общий клиент на процесс агента — переиспользуется в Storage и
// notifications, чтобы enqueue + markProcessed могли быть в одной транзакции.
export const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});
