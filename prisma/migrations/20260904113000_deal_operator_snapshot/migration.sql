/*
  The seller, as the portal stamped them at the moment of sale.

  `deal."employeeId"` is ASSIGNED_BY_ID — the deal's owner TODAY — and this
  portal reassigns deals to back office while they are processed. In July 2026
  that put 556 orders on the head of Операцион and made him the sellers board's
  number one with 4.2x the client's own leader; twelve of twelve sampled deals
  named a different, real seller in UF_CRM_1778416910. The client's published
  board ranks by that field, which is why their totals and ours never lined up.

  Both columns are free text and nullable: they are a SNAPSHOT, not a foreign
  key. `operatorTeamSource` is deliberately historic — one July row reads
  «Husniddin(ROP)», a department the portal no longer has — because a seller's
  past months belong to the team they were in then, not the one they sit in now.

  Nullable with no backfill: the sync rewrites every deal on the next full pass.
  Coverage measured on the portal before landing this — 99.96% of August's
  Доставка deals and 99.2% of July's — so readers must still fall back to
  `employeeId` rather than assume a value.
*/

ALTER TABLE "deal" ADD COLUMN "operatorNameSource" TEXT;
ALTER TABLE "deal" ADD COLUMN "operatorTeamSource" TEXT;

-- The sellers board groups by this name, so it is looked up per cohort row.
CREATE INDEX "deal_operatorNameSource_idx" ON "deal" ("operatorNameSource");

/*
  The snapshot resolved to one of our people, so the board can group by it.

  The two spellings share only the floor number — «Davlatbek Sirojov 115» in the
  portal, «Sirojov 115 Davlatbek» here — so resolution happens at import, in one
  testable place, rather than by extracting digits in every query. NULL wherever
  the field was empty or the badge is ambiguous; every reader falls back to
  `employeeId`, so no order is ever lost.

  SET NULL rather than RESTRICT: this is a denormalised convenience and must not
  block deleting an employee whose deals still have a real owner.
*/
ALTER TABLE "deal" ADD COLUMN "operatorEmployeeId" TEXT;

ALTER TABLE "deal" ADD CONSTRAINT "deal_operatorEmployeeId_fkey"
  FOREIGN KEY ("operatorEmployeeId") REFERENCES "employee"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "deal_operatorEmployeeId_idx" ON "deal" ("operatorEmployeeId");
