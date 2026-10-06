import { describe, expect, it } from 'vitest'

import { SYNC_ORDER } from '@/server/domain/types'
import type { SyncResult } from '@/server/integrations/crm/sync/SyncEngine'
import {
  isBackfillDue,
  isPassDue,
  isResolvePassDue,
  planTick,
  REFERENCE_MARKER,
  RESOLVE,
  RESOLVE_GAP_MS,
  runOneOff,
  SWEEP_REFUSED_MARK,
  sweepLogRow,
} from '@/server/integrations/crm/sync/schedule'

/**
 * A DEPLOY MUST NOT COST THE PORTAL A PASS.
 *
 * The reference pass and the deletion sweep were `tick % N === 0`, and the
 * counter restarts at zero in every process — sixteen reference passes a day
 * against eight scheduled, and a daily sweep that never reached tick 720. See
 * `schedule.ts`.
 */
const NOW = new Date('2026-09-17T05:00:00.000Z')
const THREE_HOURS = 3 * 3_600_000

describe('slow-clock passes', () => {
  it('runs a pass nothing has recorded', () => {
    expect(isPassDue(null, NOW, THREE_HOURS)).toBe(true)
  })

  it('skips a pass that ran ten minutes before the restart', () => {
    const last = new Date(NOW.getTime() - 10 * 60_000)
    expect(isPassDue(last, NOW, THREE_HOURS)).toBe(false)
  })

  it('runs it once the period has elapsed, however many restarts fell inside', () => {
    expect(isPassDue(new Date(NOW.getTime() - THREE_HOURS), NOW, THREE_HOURS)).toBe(true)
    expect(isPassDue(new Date(NOW.getTime() - THREE_HOURS + 1), NOW, THREE_HOURS)).toBe(false)
  })

  it('reads a record stamped ahead of the clock as just run', () => {
    const ahead = new Date(NOW.getTime() + 30_000)
    expect(isPassDue(ahead, NOW, THREE_HOURS)).toBe(false)
  })

  it('never runs a pass that is switched off', () => {
    expect(isPassDue(null, NOW, 0)).toBe(false)
    expect(isPassDue(null, NOW, Number.NaN)).toBe(false)
  })
})

describe('isBackfillDue — the one-off deals re-read', () => {
  const backfill = {
    since: new Date('2026-08-01T00:00:00+05:00'),
    requestedAt: new Date('2026-09-19T00:00:00+05:00'),
  }
  const at = (iso: string) => new Date(iso)
  const TZ = 'Asia/Tashkent'

  it('runs only in the Tashkent night, 01:00 to 06:00', () => {
    expect(isBackfillDue(backfill, false, at('2026-09-20T00:59:00+05:00'), TZ, null)).toBe(false)
    expect(isBackfillDue(backfill, false, at('2026-09-20T01:00:00+05:00'), TZ, null)).toBe(true)
    expect(isBackfillDue(backfill, false, at('2026-09-20T05:59:00+05:00'), TZ, null)).toBe(true)
    expect(isBackfillDue(backfill, false, at('2026-09-20T06:00:00+05:00'), TZ, null)).toBe(false)
    expect(isBackfillDue(backfill, false, at('2026-09-20T14:00:00+05:00'), TZ, null)).toBe(false)
  })

  it('never runs twice, never with nothing asked for, never after the request expires', () => {
    const night = at('2026-09-20T02:00:00+05:00')
    expect(isBackfillDue(backfill, true, night, TZ, null)).toBe(false)
    expect(isBackfillDue(null, false, night, TZ, null)).toBe(false)
    expect(isBackfillDue(backfill, false, at('2026-10-04T02:00:00+05:00'), TZ, null)).toBe(false)
  })

  it('waits an hour after a failure — never a retry on the next tick', () => {
    const night = at('2026-09-20T02:00:00+05:00')
    expect(isBackfillDue(backfill, false, night, TZ, at('2026-09-20T01:30:00+05:00'))).toBe(false)
    expect(isBackfillDue(backfill, false, night, TZ, at('2026-09-20T00:59:00+05:00'))).toBe(true)
  })
})

/**
 * A DEALS SKIP BRINGS THE REFERENCE DATA FORWARD — not the whole pass, and not
 * on every tick. The skip windows are 95 / 35 minutes; the scheduled pass is
 * three hours away.
 */
describe('isResolvePassDue — what a skipped deal asks for', () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms)

  it('asks nothing of a run that skipped nothing', () => {
    expect(isResolvePassDue(0, [null, null], NOW)).toBe(false)
  })

  it('asks at once when nothing has re-read the reference data yet', () => {
    expect(isResolvePassDue(1, [null, null], NOW)).toBe(true)
  })

  it('waits out the gap after the newest pass, whichever kind it was', () => {
    expect(isResolvePassDue(1, [ago(THREE_HOURS - 60_000), ago(5 * 60_000)], NOW)).toBe(false)
    expect(isResolvePassDue(1, [ago(5 * 60_000), null], NOW)).toBe(false)
    expect(isResolvePassDue(1, [ago(RESOLVE_GAP_MS), ago(RESOLVE_GAP_MS + 60_000)], NOW)).toBe(true)
  })

  it('stays inside the shortest skip window, so the arrival row is still re-read', () => {
    // STAGE_HISTORY rewinds 35 minutes after a skip; the gap plus a slow tick fits.
    expect(RESOLVE_GAP_MS + 5 * 60_000).toBeLessThan(35 * 60_000)
  })
})

