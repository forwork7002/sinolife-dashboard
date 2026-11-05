-- TimePay (FaceID attendance) for «Sotuvchilar oyligi»'s lateness fine
-- (2026-11-05, the owner: «har bir kechikkan minutiga 1 somdan jarima»).
--
-- Two NEW tables, nothing existing is touched: the sync worker fills them from
-- TimePay's API, the payroll reads them. Empty until the worker's first pass —
-- then every seller's fine is 0, exactly today's payroll.

-- CreateTable
CREATE TABLE "timepay_employee" (
    "timepayId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "department" TEXT,
    "position" TEXT,
    "employeeId" TEXT,
    "linkSource" TEXT,
    "linkedBy" TEXT,
    "linkedAt" TIMESTAMP(3),
    "lastSeen" DATE NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timepay_employee_pkey" PRIMARY KEY ("timepayId")
);

-- CreateTable
CREATE TABLE "timepay_day" (
    "timepayId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "checkIn" TEXT,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "holiday" BOOLEAN NOT NULL DEFAULT false,
    "onLeave" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timepay_day_pkey" PRIMARY KEY ("timepayId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "timepay_employee_employeeId_key" ON "timepay_employee"("employeeId");

-- CreateIndex
CREATE INDEX "timepay_day_day_idx" ON "timepay_day"("day");
