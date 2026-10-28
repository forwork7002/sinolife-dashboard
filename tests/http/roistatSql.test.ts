import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'
import type { Period } from '@/server/domain/period/period'

/*
  The repository reads `env` at module scope for APP_TIMEZONE; a unit test
  supplies the required names first and imports afterwards — the preamble
  `cohortsSql.test.ts` explains.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { RoistatRepository } = await import('@/server/repositories/roistatRepository')

/**
 * WHAT THE «ROISTAT» STATEMENTS PROMISE. Run against a client that records
 * what it is handed — the first live run of the previous window's totals
 * failed in Postgres («arguments to GROUPING must be grouping expressions»)
 * while the source read fine.
 */

interface Call {
  readonly sql: string
  readonly params: readonly unknown[]
}

function recorder(answer: unknown[] = []) {
  const calls: Call[] = []
  const prisma = {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params })
      return answer
    },
  } as unknown as PrismaClient
  return { calls, repository: new RoistatRepository(prisma) }
}

const PERIOD: Period = {
  start: new Date('2026-08-31T19:00:00Z'),
  end: new Date('2026-09-18T19:00:00Z'),
  timeZone: 'Asia/Tashkent',
  preset: 'custom',
}

/** Every `$n` a statement names, SQL comments stripped. */
function placeholders(sql: string): Set<number> {
  const bare = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
  return new Set([...bare.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))
}

/** Every bound parameter is named, and nothing unbound is. */
function expectBound(call: Call) {
  expect(placeholders(call.sql)).toEqual(new Set(call.params.map((_, i) => i + 1)))
}

describe('RoistatRepository.bitrix', () => {
  it('binds exactly what it names, in both shapes', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(PERIOD, new Date('2026-10-05T00:00:00Z'))
    await repository.bitrix(PERIOD, new Date('2026-10-05T00:00:00Z'), 'total')
    for (const call of calls) expectBound(call)
  })

  it('names no GROUPING() in the totals-only read, whose GROUP BY groups nothing', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(PERIOD, new Date('2026-10-05T00:00:00Z'), 'total')
    const bare = calls[0]!.sql.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(bare).not.toMatch(/GROUPING\(/)
    expect(bare).toMatch(/GROUPING SETS \(\(\)\)/)
  })

  it('reads only the () and (day) sets for «Kunlar boʻyicha»', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(PERIOD, new Date('2026-10-05T00:00:00Z'), 'days')
    expectBound(calls[0]!)
    const bare = calls[0]!.sql.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(bare).toMatch(/GROUPING SETS \(\(\), \(day\)\)/)
    expect(bare.match(/GROUPING\(/g)).toHaveLength(1)
    expect(bare).toContain('GROUPING(day)::int AS g_day')
    expect(bare).toContain('NULL::text AS rop')
  })

  it('stops reading sales a month after the window, and never past now', async () => {
    const { calls, repository } = recorder()
    const now = new Date('2026-09-25T00:00:00Z')
    await repository.bitrix(PERIOD, now)
    expect(calls[0]!.params[3]).toEqual(now)
    await repository.bitrix(PERIOD, new Date('2027-01-01T00:00:00Z'))
    expect(calls[1]!.params[3]).toEqual(new Date(PERIOD.end.getTime() + 30 * 86_400_000))
  })

  it('probes only the orders its window keeps (2026-10-27)', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(PERIOD, new Date('2026-10-05T00:00:00Z'), 'days')
    const sql = calls[0]!.sql
    // A Квалификация deal adds 0 to every counter: it is not read.
    expect(sql).toContain(`p."role" IN ('CONFIRMATION', 'REVENUE')`)
    expect(sql).not.toContain(`'QUALIFICATION'`)
    // The origin probe and the window filter come first; the product, team and first-order probes read what is kept.
    const origin = sql.indexOf('sale_origin AS MATERIALIZED')
    const rows = sql.indexOf('sale_rows AS (')
    expect(sql.indexOf('l."createdAtSource" AS created')).toBeGreaterThan(origin)
    expect(sql.indexOf('l."createdAtSource" AS created')).toBeLessThan(rows)
    expect(sql.slice(origin, rows)).toContain('WHERE COALESCE(o.created, sb."createdAtSource") >= $1')
    expect(sql.slice(rows)).toContain('FROM sale_origin sb')
    expect(sql.slice(rows)).not.toContain('WHERE COALESCE(o.created')
  })

  it('never reads База, and counts only «Дубликат (лид)» as a duplicate', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(PERIOD, new Date('2026-10-05T00:00:00Z'))
    const sql = calls[0]!.sql
    expect(sql).not.toMatch(/RETENTION/)
    expect(sql).toContain("~ '[Дд]убл[^(]*\\([[:space:]]*[Лл]ид'")
  })
})

