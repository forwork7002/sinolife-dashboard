import { describe, expect, it } from 'vitest'

import { MERGED_TEAMS, isSalesTeamName, mergeStartsAt, mergedTeam } from '@/server/domain/employees/roles'

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

describe('merged teams (the owner, 2026-11-04)', () => {
  it('reads Shohjaxon as Azizbek from 2026-11-04 on, himself before, whatever the case or spaces', () => {
    expect(MERGED_TEAMS).toEqual({ Shohjaxon: { into: 'Azizbek', from: '2026-11-04' } })
    expect(mergedTeam('Shohjaxon')).toBe('Azizbek')
    expect(mergedTeam(' shohjaxon ', '2026-11-04')).toBe('Azizbek')
    expect(mergedTeam('Shohjaxon', '2026-11-03')).toBe('Shohjaxon')
    // The merge starts at the day's Tashkent midnight: 2026-11-03 19:00 UTC.
    expect(mergeStartsAt(MERGED_TEAMS.Shohjaxon!).toISOString()).toBe('2026-11-03T19:00:00.000Z')
    expect(mergedTeam('Shohjaxon', new Date('2026-11-03T18:59:59Z'))).toBe('Shohjaxon')
    expect(mergedTeam('Shohjaxon', new Date('2026-11-03T19:00:00Z'))).toBe('Azizbek')
    expect(mergedTeam('Azizbek', '2026-10-01')).toBe('Azizbek')
    expect(mergedTeam('Lola')).toBe('Lola')
  })

  it('names only letters and an ISO day, since they are spliced into SQL', () => {
    for (const [from, merge] of Object.entries(MERGED_TEAMS)) {
      expect(from).toMatch(/^\p{L}+$/u)
      expect(merge.into).toMatch(/^\p{L}+$/u)
      expect(merge.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
