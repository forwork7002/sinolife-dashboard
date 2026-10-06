import { describe, expect, it } from 'vitest'

import { parseCost, parseDecimal, pastedCells } from '@/features/rnp/RnpCostCell'

/* The repositories read `env` at module scope (same preamble as `rnpSql.test.ts`). */
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { RnpRepository } = await import('@/server/repositories/rnpRepository')

/**
 * A typed plan cell, from the field to the tables: what the field reads, where
 * each plan is stored, and the lead value a month inherits — against an
 * in-memory stand-in for the two plan tables.
 */

type PlanRow = { month: Date; team: string; metric: string; fromDay: number; valueCenti: bigint }
type FaktRow = { month: Date; rop: string; fakt1Minor: bigint | null; fakt2Minor: bigint | null }

function fakePrisma(seed: { plans?: PlanRow[]; fakt?: FaktRow[] } = {}) {
  const plans: PlanRow[] = [...(seed.plans ?? [])]
  const fakt: FaktRow[] = [...(seed.fakt ?? [])]
  const sameMonth = (a: Date, b: Date) => a.getTime() === b.getTime()
  const matches = (r: PlanRow, w: Record<string, unknown>) =>
    (w.month === undefined || (w.month instanceof Date ? sameMonth(r.month, w.month) : r.month < (w.month as { lt: Date }).lt)) &&
    (w.team === undefined || r.team === w.team) &&
    (w.metric === undefined || r.metric === w.metric) &&
    (w.fromDay === undefined || r.fromDay === w.fromDay)
  const client = {
    rnpPlan: {
      findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: unknown }) => {
        const out = plans.filter((r) => matches(r, where))
        if (Array.isArray(orderBy)) out.sort((a, b) => b.month.getTime() - a.month.getTime() || b.fromDay - a.fromDay)
        return out.map(({ team, metric, fromDay, valueCenti }) => ({ team, metric, fromDay, valueCenti }))
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        for (let i = plans.length - 1; i >= 0; i--) if (matches(plans[i]!, where)) plans.splice(i, 1)
      },
      upsert: async ({ where, create, update }: { where: { month_team_metric_fromDay: Omit<PlanRow, 'valueCenti'> }; create: PlanRow; update: { valueCenti: bigint } }) => {
        const found = plans.find((r) => matches(r, where.month_team_metric_fromDay))
        if (found) found.valueCenti = update.valueCenti
        else plans.push({ month: create.month, team: create.team, metric: create.metric, fromDay: create.fromDay, valueCenti: create.valueCenti })
      },
    },
    teamMonthPlan: {
      findMany: async ({ where }: { where: { month: Date } }) => fakt.filter((r) => sameMonth(r.month, where.month)),
      upsert: async ({ where, create, update }: { where: { month_rop: { month: Date; rop: string } }; create: FaktRow; update: Partial<FaktRow> }) => {
        let found = fakt.find((r) => sameMonth(r.month, where.month_rop.month) && r.rop === where.month_rop.rop)
        if (found) Object.assign(found, 'fakt1Minor' in update ? { fakt1Minor: update.fakt1Minor } : {}, 'fakt2Minor' in update ? { fakt2Minor: update.fakt2Minor } : {})
        else fakt.push((found = { month: create.month, rop: create.rop, fakt1Minor: create.fakt1Minor ?? null, fakt2Minor: create.fakt2Minor ?? null }))
        return { fakt1Minor: found.fakt1Minor, fakt2Minor: found.fakt2Minor }
      },
      delete: async ({ where }: { where: { month_rop: { month: Date; rop: string } } }) => {
        const i = fakt.findIndex((r) => sameMonth(r.month, where.month_rop.month) && r.rop === where.month_rop.rop)
        fakt.splice(i, 1)
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  }
  return { client, plans, fakt }
}

const oct = new Date('2026-10-01T00:00:00Z')
const sep = new Date('2026-09-01T00:00:00Z')
const aug = new Date('2026-08-01T00:00:00Z')

