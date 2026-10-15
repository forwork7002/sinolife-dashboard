-- «Target tahlili» · «Collagen va Zextra» (2026-10-15): every CRM-form fill
-- the portal recorded (`crm.activity`, PROVIDER_ID CRM_WEBFORM), read by the
-- sync worker in id order, so the Bitrix24 side counts a form lead the way
-- Meta does — one per fill, on the day it was filled — and not only the fills
-- that opened a new deal.
--
-- A new table: nothing existing is locked or rewritten.

-- CreateTable
CREATE TABLE "crm_form_fill" (
    "id" TEXT NOT NULL,
    "externalSource" "ExternalSource" NOT NULL DEFAULT 'BITRIX24',
    "externalId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "ownerTypeId" TEXT NOT NULL,
    "ownerExternalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_form_fill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_form_fill_filledAt_idx" ON "crm_form_fill"("filledAt");

-- CreateIndex
CREATE UNIQUE INDEX "crm_form_fill_externalSource_externalId_key" ON "crm_form_fill"("externalSource", "externalId");
