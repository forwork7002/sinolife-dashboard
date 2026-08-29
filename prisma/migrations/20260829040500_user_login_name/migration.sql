-- Login name, so an administrator can hand someone credentials without an
-- email address. Both columns are nullable: the founding administrator
-- predates them and keeps signing in by email.
ALTER TABLE "user" ADD COLUMN     "username" TEXT;
ALTER TABLE "user" ADD COLUMN     "displayUsername" TEXT;

-- Unique, but nullable — Postgres allows many NULLs in a unique index, so
-- every existing account stays valid while new ones get a real login.
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");
