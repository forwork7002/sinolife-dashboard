import { describe, expect, it } from 'vitest'

import {
  ABSENT_BUCKET,
  CUSTOMER_ACTIVE_DAYS,
  CUSTOMER_AT_RISK_DAYS,
  CUSTOMER_STATES,
  RETENTION_STATE_STAGES,
  STATE_BUCKET,
  UNBUCKETED_BUCKET,
} from '@/lib/customerStates'

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

  it('partitions the retention stages without overlap', () => {
    // A stage in two buckets makes one customer two customers.
    const all = RETENTION_STATE_STAGES.flatMap((row) => row.stages)
    expect(new Set(all).size).toBe(all.length)
  })

  it('names every state exactly once and buckets each to its own integer', () => {
    const keys = CUSTOMER_STATES.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(RETENTION_STATE_STAGES.map((r) => r.state)).toEqual(keys)

    const buckets = keys.map((key) => STATE_BUCKET[key])
    expect(new Set(buckets).size).toBe(buckets.length)
    expect(buckets).not.toContain(UNBUCKETED_BUCKET)
    expect(buckets).not.toContain(ABSENT_BUCKET)
  })

  it('orders the buckets so that the BEST state wins a min()', () => {
    /*
      A customer sitting on two База stages is counted once, in their best
      bucket, and the repository does that with min(bucket). That only works
      while ACTIVE < AT_RISK < LOST, and it is the whole reason these are
      integers rather than strings.
    */
    expect(STATE_BUCKET.ACTIVE).toBeLessThan(STATE_BUCKET.AT_RISK)
    expect(STATE_BUCKET.AT_RISK).toBeLessThan(STATE_BUCKET.LOST)
    expect(STATE_BUCKET.LOST).toBeLessThan(UNBUCKETED_BUCKET)
  })

  it('carries the portal stage names in Russian, verbatim', () => {
    // The whole value of this block is that it reconciles against
    // obey.bitrix24.kz. A translated stage name is one more thing to
    // reconcile, and the prefix is load-bearing: stage ids repeat across
    // funnels, so names are stored prefixed with their pipeline.
    const all = RETENTION_STATE_STAGES.flatMap((row) => row.stages)
    for (const stage of all) expect(stage.startsWith('База · ')).toBe(true)
    expect(all).toContain('База · Недозвоны')
    expect(all).toContain('База · Неактивные')
    expect(all).toContain('База · Актив')
  })

  it('writes down no stage count', () => {
    // The portal added a 19th Доставка stage on 2026-09-10 and two places
    // went on printing "eighteen" for a day. Nothing here asserts a total.
    const all = RETENTION_STATE_STAGES.flatMap((row) => row.stages)
    expect(all.length).toBeGreaterThan(0)
  })
})
