-- «AI registrator → Boshqaruv» (2026-10-30): the owner's control panel over
-- the voice agent — which sellers' extensions it puts callers through to, how
-- many calls it makes at a time — its audit, and the agent's last report.
--
-- Three new tables: nothing existing is locked or rewritten. The one INSERT
-- below fills the NEW config table with the eighteen sellers the owner named
-- on 30.10 14:4x — the agent's live list less 125 and 129 («129 va 125 ni
-- ulamaysan»); 139 and 143 are not in it either. The agent reads this within
-- 20 s of the deploy and applies it, so it must never carry 125 or 129.

-- CreateTable
CREATE TABLE "ai_registrator_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL,
    "sellers" TEXT[],
    "parked" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxCalls" INTEGER NOT NULL,
    "maxNew" INTEGER NOT NULL,
    "maxRetry" INTEGER NOT NULL,
    "saleHandoff" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ai_registrator_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_registrator_config_change" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "savedBy" TEXT NOT NULL,
    "savedById" TEXT,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "changes" JSONB NOT NULL,

    CONSTRAINT "ai_registrator_config_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_registrator_status" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "appliedVersion" INTEGER,
    "applyError" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "ai_registrator_status_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_registrator_config_change_version_key" ON "ai_registrator_config_change"("version");

-- CreateIndex
CREATE INDEX "ai_registrator_config_change_savedAt_idx" ON "ai_registrator_config_change"("savedAt");

-- Prisma's DateTime is a zone-less timestamp read as UTC, so the seed writes
-- UTC explicitly rather than the session's local clock.
-- The starting setting, version 1 — eighteen sellers, 4 at a time, all new, refer.
INSERT INTO "ai_registrator_config" ("id", "version", "sellers", "maxCalls", "maxNew", "maxRetry", "saleHandoff", "updatedAt", "updatedBy")
VALUES (1, 1,
        ARRAY['122','120','128','123','131','127','111','112','108','109','107','114','115','117','134','136','135','141'],
        4, 4, 0, 'refer', (now() AT TIME ZONE 'UTC'), 'boshlangʻich (egasi, 30.10)');

INSERT INTO "ai_registrator_config_change" ("version", "savedAt", "savedBy", "before", "after", "changes")
VALUES (1, (now() AT TIME ZONE 'UTC'), 'boshlangʻich (egasi, 30.10)', NULL,
        '{"sellers":["122","120","128","123","131","127","111","112","108","109","107","114","115","117","134","136","135","141"],"maxCalls":4,"maxNew":4,"parked":[],"maxCalls":4,"maxNew":4,"maxRetry":0,"saleHandoff":"refer"}'::jsonb,
        '[]'::jsonb);
