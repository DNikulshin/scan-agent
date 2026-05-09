-- CreateEnum
CREATE TYPE "profile_source" AS ENUM ('github', 'fl', 'kwork', 'hh', 'freelanceru');

-- AlterTable
ALTER TABLE "profile_snapshots"
    ADD COLUMN "source" "profile_source" NOT NULL DEFAULT 'github',
    ADD COLUMN "payload" JSONB NOT NULL DEFAULT '{}',
    ALTER COLUMN "github_login" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "profile_snapshots_source_fetched_at_idx" ON "profile_snapshots"("source", "fetched_at" DESC);
