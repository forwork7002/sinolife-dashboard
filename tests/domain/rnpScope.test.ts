import { describe, expect, it } from 'vitest'

import { companyWideSections, isCompanyWideSection } from '@/lib/sections'
import { buildRopReport } from '@/server/domain/registration/ropReport'
import { narrowRnpSheet } from '@/server/domain/rnp/rnpScope'
import type { RnpBlockDto, RnpOverviewDto, RnpRowDto } from '@/server/domain/rnp/rnpSheet'
import type { RnpLine } from '@/server/domain/rnp/rnpSheetView'

// The SQL-shape tests' preamble: the repositories read `env` at module scope.
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { RnpRepository } = await import('@/server/repositories/rnpRepository')

/*
  «RNP jadvali» and «ROP otchet» for a TEAM account holding RNP as «Oʻz
  boʻlimi» (2026-10-24, the user, for Malika: «faqat … oʻzini ichidagi
  xodimlari chiqsin»). The sheet's smallest cut is a team; the report's is a
  person.
*/

const row = (key: string): RnpRowDto => ({ key, label: key, days: [] }) as unknown as RnpRowDto
const block = (id: string, team: string | null, keys: string[]): RnpBlockDto =>
  ({ id, kind: 'team', title: id, subtitle: null, team, sheet: null, rows: keys.map(row) }) as unknown as RnpBlockDto
const value = (team: string | null, key: string | null): RnpLine =>
  ({ kind: 'value', row: null, team, label: key ?? '—', sub: null, tone: 'plain', fact: 'plain', bold: false, key }) as unknown as RnpLine

const sheet: RnpOverviewDto = {
  month: '2026-10',
  days: ['2026-10-01'],
  today: '2026-10-01',
  elapsedDays: 1,
  teams: [
    { rop: 'Charos', label: 'Малика РОП - БАЗА', head: 'Malika Rahmonova', isBase: true },
    { rop: 'Sevinch', label: 'Севинч РОП', head: 'Sevinch Usmonova', isBase: false },
  ],
  blocks: [
    block('marketing', null, ['mk:spend']),
    block('team:Charos', 'Charos', ['team:Charos:fakt1']),
    block('team:Sevinch', 'Sevinch', ['team:Sevinch:fakt1']),
    block('logistics:Charos', 'Charos', ['lg:Charos:fakt1']),
    block('logistics', null, ['lg:fakt1']),
  ],
  lines: [
    value(null, 'mk:spend'),
    value('Charos', 'team:Charos:fakt1'),
    value('Charos', null),
    value('Sevinch', 'team:Sevinch:fakt1'),
    value('Charos', 'lg:Charos:fakt1'),
    // A line of hers that reads a company row would carry the company's figure.
    value('Charos', 'lg:fakt1'),
    value(null, 'lg:fakt1'),
  ],
  settings: { usdRate: 12_000, usdRateDate: '2026-10-01' },
  canEditPlans: false,
}

describe('narrowRnpSheet', () => {
  const mine = narrowRnpSheet(sheet, new Set(['Charos']))

  it('keeps the team\'s block and logistics, and no company or other team\'s block', () => {
    expect(mine.blocks.map((b) => b.id)).toEqual(['team:Charos', 'logistics:Charos'])
    expect(mine.teams.map((t) => t.rop)).toEqual(['Charos'])
    expect(mine.narrowedTo).toEqual(['Charos'])
  })

  it('keeps only the team\'s lines that read its own blocks', () => {
    expect(mine.lines.map((l) => (l.kind === 'value' ? l.key : l.label))).toEqual(['team:Charos:fakt1', null, 'lg:Charos:fakt1'])
  })

  it('hands a scope with no team nothing at all', () => {
    const none = narrowRnpSheet(sheet, new Set())
    expect(none.blocks).toEqual([])
    expect(none.lines).toEqual([])
    expect(none.narrowedTo).toEqual([])
  })

  it('reads a scope\'s teams by its people\'s primary unit, the ROP teams only', () => {
    const sql = RnpRepository.teamsOfEmployeesSql()
    expect(sql).toContain('dep."id" = e."departmentId"')
    expect(sql).toContain('e."id" = ANY($1::text[])')
    expect(sql).toContain('t.rop IS NOT NULL')
  })
})

