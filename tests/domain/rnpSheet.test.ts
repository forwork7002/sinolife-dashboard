import { describe, expect, it } from 'vitest'

import { CALL_DATA_FLOOR } from '@/lib/callQuality'
import {
  CALLS_RELIABLE_FROM,
  type RnpFaktDay,
  type RnpRowDto,
  type RnpSheetInput,
  buildRnpSheet,
} from '@/server/domain/rnp/rnpSheet'

/*
  «RNP jadvali» — the arithmetic the client's sheet got wrong, pinned.

  The fixture is one September with today = 28.09 (27 full days lived), two
  teams — Sevinch (leads) and Charos (a БАЗА team, calls) — and a lead value
  that changes on day 19, as the client's did (400 000 → 500 000).
*/

const days = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`)
const som = (n: number) => BigInt(n) * 100n

const fakt = (day: string, rop: string, o: Partial<Omit<RnpFaktDay, 'day' | 'rop'>>): RnpFaktDay => ({
  day,
  rop,
  fakt1Orders: 0,
  fakt1Minor: 0n,
  fakt2Orders: 0,
  fakt2Minor: 0n,
  refusedOrders: 0,
  refusedMinor: 0n,
  ...o,
})

function input(over: Partial<RnpSheetInput> = {}): RnpSheetInput {
  return {
    month: '2026-09',
    days,
    today: '2026-09-28',
    teams: [
      { rop: 'Sevinch', head: 'Sevinch Usmonova' },
      { rop: 'Charos', head: 'Malika Rahmonova' },
      { rop: 'Bosh', head: null },
    ],
    fakt: [
      fakt('2026-09-17', 'Sevinch', { fakt1Orders: 2, fakt1Minor: som(3_000_000), fakt2Orders: 1, fakt2Minor: som(1_000_000) }),
      fakt('2026-09-21', 'Sevinch', { fakt1Orders: 2, fakt1Minor: som(3_500_000), fakt2Orders: 1, fakt2Minor: som(2_000_000) }),
      // Today's unfinished day: in the fact, not in the pace.
      fakt('2026-09-28', 'Sevinch', { fakt1Orders: 1, fakt1Minor: som(9_000_000) }),
      fakt('2026-09-21', 'Charos', { fakt1Orders: 1, fakt1Minor: som(1_000_000), refusedOrders: 1, refusedMinor: som(1_000_000) }),
      fakt('2026-09-21', '(ROP yoʻq)', { fakt1Orders: 1, fakt1Minor: som(200_000) }),
    ],
    leads: [
      { day: '2026-09-17', rop: 'Sevinch', leads: 4 },
      { day: '2026-09-21', rop: 'Sevinch', leads: 3 },
      { day: '2026-09-21', rop: null, leads: 1 },
    ],
    registration: [{ day: '2026-09-21', leads: 4, duplicates: 1, qualified: 2, aiConversations: 2 }],
    calls: [
      { day: '2026-09-21', rop: 'Charos', employeeId: 'b1', isHead: false, connected: 3 },
      { day: '2026-09-21', rop: 'Charos', employeeId: 'mal', isHead: true, connected: 1 },
      { day: '2026-09-21', rop: 'Sevinch', employeeId: 's1', isHead: false, connected: 2 },
      { day: '2026-09-21', rop: 'Sevinch', employeeId: 's2', isHead: false, connected: 1 },
    ],
    warehouse: [
      { day: '2026-09-21', entered: 3, notPacked: 2 },
      { day: '2026-09-22', entered: 0, notPacked: 1 },
    ],
    meta: [
      { day: '2026-09-21', product: 'Collagen', spendMicroUsd: 100_000_000n, leads: 50 },
      { day: '2026-09-21', product: 'Zextra', spendMicroUsd: 40_000_000n, leads: 10 },
    ],
    plans: {
      rows: [
        { team: '', metric: 'usd_rate', fromDay: 1, valueCenti: 1_220_000n },
        { team: '', metric: 'lead_value', fromDay: 1, valueCenti: 40_000_000n },
        { team: '', metric: 'lead_value', fromDay: 19, valueCenti: 50_000_000n },
        { team: 'Sevinch', metric: 'leads', fromDay: 1, valueCenti: 30_000n },
        { team: 'Sevinch', metric: 'conversion', fromDay: 1, valueCenti: 5_000n },
      ],
      fakt: [{ rop: 'Sevinch', fakt1Minor: som(30_000_000), fakt2Minor: null }],
    },
    registrarKval: [],
    registrarGroups: [],
    noRop: '(ROP yoʻq)',
    canEditPlans: false,
    ...over,
  }
}

const block = (dto: ReturnType<typeof buildRnpSheet>, id: string) => {
  const b = dto.blocks.find((x) => x.id === id)
  if (!b) throw new Error(`no block ${id}`)
  return b
}
const row = (dto: ReturnType<typeof buildRnpSheet>, id: string, key: string): RnpRowDto => {
  const r = block(dto, id).rows.find((x) => x.key === key)
  if (!r) throw new Error(`no row ${key}`)
  return r
}
const on = (r: RnpRowDto, day: string) => r.days[days.indexOf(day)]

describe('buildRnpSheet — the forecast', () => {
  it('runs the fact through the last FULL day at its pace over the real month', () => {
    const dto = buildRnpSheet(input())
    expect(dto.elapsedDays).toBe(27)
    const f1 = row(dto, 'team:Sevinch', 'team:Sevinch:fakt1')
    // Fact includes today's 9 000 000; the pace does not.
    expect(f1.fact).toBe(15_500_000)
    expect(f1.forecast).toBeCloseTo((6_500_000 / 27) * 30, 6)
    // The index is the forecast against the plan, never the fact.
    expect(f1.plan).toBe(30_000_000)
    expect(f1.index).toBeCloseTo(((6_500_000 / 27) * 30 * 100) / 30_000_000, 6)
    expect(f1.dayPlan).toBe(1_000_000)
  })

  it('has no forecast on the first day of a month and equals the fact once the month is over', () => {
    const first = buildRnpSheet(input({ today: '2026-09-01' }))
    expect(row(first, 'team:Sevinch', 'team:Sevinch:fakt1').forecast).toBeNull()
    const after = buildRnpSheet(input({ today: '2026-10-03' }))
    const f1 = row(after, 'team:Sevinch', 'team:Sevinch:fakt1')
    expect(after.elapsedDays).toBe(30)
    expect(f1.forecast).toBe(f1.fact)
  })

  it('leaves days not yet lived empty, never zero', () => {
    const dto = buildRnpSheet(input())
    const f1 = row(dto, 'team:Sevinch', 'team:Sevinch:fakt1')
    expect(on(f1, '2026-09-28')).toBe(9_000_000)
    expect(on(f1, '2026-09-29')).toBeNull()
    expect(on(f1, '2026-09-03')).toBe(0)
  })
})

describe('buildRnpSheet — rates are ratios of sums', () => {
  it('pools the month instead of averaging the days', () => {
    const conv = row(buildRnpSheet(input()), 'team:Sevinch', 'team:Sevinch:conv1')
    expect(on(conv, '2026-09-17')).toBe(50)
    expect(on(conv, '2026-09-21')).toBeCloseTo(66.667, 2)
    // (2 + 2 + 1) ÷ (4 + 3): not the mean of 50% and 66.7%.
    expect(conv.fact).toBeCloseTo((5 / 7) * 100, 6)
    expect(conv.forecast).toBeNull()
    expect(conv.plan).toBe(50)
    expect(conv.index).toBeCloseTo(((5 / 7) * 100 * 100) / 50, 6)
  })

  it('is empty where the denominator is zero', () => {
    const conv = row(buildRnpSheet(input()), 'team:Sevinch', 'team:Sevinch:conv1')
    expect(on(conv, '2026-09-03')).toBeNull()
  })
})

describe('buildRnpSheet — plan completion prices a lead by its own day', () => {
  it('uses 400 000 before the 19th and 500 000 from it', () => {
    const pct = row(buildRnpSheet(input()), 'team:Sevinch', 'team:Sevinch:plan_pct')
    expect(on(pct, '2026-09-17')).toBeCloseTo((3_000_000 / (4 * 400_000)) * 100, 6)
    expect(on(pct, '2026-09-21')).toBeCloseTo((3_500_000 / (3 * 500_000)) * 100, 6)
    expect(pct.fact).toBeCloseTo((15_500_000 / (4 * 400_000 + 3 * 500_000)) * 100, 6)
  })
})

describe('buildRnpSheet — teams', () => {
  it('measures a БАЗА team by its connected calls and a lead team by its leads', () => {
    const dto = buildRnpSheet(input())
    expect(dto.teams.map((t) => [t.rop, t.isBase])).toEqual([
      ['Sevinch', false],
      ['Charos', true],
    ])
    const charos = block(dto, 'team:Charos')
    expect(charos.title).toBe('Малика РОП – БАЗА')
    expect(charos.subtitle).toBe('Charos(ROP) · Malika Rahmonova')
    const reach = charos.rows[0]!
    expect(reach.label).toMatch(/Дозвон/)
    expect(on(reach, '2026-09-21')).toBe(4)
    expect(on(row(dto, 'team:Charos', 'team:Charos:per_call'), '2026-09-21')).toBe(250_000)
  })

  it('counts headcount without the ROP and averages it over the days worked', () => {
    const dto = buildRnpSheet(input())
    const hc = row(dto, 'team:Charos', 'team:Charos:headcount')
    expect(on(hc, '2026-09-21')).toBe(1)
    expect(row(dto, 'team:Sevinch', 'team:Sevinch:headcount').fact).toBe(2)
  })

  it('drops a department with nothing in the month and keeps «ROP yoʻq» out of the team blocks but in the totals', () => {
    const dto = buildRnpSheet(input())
    expect(dto.blocks.some((b) => b.id === 'team:Bosh')).toBe(false)
    expect(dto.blocks.some((b) => b.id === 'team:(ROP yoʻq)')).toBe(false)
    expect(dto.blocks.some((b) => b.id === 'logistics:(ROP yoʻq)')).toBe(true)
    expect(row(dto, 'company', 'co:fakt1').fact).toBe(15_500_000 + 1_000_000 + 200_000)
    const shares = block(dto, 'summary').rows.filter((r) => r.key.startsWith('sv:fakt1:')).map((r) => r.share ?? 0)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6)
  })

  it('reads the FAKT plans from team_month_plan', () => {
    const dto = buildRnpSheet(input())
    expect(row(dto, 'team:Sevinch', 'team:Sevinch:fakt1').planKey).toEqual({ team: 'Sevinch', metric: 'fakt1' })
    expect(row(dto, 'team:Sevinch', 'team:Sevinch:fakt2').plan).toBeNull()
  })
})

describe('buildRnpSheet — company blocks', () => {
  it('splits первичка from БАЗА and prices the marketing on the dollar rate', () => {
    const dto = buildRnpSheet(input())
    expect(row(dto, 'company', 'co:primary_fakt2').fact).toBe(3_000_000)
    expect(row(dto, 'company', 'co:base_fakt2').fact).toBe(0)
    const share = row(dto, 'marketing', 'meta:share')
    expect(on(share, '2026-09-21')).toBeCloseTo((140 * 12_200 * 100) / 2_000_000, 6)
    expect(on(row(dto, 'marketing', 'meta:cac'), '2026-09-21')).toBe(140)
    expect(dto.settings.usdRate).toBe(12_200)
  })

  it('says nothing about the marketing share when no rate is set', () => {
    const dto = buildRnpSheet(input({ plans: { rows: [], fakt: [] } }))
    const share = row(dto, 'marketing', 'meta:share')
    expect(share.fact).toBeNull()
    expect(share.hint).toMatch(/kursi kiritilmagan/)
  })

  it('shows the leads a ROP got against the registrar\'s kval, and the ones nobody got', () => {
    const dto = buildRnpSheet(input())
    expect(on(row(dto, 'registration', 'reg:distributed'), '2026-09-21')).toBe(3)
    expect(on(row(dto, 'registration', 'reg:undistributed'), '2026-09-21')).toBe(1)
    expect(on(row(dto, 'registration', 'reg:difference'), '2026-09-21')).toBe(1)
    expect(row(dto, 'registration', 'reg:distributed').reliableFrom).toBe('2026-09-16')
  })

  it('never sums a snapshot: «не собран» reads the last day and its share has no month', () => {
    const dto = buildRnpSheet(input())
    expect(row(dto, 'warehouse', 'wh:not_packed').fact).toBe(0)
    expect(on(row(dto, 'warehouse', 'wh:not_packed'), '2026-09-22')).toBe(1)
    expect(row(dto, 'warehouse', 'wh:not_packed_pct').fact).toBeNull()
  })

  it('splits a team\'s FAKT 1 into delivered, refused and still in flight', () => {
    const dto = buildRnpSheet(input())
    expect(row(dto, 'logistics:Charos', 'lg:Charos:refused_pct').fact).toBe(100)
    const open = row(dto, 'logistics', 'lg:open_pct')
    // 21.09: 3 500 000 + 1 000 000 + 200 000 ordered, 2 000 000 delivered, 1 000 000 refused.
    expect(on(open, '2026-09-21')).toBeCloseTo((1_700_000 / 4_700_000) * 100, 6)
  })
})

describe('buildRnpSheet — days the portal did not record whole', () => {
  it("draws the days before a row's reliableFrom but never pools or paces them", () => {
    const base = input()
    const dto = buildRnpSheet({
      ...base,
      // 1–15.09: «РОП (Первичка)» on one lead in five, orders counted in full.
      leads: [...base.leads, { day: '2026-09-05', rop: 'Sevinch', leads: 1 }],
      fakt: [...base.fakt, fakt('2026-09-05', 'Sevinch', { fakt1Orders: 5, fakt1Minor: som(5_000_000) })],
    })
    const reach = row(dto, 'team:Sevinch', 'team:Sevinch:reach')
    const conv = row(dto, 'team:Sevinch', 'team:Sevinch:conv1')
    expect(on(reach, '2026-09-05')).toBe(1)
    // The count is drawn; the rate over it is not — 500% is not a measurement.
    expect(on(conv, '2026-09-05')).toBeNull()
    // The month reads 16.09 on: 7 leads, 5 orders — the 05.09 burst is not in it.
    expect(reach.fact).toBe(7)
    expect(conv.fact).toBeCloseTo((5 / 7) * 100, 6)
    // Paced over the 12 full days from 16.09 (16–27), not over 27.
    expect(reach.forecast).toBeCloseTo((7 / 12) * 30, 6)
  })

  it('trusts calls from the day CALL_DATA_FLOOR names', () => {
    const tashkentDay = new Date(CALL_DATA_FLOOR.getTime() + 5 * 3_600_000).toISOString().slice(0, 10)
    expect(CALLS_RELIABLE_FROM).toBe(tashkentDay)
    const dto = buildRnpSheet(input())
    expect(row(dto, 'team:Charos', 'team:Charos:reach').reliableFrom).toBe(CALLS_RELIABLE_FROM)
    expect(row(dto, 'team:Sevinch', 'team:Sevinch:headcount').reliableFrom).toBe(CALLS_RELIABLE_FROM)
  })
})

describe('buildRnpSheet — plans nobody can mean', () => {
  it("prices a БАЗА team's calls only once it has a lead value of its own", () => {
    const without = buildRnpSheet(input())
    expect(block(without, 'team:Charos').rows.some((r) => r.key === 'team:Charos:plan_pct')).toBe(false)
    const base = input()
    const withOwn = buildRnpSheet({
      ...base,
      plans: {
        ...base.plans,
        rows: [...base.plans.rows, { team: 'Charos', metric: 'lead_value', fromDay: 1, valueCenti: 5_000_000n }],
      },
    })
    const pct = row(withOwn, 'team:Charos', 'team:Charos:plan_pct')
    expect(on(pct, '2026-09-21')).toBeCloseTo((1_000_000 / (4 * 50_000)) * 100, 6)
  })

  it('offers no plan for «(ROP yoʻq)»', () => {
    const dto = buildRnpSheet(input())
    const noRop = block(dto, 'summary').rows.filter((r) => r.key.endsWith(':(ROP yoʻq)'))
    expect(noRop).toHaveLength(2)
    expect(noRop.every((r) => r.planKey === null)).toBe(true)
    expect(row(dto, 'logistics:(ROP yoʻq)', 'lg:(ROP yoʻq):success').planKey).toBeNull()
  })
})

describe('buildRnpSheet — the sheet\'s own names and plans', () => {
  it('folds a renamed department\'s deals into the team it is today, once', () => {
    const base = input()
    const dto = buildRnpSheet({
      ...base,
      teams: [...base.teams, { rop: 'Sadriddin', head: 'Mamayusupov Sadriddin' }],
      fakt: [
        ...base.fakt,
        fakt('2026-09-21', 'Sadriddin', { fakt1Orders: 1, fakt1Minor: som(2_000_000) }),
        fakt('2026-09-21', 'Sevinchxon', { fakt1Orders: 1, fakt1Minor: som(3_000_000) }),
      ],
    })
    expect(dto.blocks.some((b) => b.id === 'team:Sevinchxon')).toBe(false)
    const sadriddin = block(dto, 'team:Sadriddin')
    expect(sadriddin.title).toBe('Чарос РОП')
    expect(on(row(dto, 'team:Sadriddin', 'team:Sadriddin:fakt1'), '2026-09-21')).toBe(5_000_000)
    // The company total counts the folded order once.
    expect(on(row(dto, 'company', 'co:fakt1'), '2026-09-21')).toBe(3_500_000 + 1_000_000 + 200_000 + 5_000_000)
    expect(dto.teams.find((t) => t.rop === 'Sadriddin')?.label).toBe('Чарос РОП')
  })

  it('lets «План бажарилиши» and «Отказ %» carry a plan', () => {
    const dto = buildRnpSheet(input())
    expect(row(dto, 'team:Sevinch', 'team:Sevinch:plan_pct').planKey).toEqual({ team: 'Sevinch', metric: 'plan_pct' })
    expect(row(dto, 'logistics:Sevinch', 'lg:Sevinch:refused_pct').planKey).toEqual({ team: 'Sevinch', metric: 'refusal_rate' })
  })

  it('prices the registrar\'s kval by the day\'s lead value in «План продаж» (row 347)', () => {
    const dto = buildRnpSheet(input())
    const plan = row(dto, 'summary', 'sv:sales_plan')
    // 21.09: 2 kval × 500 000 (the value from the 19th in this fixture).
    expect(on(plan, '2026-09-21')).toBe(1_000_000)
    expect(row(dto, 'summary', 'sv:budget').fact).toBe(140)
  })
})

describe('buildRnpSheet — registration «guruh» rows', () => {
  const dto = () =>
    buildRnpSheet(
      input({
        registration: [{ day: '2026-09-02', leads: 819, duplicates: 0, qualified: 150, aiConversations: 0 }],
        registrarKval: [
          { day: '2026-09-02', registrar: 'Фарангиз', qualified: 33 },
          { day: '2026-09-02', registrar: 'Назокат', qualified: 25 },
          { day: '2026-09-02', registrar: 'Рухшона', qualified: 17 },
          { day: '2026-09-02', registrar: 'Ситора', qualified: 20 },
          { day: '2026-09-02', registrar: 'Умида', qualified: 40 },
          { day: '2026-09-02', registrar: null, qualified: 15 },
        ],
        registrarGroups: [
          { registrar: 'Фарангиз', group: 'Sevinch' },
          { registrar: 'Назокат', group: 'Sevinch' },
          { registrar: 'Рухшона', group: 'Zextra' },
          { registrar: 'Ситора', group: 'Zextra' },
        ],
      }),
    )

  it('counts a group\'s kval over its registrars — the sheet\'s 58 on 02.09', () => {
    const d = dto()
    expect(on(row(d, 'registration', 'reg:group:Sevinch:qualified'), '2026-09-02')).toBe(58)
    expect(row(d, 'registration', 'reg:group:Sevinch:qualified').sheet).toEqual({ row: 51, label: 'Sevinch guruh — квал' })
  })

  it('splits the desk into Collagen and Zextra and names each Zextra registrar', () => {
    const d = dto()
    expect(on(row(d, 'registration', 'reg:zextra:qualified'), '2026-09-02')).toBe(37)
    expect(on(row(d, 'registration', 'reg:qualified_collagen'), '2026-09-02')).toBe(150 - 37)
    expect(on(row(d, 'registration', 'reg:registrar:Рухшона'), '2026-09-02')).toBe(17)
    expect(row(d, 'registration', 'reg:registrar:Ситора').sheet).toEqual({ row: 73, label: 'Ситора - 2' })
  })

  it('keeps the kval of an unassigned registrar visible so the rows still add up', () => {
    const d = dto()
    // Умида (no group yet) 40 + a WON deal with no registrar 15.
    expect(on(row(d, 'registration', 'reg:group:none:qualified'), '2026-09-02')).toBe(55)
    expect(on(row(d, 'registration', 'reg:group:Gulzora:qualified'), '2026-09-02')).toBe(0)
    expect(d.registration.registrars).toContain('Умида')
    expect(d.registration.groupNames).toEqual(['Sevinch', 'Gulzora', 'Aziz', 'Maftuna', 'Lola', 'Saidaziz', 'Zextra'])
  })
})

describe('buildRnpSheet — the brand P&L (rows 394–445)', () => {
  const dto = () => {
    const base = input()
    return buildRnpSheet({
      ...base,
      fakt: [
        fakt('2026-09-21', 'Sevinch', { brand: 'Collagen', fakt1Orders: 2, fakt1Minor: som(3_000_000), fakt2Orders: 1, fakt2Minor: som(2_000_000) }),
        fakt('2026-09-21', 'Charos', { brand: 'Collagen', fakt1Orders: 1, fakt1Minor: som(1_000_000), fakt2Orders: 1, fakt2Minor: som(1_000_000) }),
        fakt('2026-09-21', 'Sevinch', { brand: 'Zextra', fakt1Orders: 1, fakt1Minor: som(1_500_000) }),
        fakt('2026-09-21', 'Sevinch', { brand: null, fakt1Orders: 1, fakt1Minor: som(500_000) }),
      ],
      registration: [
        { day: '2026-09-21', brand: 'Collagen', leads: 10, duplicates: 0, qualified: 4, aiConversations: 0 },
        { day: '2026-09-21', brand: null, leads: 3, duplicates: 0, qualified: 1, aiConversations: 0 },
      ],
      plans: {
        ...base.plans,
        rows: [
          ...base.plans.rows,
          { team: '', metric: 'marketing_plan_pct', fromDay: 1, valueCenti: 1_100n },
          { team: '', metric: 'targetolog_pct', fromDay: 1, valueCenti: 1_000n },
          { team: '', metric: 'marketer_pct', fromDay: 1, valueCenti: 100n },
        ],
      },
    })
  }
  const d21 = (d: ReturnType<typeof buildRnpSheet>, key: string) => on(row(d, key.split(':').slice(0, 2).join(':').replace('pj:', 'project:'), key), '2026-09-21')

  it('splits the money by the order\'s brand, первичка from БАЗА', () => {
    const d = dto()
    expect(d21(d, 'pj:collagen:fakt1')).toBe(4_000_000)
    expect(d21(d, 'pj:collagen:primary_fakt2')).toBe(2_000_000)
    expect(d21(d, 'pj:collagen:base_fakt2')).toBe(1_000_000)
    expect(d21(d, 'pj:zextra:fakt1')).toBe(1_500_000)
    expect(on(row(d, 'project:none', 'pj:none:fakt1'), '2026-09-21')).toBe(500_000)
  })

  it('costs the marketing as the sheet does: budget × rate, +10 %, + typed lines, +1 % of ФАКТ 2', () => {
    const d = dto()
    const spendUzs = 100 * 12_200
    expect(d21(d, 'pj:collagen:spend_uzs')).toBe(spendUzs)
    expect(d21(d, 'pj:collagen:cost_targetolog')).toBe(spendUzs * 0.1)
    expect(d21(d, 'pj:collagen:cost_marketer')).toBe(3_000_000 * 0.01)
    expect(d21(d, 'pj:collagen:cost_fact')).toBe(spendUzs * 1.1 + 30_000)
    expect(d21(d, 'pj:collagen:cost_plan')).toBe(3_000_000 * 0.11)
    expect(d.blocks.find((b) => b.id === 'project:collagen')!.rows.some((r) => r.key.includes('cost_blogger'))).toBe(false)
    // CAC in dollars over the первичка orders delivered.
    expect(d21(d, 'pj:collagen:cac')).toBeCloseTo((spendUzs * 1.1 + 30_000) / 12_200 / 1, 6)
  })

  it('counts leads by brand and puts the P&L after «Свод»', () => {
    const d = dto()
    expect(d21(d, 'pj:collagen:leads')).toBe(10)
    expect(d21(d, 'pj:collagen:qualified_pct')).toBe(40)
    const ids = d.blocks.map((b) => b.id)
    expect(ids.indexOf('project:collagen')).toBeGreaterThan(ids.indexOf('summary'))
    expect(d.settings.marketingPlanPct).toBe(11)
  })
})

describe('buildRnpSheet — review fixes', () => {
  it('draws dashes, not zeros, where the dollar rate is missing', () => {
    const d = buildRnpSheet(input({ plans: { rows: [], fakt: [] } }))
    const spend = row(d, 'project:collagen', 'pj:collagen:spend_uzs')
    expect(spend.fact).toBeNull()
    expect(on(spend, '2026-09-21')).toBeNull()
    expect(row(d, 'project:collagen', 'pj:collagen:cac').fact).toBeNull()
  })

  it('takes the kval total from the per-registrar read when it has one', () => {
    const d = buildRnpSheet(
      input({
        registration: [{ day: '2026-09-21', leads: 4, duplicates: 0, qualified: 9, aiConversations: 0 }],
        registrarKval: [{ day: '2026-09-21', registrar: 'Умида', qualified: 7 }],
      }),
    )
    expect(on(row(d, 'registration', 'reg:qualified'), '2026-09-21')).toBe(7)
  })
})

describe('buildRnpSheet — the sheet\'s own rows (the «Jadvaldagidek» view)', () => {
  const d = () => buildRnpSheet(input({ teams: [...input().teams, { rop: 'Sadriddin', head: 'Mamayusupov Sadriddin' }] }))

  it('puts each ROP row where the sheet has it, under the sheet\'s label', () => {
    const x = d()
    expect(block(x, 'team:Sevinch').sheet).toEqual({ row: 89, label: 'Севинч РОП' })
    expect(row(x, 'team:Sevinch', 'team:Sevinch:fakt1').sheet).toEqual({ row: 93, label: 'Сумма факт 1 сум' })
    expect(row(x, 'team:Charos', 'team:Charos:reach').sheet?.row).toBe(156)
    expect(row(x, 'logistics:Sevinch', 'lg:Sevinch:refused').sheet).toEqual({ row: 278, label: 'Отказ сумма' })
  })

  it('leaves the dashboard\'s additions off the sheet', () => {
    const x = d()
    expect(row(x, 'registration', 'reg:duplicates').sheet).toBeNull()
    expect(row(x, 'logistics:Sevinch', 'lg:Sevinch:open_pct').sheet).toBeNull()
    expect(block(x, 'logistics').sheet).toBeNull()
    expect(block(x, 'project:none').sheet).toBeNull()
  })

  it('numbers the «Свод» team rows in the sheet\'s order', () => {
    const x = d()
    expect(row(x, 'summary', 'sv:fakt1:Sevinch').sheet).toEqual({ row: 353, label: 'Севинч РОП факт1' })
    expect(row(x, 'summary', 'sv:fakt2:Charos').sheet).toEqual({ row: 370, label: 'Малика РОП – БАЗА факт2' })
    expect(row(x, 'summary', 'sv:difference').sheet?.row).toBe(379)
  })

  it('has no typed rows at all', () => {
    const x = d()
    expect(x.blocks.some((b) => (b.kind as string) === 'social' || (b.kind as string) === 'hr')).toBe(false)
  })
})