describe('the plan field — parseDecimal', () => {
  it('reads a decimal comma or dot, and dots between thousands', () => {
    expect(parseDecimal('12,5')).toBe(12.5)
    expect(parseDecimal('12.5')).toBe(12.5)
    expect(parseDecimal('0,8')).toBe(0.8)
    expect(parseDecimal('36.000')).toBe(36_000)
    expect(parseDecimal('1.200,5')).toBe(1200.5)
    expect(parseDecimal(' ')).toBeNull()
  })

  it('refuses a third decimal, a minus and text', () => {
    for (const typo of ['1,234', '-1', '12a', '1.2.3']) expect(parseDecimal(typo)).toBeNaN()
  })

  it('groups thousands only after a non-zero digit: «0.850» is a typo, not 850', () => {
    expect(parseDecimal('0.850')).toBeNaN()
    expect(parseDecimal('000.500')).toBeNaN()
    expect(parseDecimal('0.85')).toBe(0.85)
    expect(parseDecimal('10.000')).toBe(10_000)
  })

  it('reads the row’s own sign back — as the field shows it and the client’s sheet writes it (2026-10-02)', () => {
    // A dollar plan: one «$» before or after it.
    expect(parseDecimal('$36.000', '$')).toBe(36_000)
    expect(parseDecimal('16 000$', '$')).toBe(16_000)
    expect(parseDecimal('0,80$', '$')).toBe(0.8)
    expect(parseDecimal('$ 1.200,5', '$')).toBe(1200.5)
    // A percent: one «%» after it.
    expect(parseDecimal('80%', '%')).toBe(80)
    expect(parseDecimal('12,5 %', '%')).toBe(12.5)
    // The sign alone is not an empty cell, and another row's sign is a slip.
    for (const [typo, sign] of [['$', '$'], ['%', '%'], ['$36.000$', '$'], ['80%', '$'], ['$80', '%'], ['%80', '%'], ['$36', undefined]] as const) {
      expect(parseDecimal(typo, sign)).toBeNaN()
    }
  })
})

/*
  One field, one figure (2026-10-02). A sheet's row pasted into a typed cell
  arrives with a TAB between its cells, a column with line breaks, and the
  old reading dropped every separator: «5 075 000⇥0» (a cost and its empty
  neighbour) was saved as 50 750 000, «8⇥5» as an 85 % plan, a mistyped
  «1 25 000» as 125 000.
*/
describe('a typed cell reads ONE figure — parseCost, parseDecimal, pastedCells', () => {
  it('refuses several cells and a misplaced group instead of gluing them into one number', () => {
    expect(parseCost('5 075 000\t0')).toBeNaN()
    expect(parseCost('5 075 000\n3 560 000')).toBeNaN()
    expect(parseCost('1 25 000')).toBeNaN()
    expect(parseCost('1.250 000')).toBeNaN() // groups split by two different separators
    expect(parseCost('0.500')).toBeNaN() // a grouped number starts non-zero
    expect(parseDecimal('8\t5', '%')).toBeNaN()
    expect(parseDecimal('1 25 000', '$')).toBeNaN()
    expect(parseDecimal('1 200.5', '$')).toBeNaN() // grouped: the decimals follow a comma
  })

  it('reads one figure as it is typed or copied from a spreadsheet — NBSP and narrow NBSP are spaces', () => {
    expect(parseCost('1 200 000')).toBe(1_200_000)
    expect(parseCost('1\u00a0200\u00a0000')).toBe(1_200_000)
    expect(parseCost('1\u202f200\u202f000')).toBe(1_200_000)
    expect(parseCost('1.250.000')).toBe(1_250_000)
    expect(parseCost('1,250,000')).toBe(1_250_000)
    expect(parseCost('36.000')).toBe(36_000)
    expect(parseCost('5075000')).toBe(5_075_000)
    expect(parseCost(' ')).toBeNull()
    expect(parseDecimal('36.000', '$')).toBe(36_000)
    expect(parseDecimal('1\u00a0200,5', '$')).toBe(1200.5)
    expect(parseDecimal('0,80')).toBe(0.8)
    // The row's own sign still comes with it (B15).
    expect(parseDecimal('$0,80', '$')).toBe(0.8)
    expect(parseDecimal('80%', '%')).toBe(80)
  })

  it('keeps a pasted row or column apart, so the field refuses it — one copied cell pastes as usual', () => {
    expect(pastedCells('5 075 000\t0')).toBe('5 075 000\t0')
    // A browser pastes a line break as a space: «500 000 300 000» would be a valid figure.
    expect(pastedCells('500 000\r\n300 000\r\n')).toBe('500 000\t300 000')
    expect(parseCost(pastedCells('500 000\n300 000')!)).toBeNaN()
    // Excel ends one copied cell with a line break.
    expect(pastedCells('1 200 000\r\n')).toBeNull()
    expect(pastedCells('1 200 000')).toBeNull()
  })
})