describe('buildRopReport — a TEAM scope (`keepsSeller`)', () => {
  const report = buildRopReport({
    day: '2026-10-23',
    roster: [
      { employeeId: 'mal', fullName: 'Malika Rahmonova', rop: 'Charos', isHead: true },
      { employeeId: 'rux', fullName: 'Ruxshona', rop: 'Charos', isHead: false },
      // Filed in her unit, heads another: on the roster, not in her scope.
      { employeeId: 'cha', fullName: '192 Charos', rop: 'Charos', isHead: false },
      { employeeId: 'sev', fullName: 'Sevinch Usmonova', rop: 'Sevinch', isHead: true },
    ],
    names: new Map(),
    leads: [
      { rop: 'Charos', employeeId: 'rux', leads: 4 },
      { rop: 'Charos', employeeId: 'cha', leads: 2 },
      { rop: 'Sevinch', employeeId: 'sev', leads: 5 },
      { rop: null, employeeId: null, leads: 3 },
      { rop: null, employeeId: 'rux', leads: 1 },
    ],
    fakt: [
      { employeeId: 'rux', rop: 'Charos', fakt1Orders: 1, fakt1Minor: 1_000_000n, fakt2Orders: 0, fakt2Minor: 0n },
      { employeeId: 'cha', rop: 'Charos', fakt1Orders: 1, fakt1Minor: 9_000_000n, fakt2Orders: 0, fakt2Minor: 0n },
    ],
    calls: [{ employeeId: 'rux', connected: 6, talkSec: 600 }],
    keepsSeller: (id) => id === 'mal' || id === 'rux',
  })

  it('draws only the scope\'s people, wherever they are a row', () => {
    expect(report.groups.map((g) => [g.rop, g.sellers.map((s) => s.employeeId)])).toEqual([
      ['Charos', ['mal', 'rux']],
      [null, ['rux']],
    ])
  })

  it('sums the groups and the foot over the kept people alone', () => {
    const charos = report.groups.find((g) => g.rop === 'Charos')!
    expect(charos.total.leads).toBe(4)
    expect(charos.total.fakt1.amountMinor).toBe('1000000')
    expect(charos.total.connectedCalls).toBe(6)
    expect(report.total.leads).toBe(5)
  })
})

describe('«RNP jadvali» narrows by TEAM, never by OWN', () => {
  it('is a choice on a TEAM account and company-wide on any other', () => {
    expect(isCompanyWideSection('rnp', 'TEAM')).toBe(false)
    expect(isCompanyWideSection('rnp', 'OWN')).toBe(true)
    expect(isCompanyWideSection('rnp')).toBe(true)
    expect(isCompanyWideSection('leads', 'TEAM')).toBe(true)
    expect(isCompanyWideSection('confirmation', 'OWN')).toBe(false)
    expect(companyWideSections(['rnp', 'leads'], 'TEAM').map((s) => s.id)).toEqual(['leads'])
    expect(companyWideSections(['rnp', 'leads'], 'OWN').map((s) => s.id).sort()).toEqual(['leads', 'rnp'])
  })

  it('refuses OWN on both endpoints and reads the scope on both', async () => {
    const fs = await import('node:fs')
    for (const file of ['src/app/api/v1/rnp/overview/route.ts', 'src/app/api/v1/registration/report/route.ts']) {
      const source = fs.readFileSync(file, 'utf8')
      expect(source).toContain("permission: 'analytics:read:own', section: 'rnp'")
      expect(source).toContain("restrict !== null && ctx.principal.dataScope !== 'TEAM'")
      expect(source).toContain('ctx.scope.restrictToEmployeeIds')
    }
    const sheet = fs.readFileSync('src/app/api/v1/rnp/overview/route.ts', 'utf8')
    expect(sheet).toContain('narrowRnpSheet(data, scopeTeams)')
    // A narrowed MANAGER is no editor: the plan / cost POSTs judge the stored scope and refuse it.
    expect(sheet).toContain("!ctx.principal.widened && ctx.principal.dataScope === 'ALL'")
  })
})
