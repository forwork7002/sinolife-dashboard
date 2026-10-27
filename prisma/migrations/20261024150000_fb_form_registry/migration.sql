-- «Reklama samarasi» · «Formalar · Facebook» (2026-10-24, the client: every
-- Facebook form — 70+ of them — listed live, so they can see which ones reach
-- Bitrix24). Bitrix24's own Facebook connection lists every form on every page
-- it manages and names the Facebook form each CRM form is linked to; the Meta
-- token reads only the pages it is assigned to.
--
-- Additive only: four new tables, and one NULLABLE column with an index on
-- `crm_form_fill`. Nothing existing is rewritten; the new column is filled by
-- the sync worker (new fills at once, older ones by a separate id walk).

-- The worker writes `crm_form_fill` every five minutes: a busy table fails the
-- deploy instead of queueing the sync behind it.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "crm_form_fill" ADD COLUMN "crmFormId" TEXT;

-- CreateIndex
CREATE INDEX "crm_form_fill_crmFormId_filledAt_idx" ON "crm_form_fill"("crmFormId", "filledAt");

-- CreateTable
CREATE TABLE "crm_web_form" (
    "externalSource" "ExternalSource" NOT NULL DEFAULT 'BITRIX24',
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "listedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_web_form_pkey" PRIMARY KEY ("externalSource","externalId")
);

-- CreateTable
CREATE TABLE "crm_web_form_facebook" (
    "externalSource" "ExternalSource" NOT NULL DEFAULT 'BITRIX24',
    "crmFormId" TEXT NOT NULL,
    "fbFormId" TEXT NOT NULL,
    "fbFormName" TEXT NOT NULL DEFAULT '',
    "fbPageId" TEXT NOT NULL DEFAULT '',
    "fbPageName" TEXT NOT NULL DEFAULT '',
    "linkedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_web_form_facebook_pkey" PRIMARY KEY ("externalSource","crmFormId","fbFormId")
);

-- CreateIndex
CREATE INDEX "crm_web_form_facebook_fbFormId_idx" ON "crm_web_form_facebook"("fbFormId");

-- CreateTable
CREATE TABLE "fb_lead_form" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT NOT NULL DEFAULT '',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "listedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fb_lead_form_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fb_lead_form_pageId_idx" ON "fb_lead_form"("pageId");

-- CreateTable
CREATE TABLE "fb_page" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listedAt" TIMESTAMP(3) NOT NULL,
    "formsReadAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "fb_page_pkey" PRIMARY KEY ("id")
);

RESET lock_timeout;
