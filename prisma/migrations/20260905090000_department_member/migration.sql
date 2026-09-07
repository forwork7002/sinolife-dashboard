-- Which units a person belongs to — all of them.
--
-- `UF_DEPARTMENT` is an ARRAY in Bitrix24 and the portal's own company-structure
-- screen counts a person once in EVERY unit it names. The importer kept only the
-- first entry, so nine of this portal's 208 active people were invisible in their
-- second unit and five of the twenty cards under-counted against the screen this
-- dashboard now reproduces: Тошкент онлайн 0 against 1, Asliddin(ROP) 8 against
-- 10, Azizbek(ROP) 14 against 16, Saidaziz(ROP) 14 against 15, Sevinchxon(ROP) 8
-- against 10. Measured 2026-09-05.
--
-- `employee."departmentId"` is untouched and stays the PRIMARY membership. Every
-- analytic credits a person to exactly one unit; rolling a two-unit person up
-- both branches would count their headcount and their money twice. Only the org
-- chart reads this table.

-- CreateTable
CREATE TABLE "department_member" (
    "departmentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "department_member_pkey" PRIMARY KEY ("departmentId","employeeId")
);

-- CreateIndex
CREATE INDEX "department_member_employeeId_idx" ON "department_member"("employeeId");

-- AddForeignKey
ALTER TABLE "department_member" ADD CONSTRAINT "department_member_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_member" ADD CONSTRAINT "department_member_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill, so the chart is not blank between this migration and the first
-- EMPLOYEES pass that rewrites each row from the portal. Reference data reloads
-- every 30 worker ticks, which is half an hour of an empty org chart otherwise.
-- Every primary membership is already known; only the second ones are missing,
-- and they arrive with the next pass.
INSERT INTO "department_member" ("departmentId", "employeeId", "isPrimary")
SELECT e."departmentId", e."id", true
  FROM "employee" e
 WHERE e."departmentId" IS NOT NULL
ON CONFLICT DO NOTHING;
