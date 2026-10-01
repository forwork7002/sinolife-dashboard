import { describe, expect, it } from 'vitest'

import { overviewQuerySchema, sellerPlanBodySchema, splitBodySchema } from '@/app/api/v1/registration/schema'

describe('registration request schemas', () => {
  it('takes an optional real calendar day', () => {
    expect(overviewQuerySchema.safeParse({}).success).toBe(true)
    expect(overviewQuerySchema.safeParse({ day: '2026-09-30' }).success).toBe(true)
    expect(overviewQuerySchema.safeParse({ day: '2026-02-30' }).success).toBe(false)
    expect(overviewQuerySchema.safeParse({ day: '1999-01-01' }).success).toBe(false)
  })

  it('takes whole basis points from 0 to 100 % per team', () => {
    const ok = { day: '2026-09-30', rows: [{ rop: 'Sevinch', shareBp: 10_000 }] }
    expect(splitBodySchema.safeParse(ok).success).toBe(true)
    expect(splitBodySchema.safeParse({ ...ok, rows: [{ rop: 'Sevinch', shareBp: 12.5 }] }).success).toBe(false)
    expect(splitBodySchema.safeParse({ ...ok, rows: [{ rop: 'Sevinch', shareBp: 10_001 }] }).success).toBe(false)
    expect(splitBodySchema.safeParse({ ...ok, rows: [{ rop: ' ', shareBp: 100 }] }).success).toBe(false)
    expect(splitBodySchema.safeParse({ ...ok, rows: [] }).success).toBe(false)
    expect(splitBodySchema.safeParse({ ...ok, rows: [{ rop: 'Sevinch\u0000', shareBp: 100 }] }).success).toBe(false)
    expect(splitBodySchema.safeParse({ ...ok, rows: [{ rop: 'Saidazizxoʻja (ROP)', shareBp: 100 }] }).success).toBe(true)
  })
})

describe('sellerPlanBodySchema', () => {
  const ok = { month: '2026-10', sellers: [{ employeeId: 'e1', dayPlan: 5_000_000 }] }
  it('takes a month and whole soʻm per seller, null removing a plan', () => {
    expect(sellerPlanBodySchema.safeParse(ok).success).toBe(true)
    expect(sellerPlanBodySchema.safeParse({ ...ok, sellers: [{ employeeId: 'e1', dayPlan: null }] }).success).toBe(true)
  })
  it('refuses a fraction, a negative, a bad month and a seller sent twice', () => {
    expect(sellerPlanBodySchema.safeParse({ ...ok, sellers: [{ employeeId: 'e1', dayPlan: 1.5 }] }).success).toBe(false)
    expect(sellerPlanBodySchema.safeParse({ ...ok, sellers: [{ employeeId: 'e1', dayPlan: -1 }] }).success).toBe(false)
    expect(sellerPlanBodySchema.safeParse({ ...ok, month: '2026-13' }).success).toBe(false)
    expect(sellerPlanBodySchema.safeParse({ ...ok, sellers: [] }).success).toBe(false)
    expect(sellerPlanBodySchema.safeParse({ ...ok, sellers: [ok.sellers[0], ok.sellers[0]] }).success).toBe(false)
  })
})

describe('POST /registration/plan — the gate', () => {
  it('asks for kpi:manage inside the registration gate and refuses an unknown seller', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/app/api/v1/registration/plan/route.ts', 'utf8'))
    expect(source).toContain("{ permission: 'analytics:read:all', section: 'registration' }")
    expect(source).toContain("can(ctx.principal, 'kpi:manage')")
    expect(source).toContain('ApiError.validation')
  })
})

describe('POST /registration/split — the gate', () => {
  it('asks for kpi:manage inside the registration gate and checks the sum on the server', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/app/api/v1/registration/split/route.ts', 'utf8'))
    expect(source).toContain("{ permission: 'analytics:read:all', section: 'registration' }")
    expect(source).toContain("can(ctx.principal, 'kpi:manage')")
    expect(source).toContain('splitProblem(ctx.body.rows)')
  })
})
