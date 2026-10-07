import { describe, expect, it } from 'vitest'

import { MarketingRepository } from '@/server/repositories/marketingRepository'

import { SNAPSHOT_ID, saveSnapshot, snapshotOf } from '../../scripts/roistatSnapshot'

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

describe('the importer script', () => {
  it('no longer names marketing_daily writes or its digest', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('scripts/importRoistat.ts', 'utf8')
    expect(source).not.toMatch(/marketingDaily\.(deleteMany|createMany|create|upsert|update)/)
    expect(source).not.toMatch(/FROM "marketing_daily"/)
    expect(source).toMatch(/saveSnapshot\(/)
  })
})
