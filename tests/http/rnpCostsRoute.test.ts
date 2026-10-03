import { describe, expect, it } from 'vitest'

import { costsBodySchema } from '@/app/api/v1/rnp/costs/schema'

const cell = (over: Record<string, unknown> = {}) => ({ day: '2026-09-21', project: 'Collagen', line: 'bloggers', value: 2_500_000, ...over })
const body = (cells: unknown[], month = '2026-09') => ({ month, cells })

describe('POST /rnp/costs — the body', () => {
  it('takes a typed cost and a cleared one', () => {
    expect(costsBodySchema.safeParse(body([cell(), cell({ line: 'team', value: null })])).success).toBe(true)
  })

  it('refuses a day outside the month, an impossible day, and a non-day', () => {
    expect(costsBodySchema.safeParse(body([cell({ day: '2026-10-01' })])).success).toBe(false)
    expect(costsBodySchema.safeParse(body([cell({ day: '2026-09-31' })])).success).toBe(false)
    // An Invalid Date must be a 400, not a thrown RangeError.
    expect(costsBodySchema.safeParse(body([cell({ day: '2026-99-99' })], '2026-09')).success).toBe(false)
    expect(costsBodySchema.safeParse(body([cell({ day: '21.09.2026' })])).success).toBe(false)
  })

  it('refuses an unknown project or line, a fraction, a negative and an absurd amount', () => {
    expect(costsBodySchema.safeParse(body([cell({ project: 'Gummy' })])).success).toBe(false)
    expect(costsBodySchema.safeParse(body([cell({ line: 'rent' })])).success).toBe(false)
    expect(costsBodySchema.safeParse(body([cell({ value: 12.5 })])).success).toBe(false)
    expect(costsBodySchema.safeParse(body([cell({ value: -1 })])).success).toBe(false)
    expect(costsBodySchema.safeParse(body([cell({ value: 2_000_000_000_000 })])).success).toBe(false)
  })

  it('refuses an empty save and a flood', () => {
    expect(costsBodySchema.safeParse(body([])).success).toBe(false)
    expect(costsBodySchema.safeParse(body(Array.from({ length: 501 }, () => cell()))).success).toBe(false)
  })

  it('bounds the month as the overview, the plans and the headcount do', () => {
    expect(costsBodySchema.safeParse(body([cell({ day: '1990-01-05' })], '1990-01')).success).toBe(false)
    expect(costsBodySchema.safeParse(body([cell({ day: '2101-01-05' })], '2101-01')).success).toBe(false)
    expect(costsBodySchema.safeParse(body([cell({ day: '2025-01-05' })], '2025-01')).success).toBe(true)
  })
})

describe('POST /rnp/costs — the gate', () => {
  it('asks for kpi:manage inside the rnp gate, and refuses a day after today', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/app/api/v1/rnp/costs/route.ts', 'utf8'))
    expect(source).toContain("{ permission: 'analytics:read:all', section: 'rnp' }")
    expect(source).toContain("can(ctx.principal, 'kpi:manage')")
    expect(source).toContain('c.day > today')
  })
})
