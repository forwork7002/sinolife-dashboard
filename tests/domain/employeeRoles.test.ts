import { describe, expect, it } from 'vitest'

import { isSalesTeamName } from '@/server/domain/employees/roles'

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
