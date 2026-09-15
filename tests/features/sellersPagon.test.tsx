// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Pagon, medalReason } from '@/features/sellers/Pagon'
import type { SellerMedalDto, SellerMedalRowDto } from '@/lib/api'

const uzs = (amount: number) => ({ amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount })

const medal = (over: Partial<SellerMedalDto> & { code: SellerMedalDto['code'] }): SellerMedalDto => ({
  count: 1,
  tier: null,
  points: 500,
  at: '2026-08-01',
  amount: null,
  orders: null,
  percent: null,
  ...over,
})

const row = (over: Partial<SellerMedalRowDto> = {}): SellerMedalRowDto => ({
  employeeId: 'e1',
  points: 11_000,
  level: 15,
  rankTitle: 'Usta',
  levelFloor: 10_500,
  nextLevelAt: 12_000,
  nextTitle: 'Master',
  medals: [],
  ...over,
})

describe('pagon', () => {
  it('darajani, unvonni va keyingi maqsadni yozadi', () => {
    render(<Pagon row={row()} variant="seat" />)
    expect(screen.getByText(/15-daraja/)).toBeTruthy()
    expect(screen.getByText(/Usta/)).toBeTruthy()
    // Keyingi daraja unvonni almashtiradi — nomi aytiladi, 1 000 ball qolgan.
    expect(screen.getByText(/Master/)).toBeTruthy()
  })

  it('keyingi daraja unvonni almashtirmasa raqam aytiladi', () => {
    render(<Pagon row={row({ level: 12, nextTitle: null, levelFloor: 6_600, nextLevelAt: 7_800, points: 7_000 })} variant="seat" />)
    expect(screen.getByText(/13-darajaga/)).toBeTruthy()
  })

  it('medalsizda faqat daraja chizig‘i qoladi — medal qatori chizilmaydi', () => {
    const { container } = render(<Pagon row={row({ medals: [] })} variant="seat" />)
    expect(container.querySelector('.pagon-medals')).toBeNull()
  })

  it('seat varianti eng ko‘pi 5 medal chizadi va qolganini +N qiladi', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      medal({ code: 'day-winner', points: 100 - i, at: `2026-08-0${i + 1}` }),
    )
    const { container } = render(<Pagon row={row({ medals: many })} variant="seat" />)
    expect(container.querySelectorAll('.pagon-medal')).toHaveLength(5)
    expect(screen.getByText('+3')).toBeTruthy()
  })

  it('qator varianti eng ko‘pi 3 medal chizadi', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      medal({ code: 'day-winner', points: 100 - i, at: `2026-08-0${i + 1}` }),
    )
    const { container } = render(<Pagon row={row({ medals: many })} variant="row" />)
    expect(container.querySelectorAll('.pagon-medal')).toHaveLength(3)
    expect(screen.getByText('+3')).toBeTruthy()
  })

  it('takrorlangan medal sanoq bilan chiziladi', () => {
    render(<Pagon row={row({ medals: [medal({ code: 'month-gold', count: 3 })] })} variant="seat" />)
    expect(screen.getByText('×3')).toBeTruthy()
  })

  it('klub bosqich raqamini ko‘taradi', () => {
    render(<Pagon row={row({ medals: [medal({ code: 'club', tier: 4, amount: uzs(120_000_000) })] })} variant="seat" />)
    expect(screen.getByText('IV')).toBeTruthy()
  })

  it('gapiruvchi medal nomi va sababi bilan ochiladi', () => {
    const speaking = medal({ code: 'conversion-master', percent: 82, orders: 41 })
    render(<Pagon row={row({ medals: [speaking] })} variant="seat" speaking={speaking} />)
    expect(screen.getByText('Konversiya ustasi', { selector: '.pagon-speech-name' })).toBeTruthy()
    expect(screen.getByText(/82/)).toBeTruthy()
  })

  it('ekran o‘qiydigan matn har medalda bor — emoji o‘zi hech narsa demaydi', () => {
    render(<Pagon row={row({ medals: [medal({ code: 'month-gold' })] })} variant="row" />)
    expect(screen.getByText('Oy chempioni', { selector: '.sr-only' })).toBeTruthy()
  })
})

describe('medalReason', () => {
  it('oy medali — oy nomi, summa va buyurtma', () => {
    const text = medalReason(medal({ code: 'month-gold', amount: uzs(128_550_000), orders: 74 }))
    expect(text).toContain('Avgust 2026')
    expect(text).toContain('74')
  })

  it('konversiya medali — foiz va buyurtma soni', () => {
    const text = medalReason(medal({ code: 'conversion-master', percent: 82, orders: 41 }))
    expect(text).toContain('82')
    expect(text).toContain('41')
  })

  it('klub — bosqich va jami summa', () => {
    const text = medalReason(medal({ code: 'club', tier: 4, amount: uzs(120_000_000) }))
    expect(text).toContain('IV')
  })

  it('🚀 ning orders maydoni o‘rin deb chiziladi, buyurtma deb emas', () => {
    // Domen qatlami yangi yulduzning o‘rnini `orders` da uzatadi.
    const text = medalReason(medal({ code: 'rookie', at: '2026-10-01', orders: 7 }))
    expect(text).toContain('7-oʻrin')
    expect(text).not.toContain('7 buyurtma')
  })

  it('faqat oyi bor medal o‘sha oyni yozadi', () => {
    // `not.toBe('')` yetarli emasdi: u har qanday axlat satrda ham o‘tardi.
    expect(medalReason(medal({ code: 'streak-fire', at: '2026-11-01' }))).toBe('Noyabr 2026')
  })

  it('hech qanday fakti yo‘q medal o‘z NOMINI yozadi, bo‘sh satr emas', () => {
    // Zaxira shoxi: televizorda izohsiz medal javobsiz savol bo‘lib qoladi.
    const bare = medal({ code: 'streak-fire', at: null })
    expect(medalReason(bare)).toBe('Olov seriyasi')
  })
})
