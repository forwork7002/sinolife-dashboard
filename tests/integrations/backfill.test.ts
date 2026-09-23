import { describe, expect, it } from 'vitest'

import { historyBackfillCursor } from '@/server/integrations/crm/sync/backfill'
import { nextWatermark } from '@/server/integrations/crm/sync/SyncEngine'

/**
 * THE REPAIR THAT CANNOT MAKE THINGS WORSE.
 *
 * Winding the stage-history cursor back re-reads a window of the portal and
 * upserts it, which is how an arrival row lost before `SKIP_LOOKBACK_MS`
 * existed gets a second chance — deal 927148 reached the queue on 31 August,
 * this database has the deal and not the arrival, and nothing else will ever
 * ask for that row again.
 *
 * The two ways it could do damage are both refused here: truncating the first
 * sync of a cold database, and moving a cursor FORWARD over rows nobody has
 * read.
 */
const NOW = new Date('2026-09-03T12:00:00.000Z')
const DAYS = 45
const WINDOW_START = new Date(NOW.getTime() - DAYS * 86_400_000)

describe('the stage-history backfill cursor', () => {
  it('winds a cursor left by a DOWN worker back to the window', () => {
    // Two hours idle: the process was not running, so a gap can have opened.
    const cursor = new Date('2026-09-03T10:00:00.000Z')
    expect(historyBackfillCursor(cursor, NOW, DAYS)).toEqual(WINDOW_START)
  })

  /*
    A REDEPLOY IS NOT AN OUTAGE.

    Five deploys in two hours used to mean five 45-day stage-history re-reads
    against a portal that answers every screen in this product — see the
    comment in `backfill.ts` for the afternoon Bitrix24 spent blocking its own
    REST API. A cursor from five minutes ago says the worker was healthy until
    the process restarted, and `SKIP_LOOKBACK_MS` already covers that gap.
  */
  it('leaves the cursor alone when the sync was healthy moments ago', () => {
    const cursor = new Date('2026-09-03T11:55:00.000Z')
    expect(historyBackfillCursor(cursor, NOW, DAYS)).toBeNull()
    // Just past the threshold — 65 minutes still — it is a repair again.
    expect(historyBackfillCursor(new Date('2026-09-03T10:54:00.000Z'), NOW, DAYS)).toEqual(
      WINDOW_START,
    )
    // The threshold is a parameter, so a worker can be told to repair always.
    expect(historyBackfillCursor(cursor, NOW, DAYS, 0)).toEqual(WINDOW_START)
  })

  /*
    THE CURSOR A HEALTHY TICK LEAVES IS 35 MINUTES OLD.

    Stage history skips rows on nearly every run, and after a skip the engine
    stores `startedAt − SKIP_LOOKBACK_MS` (35 min). The deploy of 2026-09-23
    06:36 UTC restarted a worker that had synced two minutes earlier, read that
    cursor as half an hour idle, and re-read 81 970 rows from the portal.
  */
  it('treats the cursor a skipped-but-healthy tick leaves as a restart', () => {
    const healthyTick = new Date(NOW.getTime() - 2 * 60_000)
    const watermark = nextWatermark('STAGE_HISTORY', healthyTick, 12)
    expect(historyBackfillCursor(watermark, NOW, DAYS)).toBeNull()
  })

  it('leaves a cursor that is already older than the window alone', () => {
    // A worker down for two months must not be told to start two months late.
    const cursor = new Date('2026-07-01T00:00:00.000Z')
    expect(historyBackfillCursor(cursor, NOW, DAYS)).toBeNull()
  })

  it('refuses to write a cursor where there is none', () => {
    /*
      With no cursor the incremental run asks the portal for EVERYTHING. A
      backfill cursor here would cap the first sync of a cold database at six
      weeks and mark it complete — the one outcome worse than the gap this
      exists to repair.
    */
    expect(historyBackfillCursor(undefined, NOW, DAYS)).toBeNull()
  })

  it('is off when the window is zero or nonsense', () => {
    const cursor = new Date('2026-09-03T11:55:00.000Z')
    for (const days of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(historyBackfillCursor(cursor, NOW, days)).toBeNull()
    }
  })

  it('never moves the cursor forward, at any window length', () => {
    const cursor = new Date('2026-08-20T00:00:00.000Z')
    for (const days of [1, 7, 14, 30, 45, 90]) {
      const next = historyBackfillCursor(cursor, NOW, days)
      if (next !== null) expect(next.getTime()).toBeLessThan(cursor.getTime())
    }
  })
})
