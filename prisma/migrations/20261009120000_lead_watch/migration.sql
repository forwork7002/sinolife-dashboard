-- «Лид назорати» (2026-10-09): the open-line chats a person has left open,
-- read by the sync worker every two minutes and replaced whole on each pass,
-- and the clock of the watch's two feeds (recent calls, open chats), so the
-- screen can say how old its data is.
--
-- Two new tables: nothing existing is locked or rewritten.

-- CreateTable
CREATE TABLE "open_line_chat" (
    "id" TEXT NOT NULL,
    "externalSource" "ExternalSource" NOT NULL DEFAULT 'BITRIX24',
    "externalId" TEXT NOT NULL,
    "dealExternalId" TEXT NOT NULL,
    "responsibleExternalId" TEXT,
    "subject" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_line_chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_watch_sync" (
    "id" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "state" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_watch_sync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "open_line_chat_externalSource_externalId_key" ON "open_line_chat"("externalSource", "externalId");
