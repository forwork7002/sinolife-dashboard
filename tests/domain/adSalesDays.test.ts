import { describe, expect, it } from 'vitest'

import { isBaseTeam } from '@/server/domain/rnp/rnpSheet'
import { buildAdSalesDays, daysFrom } from '@/server/domain/sales/adSalesDays'

const fakt = (day: string, rop: string, som: number) => ({ day, rop, fakt1Minor: BigInt(som) * 100n })
const spend = (date: string, usd: number, product: string | null = 'Collagen') => ({
  date,
  product,
  spendMicroUsd: BigInt(Math.round(usd * 1_000_000)),
})

describe('isBaseTeam', () => {
  it('names the two БАЗА teams, an old alias folded first', () => {
    expect(isBaseTeam('Baza')).toBe(true)
    expect(isBaseTeam('Charos')).toBe(true)
    expect(isBaseTeam('Malika')).toBe(true) // → Charos
    expect(isBaseTeam('Sadriddin')).toBe(false)
    expect(isBaseTeam('Sevinchxon')).toBe(false) // → Sadriddin
    expect(isBaseTeam('(ROP yoʻq)')).toBe(false)
  })
})

describe('buildAdSalesDays', () => {
  const days = daysFrom('2026-10-01', '2026-10-03')

  it('lists every day oldest first, a quiet one as zeros', () => {
    const out = buildAdSalesDays(days, [fakt('2026-10-01', 'Lola', 1_000)], [])
    expect(out.rows.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(out.rows[1]).toEqual({ date: '2026-10-02', spendUsd: 0, fakt1: 0, primary: 0, base: 0 })
  })

  it('splits FAKT 1 into Первичка and База, and the two add up to it', () => {
    const out = buildAdSalesDays(
      days,
      [
        fakt('2026-10-01', 'Lola', 3_200_000),
        fakt('2026-10-01', 'Baza', 1_600_000),
        fakt('2026-10-01', 'Malika', 400_000),
        fakt('2026-10-01', '(ROP yoʻq)', 50_000),
        fakt('2026-10-02', 'Charos', 700_000),
      ],
      [],
    )
    expect(out.rows[0]).toMatchObject({ fakt1: 5_250_000, primary: 3_250_000, base: 2_000_000 })
    expect(out.rows[1]).toMatchObject({ fakt1: 700_000, primary: 0, base: 700_000 })
    for (const r of out.rows) expect(r.primary + r.base).toBe(r.fakt1)
    expect(out.total).toEqual({ spendUsd: 0, fakt1: 5_950_000, primary: 3_250_000, base: 2_700_000 })
  })

  it('counts ad-budget money only, to the cent', () => {
    const out = buildAdSalesDays(
      days,
      [],
      [spend('2026-10-01', 250.97), spend('2026-10-01', 100.01, 'Zextra'), spend('2026-10-01', 99, null), spend('2026-10-03', 0.02)],
    )
    expect(out.rows.map((r) => r.spendUsd)).toEqual([350.98, 0, 0.02])
    expect(out.total.spendUsd).toBe(351)
  })

  it('rounds a tiyin remainder once, so Первичка + База still equals FAKT 1', () => {
    const tiyin = (day: string, rop: string, minor: bigint) => ({ day, rop, fakt1Minor: minor })
    const out = buildAdSalesDays(
      ['2026-10-01'],
      [tiyin('2026-10-01', 'Lola', 100_050n), tiyin('2026-10-01', 'Baza', 50n)],
      [],
    )
    // 1 000,50 + 0,50 = 1 001,00
    expect(out.rows[0]).toMatchObject({ fakt1: 1_001, primary: 1_001, base: 0 })
    expect(out.total).toMatchObject({ fakt1: 1_001, primary: 1_001, base: 0 })
  })

  it('drops rows outside the days it was given', () => {
    const out = buildAdSalesDays(days, [fakt('2026-09-30', 'Lola', 9)], [spend('2026-10-04', 9)])
    expect(out.total).toEqual({ spendUsd: 0, fakt1: 0, primary: 0, base: 0 })
  })
})
