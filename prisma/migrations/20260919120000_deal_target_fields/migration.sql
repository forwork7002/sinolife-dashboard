/*
  «Target tahlili» — who ran the ad, which creative, and the first source.

  Three free-text snapshots of portal fields, nullable with no backfill here:
  the sync writes them on every deal it touches from now on, and
  `npm run bitrix:resync -- DEALS --since=YYYY-MM-DD` refills a recent window
  without re-reading all ~420 000 deals.

  Null is «the portal left it empty», never «organic» — on 16.08–15.09.2026
  only 5% of target leads carried a targetolog, and the screen counts the rest
  under «ko'rsatilmagan» rather than dropping them.
*/

ALTER TABLE "deal" ADD COLUMN "targetolog" TEXT;
ALTER TABLE "deal" ADD COLUMN "creative" TEXT;
ALTER TABLE "deal" ADD COLUMN "primarySource" TEXT;

-- The screen reads one set of sources over a creation window.
CREATE INDEX "deal_sourceId_createdAtSource_idx" ON "deal" ("sourceId", "createdAtSource");
