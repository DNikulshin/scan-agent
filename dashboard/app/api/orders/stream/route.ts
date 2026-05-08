// SSE-канал для real-time обновлений списка заказов.
//
// LISTEN/NOTIFY требует постоянной сессии Postgres, поэтому Prisma не подходит
// (idle-коннекты возвращаются в pgBouncer/Accelerate-пул и теряют подписку).
// Используем прямой pg.Client с не-pooled URL: DATABASE_URL_DIRECT с fallback
// на DATABASE_URL.
//
// Поток: каждое INSERT в orders дёргает trigger orders_notify_new →
// pg_notify('order_new', NEW.id) → клиент получает event и инвалидирует
// TanStack Query.
//
// Heartbeat в 25с защищает от idle-таймаутов nginx/Caddy и keepalive
// между промежуточными прокси.

import { Client } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  const databaseUrl =
    process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    return new Response("DATABASE_URL not configured", { status: 500 });
  }

  const encoder = new TextEncoder();
  const client = new Client({ connectionString: databaseUrl });

  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // controller already closed — ignore
        }
      };

      const sendEvent = (event: string, data: string) =>
        enqueue(`event: ${event}\ndata: ${data}\n\n`);

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        try {
          await client.end();
        } catch {
          // already disconnected
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      client.on("notification", (msg) => {
        if (msg.channel === "order_new") {
          sendEvent("order_new", msg.payload ?? "");
        }
      });

      client.on("error", (err) => {
        console.error("[sse] pg client error:", err);
        void cleanup();
      });

      try {
        await client.connect();
        await client.query("LISTEN order_new");
      } catch (err) {
        console.error("[sse] LISTEN setup failed:", err);
        controller.error(err);
        await cleanup();
        return;
      }

      sendEvent("ready", JSON.stringify({ ts: Date.now() }));

      heartbeat = setInterval(() => {
        // SSE-комментарий — не доходит до onmessage, но держит соединение.
        enqueue(`: heartbeat ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);

      req.signal.addEventListener("abort", () => {
        void cleanup();
      });
    },
    async cancel() {
      closed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      try {
        await client.end();
      } catch {
        // ignore
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Отключает буферизацию в nginx/Caddy reverse-proxy.
      "X-Accel-Buffering": "no",
    },
  });
}
