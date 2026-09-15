import { describe, expect, it } from 'vitest'

import { levelFloorOf, levelOf, nextTitleOf, titleOf } from '@/server/domain/analytics/sellerMedals'

/**
 * The level ladder, pinned to the numbers calibrated on production 2026-09-15.
 *
 * A level that moves after the board has shipped reads as a punishment to the
 * floor — «kecha 9-daraja edim» — so the curve is a fact this file defends,
 * not a tuning knob.
 */
describe("daraja narvoni", () => {
  it("N-darajaning chegarasi 50·N² − 50·N", () => {
    expect(levelFloorOf(1)).toBe(0)
    expect(levelFloorOf(2)).toBe(100)
    expect(levelFloorOf(3)).toBe(300)
    expect(levelFloorOf(5)).toBe(1_000)
    expect(levelFloorOf(10)).toBe(4_500)
    expect(levelFloorOf(12)).toBe(6_600)
    expect(levelFloorOf(15)).toBe(10_500)
    expect(levelFloorOf(20)).toBe(19_000)
  })

  it("nol ball — 1-daraja, chunki 1-daraja «hali savdosi yo'q» degani", () => {
    expect(levelOf(0)).toBe(1)
    expect(levelOf(99)).toBe(1)
  })

  it("chegaraning aynan ustida keyingi darajaga o'tadi", () => {
    expect(levelOf(100)).toBe(2)
    expect(levelOf(299)).toBe(2)
    expect(levelOf(300)).toBe(3)
  })

  it("kalibrlangan haqiqiy ballar o'lchangan darajani beradi", () => {
    // probe-medals3.mts, production, 2026-09-15
    expect(levelOf(7_700)).toBe(12) // Shahtiyarovna 197 Marjona
    expect(levelOf(1_130)).toBe(5) // mediana
  })

  it("unvon bandlari: 1–3 Yangi, 4–7 Sotuvchi, 8–11 Katta sotuvchi, 12–15 Usta, 16–20 Master, 21+ Legenda", () => {
    expect(titleOf(1)).toBe("Yangi")
    expect(titleOf(3)).toBe("Yangi")
    expect(titleOf(4)).toBe("Sotuvchi")
    expect(titleOf(7)).toBe("Sotuvchi")
    expect(titleOf(8)).toBe("Katta sotuvchi")
    expect(titleOf(11)).toBe("Katta sotuvchi")
    expect(titleOf(12)).toBe("Usta")
    expect(titleOf(15)).toBe("Usta")
    expect(titleOf(16)).toBe("Master")
    expect(titleOf(20)).toBe("Master")
    expect(titleOf(21)).toBe("Legenda")
    expect(titleOf(99)).toBe("Legenda")
  })

  it("keyingi unvon faqat keyingi daraja uni almashtirganda aytiladi", () => {
    // 12-darajadan 13-ga o'tish hamon Usta — aytadigan yangilik yo'q.
    expect(nextTitleOf(12)).toBeNull()
    // 15-dan 16-ga o'tish Master qiladi — aytiladi.
    expect(nextTitleOf(15)).toBe("Master")
    expect(nextTitleOf(3)).toBe("Sotuvchi")
    expect(nextTitleOf(20)).toBe("Legenda")
  })
})
