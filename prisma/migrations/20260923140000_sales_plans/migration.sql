/*
  Sales plans typed in on «Reklama samarasi · Sotuv»: a seller's plan per day
  of a month, and a ROP team's FAKT 1 / FAKT 2 plan for a month. See the block
  above `SellerDayPlan` in schema.prisma. Both start empty.
*/
CREATE TABLE "seller_day_plan" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "seller_day_plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "team_month_plan" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "rop" TEXT NOT NULL,
    "fakt1Minor" BIGINT,
    "fakt2Minor" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "team_month_plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_day_plan_month_employeeId_key" ON "seller_day_plan"("month", "employeeId");
CREATE UNIQUE INDEX "team_month_plan_month_rop_key" ON "team_month_plan"("month", "rop");

ALTER TABLE "seller_day_plan" ADD CONSTRAINT "seller_day_plan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
