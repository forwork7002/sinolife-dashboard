-- «Registratsiya» (2026-10-01): the administrator's daily split of handed-out
-- leads among the ROP teams (see the RegistrationSplit model).
-- A new, empty table: no lock on anything that exists.
CREATE TABLE "registration_split" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "rop" TEXT NOT NULL,
    "shareBp" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "registration_split_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registration_split_day_rop_key" ON "registration_split"("day", "rop");

-- The new section goes to whoever was explicitly granted «RNP jadvali», the
-- screen it was split out of; an account with no explicit sections follows its
-- role's default (src/lib/roles.ts), which gains '/registration' in the same
-- commit, so it needs nothing here.
UPDATE "user"
SET "sections" = array_append("sections", 'registration')
WHERE 'rnp' = ANY ("sections")
  AND NOT ('registration' = ANY ("sections"));
