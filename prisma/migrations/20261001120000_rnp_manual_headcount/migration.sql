-- «RNP jadvali»: each ROP team's «Ходим сони» typed by hand, per day
-- (the client's request of 2026-10-01; see the RnpManualHeadcount model).
-- A new, empty table: no lock on anything that exists.
CREATE TABLE "rnp_manual_headcount" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "rop" TEXT NOT NULL,
    "heads" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "rnp_manual_headcount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rnp_manual_headcount_day_rop_key" ON "rnp_manual_headcount"("day", "rop");
CREATE INDEX "rnp_manual_headcount_day_idx" ON "rnp_manual_headcount"("day");
