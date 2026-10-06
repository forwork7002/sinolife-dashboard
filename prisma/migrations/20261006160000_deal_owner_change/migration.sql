-- «Безквал» (2026-10-06, the client: «ропларни номига нечта сделка ўтаяпти»):
-- a deal handed to a ROP stays the ROP's even after it moves on to a seller.
-- The portal returns no history of «Ответственный» over REST, so the sync
-- records who opened each deal (CREATED_BY_ID) and every owner change it sees
-- from now on. Nothing is backfilled: the column fills as the sync re-reads
-- deals, and the history starts empty.
--
-- ADD COLUMN with no default rewrites nothing. The foreign key checks the
-- column, all NULL, under a lock the sync's writes wait on for those seconds;
-- lock_timeout makes the deploy fail fast and retryable instead.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "createdByEmployeeId" TEXT;

-- CreateTable
CREATE TABLE "deal_owner_change" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fromEmployeeId" TEXT,
    "toEmployeeId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_owner_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_owner_change_dealId_changedAt_idx" ON "deal_owner_change"("dealId", "changedAt");

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_createdByEmployeeId_fkey" FOREIGN KEY ("createdByEmployeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_owner_change" ADD CONSTRAINT "deal_owner_change_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_owner_change" ADD CONSTRAINT "deal_owner_change_fromEmployeeId_fkey" FOREIGN KEY ("fromEmployeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_owner_change" ADD CONSTRAINT "deal_owner_change_toEmployeeId_fkey" FOREIGN KEY ("toEmployeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

RESET lock_timeout;
