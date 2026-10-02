import { describe, expect, it } from 'vitest'

import { groupIntakeBodySchema, overviewQuerySchema, splitBodySchema } from '@/app/api/v1/registration/schema'

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

describe('POST /registration/split — the gate', () => {
  it('asks for kpi:manage inside the leads gate and checks the sum on the server', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/app/api/v1/registration/split/route.ts', 'utf8'))
    expect(source).toContain("{ permission: 'analytics:read:all', section: 'leads' }")
    expect(source).toContain("can(ctx.principal, 'kpi:manage')")
    expect(source).toContain('splitProblem(ctx.body.rows)')
  })
})

describe('groupIntakeBodySchema', () => {
  const ok = { day: '2026-09-28', rows: [{ group: 'Aziz', leads: 144 }] }
  it('takes a day and whole leads per known group, null removing a number', () => {
    expect(groupIntakeBodySchema.safeParse(ok).success).toBe(true)
    expect(groupIntakeBodySchema.safeParse({ ...ok, rows: [{ group: 'Marjona', leads: null }] }).success).toBe(true)
  })
  it('refuses an unknown group, a fraction, a negative, no rows and a group sent twice', () => {
    expect(groupIntakeBodySchema.safeParse({ ...ok, rows: [{ group: 'Zextra', leads: 1 }] }).success).toBe(false)
    expect(groupIntakeBodySchema.safeParse({ ...ok, rows: [{ group: 'Aziz', leads: 1.5 }] }).success).toBe(false)
    expect(groupIntakeBodySchema.safeParse({ ...ok, rows: [{ group: 'Aziz', leads: -1 }] }).success).toBe(false)
    expect(groupIntakeBodySchema.safeParse({ ...ok, rows: [] }).success).toBe(false)
    expect(groupIntakeBodySchema.safeParse({ ...ok, rows: [ok.rows[0], ok.rows[0]] }).success).toBe(false)
    expect(groupIntakeBodySchema.safeParse({ ...ok, day: '2026-02-30' }).success).toBe(false)
  })
})

describe('POST /registration/groups — the gate', () => {
  it('asks for kpi:manage inside the leads gate and refuses a day to come', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/app/api/v1/registration/groups/route.ts', 'utf8'))
    expect(source).toContain("{ permission: 'analytics:read:all', section: 'leads' }")
    expect(source).toContain("can(ctx.principal, 'kpi:manage')")
    expect(source).toContain('ctx.body.day > zonedDateKey(ctx.now, ctx.timeZone)')
  })
})
