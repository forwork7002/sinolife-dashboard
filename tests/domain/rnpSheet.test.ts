import { describe, expect, it } from 'vitest'

import { CALL_DATA_FLOOR } from '@/lib/callQuality'
import {
  CALLS_RELIABLE_FROM,
  RNP_PLAN_METRICS,
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
    // The Central Bank's rate for each day reached; none after today.
    usdRates: days.map((d) => (d <= '2026-09-28' ? 12_200 : null)),
    manualCosts: [],
    manualHeadcount: [],
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
      { day: '2026-09-21', rop: 'Charos', connected: 3 },
      { day: '2026-09-21', rop: 'Charos', connected: 1 },
      { day: '2026-09-21', rop: 'Sevinch', connected: 2 },
      { day: '2026-09-21', rop: 'Sevinch', connected: 1 },
    ],
    warehouse: [
      { day: '2026-09-21', entered: 3, notPacked: 2 },
      { day: '2026-09-22', entered: 0, notPacked: 1 },
    ],
    meta: [
      { day: '2026-09-21', product: 'Collagen', spendMicroUsd: 100_000_000n, impressions: 20_000, clicks: 400, leads: 50 },
      { day: '2026-09-21', product: 'Zextra', spendMicroUsd: 40_000_000n, impressions: 9_000, clicks: 90, leads: 10 },
    ],
    plans: {
      rows: [
        { team: '', metric: 'lead_value', fromDay: 1, valueCenti: 40_000_000n },
        { team: '', metric: 'lead_value', fromDay: 19, valueCenti: 50_000_000n },
        { team: 'Sevinch', metric: 'leads', fromDay: 1, valueCenti: 30_000n },
        // 200 000 a cheque: 30 M ÷ 200 000 = 150 orders planned, 150 ÷ 300 leads = a 50% conversion plan.
        { team: 'Sevinch', metric: 'avg_cheque1', fromDay: 1, valueCenti: 20_000_000n },
      ],
      fakt: [{ rop: 'Sevinch', fakt1Minor: som(30_000_000), fakt2Minor: null }],
    },
    registrarKval: [],
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
  it('forecasts as the sheet does: the fact so far ÷ today\'s day (today counted) × the real month', () => {
    const dto = buildRnpSheet(input())
    expect(dto.elapsedDays).toBe(28)
    const f1 = row(dto, 'team:Sevinch', 'team:Sevinch:fakt1')
    // Today is the 28th: `=D/$C$2*$C$1` with C2 = 28 and the month's 30 days (the sheet typed 31).
    expect(f1.fact).toBe(15_500_000)
    expect(f1.forecast).toBeCloseTo((15_500_000 / 28) * 30, 6)
    // The index is the forecast against the plan, never the fact.
    expect(f1.plan).toBe(30_000_000)
    expect(f1.index).toBeCloseTo(((15_500_000 / 28) * 30 * 100) / 30_000_000, 6)
    // The sheet's `=C/27`.
    expect(f1.dayPlan).toBeCloseTo(30_000_000 / 27, 6)
  })

  it('paces a row trusted only from a later day over the days since then', () => {
    // Charos's calls are trusted from 15.09: 14 days counted by the 28th, today included.
    const reach = row(buildRnpSheet(input()), 'team:Charos', 'team:Charos:reach')
    expect(reach.reliableFrom).toBe(CALLS_RELIABLE_FROM)
    expect(reach.forecast).toBeCloseTo((reach.fact! / 14) * 30, 6)
  })

  it('forecasts from the first day, and equals the fact once the month is over — for a row trusted every day', () => {
    const first = buildRnpSheet(input({ today: '2026-09-01' }))
    const day1 = row(first, 'team:Sevinch', 'team:Sevinch:fakt1')
    expect(day1.forecast).toBe(day1.fact! * 30)
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
    const isBase = new Map(dto.teams.map((t) => [t.rop, t.isBase]))
    expect(isBase.get('Sevinch')).toBe(false)
    expect(isBase.get('Charos')).toBe(true)
    // The sheet's order, not the month's FAKT 1 (2026-10-02): Гулзора's block comes first though she sold nothing.
    expect(dto.teams.slice(0, 3).map((t) => t.rop)).toEqual(['Gulzora', 'Sevinch', 'Lola'])
    const charos = block(dto, 'team:Charos')
    // The sheet's own hyphen, as its rows 161 / 299 write it.
    expect(charos.title).toBe('Малика РОП - БАЗА')
    expect(charos.subtitle).toBe('Charos(ROP) · Malika Rahmonova')
    const reach = charos.rows[0]!
    expect(reach.label).toMatch(/Дозвон/)
    expect(on(reach, '2026-09-21')).toBe(4)
    expect(on(row(dto, 'team:Charos', 'team:Charos:per_call'), '2026-09-21')).toBe(250_000)
  })

  it('takes «Ходим сони» as typed — empty where nobody typed, the month the mean of the typed days (2026-10-01)', () => {
    // Calls no longer count staff: with nothing typed every day is empty, not the callers.
    const blank = row(buildRnpSheet(input()), 'team:Sevinch', 'team:Sevinch:headcount')
    expect(on(blank, '2026-09-21')).toBeNull()
    expect(blank.fact).toBeNull()
    expect(blank.manual).toEqual({ kind: 'headcount', rop: 'Sevinch' })
    expect(blank.reliableFrom).toBeNull()

    const dto = buildRnpSheet(
      input({
        manualHeadcount: [
          { day: '2026-09-20', rop: 'Sevinch', heads: 6 },
          { day: '2026-09-21', rop: 'Sevinch', heads: 8 },
          { day: '2026-09-30', rop: 'Sevinch', heads: 9 }, // after today: not shown, not counted
        ],
      }),
    )
    const hc = row(dto, 'team:Sevinch', 'team:Sevinch:headcount')
    expect(on(hc, '2026-09-20')).toBe(6)
    expect(on(hc, '2026-09-21')).toBe(8)
    expect(on(hc, '2026-09-22')).toBeNull()
    expect(hc.fact).toBe(7)
    expect(row(dto, 'team:Charos', 'team:Charos:headcount').fact).toBeNull()
  })

  it('shows a typed 0 on its day but leaves it out of the month, and folds an alias into its team', () => {
    const dto = buildRnpSheet(
      input({
        manualHeadcount: [
          { day: '2026-09-20', rop: 'Sevinch', heads: 0 },
          { day: '2026-09-21', rop: 'Sevinch', heads: 4 },
          { day: '2026-09-21', rop: 'Lola', heads: 0 },
          { day: '2026-09-21', rop: 'Sevinchxon', heads: 5 }, // the old name of Sadriddin's department
        ],
      }),
    )
    const sevinch = row(dto, 'team:Sevinch', 'team:Sevinch:headcount')
    expect(on(sevinch, '2026-09-20')).toBe(0)
    expect(sevinch.fact).toBe(4)
    expect(row(dto, 'team:Lola', 'team:Lola:headcount').fact).toBeNull()
    expect(on(row(dto, 'team:Sadriddin', 'team:Sadriddin:headcount'), '2026-09-21')).toBe(5)
    // «ROP yoʻq» has no team block, so nothing to type a headcount into.
    expect(dto.blocks.flatMap((b) => b.rows).filter((r) => r.manual?.kind === 'headcount').every((r) => r.key !== 'team:(ROP yoʻq):headcount')).toBe(true)
  })

  it('drops a department with nothing in the month and keeps «ROP yoʻq» out of the team blocks but in the totals', () => {
    const dto = buildRnpSheet(input())
    expect(dto.blocks.some((b) => b.id === 'team:Bosh')).toBe(false)
    expect(dto.blocks.some((b) => b.id === 'team:(ROP yoʻq)')).toBe(false)
    expect(dto.blocks.some((b) => b.id === 'logistics:(ROP yoʻq)')).toBe(true)
    expect(row(dto, 'summary', 'sv:fakt1').fact).toBe(15_500_000 + 1_000_000 + 200_000)
  })

  it('reads the FAKT plans from team_month_plan', () => {
    const dto = buildRnpSheet(input({ plans: { rows: [], fakt: [{ rop: 'Sevinch', fakt1Minor: som(30_000_000), fakt2Minor: null }] } }))
    expect(row(dto, 'team:Sevinch', 'team:Sevinch:fakt1').plan).toBe(30_000_000)
    expect(row(dto, 'team:Sevinch', 'team:Sevinch:fakt2').plan).toBeNull()
  })
})

