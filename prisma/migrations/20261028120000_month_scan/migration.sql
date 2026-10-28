-- «Kunlar boʻyicha» and Roistat's closed months computed by the sync worker
-- (2026-10-28): one row per stored month question. One new table; nothing
-- existing is locked or rewritten. Until the worker's first pass fills it,
-- the screens read every month live, as before.

-- CreateTable
CREATE TABLE "month_scan" (
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL,
    "ms" INTEGER NOT NULL,

    CONSTRAINT "month_scan_pkey" PRIMARY KEY ("key")
);
