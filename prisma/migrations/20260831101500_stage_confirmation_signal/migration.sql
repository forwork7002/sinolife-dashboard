-- The five stages the client's bot reacts to, recorded on the stage itself.
--
-- Their infrastructure document lists them and marks everything else IGNORED
-- («статус ўзгармайди»). Writing the decision onto the stage row means the
-- confirmation queue reads one column instead of restating a list of Bitrix
-- stage ids inside SQL, and means a stage the portal renames keeps its
-- meaning as long as its id is stable.
CREATE TYPE "ConfirmationSignal" AS ENUM ('CONFIRM_NEW', 'NO_ANSWER', 'REJECTED', 'CONFIRMED');

ALTER TABLE "deal_stage" ADD COLUMN "confirmationSignal" "ConfirmationSignal";

CREATE INDEX "deal_stage_confirmationSignal_idx" ON "deal_stage"("confirmationSignal");

-- Back-filled here as well as written by the sync, so the queue is correct
-- from the moment this migration lands rather than after the next stage read.
UPDATE "deal_stage" SET "confirmationSignal" = 'CONFIRM_NEW' WHERE "externalId" = 'C4:NEW';
UPDATE "deal_stage" SET "confirmationSignal" = 'NO_ANSWER'   WHERE "externalId" = 'C4:UC_JQR9F1';
UPDATE "deal_stage" SET "confirmationSignal" = 'REJECTED'    WHERE "externalId" IN ('C4:LOSE', 'C12:UC_1OM8B2');
UPDATE "deal_stage" SET "confirmationSignal" = 'CONFIRMED'   WHERE "externalId" = 'C6:NEW';
