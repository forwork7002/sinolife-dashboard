-- «Mijoz qaytishi» computed by the sync worker (2026-10-24): one row per
-- stored question — the cohort matrix per brand cut and the База card. One
-- new table; nothing existing is locked or rewritten. Until the worker's
-- first pass fills it, the screen builds live, as before.

-- CreateTable
CREATE TABLE "cohort_snapshot" (
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL,
    "ms" INTEGER NOT NULL,

    CONSTRAINT "cohort_snapshot_pkey" PRIMARY KEY ("key")
);
