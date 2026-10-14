-- «Reklama samarasi» · «Formalar · Facebook» (2026-10-14): which lead form
-- each lead-form ad sends people to, read once off the ad's creative. A form
-- on a page the token is not assigned to cannot be listed and has no lead to
-- read, so without this its ads' money stood under «Forma aniqlanmagan».
-- `formId` is '' for an ad whose creative names no form (read, nothing to
-- map — so it is not asked again).
--
-- A new table: nothing existing is locked or rewritten.

-- CreateTable
CREATE TABLE "meta_ad_form" (
    "adId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL DEFAULT '',
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ad_form_pkey" PRIMARY KEY ("adId")
);

-- CreateIndex
CREATE INDEX "meta_ad_form_formId_idx" ON "meta_ad_form"("formId");
