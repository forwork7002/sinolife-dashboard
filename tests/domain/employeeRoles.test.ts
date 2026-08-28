import { describe, expect, it } from 'vitest'

import {
  SALES_TEAM_NAME_LIKE,
  SALES_TEAM_SUFFIX,
  classifyEmployeeRole,
  isSalesTeamName,
  isSeller,
} from '@/server/domain/employees/roles'

/** The fifteen sales teams as the portal actually spells them. */
const SALES_TEAMS = [
  'Lola(ROP)',
  'Azizbek(ROP)',
  'Sevinch(ROP)',
  'Baza(ROP)',
  'Asliddin(ROP)',
  'Gulzora(ROP)',
  'Saidaziz(ROP)',
  'Maftuna(ROP)',
  'NEW(ROP)',
  'Saida(ROP)',
  'Hayot(ROP)',
  'Sevinchxon(ROP)',
  'Charos(ROP)',
  'Kompaniya(ROP)',
  'Marjona(ROP)',
]

/** The departments that are not sales teams. */
const OTHER_DEPARTMENTS = ['NEWGEN', 'Регистрация', 'Операцион', 'Навоий', 'Тошкент онлайн']

describe('sales-team detection', () => {
  it('recognises every department the portal tagged (ROP)', () => {
    for (const name of SALES_TEAMS) {
      expect(isSalesTeamName(name), name).toBe(true)
    }
  })

  it('rejects the departments that are not sales teams', () => {
    for (const name of OTHER_DEPARTMENTS) {
      expect(isSalesTeamName(name), name).toBe(false)
    }
  })

  it('tolerates the hand-typing: case and surrounding whitespace', () => {
    expect(isSalesTeamName('  Charos(ROP) ')).toBe(true)
    expect(isSalesTeamName('charos(rop)')).toBe(true)
    expect(isSalesTeamName('Charos (ROP)')).toBe(true)
  })

  it('does not match a department that merely mentions ROP', () => {
    // The rule is a SUFFIX, not a substring: a team named after the marker
    // rather than tagged with it is not one of the fifteen.
    expect(isSalesTeamName('(ROP) arxiv')).toBe(false)
    expect(isSalesTeamName('ROP')).toBe(false)
    expect(isSalesTeamName('Операцион (ROP nazorati)')).toBe(false)
  })

  it('treats a missing department as not-sales rather than throwing', () => {
    expect(isSalesTeamName(null)).toBe(false)
    expect(isSalesTeamName(undefined)).toBe(false)
    expect(isSalesTeamName('')).toBe(false)
  })
})

describe('role classification', () => {
  it('ranks a sales-team member who heads nothing as a SELLER', () => {
    expect(
      classifyEmployeeRole({ departmentName: 'Asliddin(ROP)', isDepartmentHead: false }),
    ).toBe('SELLER')
  })

  it('ranks the head of a sales team as a MANAGER, not its top seller', () => {
    // Shahtiyarovna 197 Marjona, ROP of Marjona(ROP), was #2 on the old board.
    expect(
      classifyEmployeeRole({ departmentName: 'Marjona(ROP)', isDepartmentHead: true }),
    ).toBe('MANAGER')
  })

  it('ranks the head of a non-sales department as a MANAGER', () => {
    // Fazliddinov 195 Bunyod, head of Операцион, was #1 on the old board.
    expect(classifyEmployeeRole({ departmentName: 'Операцион', isDepartmentHead: true })).toBe(
      'MANAGER',
    )
  })

  it('ranks non-sales staff as OTHER', () => {
    expect(classifyEmployeeRole({ departmentName: 'Регистрация', isDepartmentHead: false })).toBe(
      'OTHER',
    )
    expect(classifyEmployeeRole({ departmentName: null, isDepartmentHead: false })).toBe('OTHER')
  })

  it('lets heading a department win over belonging to a sales team', () => {
    // Order matters: a ROP belongs to the team they run, so the two conditions
    // are true at once and only one of them may decide.
    expect(isSeller({ departmentName: 'Lola(ROP)', isDepartmentHead: true })).toBe(false)
    expect(isSeller({ departmentName: 'Lola(ROP)', isDepartmentHead: false })).toBe(true)
  })
})

describe('the SQL mirror of the rule', () => {
  it('derives the LIKE pattern from the one suffix constant', () => {
    expect(SALES_TEAM_NAME_LIKE).toBe(`%${SALES_TEAM_SUFFIX.toLowerCase()}`)
  })

  it('keeps the suffix free of LIKE wildcards', () => {
    // `%` or `_` inside the suffix would make the pattern match things the
    // TypeScript classifier rejects, and the two evaluators would disagree.
    expect(SALES_TEAM_SUFFIX).not.toMatch(/[%_\\]/)
  })

  it('agrees with the TypeScript matcher on every real department name', () => {
    // The pattern is applied to lower(btrim(name)) in SQL; reproduce that here
    // so a change to either side breaks this test rather than the leaderboard.
    const sqlLike = (name: string) =>
      name.trim().toLowerCase().endsWith(SALES_TEAM_NAME_LIKE.slice(1))

    for (const name of [...SALES_TEAMS, ...OTHER_DEPARTMENTS]) {
      expect(sqlLike(name), name).toBe(isSalesTeamName(name))
    }
  })
})
