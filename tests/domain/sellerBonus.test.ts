import { describe, expect, it } from 'vitest'

import {
  BONUS_BAND,
  BONUS_TIERS,
  bonusEligible,
  floorNumberOf,
} from '@/server/domain/analytics/sellerBonus'

/**
 * The client's own bonus rule, pinned.
 *
 * Both halves of it are quoted from their published dashboard rather than
 * derived here — the tier ladder from `bonusInfo()` and the band from
 * `idInRange()` — so what this file guards is that the transcription stays
 * faithful. The band in particular decides who is PAID: before it was
 * carried, this board offered a 2 mln soʻm rung to July's top three sellers,
 * none of whom the client's page pays anything.
 */

describe('the floor number trailing an operator name', () => {
  it('reads the number Bitrix24 puts at the end of the name', () => {
    // Real rows from `user.get` on this portal.
    expect(floorNumberOf('Davlatbek Sirojov 115')).toBe(115)
    expect(floorNumberOf('Bonu Umidovna 117')).toBe(117)
    expect(floorNumberOf('Nazarova Shirin 107')).toBe(107)
  })

  it('tolerates the trailing space the portal actually stores', () => {
    expect(floorNumberOf('Sardorbek Abdimurodov 198 ')).toBe(198)
  })

  it('is null when the name carries no number', () => {
    expect(floorNumberOf('Абдурахимов Жавохирбек')).toBeNull()
    expect(floorNumberOf('Админ')).toBeNull()
  })

  it('ignores a number that is not at the end', () => {
    // Their regex anchors at the end; a number mid-name is not a floor badge.
    expect(floorNumberOf('107 Shahzod Muxtorov')).toBeNull()
  })
})

describe('the band the ladder pays', () => {
  it('pays inside 107-147, inclusive at both ends', () => {
    expect(bonusEligible('Aziza Karimova 107')).toBe(true)
    expect(bonusEligible('Aziza Karimova 147')).toBe(true)
    expect(bonusEligible('Aziza Karimova 128')).toBe(true)
  })

  it('pays nothing outside it', () => {
    expect(bonusEligible('Ezoza Karayeva 100')).toBe(false)
    expect(bonusEligible('Aziza Karimova 106')).toBe(false)
    expect(bonusEligible('Aziza Karimova 148')).toBe(false)
  })

  it('pays nothing to July’s top three, which is the point', () => {
    // The three names that topped the client's own July board. All clear the
    // 70 mln rung; none of them is inside the band, and their page pays them
    // nothing. This board used to promise all three a 2 mln soʻm bonus.
    expect(bonusEligible('Marjona Shahtiyarovna 197')).toBe(false)
    expect(bonusEligible('Sevinchhon Abdullayevna 209')).toBe(false)
    expect(bonusEligible('Azizbek Ahatovich 169')).toBe(false)
  })

  it('withholds rather than invents when the name has no number', () => {
    // Their `idInRange()` returns false on a regex miss, and withholding a
    // badge is a smaller error than promising money nobody will pay.
    expect(bonusEligible('Абдурахимов Жавохирбек')).toBe(false)
  })

  it('states the band the screen prints', () => {
    expect(BONUS_BAND).toEqual({ from: 107, to: 147 })
  })
})

describe('the tier ladder', () => {
  it('is descending, so the highest cleared floor wins', () => {
    const floors = BONUS_TIERS.map((tier) => tier.floorMinor)
    expect(floors).toEqual([7_000_000_000n, 6_000_000_000n, 4_500_000_000n])
  })

  it('quotes their three rungs: 45/60/70 mln earn 1/1.5/2 mln', () => {
    expect(BONUS_TIERS.map((t) => [t.floorMinor, t.bonusMinor])).toEqual([
      [7_000_000_000n, 200_000_000n],
      [6_000_000_000n, 150_000_000n],
      [4_500_000_000n, 100_000_000n],
    ])
  })

  it('awards the top rung, not the first match, at 70 mln', () => {
    // The rule `bonusFor` applies: `find` over a DESCENDING table. Evaluating
    // ascending would pay 1 mln to somebody who earned 2.
    const wonMinor = 7_500_000_000n
    const cleared = BONUS_TIERS.find((tier) => wonMinor >= tier.floorMinor)
    expect(cleared?.bonusMinor).toBe(200_000_000n)
  })

  it('awards nothing below the first floor', () => {
    expect(BONUS_TIERS.find((tier) => 4_400_000_000n >= tier.floorMinor)).toBeUndefined()
  })
})