describe('buildRnpSheet — company blocks', () => {
  it('prices the marketing on the dollar rate', () => {
    const dto = buildRnpSheet(input())
    const share = row(dto, 'marketing', 'meta:share')
    expect(on(share, '2026-09-21')).toBeCloseTo((140 * 12_200 * 100) / 2_000_000, 6)
    expect(on(row(dto, 'marketing', 'meta:cac'), '2026-09-21')).toBe(140)
    // The sheet's row 45, `=IFERROR(G42/G47,0)`: the budget over the Регистрация leads (140 $ ÷ 4).
    expect(on(row(dto, 'marketing', 'meta:cost_per_reg_lead'), '2026-09-21')).toBe(35)
    expect(dto.lines.find((l) => l.row === 45)).toMatchObject({ kind: 'value', key: 'meta:cost_per_reg_lead' })
    expect(dto.settings.usdRate).toBe(12_200)
    expect(dto.settings.usdRateDate).toBe('2026-09-28')
  })

  it('says nothing about the marketing share when the bank gave no rate', () => {
    const dto = buildRnpSheet(input({ usdRates: days.map(() => null) }))
    const share = row(dto, 'marketing', 'meta:share')
    expect(share.fact).toBeNull()
    expect(share.hint).toMatch(/Markaziy bank kursi olinmadi/)
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
    // The sheet's «Отказ %» = 1 − «Успешкность %»: what is still on its way counts too (the client, 2026-10-01).
    const success = on(row(dto, 'logistics', 'lg:success'), '2026-09-21')!
    expect(on(row(dto, 'logistics', 'lg:refused_pct'), '2026-09-21')).toBeCloseTo(100 - success, 6)
    expect(row(dto, 'logistics', 'lg:refused_pct').fact).toBeCloseTo(100 - row(dto, 'logistics', 'lg:success').fact!, 6)
    // A day whose FAKT 2 runs past its FAKT 1 still keeps the month at exactly 100 − success.
    const over = buildRnpSheet(
      input({
        fakt: [
          fakt('2026-09-20', 'Sevinch', { fakt1Orders: 1, fakt1Minor: som(100), fakt2Orders: 1, fakt2Minor: som(120) }),
          fakt('2026-09-21', 'Sevinch', { fakt1Orders: 1, fakt1Minor: som(100), fakt2Orders: 1, fakt2Minor: som(50) }),
        ],
      }),
    )
    expect(row(over, 'logistics:Sevinch', 'lg:Sevinch:success').fact).toBeCloseTo(85, 6)
    expect(row(over, 'logistics:Sevinch', 'lg:Sevinch:refused_pct').fact).toBeCloseTo(15, 6)
    const open = row(dto, 'logistics', 'lg:open_pct')
    // 21.09: 3 500 000 + 1 000 000 + 200 000 ordered, 2 000 000 delivered, 1 000 000 refused.
    expect(on(open, '2026-09-21')).toBeCloseTo((1_700_000 / 4_700_000) * 100, 6)
  })
})

describe('buildRnpSheet — days the portal did not record whole', () => {
  it('counts every day of the leads a ROP got, as the portal filter does, but divides no rate by the early ones', () => {
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
    // The count is the portal's: every day, 05.09 included (the client, 2026-09-30).
    expect(reach.fact).toBe(8)
    expect(reach.reliableFrom).toBeNull()
    expect(reach.forecast).toBeCloseTo((8 / 28) * 30, 6)
    // The rate still reads 16.09 on: 7 leads, 5 orders — the 05.09 burst is not in it.
    expect(conv.fact).toBeCloseTo((5 / 7) * 100, 6)
  })

  it('trusts calls from the day CALL_DATA_FLOOR names', () => {
    const tashkentDay = new Date(CALL_DATA_FLOOR.getTime() + 5 * 3_600_000).toISOString().slice(0, 10)
    expect(CALLS_RELIABLE_FROM).toBe(tashkentDay)
    const dto = buildRnpSheet(input())
    expect(row(dto, 'team:Charos', 'team:Charos:reach').reliableFrom).toBe(CALLS_RELIABLE_FROM)
  })
})

