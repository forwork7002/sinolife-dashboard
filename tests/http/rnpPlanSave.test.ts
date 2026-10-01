import { describe, expect, it } from 'vitest'

import { parseDecimal } from '@/features/rnp/RnpCostCell'

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
