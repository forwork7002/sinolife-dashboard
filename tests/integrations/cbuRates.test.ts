import { describe, expect, it, vi } from 'vitest'

import { CbuUsdRates, type UsdRateStore, parseCbuRate, sharedCbuUsdRates } from '@/server/integrations/cbu/cbuRates'

// The container, imported below, reads `env` as it loads.
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

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
/** `usd_rate` in memory: what was written, and the newest day on or before a day. */
function memoryStore(seed: Record<string, number> = {}) {
  const rows = new Map(Object.entries(seed))
  const writes: string[] = []
  const store: UsdRateStore = {
    read: async (days) => new Map(days.flatMap((d) => (rows.has(d) ? [[d, rows.get(d)!] as const] : []))),
    latestOnOrBefore: async (day) => {
      const best = [...rows.keys()].filter((d) => d <= day).sort().pop()
      return best ? { day: best, rate: rows.get(best)! } : null
    },
    write: async (day, rate) => {
      writes.push(day)
      rows.set(day, rate)
    },
  }
  return { store, rows, writes }
}

describe('CbuUsdRates over usd_rate (2026-10-28 — cbu.uz closed to DigitalOcean)', () => {
  it('reads a past day from the store and never asks the bank for it', async () => {
    const { fetcher, asked } = bank({})
    const { store } = memoryStore({ '2026-10-27': 11861.96 })
    const rates = await new CbuUsdRates(fetcher, Date.now, store).forDays(['2026-10-27'], '2026-10-28')
    expect(rates).toEqual([11861.96])
    expect(asked).toEqual([])
  })

  it('keeps what the bank answers, so the next process has it', async () => {
    const { fetcher } = bank({ '2026-10-28': answer('11918.98') })
    const { store, rows, writes } = memoryStore()
    await new CbuUsdRates(fetcher, Date.now, store).forDays(['2026-10-28'], '2026-10-28')
    await Promise.resolve()
    expect(writes).toEqual(['2026-10-28'])
    expect(rows.get('2026-10-28')).toBe(11918.98)
    // A deploy: a new process, a bank that no longer answers — the day is still there.
    const after = await new CbuUsdRates(bank({}).fetcher, Date.now, store).forDays(['2026-10-28'], '2026-10-29')
    expect(after).toEqual([11918.98])
  })

  it("answers today's stored rate when the bank fails today", async () => {
    const { fetcher } = bank({ '2026-10-28': new Error('connect timeout') })
    const { store } = memoryStore({ '2026-10-28': 11918.98 })
    expect(await new CbuUsdRates(fetcher, Date.now, store).forDays(['2026-10-28'], '2026-10-28')).toEqual([11918.98])
  })

  it('dates a day neither answers at the newest stored day before it', async () => {
    const { fetcher } = bank({ '2026-10-30': new Error('connect timeout') })
    const { store } = memoryStore({ '2026-10-27': 11861.96, '2026-10-28': 11918.98 })
    const usd = new CbuUsdRates(fetcher, Date.now, store)
    expect(await usd.dated('2026-10-30', '2026-10-30')).toEqual({ rate: 11918.98, day: '2026-10-28' })
    expect(await usd.dated('2026-10-27', '2026-10-30')).toEqual({ rate: 11861.96, day: '2026-10-27' })
    expect(await usd.dated('2026-10-01', '2026-10-30')).toBeNull()
  })

  it('reads a failing store as an empty one', async () => {
    const broken: UsdRateStore = {
      read: async () => Promise.reject(new Error('db down')),
      latestOnOrBefore: async () => Promise.reject(new Error('db down')),
      write: async () => Promise.reject(new Error('db down')),
    }
    const usd = new CbuUsdRates(bank({ '2026-10-28': answer('11918.98') }).fetcher, Date.now, broken)
    expect(await usd.forDays(['2026-10-28'], '2026-10-28')).toEqual([11918.98])
    expect(await usd.latestOnOrBefore('2026-10-28')).toBeNull()
  })
})

describe('sharedCbuUsdRates', () => {
  it('hands a second copy of the module — another bundle’s — the same rates', async () => {
    const first = sharedCbuUsdRates()
    expect(sharedCbuUsdRates()).toBe(first)
    vi.resetModules()
    const copy = await import('@/server/integrations/cbu/cbuRates')
    expect(copy.CbuUsdRates).not.toBe(CbuUsdRates)
    expect(copy.sharedCbuUsdRates()).toBe(first)
  })

  // Two cold imports of the whole server container: ~1.5 s alone, past the
  // default 5 s under the full suite's parallel load (it timed out there on a
  // clean origin/main, 2026-10-20), so it gets room rather than a flake.
  it('is what the container hands «RNP jadvali» and «Roistat», whichever bundle builds the container', { timeout: 30_000 }, async () => {
    const routes = await import('@/server/services/container')
    vi.resetModules()
    const warmer = await import('@/server/services/container')
    expect(warmer.rnpService).not.toBe(routes.rnpService) // two containers, as the two bundles build them
    const usd = (service: object) => (service as { usd?: unknown }).usd
    expect(usd(routes.rnpService)).toBeDefined()
    expect(usd(warmer.rnpService)).toBe(usd(routes.rnpService))
    expect(usd(warmer.roistatService)).toBe(usd(routes.rnpService))
  })
})
