-- «Безквал» computed by the sync worker (2026-10-24): one row per client per
-- day, and when each day was computed. Two new tables — nothing existing is
-- locked or rewritten. The worker fills them from 2026-09-01 on its first
-- passes; until a day is computed the screens print it as not yet counted.

-- CreateTable
CREATE TABLE "bezkval_client" (
    "day" DATE NOT NULL,
    "key" TEXT NOT NULL,
    "rop" TEXT,
    "kind" TEXT NOT NULL,
    "phone" TEXT,
    "hour" INTEGER NOT NULL,
    "source" TEXT,
    "new30" BOOLEAN NOT NULL,
    "newEver" BOOLEAN NOT NULL,
    "multiRop" BOOLEAN NOT NULL,
    "previous" JSONB,
    "deals" JSONB NOT NULL,
    "dealCount" INTEGER NOT NULL,

    CONSTRAINT "bezkval_client_pkey" PRIMARY KEY ("day","key")
);

-- CreateTable
CREATE TABLE "bezkval_day" (
    "day" DATE NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "deals" INTEGER NOT NULL,
    "clients" INTEGER NOT NULL,

    CONSTRAINT "bezkval_day_pkey" PRIMARY KEY ("day")
);
