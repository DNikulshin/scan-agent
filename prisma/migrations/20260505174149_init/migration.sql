-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "price" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "offers_count" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT '',
    "hook" TEXT NOT NULL DEFAULT '',
    "pitch" TEXT NOT NULL DEFAULT '',
    "pitch_b" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '',
    "employer" TEXT,
    "city" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reminded_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_metrics" (
    "id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "parsed_total" INTEGER NOT NULL DEFAULT 0,
    "parsed_by_source" JSONB NOT NULL DEFAULT '{}',
    "filtered" INTEGER NOT NULL DEFAULT 0,
    "low_score_ai" INTEGER NOT NULL DEFAULT 0,
    "low_score_keyword" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '{}',
    "scoring_calls" INTEGER NOT NULL DEFAULT 0,
    "pitch_calls" INTEGER NOT NULL DEFAULT 0,
    "ai_tokens_in" INTEGER NOT NULL DEFAULT 0,
    "ai_tokens_out" INTEGER NOT NULL DEFAULT 0,
    "ai_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "parser_durations" JSONB NOT NULL DEFAULT '{}',
    "score_histogram" JSONB NOT NULL DEFAULT '{}',
    "run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_score_idx" ON "orders"("score" DESC);

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_source_idx" ON "orders"("source");

-- CreateIndex
CREATE INDEX "orders_processed_at_idx" ON "orders"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_id_source_key" ON "orders"("order_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "run_metrics_started_at_idx" ON "run_metrics"("started_at");