describe('buildRnpSheet — plans nobody can mean', () => {
  it("prices a БАЗА team's calls at the lead's value, as the sheet does — its own value when it has one", () => {
    const without = buildRnpSheet(input())
    // The sheet's `=G160/(G156*400000)`: 1 000 000 over 4 calls × the company's 500 000 (from the 19th).
    const pctCompany = row(without, 'team:Charos', 'team:Charos:plan_pct')
    expect(on(pctCompany, '2026-09-21')).toBeCloseTo((1_000_000 / (4 * 500_000)) * 100, 6)
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
    expect(row(dto, 'logistics:(ROP yoʻq)', 'lg:(ROP yoʻq):success').plan).toBeNull()
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
    expect(sadriddin.title).toBe('Садриддин РОП') // the sheet's «Чарос РОП», renamed by the client
    expect(on(row(dto, 'team:Sadriddin', 'team:Sadriddin:fakt1'), '2026-09-21')).toBe(5_000_000)
    // The company total counts the folded order once.
    expect(on(row(dto, 'summary', 'sv:fakt1'), '2026-09-21')).toBe(3_500_000 + 1_000_000 + 200_000 + 5_000_000)
    expect(dto.teams.find((t) => t.rop === 'Sadriddin')?.label).toBe('Садриддин РОП')
  })

  it('lets «План бажарилиши» carry a typed plan, and «Отказ %» follow the success plan as the sheet\'s 1 − C271', () => {
    const rows = [
      { team: 'Sevinch', metric: 'plan_pct', fromDay: 1, valueCenti: 8_000n },
      { team: 'Sevinch', metric: 'success_rate', fromDay: 1, valueCenti: 9_000n },
    ]
    const dto = buildRnpSheet(input({ plans: { rows, fakt: [] } }))
    expect(row(dto, 'team:Sevinch', 'team:Sevinch:plan_pct').plan).toBe(80)
    expect(row(dto, 'team:Sevinch', 'team:Sevinch:plan_pct').planInput).toEqual({ team: 'Sevinch', metric: 'plan_pct' })
    expect(row(dto, 'logistics:Sevinch', 'lg:Sevinch:refused_pct').plan).toBe(10)
    expect(row(dto, 'logistics:Sevinch', 'lg:Sevinch:refused_pct').planInput).toBeNull()
  })

  it('derives the plans the sheet computes and leaves only the typed ones open', () => {
    const rows = [
      { team: 'Sevinch', metric: 'leads', fromDay: 1, valueCenti: 30_000n },
      { team: 'Sevinch', metric: 'avg_cheque1', fromDay: 1, valueCenti: 20_000_000n },
      { team: 'Sevinch', metric: 'avg_cheque2', fromDay: 1, valueCenti: 25_000_000n },
      { team: '', metric: 'reg_qualified', fromDay: 1, valueCenti: 1_735_000n },
      { team: '', metric: 'reg_qualified_pct', fromDay: 1, valueCenti: 5_000n },
    ]
    const dto = buildRnpSheet(input({ plans: { rows, fakt: [{ rop: 'Sevinch', fakt1Minor: som(30_000_000), fakt2Minor: som(20_000_000) }] } }))
    const r = (key: string) => row(dto, 'team:Sevinch', `team:Sevinch:${key}`)
    // C92 `=C93/C91`, C90 `=C92/C89`, C97 `=C96/C99`, C98 `=C97/C89`.
    expect(r('orders1').plan).toBe(150)
    expect(r('conv1').plan).toBe(50)
    expect(r('orders2').plan).toBe(80)
    expect(r('conv2').plan).toBeCloseTo((80 / 300) * 100, 6)
    for (const key of ['orders1', 'conv1', 'orders2', 'conv2']) expect(r(key).planInput).toBeNull()
    for (const [key, metric] of [['reach', 'leads'], ['cheque1', 'avg_cheque1'], ['fakt1', 'fakt1'], ['plan_pct', 'plan_pct'], ['headcount', 'headcount'], ['fakt2', 'fakt2'], ['cheque2', 'avg_cheque2']] as const) {
      expect(r(key).planInput).toEqual({ team: 'Sevinch', metric })
    }
    // C47 `=C48/C49`: 17 350 kval at 50% is 34 700 leads.
    expect(row(dto, 'registration', 'reg:leads').plan).toBe(34_700)
    expect(row(dto, 'registration', 'reg:leads').planInput).toBeNull()
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
        // «Сделка успешна» by its closing day — row 48 only, never the groups.
        registrarKval: [{ day: '2026-09-02', registrar: 'Фарангиз', qualified: 999 }],
        // The leads handed to each ROP team that day.
        leads: [
          { day: '2026-09-02', rop: 'Sevinch', leads: 57 },
          { day: '2026-09-02', rop: 'Azizbek', leads: 13 },
          { day: '2026-09-02', rop: 'Lola', leads: 25 },
          { day: '2026-09-02', rop: 'Shohjaxon', leads: 6 },
          // A БАЗА head's: counted, but in no group — the team is measured by calls.
          { day: '2026-09-02', rop: 'Charos', leads: 2 },
          // Not handed to a ROP team (the Регистрация copy, the desk head): no row counts it.
          { day: '2026-09-02', rop: null, leads: 50 },
        ],
      }),
    )

  it('counts a group\'s kval as the leads handed to the team it is named after — the series of its «Квал лид сони» (2026-10-02)', () => {
    const d = dto()
    expect(on(row(d, 'registration', 'reg:group:Sevinch:qualified'), '2026-09-02')).toBe(57)
    // «Aziz guruh» is Azizbek's team.
    expect(on(row(d, 'registration', 'reg:group:Aziz:qualified'), '2026-09-02')).toBe(13)
    expect(row(d, 'registration', 'reg:group:Lola:qualified').days).toEqual(row(d, 'team:Lola', 'team:Lola:reach').days)
    expect(on(row(d, 'registration', 'reg:qualified_collagen'), '2026-09-02')).toBe(999)
    expect(row(d, 'registration', 'reg:group:Sevinch:qualified').sheet).toEqual({ row: 51, label: 'Sevinch guruh — квал' })
    expect(row(d, 'registration', 'reg:group:Sevinch:qualified').hint).toContain('Севинч РОП')
  })

  it('never dashes a group: a team handed nothing got 0, which is a measurement', () => {
    const d = dto()
    expect(on(row(d, 'registration', 'reg:group:Gulzora:qualified'), '2026-09-02')).toBe(0)
    expect(row(d, 'registration', 'reg:group:Gulzora:qualified').fact).toBe(0)
  })

  it('has no Zextra desk any more: «Регистрация COLLAGEN» is every kval, and Asliddin / Sadriddin are groups', () => {
    const d = dto()
    expect(d.blocks.flatMap((b) => b.rows).some((r) => r.key.startsWith('reg:zextra') || r.key.startsWith('reg:registrar:'))).toBe(false)
    expect(on(row(d, 'registration', 'reg:qualified_collagen'), '2026-09-02')).toBe(999)
    expect(row(d, 'registration', 'reg:group:Asliddin:qualified').sheet?.row).toBe(1002)
    expect(row(d, 'registration', 'reg:group:Sadriddin:qualified').sheet?.row).toBe(1012)
  })

  it('puts the leads of every team with no group row in «Boshqa jamoalar», so the rows add up to «РОП ларга тарқатилди»', () => {
    const d = dto()
    const others = row(d, 'registration', 'reg:group:none:qualified')
    expect(others.label).toBe('Boshqa jamoalar — квал')
    expect(on(others, '2026-09-02')).toBe(8)
    // The hint names who is in it.
    expect(others.hint).toContain('Шохжахон РОП')
    expect(others.hint).toContain('Малика РОП - БАЗА')
    const groups = d.blocks.find((b) => b.id === 'registration')!.rows.filter((r) => r.key.startsWith('reg:group:'))
    const sum = groups.reduce((acc, r) => acc + (on(r, '2026-09-02') ?? 0), 0)
    expect(sum).toBe(57 + 13 + 25 + 6 + 2)
    expect(on(row(d, 'registration', 'reg:distributed'), '2026-09-02')).toBe(sum)
  })
})

