import { describe, expect, it } from 'vitest'

import { isBackfillDue, isPassDue } from '@/server/integrations/crm/sync/schedule'

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
