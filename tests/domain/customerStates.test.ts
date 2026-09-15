import { describe, expect, it } from 'vitest'

import { CUSTOMER_ACTIVE_DAYS, CUSTOMER_AT_RISK_DAYS } from '@/lib/customerStates'

describe('the customer state definitions', () => {
  it('keeps the thresholds the measurement chose', () => {
    /*
      Measured on production 2026-09-15 over 2 346 inter-purchase gaps:
      median 37.5 days, p75 73.9, p90 141.1. 60 is past p75 — a customer
      inside it is inside the normal cycle. 150 is past p90 — a customer
      silent that long returns with under one chance in ten. Moving either
      is a business decision and should break this test.
    */
    expect(CUSTOMER_ACTIVE_DAYS).toBe(60)
    expect(CUSTOMER_AT_RISK_DAYS).toBe(150)
    expect(CUSTOMER_ACTIVE_DAYS).toBeLessThan(CUSTOMER_AT_RISK_DAYS)
  })

  it('keeps only what the stage table cannot answer', async () => {
    /*
      src/lib/retentionGroups.ts owns the partition of the База funnel and
      is read by both the screen and the SQL. This module owns one different
      thing: how long a customer has been SILENT, which is a fact about their
      orders and not about any stage they sit on. If a stage list ever
      reappears here, there are two definitions of one partition again.
    */
    const mod = await import('@/lib/customerStates')
    expect(Object.keys(mod).some((k) => /STAGE|BUCKET|PORTAL/i.test(k))).toBe(false)
  })
})
