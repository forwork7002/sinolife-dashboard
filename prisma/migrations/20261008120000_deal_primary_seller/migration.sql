-- «RNP jadvali» (2026-10-08): a ROP's «Квал лид сони» is counted by «Сотувчи
-- (Первичка)» (UF_CRM_1789399379) — the seller the portal names on a
-- Регистрация deal at «Сделка успешна». The column fills as the sync re-reads
-- deals; the worker re-reads the kval deals that lack it by id.
--
-- Same shape as 20261007120000_deal_rop_kval_lid: ADD COLUMN with no default
-- rewrites nothing, the foreign key is NOT VALID and never validated (the
-- column is all NULL, and every row written from now on is checked), and
-- lock_timeout fails the deploy fast instead of queueing behind a sync write.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "primarySellerEmployeeId" TEXT;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_primarySellerEmployeeId_fkey" FOREIGN KEY ("primarySellerEmployeeId") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

RESET lock_timeout;
