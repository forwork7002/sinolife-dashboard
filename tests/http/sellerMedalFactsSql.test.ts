import { describe, expect, it } from 'vitest'

/*
  Same reason `confirmationRecordsSql.test.ts` supplies these first: `env` is
  read at module scope for APP_TIMEZONE and refuses to load without a complete
  configuration. A unit test about SQL shape has no database.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * The medal cut, held to the board's own definitions.
 *
 * THE PAGON AND THE PODIUM ARE ONE SCREEN. A seat prints a gold medal above
 * the same seller's FAKT 2 figure, so the two must agree about who a seller
 * is, what FAKT 1 counts, what FAKT 2 counts, and how a place is decided — or
 * the board crowns one person and the pagon under it crowns another.
 *
 * This cut deliberately does NOT reuse `recordsSql` (which keeps only
 * `place = 1`) and does NOT modify it (`confirmationRecordsSql.test.ts` pins
 * that string, and the record wall is a working object on a television). The
 * agreement is bought instead by sharing the predicates literally, and this
 * file is what proves they are still shared.
 */
const medalFactsSql = (
  InsightsRepository as unknown as {
    medalFactsSql: (grain: 'month' | 'day', filterClause: string) => string
  }
).medalFactsSql

const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const MONTH = bare(medalFactsSql('month', ''))
const DAY = bare(medalFactsSql('day', ''))

describe('medal kesimi taxtaning tilida gapiradi', () => {
  it('FAKT 1 — navbatdan buyurtma bo‘lib chiqqan ikki natija', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toContain("c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')")
      expect(sql).not.toContain('UC_YUKVF1')
    }
  })

  it('FAKT 2 — bitimning JORIY bosqichidagi yetkazish roli', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toContain(`ds."logisticsRole" = 'DELIVERED'`)
    }
  })

  it('sotuvchi — operator, bo‘lmasa mas’ul', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toContain('COALESCE(d."operatorEmployeeId", d."employeeId")')
    }
  })

  it('o‘rin podiumning qoidasi: FAKT 2 birinchi, FAKT 1 hech kim yetkazmaganda', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toMatch(/row_number\(\) OVER \(/)
      expect(sql).toMatch(/ORDER BY[\s\S]*?DELIVERED[\s\S]*?DESC NULLS LAST/)
      expect(sql).toContain('e."id"') // tie-break — ism emas
    }
  })

  it('oy kesimi oy bo‘yicha, kun kesimi kun bo‘yicha guruhlanadi', () => {
    expect(MONTH).toContain("date_trunc('month'")
    expect(MONTH).not.toContain("date_trunc('day'")
    expect(DAY).toContain("date_trunc('day'")
    expect(DAY).not.toContain("date_trunc('month'")
  })

  it('vaqt mintaqasi hisobotning o‘zi, UTC emas', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toContain("AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'")
    }
  })

  it('sof rad javoblardan iborat kesim qator bermaydi', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toContain('HAVING')
    }
  })

  it('`place = 1` filtri YO‘Q — pagon butun floorni oladi', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).not.toContain('place = 1')
    }
  })

  it('filtr bandi ikkala kesimga ham o‘tadi', () => {
    expect(bare(medalFactsSql('month', 'AND d."id" = $4'))).toContain('AND d."id" = $4')
    expect(bare(medalFactsSql('day', 'AND d."id" = $4'))).toContain('AND d."id" = $4')
  })
})
