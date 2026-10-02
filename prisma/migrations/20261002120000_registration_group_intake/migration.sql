-- «Lidlar · Guruhlar»: each registration group's «безквал» typed by hand, per
-- day (the client's request of 2026-10-02; see the RegistrationGroupIntake
-- model). A new, empty table: no lock on anything that exists.
CREATE TABLE "registration_group_intake" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "group" TEXT NOT NULL,
    "leads" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "registration_group_intake_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registration_group_intake_day_group_key" ON "registration_group_intake"("day", "group");
