-- «Reklama samarasi» · «Formalar» (2026-10-13): every Meta lead form the
-- token's pages list, as Facebook shows it — page, name, status, creation
-- time, all-time lead count. `meta_lead` only knows forms a lead was read
-- from; a quiet form had no row anywhere.
--
-- A new table: nothing existing is locked or rewritten.

-- CreateTable
CREATE TABLE "meta_lead_form" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdTime" TIMESTAMP(3),
    "leadsCount" INTEGER,
    "listedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_lead_form_pkey" PRIMARY KEY ("id")
);
