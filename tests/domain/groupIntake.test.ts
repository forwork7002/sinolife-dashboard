import { describe, expect, it } from 'vitest'

import { buildGroupIntake, INTAKE_GROUPS } from '@/server/domain/registration/groupIntake'

const registrarGroups = [
  { registrar: 'Маржона', group: 'Aziz' },
  { registrar: 'Дилафруз', group: 'Lola' },
  { registrar: 'Мафтуна', group: 'Lola' },
  { registrar: 'Ситора', group: 'Zextra' },
]

const build = (over: Partial<Parameters<typeof buildGroupIntake>[0]> = {}) =>
  buildGroupIntake({ day: '2026-09-28', handedOut: [], registrarGroups, intake: [], canEdit: false, ...over })

describe('buildGroupIntake', () => {
  it('lists the client groups in the client order', () => {
    expect(build().groups.map((g) => g.group)).toEqual([...INTAKE_GROUPS])
  })

  it('counts kval of handed-out leads by the registrar group, as /rnp does', () => {
    const dto = build({
      handedOut: [
        { rop: 'Azizbek', registrar: 'Маржона', leads: 20 },
        { rop: 'Lola', registrar: 'Дилафруз', leads: 15 },
        { rop: 'Sevinch', registrar: 'Мафтуна', leads: 12 },
        // Not handed to a ROP team: not kval.
        { rop: null, registrar: 'Маржона', leads: 9 },
        // A group the card does not draw, and a blank registrar: apart.
        { rop: 'Sadriddin', registrar: 'Ситора', leads: 4 },
        { rop: 'Sadriddin', registrar: null, leads: 2 },
      ],
    })
    const by = new Map(dto.groups.map((g) => [g.group, g]))
    expect(by.get('Aziz')?.qualified).toBe(20)
    expect(by.get('Lola')?.qualified).toBe(27)
    expect(by.get('Lola')?.registrars).toEqual(['Дилафруз', 'Мафтуна'])
    expect(dto.ungroupedQualified).toBe(6)
    expect(dto.total.qualified).toBe(47)
  })

  it('leaves a group with no registrar unknown, not zero', () => {
    const gulzora = build().groups.find((g) => g.group === 'Gulzora')!
    expect(gulzora.registrars).toEqual([])
    expect(gulzora.qualified).toBeNull()
    expect(build().groups.find((g) => g.group === 'Aziz')!.qualified).toBe(0)
  })

  it('reads the typed intake and divides kval by it', () => {
    const dto = build({
      handedOut: [
        { rop: 'Azizbek', registrar: 'Маржона', leads: 27 },
        { rop: 'Lola', registrar: 'Дилафруз', leads: 27 },
      ],
      intake: [
        { group: 'Aziz', leads: 144 },
        { group: 'Lola', leads: 88 },
        // Typed, but the group's kval is unknown: out of the total conversion.
        { group: 'Gulzora', leads: 50 },
      ],
    })
    const by = new Map(dto.groups.map((g) => [g.group, g]))
    expect(by.get('Aziz')?.conversionPercent).toBeCloseTo(18.75)
    expect(by.get('Gulzora')?.conversionPercent).toBeNull()
    expect(by.get('Sevinch')?.intake).toBeNull()
    expect(dto.total.intake).toBe(282)
    expect(dto.total.qualified).toBe(54)
    expect(dto.total.conversionPercent).toBeCloseTo((54 / 232) * 100)
  })

  it('has no conversion where nothing is typed or the intake is zero', () => {
    expect(build().total.conversionPercent).toBeNull()
    expect(build({ intake: [{ group: 'Aziz', leads: 0 }] }).groups[0]!.conversionPercent).toBeNull()
  })
})
