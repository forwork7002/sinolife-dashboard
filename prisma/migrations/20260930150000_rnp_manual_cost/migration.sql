-- «RNP jadvali»: the brand P&L's five hand-typed cost lines, soʻm per day
-- (the client's request of 2026-09-30; see the RnpManualCost model).
-- A new, empty table: no lock on anything that exists.
CREATE TABLE "rnp_manual_cost" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "project" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "amountSom" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "rnp_manual_cost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rnp_manual_cost_day_project_line_key" ON "rnp_manual_cost"("day", "project", "line");
CREATE INDEX "rnp_manual_cost_day_idx" ON "rnp_manual_cost"("day");
