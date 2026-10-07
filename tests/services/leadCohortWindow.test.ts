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

  it('never ends after today when the START is in the future (2026-10-06 audit)', () => {
    // A day typed past the picker's max: swapped in as the end, it drew empty future rows.
    expect(leadCohortWindow({ from: '2026-10-20', today: '2026-10-06' })).toEqual({ from: '2026-10-06', to: '2026-10-06' })
    expect(leadCohortWindow({ from: '2026-10-20', to: '2026-10-03', today: '2026-10-06' })).toEqual({
      from: '2026-10-03',
      to: '2026-10-06',
    })
  })

  it(`keeps the end and trims the start past ${LEAD_COHORT_MAX_DAYS} days`, () => {
    const w = leadCohortWindow({ from: '2025-01-01', to: '2026-09-24', today: '2026-09-24' })
    expect(w.to).toBe('2026-09-24')
    expect(w.from).toBe('2026-06-25')
  })

  it('never reaches before 2025 — PostgreSQL has no year 0 (2026-10-06 review)', () => {
    // «0001-01-05» defaulted its start to «0000-12-23», which `$3::date` refused: a 500.
    expect(leadCohortWindow({ to: '0001-01-05', today: '2026-10-06' })).toEqual({ from: '2025-01-01', to: '2025-01-01' })
    expect(leadCohortWindow({ from: '0002-01-01', to: '0002-03-01', today: '2026-10-06' })).toEqual({
      from: '2025-01-01',
      to: '2025-01-01',
    })
    // A start shifted back from the end is held as well.
    expect(leadCohortWindow({ to: '2025-01-05', today: '2026-10-06' })).toEqual({ from: '2025-01-01', to: '2025-01-05' })
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
      teams: async () => new Map<string, string>(),
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

  it('keeps one brand\'s leads by the team their ROP stands for, from the same read', async () => {
    resetLeadCohortCaches()
    let reads = 0
    const deal = (dealId: string, ropEmployeeId: string | null) => ({
      dealId,
      customerId: dealId,
      pipeline: 12,
      arrivedAt: new Date('2026-09-22T06:00:00Z'),
      distributedOn: ropEmployeeId === null ? null : '2026-09-22',
      aiQualifiedAt: null,
      ropEmployeeId,
      repeat: null,
      createdDay: '2026-09-22',
    })
    const repository = {
      deals: async () => {
        reads++
        return [deal('1', 'asliddin'), deal('2', 'malika'), deal('3', 'sevinch'), deal('4', 'hayot'), deal('5', null)]
      },
      names: async () => new Map<string, string>(),
      // Malika's department folds into Charos, a Zextra team; Hayot is on neither list.
      teams: async () => new Map([['asliddin', 'Asliddin'], ['malika', 'Malika'], ['sevinch', 'Sevinch'], ['hayot', 'Hayot']]),
    } as unknown as InstanceType<typeof LeadCohortRepository>
    const service = new LeadCohortService(repository)
    const base = { timeZone: 'Asia/Tashkent', now: new Date('2026-09-24T07:00:00Z'), rop: null, pipelines: [12, 4, 6] }

    const all = await service.overview(base)
    const zextra = await service.overview({ ...base, brand: 'Zextra' })
    const collagen = await service.overview({ ...base, brand: 'Collagen' })
    expect(reads).toBe(1)
    expect(all.kpi.arrived).toBe(5)
    expect(zextra.kpi.arrived).toBe(2)
    expect(zextra.rops.map((r) => r.employeeId).sort()).toEqual(['asliddin', 'malika'])
    expect(collagen.kpi.arrived).toBe(1)
  })

  it('names each ROP\'s team by the department they head, else their own', () => {
    const sql = LeadCohortRepository.teamsSql()
    expect(sql).toMatch(/h\."headId" = e\."id"/)
    expect(sql).toMatch(/e\."id" = ANY\(\$1::text\[\]\)/)
    expect(sql).toMatch(/DISTINCT ON \(e\."id"\)/)
    // Of two ROP units they head, the one they sit in — «THE ROP OF A LEAD», as the split cards and RNP read it.
    expect(sql).toMatch(/IS NULL, \(h\."id" = e\."departmentId"\) DESC, h\."name"\s*$/)
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
