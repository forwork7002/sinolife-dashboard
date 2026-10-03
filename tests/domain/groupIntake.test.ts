import { describe, expect, it } from 'vitest'

import { buildGroupIntake, GROUP_TEAM, INTAKE_GROUPS } from '@/server/domain/registration/groupIntake'

const build = (over: Partial<Parameters<typeof buildGroupIntake>[0]> = {}) =>
  buildGroupIntake({ day: '2026-09-28', handedOut: [], intake: [], canEdit: false, ...over })

describe('buildGroupIntake', () => {
  it('lists the client groups in the client order', () => {
    expect(build().groups.map((g) => g.group)).toEqual([...INTAKE_GROUPS])
  })

  it('counts a group\'s kval as the leads handed to its ROP team, as /rnp does', () => {
    const dto = build({
      handedOut: [
        { rop: 'Azizbek', leads: 20 },
        { rop: 'Lola', leads: 15 },
        { rop: 'Lola', leads: 12 },
        // Not handed to a ROP team: not kval.
        { rop: null, leads: 9 },
        // A team none of the groups is named after: apart.
        { rop: 'Sadriddin', leads: 4 },
        { rop: 'Shohjaxon', leads: 2 },
      ],
    })
    const by = new Map(dto.groups.map((g) => [g.group, g]))
    expect(by.get('Aziz')).toMatchObject({ team: GROUP_TEAM.Aziz, qualified: 20 })
    expect(by.get('Lola')?.qualified).toBe(27)
    expect(dto.ungroupedQualified).toBe(6)
    expect(dto.total.qualified).toBe(47)
  })

  it('reads a group whose team got nothing as 0, a measurement', () => {
    expect(build().groups.find((g) => g.group === 'Gulzora')!.qualified).toBe(0)
  })

  it('folds an old team name before matching, as /rnp does', () => {
    // Sevinchxon → Sadriddin: not one of the card's groups, so apart.
    expect(build({ handedOut: [{ rop: 'Sevinchxon', leads: 3 }] }).ungroupedQualified).toBe(3)
  })

  it('reads the typed intake and divides kval by it', () => {
    const dto = build({
      handedOut: [
        { rop: 'Azizbek', leads: 27 },
        { rop: 'Lola', leads: 27 },
      ],
      intake: [
        { group: 'Aziz', leads: 144 },
        { group: 'Lola', leads: 88 },
        { group: 'Gulzora', leads: 50 },
      ],
    })
    const by = new Map(dto.groups.map((g) => [g.group, g]))
    expect(by.get('Aziz')?.conversionPercent).toBeCloseTo(18.75)
    expect(by.get('Gulzora')?.conversionPercent).toBe(0)
    expect(by.get('Sevinch')?.intake).toBeNull()
    expect(by.get('Sevinch')?.conversionPercent).toBeNull()
    expect(dto.total.intake).toBe(282)
    expect(dto.total.qualified).toBe(54)
    expect(dto.total.conversionPercent).toBeCloseTo((54 / 282) * 100)
  })

  it('has no conversion where nothing is typed or the intake is zero', () => {
    expect(build().total.conversionPercent).toBeNull()
    expect(build({ intake: [{ group: 'Aziz', leads: 0 }] }).groups[0]!.conversionPercent).toBeNull()
  })
})
