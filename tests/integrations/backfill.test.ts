import { describe, expect, it } from 'vitest'

import { historyBackfillCursor } from '@/server/integrations/crm/sync/backfill'

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
/** The hard floor: `days` back from now, and the cursor may never pass it. */
const WINDOW_START = new Date(NOW.getTime() - DAYS * 86_400_000)
/** The default margin the repair actually uses — two days before the cursor. */
const back = (iso: string, ms = 2 * 86_400_000) => new Date(new Date(iso).getTime() - ms)

describe('the stage-history backfill cursor', () => {
  /*
    THE REPAIR IS AROUND THE CURSOR, NOT AT THE START OF THE WINDOW.

    The rows this recovers sit BESIDE the watermark, because that is where a
    skipped run drops them. Reading from six weeks back to find them was a
    sweep for gaps predating `SKIP_LOOKBACK_MS`, and it cost ~80 500 rows every
    time the worker was down half an hour — including, on 2026-09-15, the tick
    that recovered from a 95-minute refusal, at a portal that had blocked this
    integration the day before for volume.
  */
  it('winds a cursor left by a DOWN worker back by the margin, not to the window', () => {
    // Two hours idle: the process was not running, so a gap can have opened.
    const cursor = new Date('2026-09-03T10:00:00.000Z')
    expect(historyBackfillCursor(cursor, NOW, DAYS)).toEqual(back('2026-09-03T10:00:00.000Z'))
  })

  it('still floors at `days`, so the margin can never reach past the window', () => {
    // A cursor 44 days old, less than the margin inside the 45-day floor.
    const cursor = new Date(NOW.getTime() - 44 * 86_400_000)
    expect(historyBackfillCursor(cursor, NOW, DAYS)).toEqual(WINDOW_START)
  })

  it('performs the old full sweep when asked for one', () => {
    const cursor = new Date('2026-09-03T10:00:00.000Z')
    expect(historyBackfillCursor(cursor, NOW, DAYS, undefined, 90 * 86_400_000)).toEqual(
      WINDOW_START,
    )
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
    // Just past the threshold, it is a repair again.
    expect(historyBackfillCursor(new Date('2026-09-03T11:29:00.000Z'), NOW, DAYS)).toEqual(
      back('2026-09-03T11:29:00.000Z'),
    )
    // The threshold is a parameter, so a worker can be told to repair always.
    expect(historyBackfillCursor(cursor, NOW, DAYS, 0)).toEqual(
      back('2026-09-03T11:55:00.000Z'),
    )
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
