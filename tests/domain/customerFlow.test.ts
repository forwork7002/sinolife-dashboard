import { describe, expect, it } from 'vitest'

import { trailingWindow } from '@/server/services/insightsService'

describe('the band’s own window', () => {
  it('trails ninety days back from now, half-open', () => {
    /*
      The screen lost its period control on 2026-09-15 because it drove
      nothing, so this band resolves its own window on the server — the same
      shape /insights/concentration took in that commit. Ninety days is the
      horizon the repeat-rate column already uses, so the two halves of the
      source block are measured over spans a reader can hold together.
    */
    const now = new Date('2026-09-15T08:00:00Z')
    const w = trailingWindow(now)
    expect(w.end.toISOString()).toBe('2026-09-15T08:00:00.000Z')
    expect(w.start.toISOString()).toBe('2026-06-17T08:00:00.000Z')
    expect(w.days).toBe(90)
  })

  it('does not mutate the clock it was handed', () => {
    // A Date is mutable and `setDate` on the caller's instance would move
    // every other window resolved from it in the same request.
    const now = new Date('2026-09-15T08:00:00Z')
    trailingWindow(now)
    expect(now.toISOString()).toBe('2026-09-15T08:00:00.000Z')
  })
})
