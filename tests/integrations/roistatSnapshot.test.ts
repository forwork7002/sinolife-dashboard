import { describe, expect, it } from 'vitest'

import { MarketingRepository } from '@/server/repositories/marketingRepository'

import { SNAPSHOT_ID, bankRateOf, isDatedRate, saveSnapshot, snapshotOf } from '../../scripts/roistatSnapshot'

/**
 * THE HOURLY ROISTAT RUN WRITES THE RATE AND NOTHING ELSE.
 *
 * `marketing_daily` had no reader since 2026-09-30, yet the import replaced
 * ~24 500 of its rows every hour in one long transaction. What /target still
 * needs is the snapshot's UZS/USD rate, read by `MarketingRepository.snapshot()`
 * and turned into `meta.usdRate` (micro-soʻm ÷ 1e6). These cases walk that
 * path end to end over an in-memory table: the importer's write → the
 * repository's read → the number /target divides by.
 */

const BLOB = {
  rate: 11_823.69,
  rateDate: '06.10.2026',
  updated: '06.10.2026 21:40',
  today: '2026-10-06',
  minDate: '2025-01-01',
  maxDate: '2026-10-06',
  dailyFrom: '2026-07-01',
  freshFrom: '2026-09-01',
}

type Row = Record<string, unknown> & { id: string; rowCount: number }

/** `marketing_snapshot` in memory; `marketing_daily` refuses to be touched. */
function fakeDb(existing: Row | null = null) {
  let row: Row | null = existing
  return {
    get row() {
      return row
    },
    marketingSnapshot: {
      findUnique: async () => row,
      upsert: async ({ create, update }: { create: Row; update: Omit<Row, 'id'> }) => {
        row = row ? { ...row, ...update } : create
        return row
      },
    },
    marketingDaily: new Proxy(
      {},
      {
        get(_t, prop) {
          throw new Error(`marketing_daily touched: ${String(prop)}`)
        },
      },
    ),
  }
}

const NOW = new Date('2026-10-07T04:00:00Z')

describe('saveSnapshot', () => {
  it('writes the rate /target reads, and never touches marketing_daily', async () => {
    const db = fakeDb()
    await saveSnapshot(db as never, BLOB, 'https://example/roistat/', 24_512, { force: false, now: NOW })

    expect(db.row?.id).toBe(SNAPSHOT_ID)
    expect(db.row?.usdRateMicro).toBe(11_823_690_000n)
    expect(db.row?.rateDate).toEqual(new Date(Date.UTC(2026, 9, 6)))
    expect(db.row?.importedAt).toEqual(NOW)
    expect(db.row?.rowCount).toBe(24_512)
  })

  it('round-trips to the rate /target divides by', async () => {
    const db = fakeDb()
    await saveSnapshot(db as never, BLOB, 'https://example/roistat/', 24_512, { force: false, now: NOW })

    const snapshot = await new MarketingRepository(db as never).snapshot()
    expect(snapshot?.rateDate).toBe('2026-10-06')
    // targetService: usdRate = Number(snapshot.usdRateMicro) / 1_000_000
    expect(Number(snapshot!.usdRateMicro) / 1_000_000).toBe(11_823.69)
    expect(snapshot?.importedAt).toEqual(NOW)
  })

  it('refuses a blob under half the rows the last import carried, unless forced', async () => {
    const previous = { id: SNAPSHOT_ID, ...snapshotOf(BLOB, 'x', 24_000, new Date(0)) } as unknown as Row
    const db = fakeDb(previous)

    await expect(
      saveSnapshot(db as never, { ...BLOB, rate: 1 }, 'x', 11_000, { force: false, now: NOW }),
    ).rejects.toThrow(/truncated publish/)
    expect(db.row?.usdRateMicro).toBe(11_823_690_000n)

    await saveSnapshot(db as never, { ...BLOB, rate: 12_000 }, 'x', 11_000, { force: true, now: NOW })
    expect(db.row?.usdRateMicro).toBe(12_000_000_000n)
  })

  it('updates the same row on every run', async () => {
    const db = fakeDb()
    await saveSnapshot(db as never, BLOB, 'x', 24_000, { force: false, now: NOW })
    await saveSnapshot(db as never, { ...BLOB, rate: 11_900.5 }, 'x', 24_100, { force: false, now: NOW })
    expect(db.row?.usdRateMicro).toBe(11_900_500_000n)
    expect(db.row?.rowCount).toBe(24_100)
  })
})

/**
 * «РЕЗЕРВ» IS NOT A RATE (2026-10-24). The source publishes its typed reserve
 * — 12 650.0 that day, the bank's rate 11 838.92 — with `rateDate: "резерв"`
 * when it cannot reach the Central Bank. The importer refused every such run;
 * now it writes the blob and takes the bank's rate, else keeps the stored one.
 */
