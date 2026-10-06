import { describe, expect, it } from 'vitest'

import { apportion } from '@/lib/apportion'
import {
  addDays,
  buildLeadSplit,
  leadSplitOfBrand,
  SPLIT_ROPS,
  splitProblem,
  teamRowsOfBrand,
} from '@/server/domain/registration/leadSplit'

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
    const dto = buildLeadSplit({ day, rows, bezkval: [], split: null, previous: null, canEdit: false })
    expect(dto.total).toBe(38 + 2 + 29 + 10 + 3)
    expect(dto.fresh).toBe(dto.total - 2)
    expect(dto.unassigned).toBe(10)
  })

  it('lists the client\'s nine in their order, then any other team that got leads, folding old names', () => {
    const dto = buildLeadSplit({ day, rows, bezkval: [], split: null, previous: null, canEdit: false })
    expect(dto.rops.map((r) => r.rop)).toEqual([...SPLIT_ROPS, 'Marjona'])
    expect(dto.rops.find((r) => r.rop === 'Sadriddin')!.received).toBe(2)
  })

  it('keeps a month of days ending on the day, and nothing older', () => {
    const dto = buildLeadSplit({ day, rows, bezkval: [], split: null, previous: null, canEdit: false })
    expect(dto.week.days).toHaveLength(31)
    expect(dto.week.days[0]).toBe('2026-08-31')
    expect(dto.week.days.at(-1)).toBe(day)
    const lola = dto.rops.find((r) => r.rop === 'Lola')!.week
    expect(lola.slice(-7)).toEqual([31, 0, 0, 0, 0, 0, 29])
    expect(lola.reduce((a, b) => a + b, 0)).toBe(31 + 29)
    expect(dto.week.unassigned.reduce((a, b) => a + b, 0)).toBe(10)
  })

  it('leaves the plan empty when nobody set the day', () => {
    const dto = buildLeadSplit({ day, rows, bezkval: [], split: null, previous: null, canEdit: true })
    expect(dto.split).toBeNull()
    expect(dto.rops.every((r) => r.shareBp === null && r.planLeads === null)).toBe(true)
  })

  it('turns the shares into leads that sum to the new leads exactly', () => {
    const split = {
      rows: SPLIT_ROPS.map((rop, i) => ({ rop, shareBp: [1200, 1200, 1200, 1600, 1700, 1000, 700, 700, 700][i]! })),
      updatedAt: '2026-09-30T04:09:00.000Z',
    }
    const dto = buildLeadSplit({ day, rows, bezkval: [], split, previous: null, canEdit: true })
    const planned = dto.rops.reduce((a, r) => a + (r.planLeads ?? 0), 0)
    expect(planned).toBe(dto.fresh)
    // A team outside the split is planned nothing, not left blank.
    expect(dto.rops.find((r) => r.rop === 'Marjona')).toMatchObject({ shareBp: 0, planLeads: 0, received: 3 })
  })
})

describe('buildLeadSplit — the previous split', () => {
  it('hands the previous split back under today\'s team names, and lists a team only it names', () => {
    const previous = { day: '2026-09-29', rows: [{ rop: 'Sevinchxon', shareBp: 6000 }, { rop: 'Marjona', shareBp: 4000 }] }
    const dto = buildLeadSplit({ day, rows: [], bezkval: [], split: null, previous, canEdit: true })
    expect(dto.previous!.rows).toEqual([{ rop: 'Sadriddin', shareBp: 6000 }, { rop: 'Marjona', shareBp: 4000 }])
    expect(dto.rops.map((r) => r.rop)).toContain('Marjona')
  })
})

