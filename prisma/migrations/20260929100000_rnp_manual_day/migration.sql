-- «RNP jadvali»: the day cells a person types (see the RnpManualDay model).
CREATE TABLE "rnp_manual_day" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "team" TEXT NOT NULL DEFAULT '',
    "metric" TEXT NOT NULL,
    "valueCenti" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "rnp_manual_day_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rnp_manual_day_day_team_metric_key" ON "rnp_manual_day"("day", "team", "metric");
CREATE INDEX "rnp_manual_day_day_idx" ON "rnp_manual_day"("day");
