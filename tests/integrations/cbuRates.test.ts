import { describe, expect, it, vi } from 'vitest'

import { CbuUsdRates, parseCbuRate, sharedCbuUsdRates } from '@/server/integrations/cbu/cbuRates'

const answer = (rate: string) => [{ Ccy: 'USD', Rate: rate, Date: '29.09.2026' }]

function bank(rates: Record<string, unknown>) {
  const asked: string[] = []
  const fetcher = async (url: string) => {
    const day = url.match(/(\d{4}-\d{2}-\d{2})\/$/)?.[1] ?? ''
    asked.push(day)
    const body = rates[day]
    if (body instanceof Error) throw body
    return { ok: body !== undefined, json: async () => body }
  }
  return { fetcher, asked }
}

describe('parseCbuRate', () => {
  it('reads the dollar from the bank\'s answer', () => {
    expect(parseCbuRate(answer('11806.97'))).toBe(11806.97)
  })

  it('refuses anything that is not a plausible rate', () => {
    expect(parseCbuRate([])).toBeNull()
    expect(parseCbuRate({ Rate: '11806' })).toBeNull()
    expect(parseCbuRate(answer('abc'))).toBeNull()
    expect(parseCbuRate(answer('12'))).toBeNull()
    expect(parseCbuRate([{ Ccy: 'EUR', Rate: '13500' }])).toBeNull()
  })
})

describe('CbuUsdRates', () => {
  it('asks for each day up to today, and nothing after', async () => {
    const { fetcher, asked } = bank({ '2026-09-01': answer('11900'), '2026-09-02': answer('11910') })
    const rates = await new CbuUsdRates(fetcher).forDays(['2026-09-01', '2026-09-02', '2026-09-03'], '2026-09-02')
    expect(rates).toEqual([11900, 11910, null])
    expect(asked.sort()).toEqual(['2026-09-01', '2026-09-02'])
  })

  it('keeps a past day for good and today for an hour', async () => {
    let now = 0
    const { fetcher, asked } = bank({ '2026-09-01': answer('11900'), '2026-09-02': answer('11910') })
    const usd = new CbuUsdRates(fetcher, () => now)
    await usd.forDays(['2026-09-01', '2026-09-02'], '2026-09-02')
    now = 30 * 60_000
    await usd.forDays(['2026-09-01', '2026-09-02'], '2026-09-02')
    expect(asked).toHaveLength(2)
    now = 61 * 60_000
    await usd.forDays(['2026-09-01', '2026-09-02'], '2026-09-02')
    expect(asked.filter((d) => d === '2026-09-02')).toHaveLength(2) // today asked again
    expect(asked.filter((d) => d === '2026-09-01')).toHaveLength(1) // the past never
  })

  it('answers null for a day the bank did not answer, and asks again ten minutes on — not on every load', async () => {
    let now = 0
    const rates: Record<string, unknown> = { '2026-09-01': new Error('down') }
    const { fetcher, asked } = bank(rates)
    const usd = new CbuUsdRates(fetcher, () => now)
    expect(await usd.forDays(['2026-09-01'], '2026-09-01')).toEqual([null])
    rates['2026-09-01'] = answer('11900')
    now = 9 * 60_000
    // A hanging bank cost every load its timeout (5 s, 30 s for a cold month): within the window, nobody asks.
    expect(await usd.forDays(['2026-09-01'], '2026-09-01')).toEqual([null])
    expect(asked).toHaveLength(1)
    now = 11 * 60_000
    expect(await usd.forDays(['2026-09-01'], '2026-09-01')).toEqual([11900])
    expect(asked).toHaveLength(2)
  })

  it("keeps today's older rate through a failed refresh, and does not ask again within ten minutes", async () => {
    let now = 0
    const rates: Record<string, unknown> = { '2026-09-02': answer('11910') }
    const { fetcher, asked } = bank(rates)
    const usd = new CbuUsdRates(fetcher, () => now)
    await usd.forDays(['2026-09-02'], '2026-09-02')
    rates['2026-09-02'] = { not: 'a rate' }
    now = 61 * 60_000
    expect(await usd.forDays(['2026-09-02'], '2026-09-02')).toEqual([11910])
    now = 65 * 60_000
    expect(await usd.forDays(['2026-09-02'], '2026-09-02')).toEqual([11910])
    expect(asked).toHaveLength(2)
  })
})

/*
  The RNP warmer's bundle and the routes' each load this module (2026-10-06):
  one cache for the process, so a day the warmer read is not asked again.
*/
describe('sharedCbuUsdRates', () => {
  it('hands a second copy of the module — another bundle’s — the same rates', async () => {
    const first = sharedCbuUsdRates()
    expect(sharedCbuUsdRates()).toBe(first)
    vi.resetModules()
    const copy = await import('@/server/integrations/cbu/cbuRates')
    expect(copy.CbuUsdRates).not.toBe(CbuUsdRates)
    expect(copy.sharedCbuUsdRates()).toBe(first)
  })
})