describe('buildLeadSplit — безквал', () => {
  const bezkval = [
    { day, rop: 'Azizbek', leads: 275 },
    { day, rop: 'Sevinchxon', leads: 4 },
    { day: '2026-09-29', rop: 'Azizbek', leads: 120 },
    { day, rop: 'Davlat', leads: 61 },
    { day, rop: null, leads: 330 },
    { day: '2026-08-30', rop: 'Azizbek', leads: 999 },
  ]

  it('counts each team\'s Регистрация deals by day over the same month, folding old names', () => {
    const dto = buildLeadSplit({ day, rows: [], bezkval, split: null, previous: null, canEdit: false })
    expect(dto.bezkval.rops.map((r) => r.rop)).toEqual([...SPLIT_ROPS, 'Davlat'])
    expect(dto.bezkval.rops.find((r) => r.rop === 'Azizbek')!.week.slice(-2)).toEqual([120, 275])
    expect(dto.bezkval.rops.find((r) => r.rop === 'Sadriddin')!.week.at(-1)).toBe(4)
    expect(dto.bezkval.unassigned.at(-1)).toBe(330)
    expect(dto.bezkval.rops.flatMap((r) => r.week).reduce((a, b) => a + b, 0)).toBe(275 + 4 + 120 + 61)
  })

  it('leaves the handed-out leads alone: a team only безквал names gets no kval row', () => {
    const dto = buildLeadSplit({ day, rows: [], bezkval, split: null, previous: null, canEdit: false })
    expect(dto.rops.map((r) => r.rop)).toEqual([...SPLIT_ROPS])
    expect(dto.total).toBe(0)
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

describe('the Collagen / Zextra switch on the team tables', () => {
  const rows = [
    { day, rop: 'Sevinch', leads: 38, duplicates: 2 },
    // Sevinchxon folds into Sadriddin, a Zextra team.
    { day, rop: 'Sevinchxon', leads: 2, duplicates: 0 },
    { day, rop: 'Lola', leads: 29, duplicates: 0 },
    { day, rop: null, leads: 10, duplicates: 0 },
    { day, rop: 'Hayot', leads: 4, duplicates: 0 },
  ]

  it('keeps the rows of the brand\'s teams, a renamed team folded, a teamless one in neither', () => {
    expect(teamRowsOfBrand(rows, 'Zextra').map((r) => r.rop)).toEqual(['Sevinchxon'])
    expect(teamRowsOfBrand(rows, 'Collagen').map((r) => r.rop)).toEqual(['Sevinch', 'Lola'])
    expect(teamRowsOfBrand(rows, 'all')).toBe(rows)
  })

  it('re-bases the split card on the brand\'s teams, each keeping its plan, and locks it', () => {
    const split = {
      rows: SPLIT_ROPS.map((rop) => ({ rop, shareBp: rop === 'Sevinch' ? 5000 : rop === 'Lola' ? 3000 : rop === 'Sadriddin' ? 2000 : 0 })),
      updatedAt: '2026-09-30T04:09:00.000Z',
    }
    const whole = buildLeadSplit({ day, rows, bezkval: [{ day, rop: 'Lola', leads: 5 }, { day, rop: null, leads: 1 }], split, previous: null, canEdit: true })
    const collagen = leadSplitOfBrand(whole, 'Collagen')
    expect(collagen.rops.filter((r) => r.received > 0).map((r) => r.rop)).toEqual(['Sevinch', 'Lola'])
    expect(collagen.total).toBe(67)
    const plan = (rop: string) => whole.rops.find((r) => r.rop === rop)!.planLeads!
    expect(collagen.fresh).toBe(collagen.rops.reduce((n, r) => n + (r.planLeads ?? 0), 0))
    expect(collagen.rops.find((r) => r.rop === 'Sevinch')!.planLeads).toBe(plan('Sevinch'))
    expect(collagen.unassigned).toBe(0)
    // The grid keeps the client's teams of the brand, quiet ones at zero; no Zextra team.
    expect(collagen.bezkval.rops.map((r) => r.rop)).toEqual(['Sevinch', 'Gulzora', 'Saidaziz', 'Azizbek', 'Maftuna', 'Lola', 'Shohjaxon'])
    expect(leadSplitOfBrand(whole, 'Zextra').bezkval.rops.map((r) => r.rop)).toEqual(['Asliddin', 'Sadriddin'])
    expect(collagen.bezkval.unassigned.every((n) => n === 0)).toBe(true)
    expect(collagen.canEdit).toBe(false)
    expect(leadSplitOfBrand(whole, 'all')).toBe(whole)
  })

  it('files a teamless lead and a team on neither list under «Brendsiz», so the three add up', () => {
    expect(teamRowsOfBrand(rows, 'none').map((r) => r.rop)).toEqual([null, 'Hayot'])
    const split = {
      rows: SPLIT_ROPS.map((rop) => ({ rop, shareBp: rop === 'Sevinch' ? 5000 : rop === 'Lola' ? 3000 : rop === 'Sadriddin' ? 2000 : 0 })),
      updatedAt: '2026-09-30T04:09:00.000Z',
    }
    const whole = buildLeadSplit({ day, rows, bezkval: [{ day, rop: 'Lola', leads: 5 }, { day, rop: null, leads: 1 }], split, previous: null, canEdit: true })
    const [c, z, n] = (['Collagen', 'Zextra', 'none'] as const).map((b) => leadSplitOfBrand(whole, b))
    expect(n.unassigned).toBe(whole.unassigned)
    expect(c!.total + z!.total + n!.total).toBe(whole.total)
    expect(c!.fresh + z!.fresh + n!.fresh).toBe(whole.fresh)
    const week = (s: typeof whole) => s.week.unassigned.reduce((a, b) => a + b, 0) + s.rops.reduce((a, r) => a + r.week.reduce((x, y) => x + y, 0), 0)
    expect(week(c!) + week(z!) + week(n!)).toBe(week(whole))
    const bez = (s: typeof whole) => s.bezkval.unassigned.reduce((a, b) => a + b, 0) + s.bezkval.rops.reduce((a, r) => a + r.week.reduce((x, y) => x + y, 0), 0)
    expect(bez(c!) + bez(z!) + bez(n!)).toBe(bez(whole))
  })
})