describe('RoistatRepository.bitrix — the form of a repeat lead (2026-10-06)', () => {
  const NOW = new Date('2026-10-05T00:00:00Z')

  it('recovers the form from SOURCE_DESCRIPTION on the full scan, reading aliases a month back', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(PERIOD, NOW)
    const sql = calls[0]!.sql
    expect(sql).toContain('form_alias AS MATERIALIZED')
    expect(sql).toContain(`"metadata"->'utm'->>'SOURCE_DESCRIPTION'`)
    expect(sql).toContain(`'CRM-формы «AI targetolog · ' || btrim(substring(`)
    // A short name borrows a form only on a «Ген лид» deal, and only when it names one form.
    expect(sql).toContain(`= 'REPEAT_SALE' THEN fa.title`)
    expect(sql).toContain(`= 'REPEAT_SALE' THEN ofa.title`)
    expect(sql).toContain('WHERE fan.place = 1 AND (fan.deals = fan.named OR (fan.one_brand AND fan.deals * 20 >= fan.named * 19))')
    expect(calls[0]!.params[6]).toEqual(new Date(PERIOD.start.getTime() - 30 * 86_400_000))
  })

  it('looks the alias up once per sale, outside the origin-lead probe', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(PERIOD, NOW)
    const sql = calls[0]!.sql
    const lateral = sql.slice(sql.indexOf('LEFT JOIN LATERAL (\n          SELECT\n            l."createdAtSource"'), sql.indexOf(') o ON true'))
    expect(lateral).not.toContain('form_alias')
    expect(sql).toContain('LEFT JOIN form_alias ofa ON ofa.sd = o.sd')
  })

  it('skips the recovery where no form is grouped, unless the brand switch reads it', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(PERIOD, NOW, 'days')
    await repository.bitrix(PERIOD, NOW, 'total')
    await repository.bitrix(PERIOD, NOW, 'days', true)
    expect(calls[0]!.sql).not.toContain('form_alias')
    expect(calls[1]!.sql).not.toContain('form_alias')
    expect(calls[0]!.params).toHaveLength(6)
    expect(calls[2]!.sql).toContain('form_alias')
    for (const call of calls) expectBound(call)
  })
})

describe('RoistatRepository.bitrix — a window is the sum of its months (2026-10-28)', () => {
  const YEAR: Period = { start: new Date('2025-12-31T19:00:00Z'), end: new Date('2026-10-28T19:00:00Z'), timeZone: 'Asia/Tashkent', preset: 'this_year' }
  const NOW = new Date('2026-10-28T05:00:00Z')

  it('runs the statement it always ran for a window inside one month', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(PERIOD, NOW, 'all', true)
    expect(calls[0]!.sql).not.toContain('bucket')
    expect(calls[0]!.sql).toContain('LEFT JOIN form_alias ofa ON ofa.sd = o.sd')
  })

  it('learns the short names per month across months — each month from its own reach, the lead and the sale by their day', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(YEAR, NOW, 'all', false)
    const sql = calls[0]!.sql
    expectBound(calls[0]!)
    // Ten months, each [its start − 30 days, the earlier of the scan end and its end + 30 days).
    expect(sql.match(/\('2026-\d\d', '/g)).toHaveLength(10)
    expect(sql).toContain(`('2026-01', '2025-12-01T19:00:00.000Z'::timestamp, LEAST($4, '2026-03-02T19:00:00.000Z'::timestamp))`)
    expect(sql).toContain(`fa.bucket = to_char(d."createdAtSource" AT TIME ZONE 'UTC' AT TIME ZONE $3, 'YYYY-MM')`)
    expect(sql).toContain(`ofa.bucket = to_char(COALESCE(o.created, sb."createdAtSource") AT TIME ZONE 'UTC' AT TIME ZONE $3, 'YYYY-MM')`)
    expect(sql).toContain('PARTITION BY fg.bucket, fg.sd')
  })

  it('writes the month bounds as TIMESTAMP, the column\'s type — TIMESTAMPTZ retyped the scan end and moved it by the session zone', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(YEAR, NOW, 'days', true)
    expect(calls[0]!.sql).not.toContain('timestamptz')
  })

  it('reads no alias at all where no form is read, however long the window', async () => {
    const { calls, repository } = recorder()
    await repository.bitrix(YEAR, NOW, 'days', false)
    expect(calls[0]!.sql).not.toContain('form_alias')
  })
})

describe('RoistatRepository.meta', () => {
  it('binds the parent only where a grain has one', async () => {
    const { calls, repository } = recorder()
    await repository.meta('camp', '2026-09-01', '2026-09-18', '123')
    await repository.meta('adset', '2026-09-01', '2026-09-18', '123')
    await repository.meta('ad', '2026-09-01', '2026-09-18', null)
    for (const call of calls) expectBound(call)
    expect(calls[0]!.params[2]).toBeNull()
    expect(calls[1]!.params[2]).toBe('123')
    expect(calls[1]!.sql).toContain('"campaignId" = $3::text')
    expect(calls[2]!.sql).toContain('GROUP BY "accountId", "campaignId", "adsetId", "adId"')
  })
})
