-- CreateTable
CREATE TABLE "notification_jobs" (
    "id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT,
    "payload" JSONB NOT NULL,
    "order_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMP(3),

    CONSTRAINT "notification_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_jobs_status_next_attempt_at_idx" ON "notification_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_jobs_order_id_idx" ON "notification_jobs"("order_id");

-- pg_notify trigger: при INSERT в orders шлёт NOTIFY 'order_new' с id заказа.
-- Используется dashboard SSE-роутом для real-time обновления открытых вкладок.
CREATE OR REPLACE FUNCTION notify_order_new() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('order_new', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_notify_new ON "orders";
CREATE TRIGGER orders_notify_new AFTER INSERT ON "orders"
FOR EACH ROW EXECUTE FUNCTION notify_order_new();

-- pg_notify trigger для NotificationJob: будит dashboard worker между poll-циклами,
-- если он подписан на канал 'notification_job_new' (опционально, для меньшей задержки).
CREATE OR REPLACE FUNCTION notify_notification_job_new() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM pg_notify('notification_job_new', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notification_jobs_notify_new ON "notification_jobs";
CREATE TRIGGER notification_jobs_notify_new AFTER INSERT ON "notification_jobs"
FOR EACH ROW EXECUTE FUNCTION notify_notification_job_new();
