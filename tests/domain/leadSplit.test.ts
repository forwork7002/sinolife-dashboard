import { describe, expect, it } from 'vitest'

import { apportion } from '@/lib/apportion'
import { addDays, buildLeadSplit, SPLIT_ROPS, splitProblem } from '@/server/domain/registration/leadSplit'

describe('apportion', () => {
  it('splits so the parts sum to the whole exactly', () => {
    const parts = apportion(900, [15, 15, 15, 20, 22, 13])
    expect(parts).toEqual([135, 135, 135, 180, 198, 117])
    expect(apportion(301, [12, 12, 12, 16, 17, 10, 7, 7, 7]).reduce((a, b) => a + b, 0)).toBe(301)
  })

  it('gives the remainder to the largest fractions, earlier first on a tie', () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3])
  })

  it('answers zeros for nothing to split or no weight', () => {
    expect(apportion(0, [1, 2])).toEqual([0, 0])
    expect(apportion(5, [0, 0])).toEqual([0, 0])
  })
})

const day = '2026-09-30'

describe('buildLeadSplit', () => {
  const rows = [
    { day, rop: 'Sevinch', leads: 38, duplicates: 2 },
    { day, rop: 'Sevinchxon', leads: 2, duplicates: 0 },
    { day, rop: 'Lola', leads: 29, duplicates: 0 },
    { day, rop: null, leads: 10, duplicates: 0 },
    { day: '2026-09-24', rop: 'Lola', leads: 31, duplicates: 0 },
    { day: '2026-08-30', rop: 'Lola', leads: 99, duplicates: 0 },
    { day, rop: 'Marjona', leads: 3, duplicates: 0 },
  ]

  it('counts the day: Jami is every handed-out lead, new is Jami less the same-day repeats', () => {
    const dto = buildLeadSplit({ day, rows, split: null, previous: null, canEdit: false })
    expect(dto.total).toBe(38 + 2 + 29 + 10 + 3)
    expect(dto.fresh).toBe(dto.total - 2)
    expect(dto.unassigned).toBe(10)
  })

  it('lists the client\'s nine in their order, then any other team that got leads, folding old names', () => {
    const dto = buildLeadSplit({ day, rows, split: null, previous: null, canEdit: false })
    expect(dto.rops.map((r) => r.rop)).toEqual([...SPLIT_ROPS, 'Marjona'])
    expect(dto.rops.find((r) => r.rop === 'Sadriddin')!.received).toBe(2)
  })

  it('keeps a month of days ending on the day, and nothing older', () => {
    const dto = buildLeadSplit({ day, rows, split: null, previous: null, canEdit: false })
    expect(dto.week.days).toHaveLength(31)
    expect(dto.week.days[0]).toBe('2026-08-31')
    expect(dto.week.days.at(-1)).toBe(day)
    const lola = dto.rops.find((r) => r.rop === 'Lola')!.week
    expect(lola.slice(-7)).toEqual([31, 0, 0, 0, 0, 0, 29])
    expect(lola.reduce((a, b) => a + b, 0)).toBe(31 + 29)
    expect(dto.week.unassigned.reduce((a, b) => a + b, 0)).toBe(10)
  })

  it('leaves the plan empty when nobody set the day', () => {
    const dto = buildLeadSplit({ day, rows, split: null, previous: null, canEdit: true })
    expect(dto.split).toBeNull()
    expect(dto.rops.every((r) => r.shareBp === null && r.planLeads === null)).toBe(true)
  })

  it('turns the shares into leads that sum to the new leads exactly', () => {
    const split = {
      rows: SPLIT_ROPS.map((rop, i) => ({ rop, shareBp: [1200, 1200, 1200, 1600, 1700, 1000, 700, 700, 700][i]! })),
      updatedAt: '2026-09-30T04:09:00.000Z',
    }
    const dto = buildLeadSplit({ day, rows, split, previous: null, canEdit: true })
    const planned = dto.rops.reduce((a, r) => a + (r.planLeads ?? 0), 0)
    expect(planned).toBe(dto.fresh)
    // A team outside the split is planned nothing, not left blank.
    expect(dto.rops.find((r) => r.rop === 'Marjona')).toMatchObject({ shareBp: 0, planLeads: 0, received: 3 })
  })
})

describe('buildLeadSplit — the previous split', () => {
  it('hands the previous split back under today\'s team names, and lists a team only it names', () => {
    const previous = { day: '2026-09-29', rows: [{ rop: 'Sevinchxon', shareBp: 6000 }, { rop: 'Marjona', shareBp: 4000 }] }
    const dto = buildLeadSplit({ day, rows: [], split: null, previous, canEdit: true })
    expect(dto.previous!.rows).toEqual([{ rop: 'Sadriddin', shareBp: 6000 }, { rop: 'Marjona', shareBp: 4000 }])
    expect(dto.rops.map((r) => r.rop)).toContain('Marjona')
  })
})

describe('splitProblem', () => {
  it('accepts exactly 100 %', () => {
    expect(splitProblem([{ rop: 'Sevinch', shareBp: 6000 }, { rop: 'Lola', shareBp: 4000 }])).toBeNull()
  })

  it('refuses a split that is not 100 %, an empty one, and a team named twice', () => {
    expect(splitProblem([{ rop: 'Sevinch', shareBp: 5000 }])).toMatch(/100%/)
    expect(splitProblem([])).not.toBeNull()
    expect(splitProblem([{ rop: 'Sadriddin', shareBp: 5000 }, { rop: 'Sevinchxon', shareBp: 5000 }])).toMatch(/ikki marta/)
  })
})

describe('addDays', () => {
  it('moves across a month and a year on the calendar', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})
