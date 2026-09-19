import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'
import type { Period } from '@/server/domain/period/period'
import { TARGET_SOURCE_IDS } from '@/server/integrations/crm/bitrix24/mapping'

/*
  The repository reads `env` at module scope for APP_TIMEZONE, and `env`
  refuses to load without a complete configuration. A unit test has no
  database and no secrets, so it supplies the four required names first and
  imports afterwards — the preamble `cohortsSql.test.ts` explains.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { NOT_STATED, TargetRepository } = await import('@/server/repositories/targetRepository')

/**
 * WHAT THE «TARGET TAHLILI» STATEMENTS PROMISE.
 *
 * These RUN the repository against a client that records what it is handed,
 * rather than only reading the source text as the other SQL tests here do.
 * The first live run of the lead list failed with `could not determine data
 * type of parameter $3` — the timezone was bound and never used, and Postgres
 * refuses an untyped parameter — while every text assertion passed. The
 * parameter check below is the guard for that exact failure.
 */

interface Call {
  readonly sql: string
  readonly params: readonly unknown[]
}

function recorder(answers: (sql: string) => unknown[]) {
  const calls: Call[] = []
  const prisma = {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      calls.push({ sql, params })
      return answers(sql)
    },
    salesSource: { findMany: async () => [] },
  } as unknown as PrismaClient
  return { calls, repository: new TargetRepository(prisma) }
}

const PERIOD: Period = {
  start: new Date('2026-08-31T19:00:00Z'),
  end: new Date('2026-09-19T19:00:00Z'),
  timeZone: 'Asia/Tashkent',
  preset: 'this_month',
}

/** Every `$n` a statement names, SQL comments stripped. */
function placeholders(sql: string): Set<number> {
  const bare = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
  return new Set([...bare.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))
}

function expectEveryParameterUsed(call: Call) {
  const used = placeholders(call.sql)
  const bound = call.params.map((_, i) => i + 1)
  // Named but not bound: a runtime error. Bound but not named: 42P18.
  expect([...used].sort((a, b) => a - b)).toEqual(bound)
}

const ZERO = {
  leads: 0n,
  lead_customers: 0n,
  lead_won: 0n,
  lead_lost: 0n,
  sales: 0n,
  orders: 0n,
  ordered_minor: '0',
  delivered: 0n,
  delivered_minor: '0',
  returned: 0n,
  returned_minor: '0',
  in_transit: 0n,
  confirming: 0n,
  seller_lost: 0n,
  stage_amount: '0',
}

const flags = (set: 'source' | 'targetolog' | 'creative' | 'day' | 'stage' | 'total') => ({
  g_source: set === 'source' ? 0 : 1,
  g_targetolog: set === 'targetolog' ? 0 : 1,
  g_creative: set === 'creative' ? 0 : 1,
  g_day: set === 'day' ? 0 : 1,
  g_stage: set === 'stage' ? 0 : 1,
})

describe('the target summary statement', () => {
  it('binds exactly the parameters it names', async () => {
    const { calls, repository } = recorder(() => [{ ...flags('total'), ...ZERO }])
    await repository.summary({ period: PERIOD, sourceIds: TARGET_SOURCE_IDS })
    expect(calls).toHaveLength(1)
    expectEveryParameterUsed(calls[0]!)
    expect(calls[0]!.params[3]).toEqual([...TARGET_SOURCE_IDS])
    expect(calls[0]!.params[4]).toBe(NOT_STATED)
  })

  it('passes null for «every source», never an empty list', async () => {
    const { calls, repository } = recorder(() => [{ ...flags('total'), ...ZERO }])
    await repository.summary({ period: PERIOD, sourceIds: null })
    expect(calls[0]!.params[3]).toBeNull()
  })

  it('reads the four lead-to-delivery pipelines and never База', async () => {
    const { calls, repository } = recorder(() => [{ ...flags('total'), ...ZERO }])
    await repository.summary({ period: PERIOD, sourceIds: null })
    const sql = calls[0]!.sql
    expect(sql).toContain(`p."role" IN ('LEAD', 'QUALIFICATION', 'CONFIRMATION', 'REVENUE')`)
    // База re-records Доставка's orders; counting it doubles the money.
    expect(sql).not.toMatch(/RETENTION/)
    expect(sql).toMatch(
      /GROUPING SETS\s*\(\s*\(source\), \(targetolog\), \(creative\), \(day\), \(kind, pipeline, stage\), \(\)\s*\)/,
    )
  })

  it('files each row under exactly one grouping set', async () => {
    const { repository } = recorder(() => [
      { ...flags('total'), ...ZERO, leads: 10n, sales: 4n, orders: 3n, ordered_minor: '300' },
      { ...flags('source'), ...ZERO, source: 'sinolifeuz', leads: 7n },
      { ...flags('source'), ...ZERO, source: 'zextrauzb', leads: 3n },
      { ...flags('targetolog'), ...ZERO, targetolog: NOT_STATED, leads: 9n },
      { ...flags('targetolog'), ...ZERO, targetolog: 'Umar', leads: 1n },
      { ...flags('day'), ...ZERO, day: '2026-09-02', leads: 4n },
      { ...flags('day'), ...ZERO, day: '2026-09-01', leads: 6n },
      {
        ...flags('stage'),
        ...ZERO,
        kind: 'lead',
        pipeline: 'Регистрация',
        stage: 'Дубликат',
        category: 'LOST',
        stage_order: 4,
        pipeline_order: 1,
        leads: 2n,
      },
      {
        ...flags('stage'),
        ...ZERO,
        kind: 'lead',
        pipeline: 'Регистрация',
        stage: 'Обработка',
        category: 'IN_PROGRESS',
        stage_order: 0,
        pipeline_order: 1,
        leads: 8n,
      },
    ])

    const out = await repository.summary({ period: PERIOD, sourceIds: null })

    expect(out.total.leads).toBe(10)
    expect(out.total.orderedMinor).toBe(300n)
    expect(out.sources.map((r) => r.key)).toEqual(['sinolifeuz', 'zextrauzb'])
    expect(out.targetologs.map((r) => r.key)).toEqual([NOT_STATED, 'Umar'])
    // Days oldest first, whatever order the database answered in.
    expect(out.days.map((r) => r.key)).toEqual(['2026-09-01', '2026-09-02'])
    // Stages in the portal's own order, not by size.
    expect(out.stages.map((s) => s.stage)).toEqual(['Обработка', 'Дубликат'])
    expect(out.stages[0]!.deals).toBe(8)
  })

  it('refuses an answer with no grand total rather than printing zeros', async () => {
    const { repository } = recorder(() => [])
    await expect(repository.summary({ period: PERIOD, sourceIds: null })).rejects.toThrow(
      /grand-total/,
    )
  })
})

