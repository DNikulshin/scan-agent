-- CreateTable
CREATE TABLE "profile_snapshots" (
    "id" UUID NOT NULL,
    "github_login" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "languages_agg" JSONB NOT NULL DEFAULT '{}',
    "repos" JSONB NOT NULL DEFAULT '[]',
    "raw_json" JSONB,

    CONSTRAINT "profile_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_snapshots_fetched_at_idx" ON "profile_snapshots"("fetched_at" DESC);
