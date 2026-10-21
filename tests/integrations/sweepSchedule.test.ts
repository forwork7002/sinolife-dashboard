import { describe, expect, it } from 'vitest'

import { sweepDue } from '@/server/integrations/crm/sync/sweepSchedule'

/**
 * THE BIGGEST BURST WE SEND MUST NOT CHOOSE ITS OWN HOUR.
 *
 * Counted in ticks since start, the deletion sweep landed wherever the last
 * deploy put it — a deploy at 11:00 Asia/Tashkent pinned ~9 300 `crm.deal.list`
 * invocations to 11:00 every day, the hour all three OVERLOAD_LIMIT blocks fell
 * in — and with a deploy most days, tick 720 was never reached at all.
 */
const HOUR = 3 // 03:00 Asia/Tashkent = 22:00 UTC the day before

describe('the deletion sweep schedule', () => {
  it('is due inside the night hour when this process has not swept', () => {
    expect(sweepDue(new Date('2026-09-16T22:10:00.000Z'), null, HOUR)).toBe(true)
  })

  it('is not due at the hour the portal blocked us, however long since the last one', () => {
    // 11:53 Asia/Tashkent, and no sweep for three days.
    const last = new Date('2026-09-13T22:00:00.000Z')
    expect(sweepDue(new Date('2026-09-17T06:53:00.000Z'), last, HOUR)).toBe(false)
  })

  it('runs once a night, not on every tick of the hour', () => {
    const last = new Date('2026-09-16T22:02:00.000Z')
    expect(sweepDue(new Date('2026-09-16T22:40:00.000Z'), last, HOUR)).toBe(false)
  })

  it('is due again the following night', () => {
    const last = new Date('2026-09-16T22:02:00.000Z')
    expect(sweepDue(new Date('2026-09-17T22:00:30.000Z'), last, HOUR)).toBe(true)
  })

  it('is switched off by an hour outside 0-23', () => {
    expect(sweepDue(new Date('2026-09-16T22:10:00.000Z'), null, -1)).toBe(false)
    expect(sweepDue(new Date('2026-09-16T22:10:00.000Z'), null, Number.NaN)).toBe(false)
  })
})
