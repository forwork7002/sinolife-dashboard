import { describe, expect, it } from 'vitest'

import { headcountBodySchema } from '@/app/api/v1/rnp/headcount/schema'

const cell = (over: Record<string, unknown> = {}) => ({ day: '2026-09-21', rop: 'Sevinch', value: 8, ...over })
const body = (cells: unknown[], month = '2026-09') => ({ month, cells })

describe('POST /rnp/headcount — the body', () => {
  it('takes a typed headcount, a zero and a cleared one', () => {
    expect(headcountBodySchema.safeParse(body([cell(), cell({ value: 0 }), cell({ rop: 'Lola', value: null })])).success).toBe(true)
  })

  it('refuses a day outside the month, an impossible day, and a non-day', () => {
    expect(headcountBodySchema.safeParse(body([cell({ day: '2026-10-01' })])).success).toBe(false)
    expect(headcountBodySchema.safeParse(body([cell({ day: '2026-09-31' })])).success).toBe(false)
    expect(headcountBodySchema.safeParse(body([cell({ day: '2026-99-99' })])).success).toBe(false)
    expect(headcountBodySchema.safeParse(body([cell({ day: '0001-01-21' })], '0001-01')).success).toBe(false)
  })

  it('refuses a fraction, a negative, an absurd count and an empty or overlong team', () => {
    expect(headcountBodySchema.safeParse(body([cell({ value: 2.5 })])).success).toBe(false)
    expect(headcountBodySchema.safeParse(body([cell({ value: -1 })])).success).toBe(false)
    expect(headcountBodySchema.safeParse(body([cell({ value: 1001 })])).success).toBe(false)
    expect(headcountBodySchema.safeParse(body([cell({ rop: '  ' })])).success).toBe(false)
    expect(headcountBodySchema.safeParse(body([cell({ rop: 'x'.repeat(101) })])).success).toBe(false)
  })

  it('refuses an empty save and a flood', () => {
    expect(headcountBodySchema.safeParse(body([])).success).toBe(false)
    expect(headcountBodySchema.safeParse(body(Array.from({ length: 501 }, () => cell()))).success).toBe(false)
  })
})

describe('POST /rnp/headcount — the gate', () => {
  it('asks for kpi:manage inside the rnp gate, and refuses a day after today', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/app/api/v1/rnp/headcount/route.ts', 'utf8'))
    expect(source).toContain("{ permission: 'analytics:read:all', section: 'rnp' }")
    expect(source).toContain("can(ctx.principal, 'kpi:manage')")
    expect(source).toContain('c.day > today')
    // A team the month's sheet does not draw (or an alias) is refused.
    expect(source).toContain('rnpService.headcountTeams(')
    expect(source).toContain('!teams.has(c.rop)')
  })
})
