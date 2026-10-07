import { describe, expect, it } from 'vitest'

import { manualSpendBodySchema } from '@/app/api/v1/reklama/manual-spend/schema'

const cell = (over: Record<string, unknown> = {}) => ({ day: '2026-10-06', project: 'Zextra', channel: 'telegram', value: 254.9, ...over })
const body = (cells: unknown[]) => ({ cells })

describe('POST /reklama/manual-spend — the body', () => {
  it('takes typed dollars to the cent, and a cleared day', () => {
    expect(manualSpendBodySchema.safeParse(body([cell(), cell({ day: '2026-10-07', value: null }), cell({ value: 390.6 })])).success).toBe(true)
    expect(manualSpendBodySchema.safeParse(body([cell({ value: 0 })])).success).toBe(true)
  })

  it('refuses an impossible day, a non-day and a day before the data', () => {
    expect(manualSpendBodySchema.safeParse(body([cell({ day: '2026-09-31' })])).success).toBe(false)
    expect(manualSpendBodySchema.safeParse(body([cell({ day: '1990-05-05' })])).success).toBe(false)
    expect(manualSpendBodySchema.safeParse(body([cell({ day: '2025-01-01' })])).success).toBe(true)
    expect(manualSpendBodySchema.safeParse(body([cell({ day: '2026-99-99' })])).success).toBe(false)
    expect(manualSpendBodySchema.safeParse(body([cell({ day: '06.10.2026' })])).success).toBe(false)
  })

  it('refuses an unknown project or channel, a third decimal, a negative and an absurd amount', () => {
    expect(manualSpendBodySchema.safeParse(body([cell({ project: 'Boshqa' })])).success).toBe(false)
    expect(manualSpendBodySchema.safeParse(body([cell({ channel: 'yandex' })])).success).toBe(false)
    expect(manualSpendBodySchema.safeParse(body([cell({ value: 12.345 })])).success).toBe(false)
    expect(manualSpendBodySchema.safeParse(body([cell({ value: -1 })])).success).toBe(false)
    expect(manualSpendBodySchema.safeParse(body([cell({ value: 2_000_000 })])).success).toBe(false)
  })

  it('refuses an empty save and a flood', () => {
    expect(manualSpendBodySchema.safeParse(body([])).success).toBe(false)
    expect(manualSpendBodySchema.safeParse(body(Array.from({ length: 501 }, () => cell()))).success).toBe(false)
  })
})

describe('POST /reklama/manual-spend — the gate', () => {
  it('asks for kpi:manage inside the marketing gate, refuses a day after today, and saves cents', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/app/api/v1/reklama/manual-spend/route.ts', 'utf8'))
    expect(source).toContain("{ permission: 'analytics:read:all', section: 'marketing' }")
    expect(source).toContain("can(ctx.principal, 'kpi:manage')")
    expect(source).toContain('c.day > today')
    expect(source).toContain('usdToCents(c.value)')
  })
})
