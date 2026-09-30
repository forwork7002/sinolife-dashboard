import { describe, expect, it } from 'vitest'

import { scopedPeriod } from '@/server/domain/employees/branches'

describe('the scoped window the insights SQL receives', () => {
  const period = {
    preset: 'this_month' as const,
    start: new Date('2026-08-01T00:00:00.000Z'),
    end: new Date('2026-09-01T00:00:00.000Z'),
    timeZone: 'Asia/Tashkent',
    days: 31,
  }

  it('carries the ids alongside the window', () => {
    const window = scopedPeriod(period, { restrictToEmployeeIds: ['e1'] })
    expect(window.start).toEqual(period.start)
    expect(window.restrictToEmployeeIds).toEqual(['e1'])
  })

  it('says null rather than undefined when nothing is scoped', () => {
    // The SQL tests `IS NULL`; an absent key and a null one must not be two
    // different states by the time they reach a query.
    expect(scopedPeriod(period, {}).restrictToEmployeeIds).toBeNull()
  })
})
