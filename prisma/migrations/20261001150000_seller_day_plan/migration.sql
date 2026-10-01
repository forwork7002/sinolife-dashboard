-- «Registratsiya · ROP otchet»: each seller's day plan, typed by hand (the
-- client's request of 2026-10-01, the «ПЛАН» column of their group sheet; see
-- the SellerDayPlan model). The same shape as the table 20261001130000
-- dropped, which had lost its screen; a new, empty table, so no lock on
-- anything that exists.
CREATE TABLE "seller_day_plan" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "seller_day_plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_day_plan_month_employeeId_key" ON "seller_day_plan"("month", "employeeId");

ALTER TABLE "seller_day_plan" ADD CONSTRAINT "seller_day_plan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
