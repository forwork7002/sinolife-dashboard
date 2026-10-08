-- «Reklama samarasi» · «Kampaniyalar» (2026-10-08): kval per Meta campaign.
-- A Регистрация deal names its form, not its campaign; Meta's own lead names
-- the campaign and carries the phone the deal is filed under. One row per
-- Meta lead, kept by phone key (last nine digits) — no name, no answers.
--
-- A new table: nothing existing is locked or rewritten.

-- CreateTable
CREATE TABLE "meta_lead" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formName" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL DEFAULT '',
    "adsetId" TEXT NOT NULL DEFAULT '',
    "adId" TEXT NOT NULL DEFAULT '',
    "phoneKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdTime" TIMESTAMP(3) NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meta_lead_createdTime_idx" ON "meta_lead"("createdTime");

-- CreateIndex
CREATE INDEX "meta_lead_formId_createdTime_idx" ON "meta_lead"("formId", "createdTime");