describe('the lead list statements', () => {
  it('bind exactly the parameters they name — the page and the count alike', async () => {
    const { calls, repository } = recorder((sql) =>
      sql.includes('count(*)::bigint AS total') ? [{ total: 0n }] : [],
    )
    await repository.leads({
      period: PERIOD,
      sourceIds: TARGET_SOURCE_IDS,
      source: 'sinolifeuz',
      targetolog: NOT_STATED,
      stage: 'Дубликат',
      search: '90',
      limit: 50,
      offset: 100,
    })
    expect(calls).toHaveLength(2)
    for (const call of calls) expectEveryParameterUsed(call)
  })

  it('finds the sale per row, after the page, by the same contact on or after the lead', async () => {
    const { calls, repository } = recorder((sql) =>
      sql.includes('count(*)::bigint AS total') ? [{ total: 0n }] : [],
    )
    await repository.leads({ period: PERIOD, sourceIds: null, limit: 25, offset: 50 })
    const page = calls.find((c) => c.sql.includes('LEFT JOIN LATERAL'))!.sql
    expect(page).toMatch(/LIMIT 25 OFFSET 50\s*\)/)
    expect(page).toContain('x."customerId" = page.customer_id')
    expect(page).toContain('x."createdAtSource" >= page.created_at')
    expect(page).toContain(`xp."role" IN ('QUALIFICATION', 'CONFIRMATION', 'REVENUE')`)
    expect(page).not.toMatch(/RETENTION/)
  })

  it('treats a typed % or _ as text, not as a wildcard', async () => {
    const { calls, repository } = recorder((sql) =>
      sql.includes('count(*)::bigint AS total') ? [{ total: 0n }] : [],
    )
    await repository.leads({ period: PERIOD, sourceIds: null, search: '50%_x', limit: 10, offset: 0 })
    expect(calls[0]!.params).toContain('%50\\%\\_x%')
  })

  it('shapes a row with and without a sale', async () => {
    const lead = {
      bitrix_id: '905147',
      created_at: new Date('2026-09-19T04:51:00Z'),
      title: 'Lola',
      customer_name: 'Lola Saidova',
      phone: '+998903007823',
      source: 'sinolife_otziv',
      targetolog: 'Элдор',
      creative: null,
      primary_source: null,
      stage: 'Сделка успешна',
      category: 'WON',
      registrar: 'Rayhona B.',
    }
    const { repository } = recorder((sql) =>
      sql.includes('count(*)::bigint AS total')
        ? [{ total: 2n }]
        : [
            {
              ...lead,
              sale_bitrix_id: '1405147',
              sale_created_at: new Date('2026-09-19T06:00:00Z'),
              sale_pipeline: 'Доставка',
              sale_role: 'REVENUE',
              sale_stage: 'Доставлено',
              sale_status: 'WON',
              sale_amount: '69000000',
              sale_seller: 'Aziz M.',
            },
            { ...lead, bitrix_id: '905148', sale_pipeline: null },
          ],
    )
    const { rows, total } = await repository.leads({
      period: PERIOD,
      sourceIds: null,
      limit: 50,
      offset: 0,
    })
    expect(total).toBe(2)
    expect(rows[0]!.sale).toMatchObject({ role: 'REVENUE', status: 'WON', amountMinor: 69000000n })
    expect(rows[1]!.sale).toBeNull()
  })
})
