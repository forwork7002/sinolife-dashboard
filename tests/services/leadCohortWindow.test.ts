import { describe, expect, it } from 'vitest'

/*
  The service module reaches the repository types only; the repository reads
  `env` at module scope — the preamble `cohortsSql.test.ts` explains.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { LEAD_COHORT_MAX_DAYS, LeadCohortService, leadCohortWindow, resetLeadCohortCaches } = await import(
  '@/server/services/leadCohortService'
)
const { LeadCohortRepository } = await import('@/server/repositories/leadCohortRepository')

describe('leadCohortWindow', () => {
  it('defaults to the last fourteen days, today included', () => {
    expect(leadCohortWindow({ today: '2026-09-24' })).toEqual({ from: '2026-09-11', to: '2026-09-24' })
  })

  it('never ends after today, and swaps an inverted pair', () => {
    expect(leadCohortWindow({ from: '2026-09-20', to: '2026-10-05', today: '2026-09-24' })).toEqual({
      from: '2026-09-20',
      to: '2026-09-24',
    })
    expect(leadCohortWindow({ from: '2026-09-22', to: '2026-09-18', today: '2026-09-24' })).toEqual({
      from: '2026-09-18',
      to: '2026-09-22',
    })
  })

  it(`keeps the end and trims the start past ${LEAD_COHORT_MAX_DAYS} days`, () => {
    const w = leadCohortWindow({ from: '2025-01-01', to: '2026-09-24', today: '2026-09-24' })
    expect(w.to).toBe('2026-09-24')
    expect(w.from).toBe('2026-06-25')
  })
})

describe('LeadCohortService', () => {
  it('reads the deals once per window and answers every filter from them', async () => {
    resetLeadCohortCaches()
    let reads = 0
    const repository = {
      deals: async () => {
        reads++
        return []
      },
      names: async () => new Map<string, string>(),
    } as unknown as InstanceType<typeof LeadCohortRepository>
    const service = new LeadCohortService(repository)
    const now = new Date('2026-09-24T07:00:00Z')
    const base = { timeZone: 'Asia/Tashkent', now, rop: null }

    await service.overview({ ...base, pipelines: [12, 4, 6] })
    await service.overview({ ...base, pipelines: [6] })
    await service.overview({ ...base, pipelines: [12], rop: 'x' })
    expect(reads).toBe(1)

    await service.overview({ ...base, pipelines: [12, 4, 6], from: '2026-09-20' })
    expect(reads).toBe(2)
  })

  it('reads the deal SQL with the three windows and the three pipelines', () => {
    const sql = LeadCohortRepository.dealsSql()
    expect(sql).toMatch(/"leadArrivedAt" >= \$1 AND d\."leadArrivedAt" < \$2/)
    expect(sql).toMatch(/"leadDistributedOn" BETWEEN \$3::date AND \$4::date/)
    expect(sql).toMatch(/"leadDistributedOn" = \$5::date/)
    expect(sql).toMatch(/"leadArrivedAt" IS NULL AND d\."createdAtSource" >= \$1/)
    expect(sql).toMatch(/p\."externalId" = ANY\(\$7::text\[\]\)/)
    // A DATE must travel as text: node-postgres builds a bare DATE at LOCAL midnight.
    expect(sql).toMatch(/"leadDistributedOn"::text/)
  })
})