describe('RnpRepository.savePlanCells', () => {
  it('keeps a team\'s FAKT plans in team_month_plan and every other plan in rnp_plan, from day 1, in cents', async () => {
    const { client, plans, fakt } = fakePrisma()
    await new RnpRepository(client as never).savePlanCells(
      '2026-10',
      [
        { team: 'Lola', metric: 'fakt1', value: 750_000_000 },
        { team: 'Lola', metric: 'plan_pct', value: 80.29 },
        { team: '', metric: 'fakt1', value: 5_000_000_000 },
      ],
      'u1',
    )
    expect(fakt).toEqual([{ month: oct, rop: 'Lola', fakt1Minor: 75_000_000_000n, fakt2Minor: null }])
    expect(plans).toEqual([
      { month: oct, team: 'Lola', metric: 'plan_pct', fromDay: 1, valueCenti: 8_029n },
      { month: oct, team: '', metric: 'fakt1', fromDay: 1, valueCenti: 500_000_000_000n },
    ])
  })

  it('clears with null — and drops a team\'s FAKT row once both its plans are gone', async () => {
    const { client, plans, fakt } = fakePrisma({
      plans: [{ month: oct, team: 'Lola', metric: 'plan_pct', fromDay: 1, valueCenti: 8_000n }],
      fakt: [{ month: oct, rop: 'Lola', fakt1Minor: 1n, fakt2Minor: 2n }],
    })
    const repo = new RnpRepository(client as never)
    await repo.savePlanCells('2026-10', [{ team: 'Lola', metric: 'fakt1', value: null }, { team: 'Lola', metric: 'plan_pct', value: null }], 'u1')
    expect(fakt).toEqual([{ month: oct, rop: 'Lola', fakt1Minor: null, fakt2Minor: 2n }])
    expect(plans).toEqual([])
    await repo.savePlanCells('2026-10', [{ team: 'Lola', metric: 'fakt2', value: null }], 'u1')
    expect(fakt).toEqual([])
  })
})

/*
  A save waits for a connection as long as a read does (2026-10-06): with
  Prisma's 2 s default a typed cell failed (P2028) while the pool kept every
  read on the page queued — and answered — for 20 s.
*/
describe('RnpRepository — every typed save waits the pool’s 20 s for a connection, not Prisma’s 2 s', () => {
  it('passes maxWait to the plan, cost and «Ходим сони» transactions', async () => {
    const options: unknown[] = []
    const { client } = fakePrisma()
    const recording = {
      ...client,
      rnpManualCost: { deleteMany: () => 'delete', upsert: () => 'upsert' },
      rnpManualHeadcount: { deleteMany: () => 'delete', upsert: () => 'upsert' },
      $transaction: async (work: unknown, o: unknown) => {
        options.push(o)
        return typeof work === 'function' ? (work as (tx: unknown) => Promise<unknown>)(client) : work
      },
    }
    const repo = new RnpRepository(recording as never)
    await repo.savePlanCells('2026-10', [{ team: 'Lola', metric: 'plan_pct', value: 80 }], 'u1')
    await repo.saveManualCosts([{ day: '2026-10-01', project: 'Collagen', line: 'bloggers', value: 1_000_000 }], 'u1')
    await repo.saveManualHeadcount([{ day: '2026-10-01', rop: 'Lola', value: 12 }], 'u1')
    expect(options).toEqual([{ maxWait: 20_000, timeout: 15_000 }, { maxWait: 20_000 }, { maxWait: 20_000 }])
  })
})

describe('RnpRepository.plans — the lead value a month inherits', () => {
  it('keeps each team\'s last value, team by team, where the month has none of its own', async () => {
    const { client } = fakePrisma({
      plans: [
        { month: aug, team: 'Charos', metric: 'lead_value', fromDay: 1, valueCenti: 5_000_000n },
        { month: sep, team: '', metric: 'lead_value', fromDay: 1, valueCenti: 40_000_000n },
        { month: sep, team: '', metric: 'lead_value', fromDay: 14, valueCenti: 50_000_000n },
        // October set Lola's own; the company's and Charos's carry over.
        { month: oct, team: 'Lola', metric: 'lead_value', fromDay: 1, valueCenti: 30_000_000n },
      ],
    })
    const { rows } = await new RnpRepository(client as never).plans('2026-10')
    const lead = rows.filter((r) => r.metric === 'lead_value').map((r) => [r.team, r.fromDay, r.valueCenti])
    expect(lead).toEqual(
      expect.arrayContaining([
        ['Lola', 1, 30_000_000n],
        ['', 1, 50_000_000n],
        ['Charos', 1, 5_000_000n],
      ]),
    )
    expect(lead).toHaveLength(3)
  })
})
