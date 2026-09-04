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

describe('the floor number inside an operator name', () => {
  /*
    THE NUMBER MOVES, AND THAT IS THE BUG THIS PINS.

    Bitrix24 keeps the floor badge on LAST_NAME, so `user.get` reads
    «Davlatbek Sirojov 115» and the client's board prints it at the end. This
    application composes `fullName` the other way round, so the SAME person is
    stored «Sirojov 115 Davlatbek» — the number in the middle. Every string
    below is a real production row (2026-09-04).
  */
  it('reads it in the middle, which is where this database puts it', () => {
    expect(floorNumberOf("Murodov 109 Ma'ruf")).toBe(109)
    expect(floorNumberOf('Karimova 173 Feruza')).toBe(173)
    expect(floorNumberOf('Ahatovich 200 Azizbek')).toBe(200)
  })

  it('reads it first — 90 of 289 production rows look like this', () => {
    expect(floorNumberOf('118 Aziza Vafoqulova')).toBe(118)
    expect(floorNumberOf('292 Sotuvchi')).toBe(292)
  })

  it('reads it last, the way their own board prints it', () => {
    expect(floorNumberOf('Davlatbek Sirojov 115')).toBe(115)
    expect(floorNumberOf('Stojor 179')).toBe(179)
  })

  it('splits on a hyphen, because one row really is written that way', () => {
    expect(floorNumberOf('130-Salomat Shoimova')).toBe(130)
  })

  it('tolerates the trailing space the portal actually stores', () => {
    expect(floorNumberOf('Sardorbek Abdimurodov 198 ')).toBe(198)
  })

  it('is null when the name carries no number', () => {
    expect(floorNumberOf('Abdullayeva Sevinchxon')).toBeNull()
    expect(floorNumberOf('Админ')).toBeNull()
  })

  it('refuses two numbers rather than guessing which is the badge', () => {
    // The rule `marketingService.employeeCode()` already applies: an
    // ambiguity is not a match. No production row has two today.
    expect(floorNumberOf('Karimova 173 Feruza 118')).toBeNull()
  })

  it('ignores digits that are not a standalone 2-4 digit token', () => {
    expect(floorNumberOf('Aziza7 Karimova')).toBeNull()
    expect(floorNumberOf('Aziza 7 Karimova')).toBeNull()
    expect(floorNumberOf('Aziza 12345 Karimova')).toBeNull()
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

  it('pays the same people however the name is spelled', () => {
    /*
      The regression that shipped and had to be fixed within the hour: an
      end-anchored read found the badge in 16 of 289 production names and put
      three people in the band, so the bonus column went dark for a floor that
      has 55. These two strings are one person.
    */
    expect(bonusEligible('Murodov 109 Ma’ruf')).toBe(true)
    expect(bonusEligible('Ma’ruf Murodov 109')).toBe(true)
  })

  it('withholds rather than invents when the name has no number', () => {
    // Their `idInRange()` returns false on a regex miss, and withholding a
    // badge is a smaller error than promising money nobody will pay.
    expect(bonusEligible('Abdullayeva Sevinchxon')).toBe(false)
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
