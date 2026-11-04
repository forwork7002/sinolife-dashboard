-- «AI registrator → Boshqaruv» (2026-11-04, the owner: «ai boshqaruvda ai
-- registratorni oʻchirib toʻxtatish funksiyasi ham boʻlsin»): the stop switch
-- the agent reads as `enabled` in GET /api/ai-registrator/config.
--
-- One column, ADDED ONLY, NOT NULL DEFAULT true: the one existing row reads as
-- «ishlayapti», exactly what the agent does today. In PostgreSQL 11+ a constant
-- default is a catalogue change — no rewrite, the lock held for an instant.

-- AlterTable
ALTER TABLE "ai_registrator_config" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