/**
 * THE FORCED PASS RUNS IN THE FULL PASS'S ORDER, AND NEVER DATES IT.
 *
 * EMPLOYEES writes each person's unit and replaces their memberships with the
 * units it can resolve. Run without DEPARTMENTS in front of it, a forced pass
 * during a reorganisation would set everybody in a unit newer than the last
 * full pass to no unit at all, for up to three hours.
 */
describe('RESOLVE — what a skipped deal brings forward', () => {
  it('re-reads what a skipped deal waits on: its seller and its stage', () => {
    expect(RESOLVE).toEqual(expect.arrayContaining(['EMPLOYEES', 'STAGES']))
  })

  it('writes the units before the people who point at them', () => {
    expect(RESOLVE).toContain('DEPARTMENTS')
    expect(RESOLVE).toEqual(SYNC_ORDER.filter((entity) => RESOLVE.includes(entity)))
  })

  it('never writes the row that dates the full pass at startup', () => {
    expect(RESOLVE).not.toContain(REFERENCE_MARKER)
  })
})

/**
 * WHICH SLOW PASS A TICK RUNS — the worker's loop decides it through
 * `planTick`, so these are the loop's own answers.
 */
describe('planTick', () => {
  const idle = { referenceDue: false, resolveOwed: false, calm: 0 }

  it('runs the hot entities alone when nothing is owed', () => {
    expect(planTick(idle)).toEqual({ reference: false, resolve: false, referenceOwed: false, resolveOwed: false })
  })

  it('runs the forced pass on the tick after a skip, and settles it', () => {
    expect(planTick({ ...idle, resolveOwed: true })).toEqual({
      reference: false,
      resolve: true,
      referenceOwed: false,
      resolveOwed: false,
    })
  })

  it('lets the full pass settle a forced pass owed on the same tick', () => {
    expect(planTick({ referenceDue: true, resolveOwed: true, calm: 0 })).toEqual({
      reference: true,
      resolve: false,
      referenceOwed: false,
      resolveOwed: false,
    })
  })

  it('runs neither inside the calm after an outage, and keeps both owed', () => {
    expect(planTick({ referenceDue: true, resolveOwed: true, calm: 2 })).toEqual({
      reference: false,
      resolve: false,
      referenceOwed: true,
      resolveOwed: true,
    })
  })
})

/**
 * THE NIGHT'S ONE-OFF READS MAY NOT TAKE THE WORKER DOWN.
 *
 * `runEntity` reports a failed fetch in its result, but its own `sync_log`
 * writes are bare database calls — and the backfill and the one-off reads were
 * the two awaited calls in the loop with no catch. A dropped connection there
 * reached `main().catch` and exited the process.
 */
describe('runOneOff', () => {
  const result = (status: SyncResult['status'], errorMessage?: string): SyncResult => ({
    entity: 'DEALS',
    mode: 'BACKFILL',
    status,
    recordsRead: 10,
    recordsCreated: 0,
    recordsUpdated: 10,
    recordsSkipped: 0,
    recordsFailed: 0,
    recordsDeleted: 0,
    errorMessage,
    skippedUnsupported: false,
  })

  it('settles on SUCCESS and on PARTIAL, as the worker always did', async () => {
    expect(await runOneOff(async () => result('SUCCESS'))).toMatchObject({ settled: true })
    expect(await runOneOff(async () => result('PARTIAL'))).toMatchObject({ settled: true })
  })

  it('reports a FAILED run with its reason', async () => {
    expect(await runOneOff(async () => result('FAILED', 'OVERLOAD_LIMIT'))).toEqual({
      settled: false,
      reason: 'OVERLOAD_LIMIT',
    })
  })

  it('turns a throw from the run into a failure instead of rejecting', async () => {
    const outcome = await runOneOff(async () => {
      throw new Error('Connection terminated unexpectedly')
    })
    expect(outcome).toEqual({ settled: false, reason: 'Connection terminated unexpectedly' })
  })
})

/**
 * THE SWEEP'S OWN ROW, WHICH THE NEXT PROCESS READS BACK AT STARTUP.
 *
 * A refusal waits a day like a success, so it is read back too — but a manual
 * `bitrix:resync -- DEALS` is a FULL engine run that ends PARTIAL whenever it
 * skips a deal, and read as a sweep it would put the real one off by a day.
 * The startup read takes a PARTIAL row only under `SWEEP_REFUSED_MARK`.
 */
describe('sweepLogRow', () => {
  const started = new Date('2026-10-06T00:00:00.000Z')
  const finished = new Date('2026-10-06T00:01:40.000Z')

  it('records a sweep that ran as a success, with the rows it deleted', () => {
    expect(sweepLogRow({ refused: false, seen: 464_396, deleted: 3 }, started, finished)).toEqual({
      entity: 'DEALS',
      mode: 'FULL',
      status: 'SUCCESS',
      startedAt: started,
      finishedAt: finished,
      recordsRead: 464_396,
      recordsUpdated: 3,
    })
  })

  it('records a refusal as PARTIAL under the mark, with the rows it would have deleted', () => {
    const row = sweepLogRow(
      { refused: true, seen: 279_816, gone: 184_580, reason: 'deal: … juda koʻp' },
      started,
      finished,
    )
    expect(row).toMatchObject({
      entity: 'DEALS',
      mode: 'FULL',
      status: 'PARTIAL',
      recordsRead: 279_816,
      recordsSkipped: 184_580,
      errorMessage: `${SWEEP_REFUSED_MARK}: deal: … juda koʻp`,
    })
  })
})
