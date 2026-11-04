-- «AI registrator → Boshqaruv → Ish vaqti» (2026-11-04, the owner: «hohlagan
-- vaqtim ish vaqtini oʻzgartiray»): when the agent dials and puts callers
-- through, and the sellers' lunch. Sent to the agent as `hours` in
-- GET /api/ai-registrator/config.
--
-- Four columns, ADDED ONLY, all NULLABLE with no default: the one existing row
-- reads as «not set» — `hours` is left out of the config and the agent keeps
-- its own .env hours, exactly what it does today. «HH:MM» text; the rules
-- (start < end, lunch both or neither and inside the day) are checked before
-- a save, in `src/lib/aiWorkHours.ts`. Nullable with no default is a catalogue
-- change in PostgreSQL — no rewrite, the lock held for an instant.

-- AlterTable
ALTER TABLE "ai_registrator_config" ADD COLUMN "hoursStart" TEXT,
ADD COLUMN "hoursEnd" TEXT,
ADD COLUMN "lunchStart" TEXT,
ADD COLUMN "lunchEnd" TEXT;
