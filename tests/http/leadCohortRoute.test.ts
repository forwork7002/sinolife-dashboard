import { describe, expect, it } from 'vitest'

import { overviewQuerySchema } from '@/app/api/v1/lead-cohort/overview/schema'

/*
  `/lead-cohort/overview`'s query. A day that is no day reached the window's
  date arithmetic and threw — a 500 and an error log where a 400 is right
  (2026-10-06 audit).
*/
describe('lead-cohort overview query', () => {
  it('takes real calendar days and refuses the rest — a 400, not a 500', () => {
    expect(overviewQuerySchema.safeParse({}).success).toBe(true)
    expect(overviewQuerySchema.safeParse({ from: '2026-09-23', to: '2026-10-06' }).success).toBe(true)
    expect(overviewQuerySchema.safeParse({ to: '2026-00-99' }).success).toBe(false)
    expect(overviewQuerySchema.safeParse({ from: '2026-13-45' }).success).toBe(false)
    expect(overviewQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false)
  })

  it('takes a year half-typed into the date box: the window is clamped, never refused', () => {
    // A refusal puts the error card in place of the whole tab, the date box with it.
    expect(overviewQuerySchema.safeParse({ from: '0002-10-06' }).success).toBe(true)
  })
})
