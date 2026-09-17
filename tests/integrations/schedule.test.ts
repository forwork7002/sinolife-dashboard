import { describe, expect, it } from 'vitest'

import { isPassDue } from '@/server/integrations/crm/sync/schedule'

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