describe('a blob whose rate is the source\u2019s reserve', () => {
  const RESERVE = { ...BLOB, rate: 12_650, rateDate: 'резерв', today: '2026-10-24' }
  const BANK = [{ Ccy: 'USD', Rate: '11838.92', Date: '24.10.2026' }]

  it('is told apart from a dated rate', () => {
    expect(isDatedRate('06.10.2026')).toBe(true)
    expect(isDatedRate('резерв')).toBe(false)
  })

  it('reads the bank\u2019s rate and its own date, and nothing that is not one', () => {
    expect(bankRateOf(BANK)).toEqual({ rate: 11_838.92, date: '24.10.2026' })
    expect(bankRateOf([{ Ccy: 'USD', Rate: '11838.92', Date: 'bugun' }])).toBeNull()
    expect(bankRateOf([{ Ccy: 'EUR', Rate: '13000', Date: '24.10.2026' }])).toBeNull()
    expect(bankRateOf({})).toBeNull()
  })

  it('stores the bank\u2019s rate, never the reserve, and writes the rest of the blob', async () => {
    const db = fakeDb({ id: SNAPSHOT_ID, ...snapshotOf(BLOB, 'x', 24_000, new Date(0)) } as unknown as Row)
    const saved = await saveSnapshot(db as never, RESERVE, 'x', 55_899, {
      force: false,
      now: NOW,
      bankRate: async () => bankRateOf(BANK),
    })

    expect(saved.rateSource).toBe('cbu')
    expect(db.row?.usdRateMicro).toBe(11_838_920_000n)
    expect(db.row?.rateDate).toEqual(new Date(Date.UTC(2026, 9, 24)))
    expect(db.row?.today).toEqual(new Date(Date.UTC(2026, 9, 24)))
    expect(db.row?.rowCount).toBe(55_899)
    expect(db.row?.importedAt).toEqual(NOW)
  })

  it('keeps the stored rate when the bank does not answer either', async () => {
    const db = fakeDb({ id: SNAPSHOT_ID, ...snapshotOf(BLOB, 'x', 24_000, new Date(0)) } as unknown as Row)
    const saved = await saveSnapshot(db as never, RESERVE, 'x', 55_899, {
      force: false,
      now: NOW,
      bankRate: async () => {
        throw new Error('cbu.uz timed out')
      },
    })

    expect(saved.rateSource).toBe('previous')
    expect(db.row?.usdRateMicro).toBe(11_823_690_000n)
    expect(db.row?.rateDate).toEqual(new Date(Date.UTC(2026, 9, 6)))
    expect(db.row?.importedAt).toEqual(NOW)
  })

  it('refuses when there is neither a bank answer nor an earlier rate', async () => {
    const db = fakeDb()
    await expect(
      saveSnapshot(db as never, RESERVE, 'x', 55_899, { force: false, now: NOW, bankRate: async () => null }),
    ).rejects.toThrow(/reserve/)
    expect(db.row).toBeNull()
  })

  it('takes usd_rate\u2019s newest day over the snapshot\u2019s older one when the bank is out of reach (2026-10-28)', async () => {
    const db = fakeDb({ id: SNAPSHOT_ID, ...snapshotOf(BLOB, 'x', 24_000, new Date(0)) } as unknown as Row)
    const saved = await saveSnapshot(db as never, RESERVE, 'x', 55_899, {
      force: false,
      now: NOW,
      bankRate: async () => null,
      rates: {
        latest: async () => ({ usdRateMicro: 11_918_980_000n, rateDate: new Date(Date.UTC(2026, 9, 28)) }),
        keep: async () => {},
      },
    })
    expect(saved.rateSource).toBe('stored')
    expect(db.row?.usdRateMicro).toBe(11_918_980_000n)
    expect(db.row?.rateDate).toEqual(new Date(Date.UTC(2026, 9, 28)))
  })

  it('keeps the snapshot\u2019s rate when usd_rate holds nothing newer', async () => {
    const db = fakeDb({ id: SNAPSHOT_ID, ...snapshotOf(BLOB, 'x', 24_000, new Date(0)) } as unknown as Row)
    const saved = await saveSnapshot(db as never, RESERVE, 'x', 55_899, {
      force: false,
      now: NOW,
      bankRate: async () => null,
      rates: { latest: async () => ({ usdRateMicro: 1n, rateDate: new Date(Date.UTC(2026, 9, 1)) }), keep: async () => {} },
    })
    expect(saved.rateSource).toBe('previous')
    expect(db.row?.usdRateMicro).toBe(11_823_690_000n)
  })

  it('hands a dated rate to usd_rate, the blob\u2019s as «roistat», the bank\u2019s as «cbu»', async () => {
    const kept: string[] = []
    const rates = {
      latest: async () => null,
      keep: async (r: { rateDate: Date }, source: string) => void kept.push(`${source} ${r.rateDate.toISOString().slice(0, 10)}`),
    }
    await saveSnapshot(fakeDb() as never, BLOB, 'x', 24_000, { force: false, now: NOW, rates })
    const db = fakeDb({ id: SNAPSHOT_ID, ...snapshotOf(BLOB, 'x', 24_000, new Date(0)) } as unknown as Row)
    await saveSnapshot(db as never, RESERVE, 'x', 55_899, { force: false, now: NOW, bankRate: async () => bankRateOf(BANK), rates })
    expect(kept).toEqual(['roistat 2026-10-06', 'cbu 2026-10-24'])
  })

  it('takes a dated blob\u2019s own rate without asking the bank', async () => {
    const db = fakeDb()
    let asked = 0
    const saved = await saveSnapshot(db as never, BLOB, 'x', 24_000, {
      force: false,
      now: NOW,
      bankRate: async () => {
        asked += 1
        return bankRateOf(BANK)
      },
    })
    expect(saved.rateSource).toBe('source')
    expect(asked).toBe(0)
    expect(db.row?.usdRateMicro).toBe(11_823_690_000n)
  })
})

describe('the importer script', () => {
  it('no longer names marketing_daily writes or its digest', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('scripts/importRoistat.ts', 'utf8')
    expect(source).not.toMatch(/marketingDaily\.(deleteMany|createMany|create|upsert|update)/)
    expect(source).not.toMatch(/FROM "marketing_daily"/)
    expect(source).toMatch(/saveSnapshot\(/)
  })
})
