/*
  Telephony leaves the database.

  310 000 rows, 118 MB, and by a wide margin the most sequentially scanned
  table here — 2.8 BILLION tuples read against deal's 15 million — imported
  every minute to answer two endpoints that no screen in the application ever
  called. Nothing renders a call. The data stays in Bitrix24 and can be
  re-imported by restoring the model and the CALLS handler; nothing here is the
  system of record.

  `SyncEntity.CALLS` is deliberately NOT dropped: it is a database enum and the
  sync log holds thousands of historical rows naming it. Removing the value
  would mean deleting that history to tidy away a name nobody reads.

  WHAT PRISMA WANTED TO DROP AND MUST NOT.  `prisma migrate dev` also emitted
  DROP INDEX for customer_name_trgm_idx, customer_phone_trgm_idx,
  deal_ordercode_trgm_idx and deal_title_trgm_idx. Those are the GIN trigram
  indexes behind the ⌘K search, created in raw SQL because Prisma's schema
  language cannot express them — so every `migrate dev` reads them as drift and
  tries to remove them. They are kept. Any future generated migration has to be
  read for the same four lines before it is committed.
*/

-- DropForeignKey
ALTER TABLE "call_record" DROP CONSTRAINT "call_record_customerId_fkey";

-- DropForeignKey
ALTER TABLE "call_record" DROP CONSTRAINT "call_record_dealId_fkey";

-- DropForeignKey
ALTER TABLE "call_record" DROP CONSTRAINT "call_record_employeeId_fkey";

-- DropTable
DROP TABLE "call_record";

-- DropEnum
DROP TYPE "CallDirection";
