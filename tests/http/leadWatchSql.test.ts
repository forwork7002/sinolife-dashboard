import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { LeadWatchRepository } = await import('@/server/repositories/leadWatchRepository')

/**
 * «Лид назорати» is rebuilt every minute on a database that was saturated
 * once (2026-10-05), so what its statements may NOT do is pinned here: none
 * of them reads the deal table at large. Read with the prose stripped, the
 * way the other SQL-shape tests do — the comments name the very things the
 * statements must not contain.
 */

const code = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

describe('todayLeads', () => {
  const sql = code(LeadWatchRepository.todayLeadsSql())

  it('reads one creation window of Регистрация, by role', () => {
    expect(sql).toMatch(/JOIN "pipeline" p ON p\."id" = d\."pipelineId" AND p\."role" = 'LEAD'\s+WHERE d\."createdAtSource" >= \$1 AND d\."createdAtSource" < \$2/)
    // The day's deals are read ONCE; every other reference is to that read.
    expect(sql.match(/FROM "deal" d\b/g)).toHaveLength(1)
  })

  it('bounds the calls by the day and folds them before the join', () => {
    /*
      Both folds, each bounded by the day — and each counting only a call
      that means the lead was WORKED: outgoing, or connected. The customer's
      own unanswered ring must not take a lead off «no call».
    */
    expect(
      sql.match(
        /FROM "call_record" c\s+WHERE c\."startedAt" >= \$1 AND c\."(customerId|dealId)" IS NOT NULL\s+AND \(c\."direction" = 'OUTBOUND' OR c\."durationSec" > 0\)\s+GROUP BY 1/g,
      ),
    ).toHaveLength(2)
    expect(sql).toMatch(/LEFT JOIN called_contact cc ON cc\.customer_id = r\."customerId"/)
    expect(sql).toMatch(/LEFT JOIN called_deal cd ON cd\.deal_id = r\.id/)
    // Never asked per lead: `call_record` has no index on `customerId`.
    expect(sql).not.toMatch(/EXISTS\s*\(\s*SELECT[^)]*"call_record"/)
  })

  it('reads «РОП (Первичка)» or «ROP KVAL LID» for the first check, and the stage as the portal names it', () => {
    expect(sql).toContain('COALESCE(d."leadRopEmployeeId", d."ropKvalLidEmployeeId") AS rop_id')
    expect(sql).toContain('(r.rop_id IS NOT NULL) AS rop_assigned')
    expect(sql).toContain('st."externalId" AS stage_id')
  })

  it('keeps every status: the open ones are rows, all of them are the intake', () => {
    expect(sql).not.toMatch(/"status"\s*=\s*'OPEN'/)
  })
})

describe('feedHours', () => {
  const sql = code(LeadWatchRepository.feedHoursSql())

  it('reads one bounded window, grouped before it leaves the database', () => {
    expect(sql).toMatch(/WHERE d\."createdAtSource" >= \$1 AND d\."createdAtSource" < \$2/)
    expect(sql).toMatch(/GROUP BY 1, 2, 3, 4, 5/)
  })

  it('buckets the naive UTC column in two steps, and never hands node a bare date', () => {
    expect(sql).toContain(`(r.created AT TIME ZONE 'UTC' AT TIME ZONE $3)::date::text AS day`)
    expect(sql).toContain(`extract(hour FROM (r.created AT TIME ZONE 'UTC' AT TIME ZONE $3))::int AS hour`)
    expect(sql).not.toMatch(/::date(?!::text)/)
  })

  it('leaves the late «Qayta zayavka» copies out of «usual»', () => {
    expect(sql).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM replayed x WHERE x\.id = r\.id\)/)
  })
})

describe('openChats and latestDeals', () => {
  it('joins a chat to its deal and its responsible by their portal ids', () => {
    const sql = code(LeadWatchRepository.openChatsSql())
    expect(sql).toMatch(/LEFT JOIN "deal" d ON d\."externalSource" = c\."externalSource" AND d\."externalId" = c\."dealExternalId"/)
    expect(sql).toMatch(/resp\."externalSource" = c\."externalSource" AND resp\."externalId" = c\."responsibleExternalId"/)
    // Any pipeline: a chat is waiting wherever its deal stands.
    expect(sql).not.toContain('"pipeline"')
    // The ROP as `todayLeads` reads it: «РОП (Первичка)», else «ROP KVAL LID».
    expect(sql).toContain('LEFT JOIN "employee" rp ON rp."id" = COALESCE(d."leadRopEmployeeId", d."ropKvalLidEmployeeId")')
  })

  it('reads a contact’s latest deal through the customer index, for the ids given', () => {
    const sql = code(LeadWatchRepository.latestDealsSql())
    expect(sql).toMatch(/SELECT DISTINCT ON \(d\."customerId"\)/)
    expect(sql).toMatch(/WHERE d\."customerId" = ANY\(\$1::text\[\]\)/)
    expect(sql).toMatch(/ORDER BY d\."customerId", d\."createdAtSource" DESC/)
  })
})
