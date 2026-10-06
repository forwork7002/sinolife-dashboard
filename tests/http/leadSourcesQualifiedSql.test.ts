import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { LeadSourcesRepository } = await import('@/server/repositories/leadSourcesRepository')
const { dealFormTitleSql } = await import('@/server/repositories/leadFormSql')

/*
  «Квал лидлар сони» on «Lidlar» — a Регистрация deal WON in the window, by
  the day it was won: the RNP sheet's kval and the portal's CLOSEDATE filter.
*/
describe('LeadSourcesRepository.qualifiedSources', () => {
  it('counts WON Регистрация deals by closedAt over the half-open window, by source', async () => {
    const seen: { sql: string; params: unknown[] }[] = []
    const client = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        seen.push({ sql, params })
        return [
          { source_id: 'REPEAT_SALE', form_title: 'Заполнение CRM-формы «Kamron 6 etap»', ai_qualified: false, qualified: 200n },
          { source_id: null, form_title: null, ai_qualified: true, qualified: 40n },
        ]
      },
    }
    const start = new Date('2026-09-29T19:00:00Z')
    const end = new Date('2026-09-30T19:00:00Z')
    const rows = await new LeadSourcesRepository(client as never).qualifiedSources({ start, end } as never)

    expect(rows).toEqual([
      { sourceId: 'REPEAT_SALE', formTitle: 'Заполнение CRM-формы «Kamron 6 etap»', aiQualified: false, qualified: 200 },
      { sourceId: null, formTitle: null, aiQualified: true, qualified: 40 },
    ])
    const { sql, params } = seen[0]!
    expect(sql).toMatch(/p\."role" = 'LEAD'/)
    expect(sql).toMatch(/d\."status" = 'WON'/)
    expect(sql).toMatch(/d\."closedAt" >= \$1 AND d\."closedAt" < \$2/)
    expect(sql).toMatch(/d\."aiQualifiedAt" IS NOT NULL/)
    // A LEFT join: the headline is the sum of these rows, so a kval with no source must not drop out.
    expect(sql).toMatch(/LEFT JOIN "sales_source" s ON s\."id" = d\."sourceId"/)
    expect(sql).toMatch(/s\."externalId" AS source_id/)
    // The form title, so the Collagen / Zextra switch reads a form kval's brand.
    // leadFormSql.ts: the title, else a repeat lead's SOURCE_DESCRIPTION.
    expect(sql).toContain(`${dealFormTitleSql('d', 's', 'fa')} AS form_title`)
    // Only the form aliases are read by creation; the kval itself is by closedAt.
    expect(sql.slice(sql.indexOf('FROM "deal" d'))).not.toMatch(/createdAtSource/)
    expect(params).toEqual([start, end])
  })
})

/*
  «Сммщик ии» — the portal's «ИИ квал сана» filter: every pipeline, every
  creation day, the AI's own date in the half-open window.
*/
describe('LeadSourcesRepository.aiQualifiedStages', () => {
  it('counts deals by aiQualifiedAt in any pipeline, flagged Регистрация or not, by the stage they sit in now', async () => {
    const seen: { sql: string; params: unknown[] }[] = []
    const client = {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        seen.push({ sql, params })
        return [
          { registration: true, source_id: 'UC_A8LE21', form_title: null, stage: 'Дубликат (лид)', status: 'OPEN', leads: 14n },
          { registration: false, source_id: null, form_title: null, stage: null, status: 'WON', leads: 3n },
        ]
      },
    }
    const start = new Date('2026-09-30T19:00:00Z')
    const end = new Date('2026-10-01T19:00:00Z')
    const rows = await new LeadSourcesRepository(client as never).aiQualifiedStages({ start, end } as never)

    expect(rows).toEqual([
      { registration: true, sourceId: 'UC_A8LE21', formTitle: null, stage: 'Дубликат (лид)', status: 'OPEN', leads: 14 },
      { registration: false, sourceId: null, formTitle: null, stage: '—', status: 'WON', leads: 3 },
    ])
    const { sql, params } = seen[0]!
    expect(sql).toMatch(/d\."aiQualifiedAt" >= \$1 AND d\."aiQualifiedAt" < \$2/)
    // Every pipeline is read (01.10: 72 of 89 in Регистрация); the rest are only flagged, never dropped.
    expect(sql).toMatch(/LEFT JOIN "pipeline" p/)
    expect(sql).toMatch(/p\."role" = 'LEAD'/)
    expect(sql).not.toMatch(/WHERE[\s\S]*role/)
    expect(sql).not.toMatch(/createdAtSource/)
    expect(params).toEqual([start, end])
  })
})
