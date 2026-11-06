-- «AI liniya qoʻshish» from «AI registrator → Boshqaruv» (2026-11-06, T123). ADD COLUMN
-- only — nothing existing is changed or dropped; every press of before reads as before.
-- `params` holds an add_line press's product and transport. `secret` holds the password
-- SEALED in the browser with the AI server's public key (RSA-OAEP) — never the password
-- itself, which ISH never has. It is sent to the agent once and cleared on its first
-- answer, or when the press goes stale.

-- AlterTable
ALTER TABLE "ai_registrator_action" ADD COLUMN     "params" JSONB,
ADD COLUMN     "secret" TEXT;
