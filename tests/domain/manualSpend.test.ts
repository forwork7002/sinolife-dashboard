import { describe, expect, it } from 'vitest'

import { type ManualSpendRow, manualSpendBlocks, usdToCents } from '@/server/domain/reklama/manualSpend'

const DAYS = ['2026-10-05', '2026-10-06', '2026-10-07']

const row = (over: Partial<ManualSpendRow>): ManualSpendRow => ({ day: '2026-10-06', project: 'Zextra', channel: 'telegram', amountCents: 25_490, ...over })

describe('manualSpendBlocks — the sheet\'s «Telegram» block onto the window', () => {
  it('lays each typed day on its date, leaves the rest null, and totals in dollars', () => {
    const [collagen, zextra] = manualSpendBlocks(DAYS, [row({}), row({ day: '2026-10-07' })], 'all')
    expect(collagen).toMatchObject({ key: 'Collagen|telegram', name: 'Telegram', product: 'Collagen', totalUsd: 0 })
    expect(collagen!.days.map((d) => d.spendUsd)).toEqual([null, null, null])
    expect(zextra).toMatchObject({ key: 'Zextra|telegram', product: 'Zextra', totalUsd: 509.8 })
    expect(zextra!.days).toEqual([
      { date: '2026-10-05', spendUsd: null },
      { date: '2026-10-06', spendUsd: 254.9 },
      { date: '2026-10-07', spendUsd: 254.9 },
    ])
  })

  it('ignores a row outside the window', () => {
    const [, zextra] = manualSpendBlocks(DAYS, [row({ day: '2026-09-09', amountCents: 39_060 })], 'all')
    expect(zextra!.totalUsd).toBe(0)
    expect(zextra!.days.every((d) => d.spendUsd === null)).toBe(true)
  })

  it('follows the brand switch: one brand keeps its own block, «Brendsiz» none', () => {
    expect(manualSpendBlocks(DAYS, [row({})], 'Zextra').map((b) => b.product)).toEqual(['Zextra'])
    expect(manualSpendBlocks(DAYS, [row({})], 'Collagen').map((b) => b.product)).toEqual(['Collagen'])
    expect(manualSpendBlocks(DAYS, [row({})], 'none')).toEqual([])
  })
})

describe('usdToCents — what the field typed, as the table keeps it', () => {
  it('rounds to whole cents and keeps a cleared day null', () => {
    expect(usdToCents(254.9)).toBe(25_490)
    expect(usdToCents(0.29)).toBe(29)
    expect(usdToCents(390.6)).toBe(39_060)
    expect(usdToCents(0)).toBe(0)
    expect(usdToCents(null)).toBeNull()
  })
})
