// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RECORD_CUT_MS, RecordWallView, monthLabel, monthName } from '@/features/sellers/RecordWall'
import type { SellerRecordDto } from '@/lib/api'
import { NARROW_NBSP } from '@/lib/format'

/**
 * Rekord devori — sahifa sarlavhasining o'rtasida IKKI STATIK band (spec §7):
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

const labels = (c: HTMLElement) => [...c.querySelectorAll('.record')].map((r) => r.querySelector('.record__k')!.textContent)

describe('rekord devori — ikki statik band (spec §7)', () => {
  it('keng sarlavhada eng yangi ikki oy: yetakchi va rekord; to‘liq so‘m; «57 ta yetkazilgan»', () => {
    const { container } = render(<RecordWallView months={MONTHS} wide reduced={false} />)
    expect(labels(container)).toEqual(['Sentabr yetakchisi', 'Avgust 2026 rekordi'])
    const [lead, rec] = container.querySelectorAll('.record')
    expect(lead!.querySelector('.record__n')!.textContent).toBe('Shahtiyarovna 197 Marjona')
    expect(lead!.querySelector('.record__v')!.textContent).toBe(`79${S}600${S}000`)
    expect(lead!.querySelector('.record__note')!.textContent).toBe('57 ta yetkazilgan')
    expect(rec!.querySelector('.record__v')!.textContent).toBe(`128${S}550${S}000`)
    expect(container.querySelector('.record-wall')!.getAttribute('aria-label')).toBe('Har oyning eng yaxshi sotuvchisi')
    // Marquee, lozenge, kubok — hech biri yo'q.
    expect(container.querySelector('.record-track')).toBeNull()
    expect(container.textContent).not.toMatch(/mln|soʻm|🏆|◆|Rekord ·|Yetakchi ·/)
  })

  it('tasdiqlangan pul bilan o‘lchangan oy «tasdiqlangan» deb yoziladi', () => {
    const { container } = render(<RecordWallView months={MONTHS.slice(2)} wide reduced={false} />)
    expect(labels(container)).toEqual(['Iyul 2026 rekordi'])
    expect(container.querySelector('.record__note')!.textContent).toBe('40 ta tasdiqlangan')
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
