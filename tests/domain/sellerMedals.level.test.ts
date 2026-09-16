import { describe, expect, it } from 'vitest'

import {
  LEGENDA_STEP_MINOR,
  LEVEL_THRESHOLDS_MINOR,
  LEVEL_TITLES,
  MINOR_PER_MLN,
  levelFloorMinorOf,
  levelOf,
  nextLevelAtMinorOf,
  nextTitleOf,
  romanOf,
  titleOf,
} from '@/server/domain/analytics/sellerMedals'

/**
 * Narvon — 2026-09-16 da production'da 126 sotuvchi ustida o'lchangan
 * taqsimotdan tanlangan va QOTIRILGAN (spec §1). Ishga tushgan darajani
 * ko'tarish floor uchun jazo — bu fayl raqamlarni himoya qiladi.
 */
const MLN = MINOR_PER_MLN

describe('narvon ostonalari', () => {
  it('olti ostona: birinchi so‘m, 10, 30, 100, 300, 1000 mln', () => {
    expect(LEVEL_THRESHOLDS_MINOR).toEqual([1n, 10n * MLN, 30n * MLN, 100n * MLN, 300n * MLN, 1000n * MLN])
    expect(LEVEL_TITLES).toEqual(['Yangi', 'Sotuvchi', 'Katta sotuvchi', 'Usta', 'Ustoz', 'Legenda'])
    expect(LEGENDA_STEP_MINOR).toBe(1000n * MLN)
  })

  it('nol — 0-daraja, unvonsiz; birinchi so‘m — Yangi', () => {
    expect(levelOf(0n)).toEqual({ level: 0, legendaTier: 0 })
    expect(titleOf(levelOf(0n))).toBeNull()
    expect(levelOf(1n)).toEqual({ level: 1, legendaTier: 0 })
    expect(titleOf(levelOf(1n))).toBe('Yangi')
  })

  it('ostonaning AYNAN ustida ko‘tariladi, bir minor pastda ko‘tarilmaydi', () => {
    expect(levelOf(10n * MLN - 1n).level).toBe(1)
    expect(levelOf(10n * MLN).level).toBe(2)
    expect(levelOf(30n * MLN - 1n).level).toBe(2)
    expect(levelOf(30n * MLN).level).toBe(3)
    expect(levelOf(100n * MLN).level).toBe(4)
    expect(levelOf(300n * MLN).level).toBe(5)
    expect(levelOf(1000n * MLN).level).toBe(6)
  })

  it('production‘dagi haqiqiy raqamlar (2026-09-16): 173 mln — Usta, 30,8 mln — Katta sotuvchi, 7,1 mln — Yangi', () => {
    expect(titleOf(levelOf(173n * MLN))).toBe('Usta')
    expect(titleOf(levelOf(308n * MLN / 10n))).toBe('Katta sotuvchi')
    expect(titleOf(levelOf(71n * MLN / 10n))).toBe('Yangi')
  })

  it('Legenda har keyingi milliardda rim raqami oladi, lavha o‘zgarmaydi', () => {
    expect(levelOf(1000n * MLN)).toEqual({ level: 6, legendaTier: 1 })
    expect(titleOf(levelOf(1000n * MLN))).toBe('Legenda')
    expect(levelOf(2000n * MLN)).toEqual({ level: 6, legendaTier: 2 })
    expect(titleOf(levelOf(2000n * MLN))).toBe('Legenda II')
    expect(levelOf(3999n * MLN)).toEqual({ level: 6, legendaTier: 3 })
    expect(titleOf(levelOf(3999n * MLN))).toBe('Legenda III')
  })

  it('shu darajaning ostonasi va keyingi ostona — pul bilan', () => {
    expect(levelFloorMinorOf(levelOf(0n))).toBe(0n)
    expect(nextLevelAtMinorOf(levelOf(0n))).toBe(1n)
    expect(levelFloorMinorOf(levelOf(5n * MLN))).toBe(1n)
    expect(nextLevelAtMinorOf(levelOf(5n * MLN))).toBe(10n * MLN)
    expect(levelFloorMinorOf(levelOf(173n * MLN))).toBe(100n * MLN)
    expect(nextLevelAtMinorOf(levelOf(173n * MLN))).toBe(300n * MLN)
    // Legenda II ning ostonasi 2 mlrd, keyingisi 3 mlrd — narvon tugamaydi.
    expect(levelFloorMinorOf(levelOf(2500n * MLN))).toBe(2000n * MLN)
    expect(nextLevelAtMinorOf(levelOf(2500n * MLN))).toBe(3000n * MLN)
  })

  it('keyingi unvon HAR DOIM bor — «… ga N mln qoldi» jumlasi hech qachon bo‘sh qolmaydi', () => {
    expect(nextTitleOf(levelOf(0n))).toBe('Yangi')
    expect(nextTitleOf(levelOf(5n * MLN))).toBe('Sotuvchi')
    expect(nextTitleOf(levelOf(173n * MLN))).toBe('Ustoz')
    expect(nextTitleOf(levelOf(300n * MLN))).toBe('Legenda')
    expect(nextTitleOf(levelOf(1000n * MLN))).toBe('Legenda II')
    expect(nextTitleOf(levelOf(2000n * MLN))).toBe('Legenda III')
  })

  it('rim raqamlari', () => {
    expect(romanOf(1)).toBe('I')
    expect(romanOf(4)).toBe('IV')
    expect(romanOf(9)).toBe('IX')
    expect(romanOf(14)).toBe('XIV')
    expect(romanOf(40)).toBe('XL')
  })
})