describe('buildRnpSheet — the brand P&L (rows 394–445)', () => {
  const dto = () => {
    const base = input()
    return buildRnpSheet({
      ...base,
      fakt: [
        // The brand is the selling team's, as the sheet's SUMIFS lists them (Baza is Collagen's БАЗА).
        fakt('2026-09-21', 'Sevinch', { fakt1Orders: 2, fakt1Minor: som(3_000_000), fakt2Orders: 1, fakt2Minor: som(2_000_000) }),
        fakt('2026-09-21', 'Baza', { fakt1Orders: 1, fakt1Minor: som(1_000_000), fakt2Orders: 1, fakt2Minor: som(1_000_000) }),
        fakt('2026-09-21', 'Asliddin', { fakt1Orders: 1, fakt1Minor: som(1_000_000) }),
        // «Sevinchxon(ROP)» is on the sheet's Zextra list — folded into Sadriddin, still Zextra.
        fakt('2026-09-21', 'Sevinchxon', { fakt1Orders: 1, fakt1Minor: som(500_000) }),
        // Hayot is on neither list.
        fakt('2026-09-21', 'Hayot', { fakt1Orders: 1, fakt1Minor: som(500_000) }),
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

  it('splits the money by the selling team\'s brand, первичка from БАЗА', () => {
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
    // The typed lines are there (editable), empty while nobody typed them.
    expect(row(d, 'project:collagen', 'pj:collagen:cost_bloggers').fact).toBeNull()
    expect(row(d, 'project:collagen', 'pj:collagen:cost_bloggers').manual).toEqual({ kind: 'cost', project: 'Collagen', line: 'bloggers' })
    // CAC in dollars over the первичка orders delivered.
    expect(d21(d, 'pj:collagen:cac')).toBeCloseTo((spendUzs * 1.1 + 30_000) / 12_200 / 1, 6)
  })

  it('takes the sheet\'s own percentages when the month has none saved: plan 11 %, targetolog 10 %, marketolog 1 %', () => {
    const base = input()
    const d = buildRnpSheet({ ...base, fakt: [fakt('2026-09-21', 'Sevinch', { fakt1Orders: 1, fakt1Minor: som(3_000_000), fakt2Orders: 1, fakt2Minor: som(2_000_000) })] })
    const spendUzs = 100 * 12_200
    expect(d21(d, 'pj:collagen:cost_plan')).toBe(2_000_000 * 0.11)
    expect(d21(d, 'pj:collagen:cost_targetolog')).toBe(spendUzs * 0.1)
    expect(d21(d, 'pj:collagen:cost_marketer')).toBe(2_000_000 * 0.01)
  })

  it('counts «Malika(ROP)» as Charos (Zextra) and an order with no ROP as «Brendsiz»', () => {
    const d = buildRnpSheet(
      input({
        fakt: [
          fakt('2026-09-21', 'Malika', { fakt1Orders: 1, fakt1Minor: som(700_000), fakt2Orders: 1, fakt2Minor: som(700_000) }),
          fakt('2026-09-21', '(ROP yoʻq)', { fakt1Orders: 1, fakt1Minor: som(300_000) }),
        ],
      }),
    )
    expect(d21(d, 'pj:zextra:fakt1')).toBe(700_000)
    // Charos is the БАЗА team of the Zextra list: base, not первичка.
    expect(d21(d, 'pj:zextra:base_fakt2')).toBe(700_000)
    expect(d21(d, 'pj:zextra:primary_fakt2')).toBe(0)
    expect(on(row(d, 'project:none', 'pj:none:fakt1'), '2026-09-21')).toBe(300_000)
  })

  it('counts leads by brand and puts the P&L after «Свод»', () => {
    const d = dto()
    expect(d21(d, 'pj:collagen:leads')).toBe(10)
    expect(d21(d, 'pj:collagen:qualified_pct')).toBe(40)
    const ids = d.blocks.map((b) => b.id)
    expect(ids.indexOf('project:collagen')).toBeGreaterThan(ids.indexOf('summary'))
  })
})

describe('buildRnpSheet — review fixes', () => {
  it('draws dashes, not zeros, where the dollar rate is missing', () => {
    const d = buildRnpSheet(input({ usdRates: days.map(() => null) }))
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

  it('has no typed rows at all', () => {
    const x = d()
    expect(x.blocks.some((b) => (b.kind as string) === 'social' || (b.kind as string) === 'hr')).toBe(false)
  })
})

describe('buildRnpSheet — the page is the client\'s sheet, row by row', () => {
  const lineAt = (dto: ReturnType<typeof buildRnpSheet>, sheetRow: number) => dto.lines.find((l) => l.row === sheetRow)

  it('keeps every titled sheet row in its order, under the sheet\'s label', () => {
    const x = buildRnpSheet(input())
    const rows = x.lines.flatMap((l) => (l.row === null ? [] : [l.row]))
    const before = (a: number, b: number) => expect(rows.indexOf(a)).toBeLessThan(rows.indexOf(b))
    // The client's order (2026-09-30): totals above the targets, 47 under 48,
    // the new groups after Saidaziz, plan % first in a ROP block; then (2026-10-01)
    // the reach right under it, as «Квал лид сони»; «Жами лид сони» over «Жами квал сони».
    before(44, 13)
    before(47, 48)
    before(48, 49)
    before(67, 1001)
    before(81, 76)
    before(76, 77)
    expect(lineAt(x, 13)).toMatchObject({ kind: 'title', label: 'Таргет Collagen' })
    expect(lineAt(x, 37)).toMatchObject({ kind: 'title', label: 'Таргет Zextra' })
    expect(lineAt(x, 94)).toMatchObject({ kind: 'value', sub: 'Севинч РОП', key: 'team:Sevinch:plan_pct' })
    expect(lineAt(x, 274)).toMatchObject({ sub: 'Севинч РОП' }) // was «Бунёд»
    expect(lineAt(x, 4)).toMatchObject({ kind: 'title', label: 'Маркетинг COLLAGEN', sub: 'Хаёт' })
    expect(lineAt(x, 93)).toMatchObject({ kind: 'value', label: 'Сумма факт 1 сум', key: 'team:Sevinch:fakt1' })
    expect(lineAt(x, 47)).toMatchObject({ kind: 'value', label: 'Жами лид сони', key: 'reg:leads' })
    expect(lineAt(x, 48)).toMatchObject({ kind: 'value', label: 'Жами квал сони', key: 'reg:qualified_collagen' })
    expect(lineAt(x, 89)).toMatchObject({ kind: 'value', label: 'Квал лид сони', key: 'team:Sevinch:reach' })
    expect(lineAt(x, 156)).toMatchObject({ kind: 'value', label: 'Дозвон сони', key: 'team:Charos:reach' })
  })

  it('leaves a row Bitrix24 cannot supply in place, empty', () => {
    const x = buildRnpSheet(input())
    expect(lineAt(x, 2003)).toMatchObject({ kind: 'value', label: 'Кол подписчиков', key: null })
    expect(lineAt(x, 5)).toBeUndefined() // the follower rows — the funnel took their place
    expect(lineAt(x, 337)).toBeUndefined() // HR — removed by the client
    expect(lineAt(x, 70)).toBeUndefined() // the Zextra registration — removed
    expect(lineAt(x, 210)).toBeUndefined() // Саида — removed
    expect(lineAt(x, 165)).toBeUndefined() // a БАЗА block's «Конверсия % факт2» — removed
    expect(lineAt(x, 353)).toBeUndefined() // the per-ROP «Свод» — removed
    expect(lineAt(x, 50)).toMatchObject({ kind: 'value', sub: 'без квал', key: null })
  })

  it('fills a sheet team with zeros in a quiet month rather than calling it missing', () => {
    const x = buildRnpSheet(input())
    expect(lineAt(x, 170)).toMatchObject({ kind: 'value', key: 'team:Marjona:reach' })
  })

  it('shows an unlabelled helper row only when Bitrix24 fills it', () => {
    const x = buildRnpSheet(input())
    expect(lineAt(x, 278)).toMatchObject({ kind: 'value', key: 'lg:Sevinch:refused' })
    expect(lineAt(x, 75)).toBeUndefined()
  })

  it('leaves out the Sinolife первичка / первичка+база ФАКТ 2 blocks (rows 249–262)', () => {
    const x = buildRnpSheet(input())
    for (let r = 249; r <= 262; r++) expect(lineAt(x, r)).toBeUndefined()
    expect(x.blocks.some((b) => b.id === 'company')).toBe(false)
  })

  it('adds a team the sheet has no block for after the sheet\'s teams, so its sales are not lost', () => {
    const x = buildRnpSheet(input())
    const withNewTeam = buildRnpSheet(
      input({ fakt: [...input().fakt, fakt('2026-09-21', 'Bosh', { fakt1Orders: 1, fakt1Minor: som(1_500_000) })] }),
    )
    const first = withNewTeam.lines.findIndex((l) => l.added === true && l.team === 'Bosh' && l.kind === 'value' && l.key === 'team:Bosh:plan_pct')
    expect(first).toBeGreaterThan(-1)
    const lastTeamRow = withNewTeam.lines.findIndex((l) => l.row === 246)
    const warehouseRow = withNewTeam.lines.findIndex((l) => l.row === 264)
    // Only orders nobody's team claims are added in the plain fixture — and they are real money.
    expect(x.lines.filter((l) => l.added).map((l) => [l.label, l.sub])).toEqual([['Логистика  Сумма факт1', '(ROP yoʻq)']])
    expect(first).toBeGreaterThan(lastTeamRow)
    expect(first).toBeLessThan(warehouseRow)
  })

  it('points every filled line at a row the payload carries', () => {
    const x = buildRnpSheet(input())
    const keys = new Set(x.blocks.flatMap((b) => b.rows.map((r) => r.key)))
    for (const l of x.lines) if (l.kind === 'value' && l.key !== null) expect(keys.has(l.key)).toBe(true)
  })
})

describe('buildRnpSheet — «Баҳо», the day\'s grade from its FAKT 1 (2026-10-03)', () => {
  const graded = () =>
    buildRnpSheet(
      input({
        fakt: [
          fakt('2026-09-10', 'Sevinch', { fakt1Orders: 9, fakt1Minor: som(20_000_000) }),
          fakt('2026-09-11', 'Sevinch', { fakt1Orders: 20, fakt1Minor: som(50_000_000) }),
          fakt('2026-09-11', 'Charos', { fakt1Orders: 9, fakt1Minor: som(15_000_000) }),
          fakt('2026-09-11', 'Bosh', { fakt1Orders: 1, fakt1Minor: som(90_000_000) }),
        ],
      }),
    )

  it('grades each day on the team\'s own scale, leaves a day with no sale empty, and averages the graded days', () => {
    const x = graded()
    const sevinch = row(x, 'team:Sevinch', 'team:Sevinch:grade')
    expect(on(sevinch, '2026-09-10')).toBe(3)
    expect(on(sevinch, '2026-09-11')).toBe(5)
    expect(on(sevinch, '2026-09-12')).toBeNull()
    expect(on(sevinch, '2026-09-29')).toBeNull() // not lived yet
    expect(sevinch.fact).toBe(4)
    expect(sevinch).toMatchObject({ unit: 'grade', plan: null, forecast: null, index: null })
    // Малика's БАЗА scale: 15 M is a 3 there, a 2 on Севинч's.
    expect(on(row(x, 'team:Charos', 'team:Charos:grade'), '2026-09-11')).toBe(3)
  })

  it('leaves a team with no scale empty, and says so', () => {
    const bosh = row(graded(), 'team:Bosh', 'team:Bosh:grade')
    expect(bosh.days.every((v) => v === null)).toBe(true)
    expect(bosh.fact).toBeNull()
    expect(bosh.hint).toMatch(/shkalasi belgilanmagan/)
  })

  it('sits right under «Сумма факт 1 сум» in every sheet block, and in an added one', () => {
    const x = graded()
    const at = (key: string) => x.lines.findIndex((l) => l.kind === 'value' && l.key === key)
    expect(at('team:Sevinch:grade')).toBe(at('team:Sevinch:fakt1') + 1)
    expect(at('team:Charos:grade')).toBe(at('team:Charos:fakt1') + 1)
    expect(x.lines[at('team:Sevinch:grade')]).toMatchObject({ label: 'Баҳо', row: 2089, team: 'Sevinch' })
    expect(at('team:Bosh:grade')).toBe(at('team:Bosh:fakt1') + 1)
  })
})

describe('buildRnpSheet — «Маркетинг COLLAGEN» funnel (the client, 2026-10-03)', () => {
  const dto = () =>
    buildRnpSheet(
      input({
        fakt: [
          fakt('2026-09-21', 'Sevinch', { fakt1Orders: 4, fakt1Minor: som(6_000_000), fakt2Orders: 2, fakt2Minor: som(4_000_000) }),
          // БАЗА: in «Сумма общий успешка» only, never a new transaction.
          fakt('2026-09-21', 'Baza', { fakt1Orders: 1, fakt1Minor: som(1_000_000), fakt2Orders: 1, fakt2Minor: som(1_000_000) }),
          // Zextra's team: not Collagen's funnel.
          fakt('2026-09-21', 'Asliddin', { fakt1Orders: 3, fakt1Minor: som(3_000_000), fakt2Orders: 3, fakt2Minor: som(3_000_000) }),
        ],
        registration: [
          { day: '2026-09-21', brand: 'Collagen', leads: 20, duplicates: 0, qualified: 8, aiConversations: 0 },
          { day: '2026-09-21', brand: 'Zextra', leads: 5, duplicates: 0, qualified: 5, aiConversations: 0 },
        ],
      }),
    )
  const f = (d: ReturnType<typeof buildRnpSheet>, metric: string) => row(d, 'funnel:collagen', `fn:collagen:${metric}`)

  it('runs from Meta views to Collagen money, day and month alike', () => {
    const d = dto()
    expect(on(f(d, 'impressions'), '2026-09-21')).toBe(20_000)
    expect(on(f(d, 'clicks'), '2026-09-21')).toBe(400)
    expect(on(f(d, 'leads'), '2026-09-21')).toBe(20)
    expect(on(f(d, 'qualified'), '2026-09-21')).toBe(8)
    expect(on(f(d, 'orders1'), '2026-09-21')).toBe(4)
    expect(on(f(d, 'orders2'), '2026-09-21')).toBe(2)
    expect(f(d, 'ctr').fact).toBe(2) // 400 ÷ 20 000
    expect(f(d, 'lead_per_click').fact).toBe(5) // 20 ÷ 400
    expect(f(d, 'qualified_pct').fact).toBe(40) // 8 ÷ 20
    expect(f(d, 'conv_qualified').fact).toBe(50) // 4 ÷ 8
    expect(f(d, 'conv_total').fact).toBe(10) // 2 ÷ 20
    expect(f(d, 'spend').fact).toBe(100)
    expect(f(d, 'primary_fakt2').fact).toBe(4_000_000)
    expect(f(d, 'cheque2').fact).toBe(2_000_000)
    expect(f(d, 'fakt2').fact).toBe(5_000_000)
    // (4 000 000 − 100 $ × 12 200) ÷ (100 $ × 12 200)
    expect(f(d, 'roi').fact).toBeCloseTo(((4_000_000 - 1_220_000) / 1_220_000) * 100, 6)
  })

  it('fills the follower rows\' place, «Кол подписчиков» left unfilled', () => {
    const d = dto()
    const at = (r: number) => d.lines.find((l) => l.row === r)
    expect(at(2001)).toMatchObject({ kind: 'value', label: 'Колич просмотр', key: 'fn:collagen:impressions' })
    expect(at(2003)).toMatchObject({ kind: 'value', key: null })
    expect(at(2016)).toMatchObject({ kind: 'value', label: 'ROI', key: 'fn:collagen:roi' })
    const i = d.lines.findIndex((l) => l.row === 2001)
    expect(d.lines[i - 1]).toMatchObject({ kind: 'title', row: 4 })
    expect(d.lines.findIndex((l) => l.row === 2017)).toBeLessThan(d.lines.findIndex((l) => l.row === 11))
  })

  it('shares a plan with the P&L where the row is the same figure', () => {
    const d = dto()
    expect(f(d, 'leads').planInput).toEqual(row(d, 'project:collagen', 'pj:collagen:leads').planInput)
    expect(f(d, 'spend').planInput).toEqual({ team: '', metric: 'budget_collagen' })
  })

  it('reads a day with spend and no money as −100 % ROI', () => {
    const d = buildRnpSheet(input({ fakt: [] }))
    expect(on(f(d, 'roi'), '2026-09-21')).toBe(-100)
    expect(f(d, 'roi').planInput).toBeNull()
  })

  it('prints no ROI without the bank\'s rate', () => {
    const d = buildRnpSheet(input({ usdRates: days.map(() => null) }))
    expect(f(d, 'roi').fact).toBeNull()
  })
})

describe('buildRnpSheet — every sheet row claimed once, and on the layout', () => {
  it('never lets two rows claim one sheet row, nor claim a row the layout lacks', async () => {
    const { RNP_SHEET_LAYOUT } = await import('@/server/domain/rnp/rnpSheetLayout')
    const onLayout = new Set(RNP_SHEET_LAYOUT.map(([row]) => row))
    const x = buildRnpSheet(input())
    const claimed = x.blocks.flatMap((b) => b.rows.flatMap((r) => (r.sheet ? [r.sheet.row] : [])))
    expect(new Set(claimed).size).toBe(claimed.length)
    expect(claimed.filter((row) => !onLayout.has(row))).toEqual([])
  })

  it('draws a sheet team with no sales in logistics as zeros, not as missing', () => {
    const x = buildRnpSheet(input())
    const at = (row: number) => x.lines.find((l) => l.row === row)
    expect(at(304)).toMatchObject({ kind: 'value', key: 'lg:Marjona:fakt1' })
    expect(at(314)).toMatchObject({ kind: 'value', key: 'lg:Shohjaxon:fakt1' })
  })

  it('keeps the leads of teams with no group row on the page, after the groups', () => {
    const x = buildRnpSheet(input())
    const i = x.lines.findIndex((l) => l.kind === 'value' && l.key === 'reg:group:none:qualified')
    expect(i).toBeGreaterThan(x.lines.findIndex((l) => l.row === 1013))
    expect(i).toBeLessThan(x.lines.findIndex((l) => l.row === 81))
  })
})

describe('buildRnpSheet — the dollar rate is the bank\'s, day by day', () => {
  it('converts each day at its own rate and carries a missing day from the one before', () => {
    const rates = days.map((d) => (d === '2026-09-21' ? 11_800 : d === '2026-09-22' ? null : d <= '2026-09-28' ? 12_000 : null))
    const x = buildRnpSheet(input({ usdRates: rates }))
    const spend21 = on(row(x, 'marketing', 'meta:spend'), '2026-09-21')!
    const uzs21 = on(row(x, 'project:collagen', 'pj:collagen:spend_uzs'), '2026-09-21')
    expect(uzs21).toBeCloseTo(on(row(x, 'project:collagen', 'pj:collagen:spend'), '2026-09-21')! * 11_800, 6)
    expect(spend21).toBeGreaterThanOrEqual(0)
    // 22.09 was not answered: it converts at 21.09's rate, not at nothing.
    expect(on(row(x, 'project:collagen', 'pj:collagen:spend_uzs'), '2026-09-22')).toBeCloseTo(
      on(row(x, 'project:collagen', 'pj:collagen:spend'), '2026-09-22')! * 11_800,
      6,
    )
  })

  it('draws the converted rows empty when the bank never answered', () => {
    const x = buildRnpSheet(input({ usdRates: days.map(() => null) }))
    expect(x.settings.usdRate).toBeNull()
    expect(row(x, 'project:collagen', 'pj:collagen:spend_uzs').fact).toBeNull()
  })
})

describe('buildRnpSheet — each line knows its ROP, for the page\'s ROP filter', () => {
  it('names the team of a team or logistics line, and nothing else', async () => {
    const { teamOfKey } = await import('@/server/domain/rnp/rnpSheetView')
    expect(teamOfKey('team:Sevinch:fakt1')).toBe('Sevinch')
    expect(teamOfKey('lg:Sevinch:refused')).toBe('Sevinch')
    expect(teamOfKey('lg:(ROP yoʻq):fakt1')).toBe('(ROP yoʻq)')
    expect(teamOfKey('sv:fakt2')).toBeNull()
    expect(teamOfKey('lg:fakt1')).toBeNull()
    expect(teamOfKey('reg:leads')).toBeNull()
    expect(teamOfKey(null)).toBeNull()
  })

  it('gives one ROP its block and its logistics', () => {
    const x = buildRnpSheet(input())
    const sevinch = x.lines.filter((l) => l.team === 'Sevinch').map((l) => l.row)
    expect(sevinch).toContain(89) // the ROP block
    expect(sevinch).toContain(93)
    expect(sevinch).toContain(274) // its logistics
    expect(sevinch).not.toContain(76) // Gulzora's
  })
})

describe('buildRnpSheet — the P&L cost lines typed by hand (the client, 2026-09-30)', () => {
  const typed = () =>
    buildRnpSheet(
      input({
        plans: {
          rows: [
            { team: '', metric: 'targetolog_pct', fromDay: 1, valueCenti: 1_000n },
            { team: '', metric: 'marketer_pct', fromDay: 1, valueCenti: 100n },
          ],
          fakt: [],
        },
        manualCosts: [
          { day: '2026-09-21', project: 'Collagen', line: 'bloggers', amount: 2_000_000 },
          { day: '2026-09-21', project: 'Collagen', line: 'team', amount: 500_000 },
          { day: '2026-09-22', project: 'Zextra', line: 'bloggers', amount: 700_000 },
        ],
      }),
    )

  it('puts each line on its sheet row, editable, empty where nobody typed', () => {
    const x = typed()
    const bloggers = row(x, 'project:collagen', 'pj:collagen:cost_bloggers')
    expect(bloggers.sheet).toEqual({ row: 411, label: 'Блогерлар' })
    expect(bloggers.manual).toEqual({ kind: 'cost', project: 'Collagen', line: 'bloggers' })
    expect(on(bloggers, '2026-09-21')).toBe(2_000_000)
    expect(on(bloggers, '2026-09-20')).toBeNull()
    expect(bloggers.fact).toBe(2_000_000)
    expect(row(x, 'project:zextra', 'pj:zextra:cost_bloggers').sheet?.row).toBe(438)
    expect(row(x, 'project:collagen', 'pj:collagen:cost_team').sheet?.row).toBe(415)
    // Computed rows stay read-only.
    expect(row(x, 'project:collagen', 'pj:collagen:spend_uzs').manual).toBeNull()
  })

  it('adds the typed lines into «Маркетинг харажат факт», per brand', () => {
    const x = typed()
    const pcts = [
      { team: '', metric: 'targetolog_pct', fromDay: 1, valueCenti: 1_000n },
      { team: '', metric: 'marketer_pct', fromDay: 1, valueCenti: 100n },
    ]
    const without = buildRnpSheet(input({ plans: { rows: pcts, fakt: [] } }))
    const d21 = (d: ReturnType<typeof buildRnpSheet>) => on(row(d, 'project:collagen', 'pj:collagen:cost_fact'), '2026-09-21')!
    expect(d21(x) - d21(without)).toBeCloseTo(2_500_000, 6)
    expect(on(row(x, 'project:zextra', 'pj:zextra:cost_fact'), '2026-09-21')).toBe(on(row(without, 'project:zextra', 'pj:zextra:cost_fact'), '2026-09-21'))
  })
})

describe('buildRnpSheet — review fixes of 2026-09-30', () => {
  it('never forecasts a typed cost from its pace — a payment is added as paid', () => {
    const pcts = [
      { team: '', metric: 'targetolog_pct', fromDay: 1, valueCenti: 1_000n },
      { team: '', metric: 'marketer_pct', fromDay: 1, valueCenti: 100n },
    ]
    const without = buildRnpSheet(input({ plans: { rows: pcts, fakt: [] } }))
    const x = buildRnpSheet(
      input({ plans: { rows: pcts, fakt: [] }, manualCosts: [{ day: '2026-09-01', project: 'Collagen', line: 'bloggers', amount: 10_000_000 }] }),
    )
    const typed = row(x, 'project:collagen', 'pj:collagen:cost_bloggers')
    expect(typed.fact).toBe(10_000_000)
    expect(typed.forecast).toBeNull()
    const fact = row(x, 'project:collagen', 'pj:collagen:cost_fact')
    const base = row(without, 'project:collagen', 'pj:collagen:cost_fact')
    expect(fact.fact! - base.fact!).toBeCloseTo(10_000_000, 6)
    expect(fact.forecast! - base.forecast!).toBeCloseTo(10_000_000, 6) // not 10 M × 30 / 27
  })

  it('offers no plan on a БАЗА team\'s «План бажарилиши» nobody planned', () => {
    const r = row(buildRnpSheet(input()), 'team:Charos', 'team:Charos:plan_pct')
    expect(r.plan).toBeNull()
    expect(r.dayPlan).toBeNull()
  })
})

describe('buildRnpSheet — the audit fixes of 2026-10-02', () => {
  /* Two teams the sheet has no block for: Kompaniya (a little money) and Zafar (more of it). */
  const withAdded = () =>
    buildRnpSheet(
      input({
        teams: [...input().teams, { rop: 'Kompaniya', head: 'Murod Sodiqov' }, { rop: 'Zafar', head: null }],
        fakt: [
          ...input().fakt,
          fakt('2026-09-21', 'Kompaniya', { fakt1Orders: 1, fakt1Minor: som(1_500_000) }),
          fakt('2026-09-22', 'Zafar', { fakt1Orders: 3, fakt1Minor: som(9_000_000) }),
        ],
        leads: [...input().leads, { day: '2026-09-21', rop: 'Kompaniya', leads: 2 }],
      }),
    )
  type Line = ReturnType<typeof buildRnpSheet>['lines'][number]
  const valueLines = (x: ReturnType<typeof buildRnpSheet>, prefix: string) => x.lines.filter((l) => l.kind === 'value' && l.key?.startsWith(prefix) === true)
  /* What a block looks like without its team: labels, tones, bold, and what each line measures. */
  const shape = (lines: readonly Line[]) => lines.map((l) => (l.kind === 'value' ? [l.label, l.tone, l.fact, l.bold, l.key?.split(':').at(-1)] : []))

  it("draws an added team on a sheet block's template — its labels, its order, the name on the first line", () => {
    const x = withAdded()
    const added = valueLines(x, 'team:Kompaniya:')
    expect(shape(added)).toEqual(shape(valueLines(x, 'team:Gulzora:')))
    expect(added[0]).toMatchObject({ row: null, team: 'Kompaniya', label: 'План бажарилиши', sub: 'Kompaniya РОП', tone: 'team', key: 'team:Kompaniya:plan_pct', added: true })
    expect(added[1]).toMatchObject({ label: 'Квал лид сони', key: 'team:Kompaniya:reach' })
    expect(added.slice(1).some((l) => l.added)).toBe(false)
    // No heading band any more: the first line carries the name, as a sheet block's does.
    expect(x.lines.some((l) => l.kind === 'title' && l.team === 'Kompaniya')).toBe(false)
    // The rows themselves read the sheet's names too.
    expect(row(x, 'team:Kompaniya', 'team:Kompaniya:reach').label).toBe('Квал лид сони')
    expect(row(x, 'team:Charos', 'team:Charos:reach').label).toBe('Дозвон сони')
  })

  it('draws an added logistics block on the sheet\'s five lines, «Жараёнда, %» left in the payload', () => {
    const x = withAdded()
    const added = valueLines(x, 'lg:Kompaniya:')
    expect(shape(added)).toEqual(shape(valueLines(x, 'lg:Gulzora:')))
    expect(added.map((l) => l.label)).toEqual(['Логистика  Сумма факт1', 'Успешка сумма факт 2', 'Успешкность % 📌', 'Отказ %', 'Отказ сумма'])
    expect(added[0]).toMatchObject({ sub: 'Kompaniya РОП', added: true })
    expect(row(x, 'logistics:Kompaniya', 'lg:Kompaniya:open_pct').key).toBe('lg:Kompaniya:open_pct')
  })

  it('gives a team one name — its block, its logistics and the ROP list', () => {
    const x = withAdded()
    expect(block(x, 'team:Kompaniya').title).toBe('Kompaniya РОП')
    expect(block(x, 'logistics:Kompaniya').title).toBe('Логистика — Kompaniya РОП')
    expect(x.teams.find((t) => t.rop === 'Kompaniya')?.label).toBe('Kompaniya РОП')
    expect(x.teams.find((t) => t.rop === 'Charos')?.label).toBe('Малика РОП - БАЗА')
    // «(ROP yoʻq)» is not a team: it keeps its own name.
    expect(block(x, 'logistics:(ROP yoʻq)').title).toBe('Логистика — (ROP yoʻq)')
  })

  it("orders the teams as the sheet does and the rest by name — never by the month's money", () => {
    const x = withAdded()
    expect(x.teams.map((t) => t.rop)).toEqual(['Gulzora', 'Sevinch', 'Lola', 'Saidaziz', 'Asliddin', 'Sadriddin', 'Charos', 'Marjona', 'Azizbek', 'Maftuna', 'Hayot', 'Baza', 'Kompaniya', 'Zafar'])
    const firstOf = (team: string) => x.lines.findIndex((l) => l.team === team)
    expect(firstOf('Kompaniya')).toBeLessThan(firstOf('Zafar'))
  })

  it("prints the page's own month on row 346, where the sheet kept «ИЮЛЬ»", async () => {
    const { sheetLines } = await import('@/server/domain/rnp/rnpSheetView')
    const x = buildRnpSheet(input())
    expect(x.lines.find((l) => l.row === 346)).toMatchObject({ label: 'Квал лид сони', sub: 'СЕНТЯБРЬ' })
    expect(sheetLines(x.blocks, { month: '2026-10', teamName: (rop) => rop }).find((l) => l.row === 346)).toMatchObject({ sub: 'ОКТЯБРЬ' })
  })

  it('opens the page on «Основные показатели»: САС, ROMI, the totals, then «Свод» (2026-10-03)', () => {
    const x = buildRnpSheet(input())
    const rows = x.lines.slice(0, 11).map((l) => l.row)
    expect(x.lines[0]).toMatchObject({ kind: 'title', label: 'Основные показатели' })
    expect(rows).toEqual([3000, 11, 12, 42, 43, 44, 45, 346, 347, 348, 349])
    expect(x.lines[11]).toMatchObject({ kind: 'title', row: 4, label: 'Маркетинг COLLAGEN' })
    // «Свод»'s «Бюджет» repeated row 42 two lines above it.
    expect(x.lines.some((l) => l.row === 350)).toBe(false)
  })

  it('keeps row 45 under the totals it is computed from, not under «Цена лида Zextra»', () => {
    const rows = buildRnpSheet(input()).lines.map((l) => l.row)
    expect(rows.indexOf(45)).toBe(rows.indexOf(44) + 1)
    expect(rows.indexOf(47)).toBe(rows.indexOf(40) + 1)
  })

  it('draws «Отказ сумма» alike in every logistics block', () => {
    const refused = buildRnpSheet(input()).lines.filter((l) => l.kind === 'value' && l.row !== null && /^lg:.+:refused$/.test(l.key ?? ''))
    expect(refused).toHaveLength(12)
    expect(new Set(refused.map((l) => l.kind === 'value' && l.bold))).toEqual(new Set([false]))
  })

  it('computes C of the brand P&L\'s «Сумма факт2» and «База усп» as the sheet does — a share, never a typed soʻm', () => {
    const x = buildRnpSheet(
      input({
        fakt: [
          fakt('2026-09-21', 'Sevinch', { fakt1Orders: 2, fakt1Minor: som(3_000_000), fakt2Orders: 1, fakt2Minor: som(2_000_000) }),
          fakt('2026-09-21', 'Baza', { fakt1Orders: 1, fakt1Minor: som(1_000_000), fakt2Orders: 1, fakt2Minor: som(1_000_000) }),
        ],
      }),
    )
    // C395 `=D395/D394`: 3 M of 4 M; C397 `=IFERROR(D397/D395,0)`: 1 M of 3 M.
    const f2 = row(x, 'project:collagen', 'pj:collagen:fakt2')
    expect(f2.plan).toBeCloseTo(75, 6)
    expect(f2).toMatchObject({ planUnit: 'percent', planInput: null, dayPlan: null, index: null, unit: 'uzs' })
    expect(row(x, 'project:collagen', 'pj:collagen:base_fakt2').plan).toBeCloseTo(100 / 3, 6)
    // Zextra sold nothing: no share at all, not 0.
    expect(row(x, 'project:zextra', 'pj:zextra:fakt2').plan).toBeNull()
    // Nothing stores them, so the plan route refuses them.
    expect(RNP_PLAN_METRICS as readonly string[]).not.toContain('brand_fakt2')
    expect(RNP_PLAN_METRICS as readonly string[]).not.toContain('brand_base_fakt2')
  })

  it("prints «—», not 0, for the month of a row trusted only from a later day (August's БАЗА calls)", () => {
    const aug = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
    const x = buildRnpSheet(
      input({ month: '2026-08', days: aug, today: '2026-10-02', usdRates: aug.map(() => 12_000), fakt: [], leads: [], registration: [], meta: [], warehouse: [], calls: aug.map((day) => ({ day, rop: 'Charos', connected: 100 })) }),
    )
    const reach = row(x, 'team:Charos', 'team:Charos:reach')
    expect(reach.days.filter((v) => v === 100)).toHaveLength(31) // drawn, muted
    expect(reach.fact).toBeNull()
    expect(reach.forecast).toBeNull()
  })

  it("keeps a closed month's reliable-day pace on a row trusted from a later day", () => {
    const x = buildRnpSheet(input({ today: '2026-10-03', calls: days.map((day) => ({ day, rop: 'Charos', connected: 10 })) }))
    const reach = row(x, 'team:Charos', 'team:Charos:reach')
    // 15–30.09: 16 trusted days of 10 calls — paced over the month, not the fact.
    expect(reach.fact).toBe(160)
    expect(reach.forecast).toBeCloseTo((160 / 16) * 30, 6)
  })

  it("converts the month's first days, before the bank's first answer, at that first answer — never at 0", () => {
    const rates = days.map((d) => (d < '2026-09-03' ? null : d <= '2026-09-28' ? 11_900 : null))
    const x = buildRnpSheet(input({ usdRates: rates, meta: [{ day: '2026-09-01', product: 'Collagen', spendMicroUsd: 100_000_000n, impressions: 0, clicks: 0, leads: 1 }] }))
    expect(on(row(x, 'project:collagen', 'pj:collagen:spend_uzs'), '2026-09-01')).toBe(100 * 11_900)
    expect(row(x, 'project:collagen', 'pj:collagen:spend_uzs').fact).toBe(100 * 11_900)
  })

  it('dates the header\'s rate by the day the bank answered, not a day it was carried to', () => {
    const rates = days.map((d) => (d <= '2026-09-26' ? 11_900 : null))
    expect(buildRnpSheet(input({ usdRates: rates })).settings).toEqual({ usdRate: 11_900, usdRateDate: '2026-09-26' })
  })

  it('opens no plan cell on the undrawn company logistics block', () => {
    const x = buildRnpSheet(input({ plans: { rows: [{ team: '', metric: 'success_rate', fromDay: 1, valueCenti: 9_000n }], fakt: [] } }))
    expect(row(x, 'logistics', 'lg:success')).toMatchObject({ planInput: null, plan: null })
    expect(row(x, 'logistics', 'lg:refused_pct').plan).toBeNull()
  })

  it("says a БАЗА team's calls reach the sheet about every 3 hours, and a lead team's leads are fresh hand-outs", () => {
    const x = buildRnpSheet(input())
    expect(row(x, 'team:Charos', 'team:Charos:reach').hint).toMatch(/har 3 soatda/)
    expect(row(x, 'team:Sevinch', 'team:Sevinch:reach').hint).toMatch(/30 kun ichida yaratilganlari/)
  })

  it("names, on the projects' «Сумма факт1», who is in «Свод» but in neither project", () => {
    const x = buildRnpSheet(input({ fakt: [...input().fakt, fakt('2026-09-21', 'Hayot', { fakt1Orders: 1, fakt1Minor: som(500_000) })] }))
    const hint = row(x, 'project:collagen', 'pj:collagen:fakt1').hint!
    expect(hint).toContain('Ҳаёт РОП')
    expect(hint).toContain('(ROP yoʻq)')
    expect(hint).not.toContain('Севинч')
    expect(row(x, 'project:zextra', 'pj:zextra:fakt1').hint).toBe(hint)
    expect(block(x, 'project:collagen').subtitle).toBe('Brend: buyurtmani sotgan jamoa (jadvaldagi roʻyxat); lid: manba yoki forma.')
  })

  it("explains the P&L's percent rows with the constants in force", () => {
    const x = buildRnpSheet(input())
    expect(row(x, 'project:collagen', 'pj:collagen:cost_share').hint).toBe('Маркетинг харажат факт ÷ Сумма факт2 (успешка).')
    expect(row(x, 'project:collagen', 'pj:collagen:cost_plan').hint).toBe('Сумма факт2 (успешка) × 11%.')
    expect(row(x, 'project:collagen', 'pj:collagen:cost_targetolog').hint).toBe('Таргет бюджет × 10%.')
  })

  it("prices a БАЗА team's calls at its own schedule, as the sheet does, and says which", () => {
    const base = input()
    const x = buildRnpSheet({
      ...base,
      plans: {
        ...base.plans,
        rows: [
          ...base.plans.rows,
          { team: 'Charos', metric: 'lead_value', fromDay: 1, valueCenti: 40_000_000n },
          { team: 'Charos', metric: 'lead_value', fromDay: 27, valueCenti: 20_000_000n },
        ],
      },
    })
    const pct = row(x, 'team:Charos', 'team:Charos:plan_pct')
    // 21.09: 1 000 000 over 4 calls × 400 000 — not the company's 500 000 of that day.
    expect(on(pct, '2026-09-21')).toBeCloseTo((1_000_000 / (4 * 400_000)) * 100, 6)
    expect(pct.hint).toContain('jamoaning oʻz qiymati')
    expect(pct.hint).toContain('400.000, 27.09 dan 200.000')
    // A lead team keeps the company's schedule, named as it stands this month.
    expect(row(x, 'team:Sevinch', 'team:Sevinch:plan_pct').hint).toContain('jadvaldagi doimiy: 400.000, 19.09 dan 500.000')
  })

  it('prints «—» for the rates of a team whose leads are fewer than its orders, and says why', () => {
    const x = buildRnpSheet(
      input({
        fakt: [
          ...input().fakt,
          ...['2026-09-20', '2026-09-21', '2026-09-22'].map((day) => fakt(day, 'Marjona', { fakt1Orders: 18, fakt1Minor: som(27_000_000), fakt2Orders: 3, fakt2Minor: som(4_000_000) })),
        ],
        leads: [...input().leads, { day: '2026-09-21', rop: 'Marjona', leads: 1 }],
      }),
    )
    for (const key of ['conv1', 'conv2', 'plan_pct']) {
      const r = row(x, 'team:Marjona', `team:Marjona:${key}`)
      expect(r.fact).toBeNull()
      expect(r.days.every((v) => v === null)).toBe(true)
      expect(r.hint).toContain('«РОП (Первичка)»')
      expect(r.hint).toContain('16.09 dan beri 1 ta lid, 54 ta ФАКТ 1 buyurtma')
    }
    // The counts beside them stay.
    expect(row(x, 'team:Marjona', 'team:Marjona:reach').fact).toBe(1)
    expect(row(x, 'team:Marjona', 'team:Marjona:orders1').fact).toBe(54)
    // A team with leads enough keeps its rates; a БАЗА team is measured by calls and never guarded.
    expect(row(x, 'team:Sevinch', 'team:Sevinch:conv1').fact).toBeCloseTo((5 / 7) * 100, 6)
    expect(on(row(x, 'team:Charos', 'team:Charos:conv1'), '2026-09-21')).toBe(25)
  })
})
