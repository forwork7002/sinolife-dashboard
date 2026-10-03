import { describe, expect, it } from 'vitest'

import { RNP_GRADE_SCALES, rnpDayGrade, rnpGradeScaleText } from '@/server/domain/rnp/rnpGrade'

/* «Баҳо» — the client's three scales of 2026-10-03, every bound on both sides. */

const grade = (rop: string, som: number) => rnpDayGrade(som, RNP_GRADE_SCALES[rop]!)

describe('rnpDayGrade', () => {
  it('grades a Collagen первичка day: < 20 M → 2, 20–35 → 3, 35–50 → 4, 50+ → 5', () => {
    expect(grade('Sevinch', 1)).toBe(2)
    expect(grade('Sevinch', 19_999_999)).toBe(2)
    expect(grade('Sevinch', 20_000_000)).toBe(3)
    expect(grade('Sevinch', 34_999_999)).toBe(3)
    expect(grade('Sevinch', 35_000_000)).toBe(4)
    expect(grade('Sevinch', 49_999_999)).toBe(4)
    expect(grade('Sevinch', 50_000_000)).toBe(5)
  })

  it('grades a Zextra day: < 25 M → 2, 25–40 → 3, 40–60 → 4, 60+ → 5', () => {
    expect(grade('Sadriddin', 24_999_999)).toBe(2)
    expect(grade('Sadriddin', 25_000_000)).toBe(3)
    expect(grade('Asliddin', 40_000_000)).toBe(4)
    expect(grade('Asliddin', 59_999_999)).toBe(4)
    expect(grade('Asliddin', 60_000_000)).toBe(5)
  })

  it('grades both БАЗА teams on one scale: < 15 M → 2, 15–25 → 3, 25–35 → 4, 35+ → 5', () => {
    for (const rop of ['Baza', 'Charos']) {
      expect(grade(rop, 14_999_999)).toBe(2)
      expect(grade(rop, 15_000_000)).toBe(3)
      expect(grade(rop, 25_000_000)).toBe(4)
      expect(grade(rop, 35_000_000)).toBe(5)
    }
  })

  it('gives a day with no FAKT 1 no grade — a day off is not a 2', () => {
    expect(grade('Sevinch', 0)).toBeNull()
    expect(grade('Charos', 0)).toBeNull()
  })

  it('has a scale for every team the client named, and for no other', () => {
    expect(Object.keys(RNP_GRADE_SCALES).sort()).toEqual(
      ['Asliddin', 'Azizbek', 'Baza', 'Charos', 'Gulzora', 'Hayot', 'Lola', 'Maftuna', 'Marjona', 'Sadriddin', 'Saidaziz', 'Sevinch', 'Shohjaxon'].sort(),
    )
  })

  it('says the scale in words', () => {
    expect(rnpGradeScaleText(RNP_GRADE_SCALES.Sevinch!)).toBe('20 mln gacha — 2, 20 mln–35 mln — 3, 35 mln–50 mln — 4, 50 mln dan — 5')
  })
})
