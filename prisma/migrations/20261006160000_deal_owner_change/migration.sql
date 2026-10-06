-- «Безквал» (2026-10-06, the client: «ропларни номига нечта сделка ўтаяпти»):
-- a deal handed to a ROP stays the ROP's even after it moves on to a seller.
-- The portal returns no history of «Ответственный» over REST, so the sync
-- records who opened each deal (CREATED_BY_ID) and every owner change it sees
-- from now on. Nothing is backfilled: the column fills as the sync re-reads
-- deals, and the history starts empty.
--
-- ADD COLUMN with no default rewrites nothing. The foreign key is NOT VALID
-- and never validated: checking ~434 000 rows of a column that is all NULL
-- would hold the ADD COLUMN's exclusive lock on "deal" for the whole scan
-- (one transaction), and every row written from now on is checked anyway.
-- lock_timeout makes the deploy fail fast instead of queueing behind a long
-- sync write; a failed run then needs `prisma migrate resolve --rolled-back`.
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
ALTER TABLE "deal" ADD CONSTRAINT "deal_createdByEmployeeId_fkey" FOREIGN KEY ("createdByEmployeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "deal_owner_change" ADD CONSTRAINT "deal_owner_change_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_owner_change" ADD CONSTRAINT "deal_owner_change_fromEmployeeId_fkey" FOREIGN KEY ("fromEmployeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_owner_change" ADD CONSTRAINT "deal_owner_change_toEmployeeId_fkey" FOREIGN KEY ("toEmployeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

RESET lock_timeout;
