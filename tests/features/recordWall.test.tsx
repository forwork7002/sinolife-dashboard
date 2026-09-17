// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RECORD_CUT_MS, RecordWallView, monthLabel, monthName } from '@/features/sellers/RecordWall'
import type { SellerRecordDto } from '@/lib/api'
import { NARROW_NBSP } from '@/lib/format'

/**
 * Rekord devori — sahifa sarlavhasining o'rtasida IKKI PLAKET (EFIR Premium
 * spec §7): 32 px medal, neytral caps yorliq, sanoq, ism · kod · summa;
 * sudralmaydi, tor sarlavhada bittasi 10 s da KESIB almashadi, kamaytirilgan
 * harakatda birinchisi turadi. So'rov `RecordWall` da; bu yerda ko'rinish.
 */
const S = NARROW_NBSP
const money = (amount: number) => ({ amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount })

function record(
  month: string,
  running: boolean,
  fullName: string,
  amount: number,
  orders: number,
  basis: SellerRecordDto['basis'] = 'delivered',
): SellerRecordDto {
  return {
    month,
    running,
    employeeId: fullName,
    fullName,
    rop: null,
    basis,
    amount: money(amount),
    orders,
    confirmed: money(amount),
    confirmedOrders: orders,
    delivered: money(amount),
    deliveredOrders: orders,
  }
}

/* Payload — eng yangi oy birinchi (`SellerRecordsDto.months`). */
const MONTHS = [
  record('2026-09-01', true, 'Shahtiyarovna 197 Marjona', 79_600_000, 57),
  record('2026-08-01', false, '154 Marjona Xayrullayeva', 128_550_000, 74),
  record('2026-07-01', false, 'Saparboyeva 110 Farida', 90_000_000, 40, 'confirmed'),
]

const labels = (c: HTMLElement) =>
  [...c.querySelectorAll('.plaque')].map((r) => r.querySelector('.plaque__label')!.textContent)

describe('rekord devori — ikki plaket (spec §7)', () => {
  it('keng sarlavhada eng yangi ikki oy: yetakchi va rekord; ism · kod · to‘liq so‘m; «57 ta yetkazilgan»', () => {
    const { container } = render(<RecordWallView months={MONTHS} wide reduced={false} />)
    expect(labels(container)).toEqual(['Sentabr yetakchisi', 'Avgust 2026 rekordi'])
    const wall = container.querySelector('.record-wall')!
    expect(wall.getAttribute('aria-label')).toBe('Har oyning eng yaxshi sotuvchisi')
    expect(wall.getAttribute('data-bands')).toBe('2')
    const [lead, rec] = container.querySelectorAll('.plaque')
    expect(lead!.querySelector('.nm')!.textContent).toBe('Shahtiyarovna Marjona')
    expect(lead!.querySelector('.code')!.textContent).toBe('197')
    expect(lead!.querySelector('.plaque__amount')!.textContent).toBe(`79${S}600${S}000`)
    expect(lead!.querySelector('.plaque__count')!.textContent).toBe('57 ta yetkazilgan')
    expect(rec!.querySelector('.nm')!.textContent).toBe('Marjona Xayrullayeva')
    expect(rec!.querySelector('.code')!.textContent).toBe('154')
    expect(rec!.querySelector('.plaque__amount')!.textContent).toBe(`128${S}550${S}000`)
    // Marquee, lozenge, kubok, «hozircha» — hech biri yo'q.
    expect(container.querySelector('.record-track, .tag')).toBeNull()
    expect(container.textContent).not.toMatch(/mln|soʻm|🏆|◆|Rekord ·|Yetakchi ·|hozircha/)
  })

  it('medal: joriy oy yetakchisi — month-gold, yopiq oy rekordi — day-record; 32 px', () => {
    const { container } = render(<RecordWallView months={MONTHS} wide reduced={false} />)
    const medals = [...container.querySelectorAll('.plaque svg.medal')]
    expect(medals.map((m) => m.getAttribute('data-medal'))).toEqual(['month-gold', 'day-record'])
    for (const m of medals) {
      expect(m.getAttribute('width')).toBe('32')
      expect(m.getAttribute('height')).toBe('32')
    }
  })

  it('summa BITTA matn tuguni; ajratgichlar o‘ralmaydi', () => {
    const { container } = render(<RecordWallView months={MONTHS} wide reduced={false} />)
    for (const amount of container.querySelectorAll('.plaque__amount')) {
      expect(amount.childNodes).toHaveLength(1)
      expect(amount.firstChild!.nodeType).toBe(Node.TEXT_NODE)
    }
  })

  it('kodsiz ism kod tokenini chizmaydi', () => {
    const months = [record('2026-09-01', true, 'Содиков Мурод', 5_000_000, 3)]
    const { container } = render(<RecordWallView months={months} wide reduced={false} />)
    expect(container.querySelector('.nm')!.textContent).toBe('Содиков Мурод')
    expect(container.querySelector('.code')).toBeNull()
  })

  it('tasdiqlangan pul bilan o‘lchangan oy «tasdiqlangan» deb yoziladi', () => {
    const { container } = render(<RecordWallView months={MONTHS.slice(2)} wide reduced={false} />)
    expect(labels(container)).toEqual(['Iyul 2026 rekordi'])
    expect(container.querySelector('.plaque__count')!.textContent).toBe('40 ta tasdiqlangan')
  })

  it('oy yo‘q — hech narsa chizilmaydi', () => {
    const { container } = render(<RecordWallView months={[]} wide reduced={false} />)
    expect(container.firstChild).toBeNull()
  })

  describe('tor sarlavha (~1500 px dan kam) — bitta band, 10 s da kesib almashadi', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('avval yetakchi, 10 s dan keyin rekord, yana 10 s dan keyin yetakchi', () => {
      const { container } = render(<RecordWallView months={MONTHS} wide={false} reduced={false} />)
      expect(labels(container)).toEqual(['Sentabr yetakchisi'])
      expect(container.querySelector('.record-wall')!.getAttribute('data-bands')).toBe('1')
      act(() => vi.advanceTimersByTime(RECORD_CUT_MS))
      expect(labels(container)).toEqual(['Avgust 2026 rekordi'])
      act(() => vi.advanceTimersByTime(RECORD_CUT_MS))
      expect(labels(container)).toEqual(['Sentabr yetakchisi'])
      // Uchinchi oy hech qachon — devor eng yangi ikki oyni ko'rsatadi.
      expect(container.textContent).not.toContain('Iyul')
    })

    it('kamaytirilgan harakatda kesish yo‘q — birinchisi turadi', () => {
      const { container } = render(<RecordWallView months={MONTHS} wide={false} reduced />)
      act(() => vi.advanceTimersByTime(RECORD_CUT_MS * 3))
      expect(labels(container)).toEqual(['Sentabr yetakchisi'])
    })

    it('bitta oy — kesadigan narsa yo‘q', () => {
      const { container } = render(<RecordWallView months={MONTHS.slice(0, 1)} wide={false} reduced={false} />)
      act(() => vi.advanceTimersByTime(RECORD_CUT_MS * 2))
      expect(labels(container)).toEqual(['Sentabr yetakchisi'])
    })
  })

  it('oy nomlari satrdan, brauzer mintaqasidan emas: «Sentabr», «Avgust 2026»', () => {
    expect(monthName('2026-09-01')).toBe('Sentabr')
    expect(monthLabel('2026-08-01')).toBe('Avgust 2026')
    expect(monthLabel('2026-13-01')).toBe('2026-13-01')
  })
})
