import { describe, expect, it } from 'vitest'

import { planBodySchema } from '@/app/api/v1/rnp/plan/schema'

const cell = (over: Record<string, unknown> = {}) => ({ team: 'Sevinch', metric: 'fakt1', value: 700_000_000, ...over })
const body = (cells: unknown[], month = '2026-10') => ({ month, cells })

describe('POST /rnp/plan — the body', () => {
  it('takes a team plan, a company plan, a percent with decimals and a cleared one', () => {
    expect(planBodySchema.safeParse(body([cell(), cell({ team: '', metric: 'budget', value: 36_000 }), cell({ metric: 'plan_pct', value: 80.5 }), cell({ value: null })])).success).toBe(true)
  })

  it('refuses an unknown metric, three decimals, a negative and an absurd value', () => {
    expect(planBodySchema.safeParse(body([cell({ metric: 'rent' })])).success).toBe(false)
    expect(planBodySchema.safeParse(body([cell({ value: 1.005 })])).success).toBe(false)
    expect(planBodySchema.safeParse(body([cell({ value: -1 })])).success).toBe(false)
    expect(planBodySchema.safeParse(body([cell({ value: 2_000_000_000_000 })])).success).toBe(false)
  })

  it('refuses a bad month, an empty save and a flood', () => {
    expect(planBodySchema.safeParse(body([cell()], '2026-13')).success).toBe(false)
    expect(planBodySchema.safeParse(body([])).success).toBe(false)
    expect(planBodySchema.safeParse(body(Array.from({ length: 501 }, () => cell()))).success).toBe(false)
  })
})

describe('POST /rnp/plan — the gate', () => {
  it('asks for kpi:manage inside the rnp gate, and takes only a cell the sheet leaves open', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/app/api/v1/rnp/plan/route.ts', 'utf8'))
    expect(source).toContain("{ permission: 'analytics:read:all', section: 'rnp' }")
    expect(source).toContain("can(ctx.principal, 'kpi:manage')")
    expect(source).toContain('rnpService.planInputs(')
    expect(source).toContain('!open.has(`${c.team}|${c.metric}`)')
  })
})
