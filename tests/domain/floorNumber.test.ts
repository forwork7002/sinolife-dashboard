import { describe, expect, it } from 'vitest'

import { floorNumberOf, indexByFloorNumber } from '@/server/domain/employees/floorNumber'

/**
 * The badge is the only stable join between three spellings of one person.
 *
 * Bitrix keeps it on LAST_NAME, so `user.get` reads «Davlatbek Sirojov 115».
 * This application composes `fullName` the other way round and stores
 * «Sirojov 115 Davlatbek». The portal's operator snapshot spells it the Bitrix
 * way again. Resolving the snapshot to one of our people — which is what puts
 * the right seller at the top of the board — depends entirely on this.
 */

describe('reading the badge', () => {
  it('finds it wherever the spelling puts it', () => {
    // All real production strings, 2026-09-04.
    expect(floorNumberOf('Davlatbek Sirojov 115')).toBe(115)   // portal spelling
    expect(floorNumberOf('Sirojov 115 Davlatbek')).toBe(115)   // ours
    expect(floorNumberOf('118 Aziza Vafoqulova')).toBe(118)    // 90 of 289 look like this
    expect(floorNumberOf('130-Salomat Shoimova')).toBe(130)    // hyphen, not a space
    expect(floorNumberOf('Sardorbek Abdimurodov 198 ')).toBe(198)
  })

  it('is null with no badge at all', () => {
    expect(floorNumberOf('Abdullayeva Sevinchxon')).toBeNull()
    expect(floorNumberOf('Админ')).toBeNull()
    expect(floorNumberOf('')).toBeNull()
  })

  it('refuses to guess between two numbers', () => {
    expect(floorNumberOf('Karimova 173 Feruza 118')).toBeNull()
  })

  it('ignores digits that are not a standalone 2-4 digit token', () => {
    expect(floorNumberOf('Aziza7 Karimova')).toBeNull()
    expect(floorNumberOf('Aziza 7 Karimova')).toBeNull()
    expect(floorNumberOf('Aziza 12345 Karimova')).toBeNull()
  })
})

describe('indexing the roster by badge', () => {
  const roster = [
    { id: 'e1', fullName: 'Sirojov 115 Davlatbek' },
    { id: 'e2', fullName: '118 Aziza Vafoqulova' },
    { id: 'e3', fullName: 'Abdullayeva Sevinchxon' },
  ]

  it('resolves a portal-spelled name to our person', () => {
    const index = indexByFloorNumber(roster, (p) => p)
    // This IS the fix: the snapshot says «Davlatbek Sirojov 115» and the board
    // has to land on e1, whose own name reads the other way round.
    expect(index.get(floorNumberOf('Davlatbek Sirojov 115')!)).toBe('e1')
    expect(index.get(118)).toBe('e2')
  })

  it('leaves a badgeless employee out rather than inventing a key', () => {
    const index = indexByFloorNumber(roster, (p) => p)
    expect([...index.values()]).not.toContain('e3')
  })

  it('drops a collision instead of picking a winner', () => {
    /*
      Two people on one badge is not a match, it is a collision, and resolving
      it either way silently moves somebody's sales onto somebody else's row.
      Measured on production: of 127 badges, 123 are unique, 1 collides.
    */
    const index = indexByFloorNumber(
      [...roster, { id: 'e4', fullName: 'Boshqa 115 Odam' }],
      (p) => p,
    )
    expect(index.has(115)).toBe(false)
    expect(index.get(118)).toBe('e2')
  })
})
