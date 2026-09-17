// @vitest-environment jsdom
import { fireEvent, render, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fromSeller, fromTeam } from '@/features/sellers/board'
import { teamTotals } from '@/features/sellers/TeamsBoard'
import type { SellerBoardDto, SellerMedalRowDto } from '@/lib/api'
import { NARROW_NBSP } from '@/lib/format'

/**
 * KOMANDALAR USTUNI — EFIR Premium (spec §6). Rank 1–3 zarb qilingan tanga,
 * nom va sotuvchi soni bitta uyada, qahramon uyasi har doim FAOL fakt, ulush
 * chizig'i yetakchiga nisbatan, va pastdagi `footer.jami` plaketi — komandalar
 * jami + komandasizlar = barcha sotuvchilar, ikkala faktda.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/sellers',
  useSearchParams: () => new URLSearchParams(''),
}))

/* Kamaytirilgan harakat — `useAutoScroll` o'chiq, raqamlar bir marta chiziladi. */
window.matchMedia = ((query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const { TeamsColumn } = await import('@/features/sellers/SellersPage')

const S = NARROW_NBSP
const som = (text: string) => Number(text.split(S).join(''))

function money(amount: number) {
  return { amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount }
}

function seller(fullName: string, won: number, ordered: number, rop: string | null) {
  return {
    employeeId: fullName,
    rank: 0,
    fullName,
    rop,
    orders: 3,
    wonOrders: won > 0 ? 2 : 0,
    openOrders: 0,
    ordered: money(ordered),
    won: money(won),
    sharePercent: null,
    conversionPercent: won > 0 ? 91.3 : null,
    bonus: { earned: money(0), toNext: null, toNextPercent: null, eligible: false },
  }
}

function team(rop: string, rank: number, sellers: number, won: number, ordered: number, conv: number | null = 70) {
  return {
    rank,
    rop,
    sellers,
    orders: 10,
    wonOrders: won > 0 ? 6 : 0,
    ordered: money(ordered),
    won: money(won),
    open: money(0),
    conversionPercent: conv,
    sharePercent: null,
  }
}

function board(over: {
  rows?: ReturnType<typeof seller>[]
  teams?: ReturnType<typeof team>[]
  teamlessSellers?: number
}): SellerBoardDto {
  return {
    rows: over.rows ?? [],
    teams: over.teams ?? [],
    totals: { orders: 0, wonOrders: 0, won: money(0), teamlessSellers: over.teamlessSellers ?? 0 },
  } as unknown as SellerBoardDto
}

/*
  Bir-biriga mos taxta: har komanda puli — uning sotuvchilari yig'indisi, va
  ikki sotuvchi komandasiz. FAKT 2 bo'yicha Gulzora, Sevinch, Lola, Azizbek;
  FAKT 1 bo'yicha Lola birinchi (220 mln tasdiqlangan).
*/
const LEDGER = board({
  rows: [
    seller('Ashrafova 172 Marjona', 120_000_000, 130_000_000, 'Gulzora'),
    seller('Nodira 118 Karimova', 45_950_000, 76_350_000, 'Gulzora'),
    seller('Saparboyeva 110 Farida', 108_000_000, 144_500_000, 'Sevinch'),
    seller('Yusupova 139 Mahliyo', 41_000_000, 220_000_000, 'Lola'),
    seller('Rustamov 201 Diyor', 12_000_000, 30_000_000, 'Azizbek'),
    seller('Aziza 121 Toshmatova', 20_000_000, 31_000_000, null),
    seller('Qodirova 188 Zilola', 0, 5_000_000, null),
  ],
  teams: [
    team('Gulzora', 1, 12, 165_950_000, 206_350_000),
    team('Sevinch', 2, 9, 108_000_000, 144_500_000),
    team('Lola', 3, 7, 41_000_000, 220_000_000),
    team('Azizbek', 4, 8, 12_000_000, 30_000_000, null),
  ],
  teamlessSellers: 2,
})

/* «Bugun» komandalar tomoni: hech kim yetkazmagan — FAKT 1 da o'qiladi. */
const TEAM_FALLBACK = board({
  teams: [
    team('Gulzora', 1, 12, 0, 40_000_000),
    team('Azizbek', 2, 14, 0, 15_000_000),
    team('Asliddin', 3, 8, 0, 2_000_000),
    team('Baza', 4, 5, 0, 1_000_000),
  ],
})

/** Sahifaning o'z simi: bitta tanlov, sarlavhadan bosiladi. */
function Teams({ data }: { data: SellerBoardDto }) {
  const [fakt, setFakt] = useState<'auto' | 'fakt1' | 'fakt2'>('auto')
  return (
    <TeamsColumn
      data={data}
      status="ready"
      onRetry={() => {}}
      fakt={fakt}
      onFakt={setFakt}
      medals={new Map<string, SellerMedalRowDto>()}
      medalsToday={null}
    />
  )
}

const col = () => document.getElementById('tv-teams')!
const rows = () => [...col().querySelectorAll('li.trow')] as HTMLElement[]
const names = () => rows().map((r) => r.querySelector('.trow__name .nm')!.textContent)
const cells = (row: HTMLElement) => [...row.querySelectorAll('.trow__hero, .trow__sec')].map((c) => c.textContent)
const press = (label: string) => fireEvent.click(within(col()).getByRole('button', { name: label }))

const RealResizeObserver = globalThis.ResizeObserver
afterEach(() => {
  globalThis.ResizeObserver = RealResizeObserver
})

describe('komandalar qatori (spec §6)', () => {
  it('podium yo‘q; 1–3 kichik tanga (30 px, `#halo-sm-N`, `data-metal` qatorda), qolgani sokin raqam', () => {
    render(<Teams data={LEDGER} />)
    expect(col().querySelector('.seat, .tv-podium')).toBeNull()
    expect(names()).toEqual(['Gulzora', 'Sevinch', 'Lola', 'Azizbek'])
    expect(rows().map((r) => r.getAttribute('data-metal'))).toEqual(['gold', 'silver', 'bronze', null])
    rows()
      .slice(0, 3)
      .forEach((row, i) => {
        const halo = row.querySelector('.trow__rank svg.halo')!
        expect(halo.getAttribute('width')).toBe('30')
        expect(halo.querySelector('use')!.getAttribute('href')).toBe(`#halo-sm-${i + 1}`)
        expect(row.querySelector('.trow__rank')!.textContent).toBe(String(i + 1))
      })
    const fourth = rows()[3]!.querySelector('.trow__rank')!
    expect(fourth.querySelector('svg')).toBeNull()
    expect(fourth.textContent).toBe('4')
  })

  it('nom va sotuvchi soni bitta uyada; alohida «Sotuvchi» ustuni yo‘q; yorliq «Komanda · sotuvchi»', () => {
    render(<Teams data={LEDGER} />)
    const name = rows()[0]!.querySelector('.trow__name')!
    expect(name.querySelector('.nm')!.textContent).toBe('Gulzora')
    expect(name.querySelector('.cnt')!.textContent).toBe('12')
    expect(col().querySelector('.trow__cnt')).toBeNull()
    const labels = [...col().querySelectorAll('.tv-tcols span')].map((s) => s.textContent)
    expect(labels).toEqual(['#', 'Komanda · sotuvchi', 'FAKT 2', 'Ulush', 'FAKT 1', 'Buyurt.', 'Konv.'])
    expect(col().querySelector('.tv-tcols .on')!.textContent).toBe('FAKT 2')
  })

  it('qahramon = faol fakt ikkala o‘qishda; ulush faol fakt ustida; ustunlar almashadi', () => {
    render(<Teams data={LEDGER} />)
    // 165 950 000 / 326 950 000 = 50,76 %; Sevinch 108 / 326,95 = 33,03 %.
    expect(cells(rows()[0]!)).toEqual([`165${S}950${S}000`, `50,8${S}%`, `206${S}350${S}000`, '10', `70${S}%`])
    expect(cells(rows()[1]!)[1]).toBe(`33${S}%`)

    press('FAKT 1')

    expect(names()).toEqual(['Lola', 'Gulzora', 'Sevinch', 'Azizbek'])
    // 220 000 000 / 600 850 000 = 36,6 %.
    expect(cells(rows()[0]!)).toEqual([`220${S}000${S}000`, `36,6${S}%`, `41${S}000${S}000`, '10', `70${S}%`])
    expect([...col().querySelectorAll('.tv-tcols span')].map((s) => s.textContent)).toEqual([
      '#', 'Komanda · sotuvchi', 'FAKT 1', 'Ulush', 'FAKT 2', 'Buyurt.', 'Konv.',
    ])
    expect(col().querySelector('.tv-trows')!.getAttribute('data-read')).toBe('fakt1')
    expect(rows()[0]!.getAttribute('data-metal')).toBe('gold')
  })

  it('ulush chizig‘i = ulush ÷ yetakchi ulushi', () => {
    render(<Teams data={LEDGER} />)
    const widths = rows().map((r) => (r.querySelector('.trow__bar i') as HTMLElement).style.width)
    // 108 / 165,95 = 65,08 %; 41 / 165,95 = 24,71 %; 12 / 165,95 = 7,23 %.
    expect(widths).toEqual(['100%', '65.1%', '24.7%', '7.2%'])
    press('FAKT 1')
    const after = rows().map((r) => (r.querySelector('.trow__bar i') as HTMLElement).style.width)
    // Gulzora 206,35 / 220 = 93,80 %; Sevinch 144,5 / 220 = 65,68 %; Azizbek 30 / 220 = 13,64 %.
    expect(after).toEqual(['100%', '93.8%', '65.7%', '13.6%'])
  })

  it('nol yoki null ikkinchi darajali qiymat — xira chiziqcha, qalin «0» yo‘q', () => {
    render(<Teams data={TEAM_FALLBACK} />)
    expect(names()).toEqual(['Gulzora', 'Azizbek', 'Asliddin', 'Baza'])
    const first = rows()[0]!
    const other = first.querySelectorAll('.trow__sec')[1]!
    expect(other.textContent).toBe('—')
    expect(other.classList.contains('trow__none')).toBe(true)
    expect(within(col()).getByRole('button', { name: 'FAKT 1' }).getAttribute('aria-pressed')).toBe('true')
    for (const cell of col().querySelectorAll('.trow__hero, .trow__sec')) expect(cell.textContent).not.toBe('0')
  })

  it('qator balandligi ustundan: clamp(40, floor(joy / n), 52)', () => {
    let height = 700
    globalThis.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { height } } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver

    const many = (n: number) =>
      board({ teams: Array.from({ length: n }, (_, i) => team(`K${String(i).padStart(2, '0')}`, i + 1, 3, 1_000_000 * (n - i), 2_000_000)) })
    const trowH = () => (col().querySelector('.tv-trows') as HTMLElement).style.getPropertyValue('--trow-h')

    const first = render(<Teams data={many(14)} />)
    expect(trowH()).toBe('50px')
    first.unmount()

    const second = render(<Teams data={LEDGER} />)
    expect(trowH()).toBe('52px')
    second.unmount()

    height = 1000
    render(<Teams data={many(30)} />)
    expect(trowH()).toBe('40px')
  })
})

describe('komandalar jami plaketi (spec §6)', () => {
  it('«4 komanda jami · FAKT 2», boshqa fakt, komandasizlar, barcha sotuvchilar va izoh', () => {
    render(<Teams data={LEDGER} />)
    const jami = col().querySelector('footer.jami')!
    expect(jami.querySelector('.jami__k')!.textContent).toBe('4 komanda jami · FAKT 2')
    expect(jami.querySelector('.jami__v')!.textContent).toBe(`326${S}950${S}000`)
    expect(jami.querySelector('.jami__o')!.textContent).toBe(`FAKT 1600${S}850${S}000`)
    expect([...jami.querySelectorAll('dt')].map((d) => d.textContent)).toEqual([
      'Komandasiz · 2 sotuvchi',
      'Barcha sotuvchilar',
    ])
    expect([...jami.querySelectorAll('dd')].map((d) => d.textContent)).toEqual([
      `20${S}000${S}000`,
      `346${S}950${S}000`,
      'Ulush 4 komanda jamidan hisoblanadi',
    ])
    expect(col().querySelector('.tv-tfoot')).toBeNull()
  })

  it('komandalar + komandasiz = barcha sotuvchi qatorlari — ikkala faktda, ekranda va hisobda', () => {
    render(<Teams data={LEDGER} />)
    const read = () => {
      const jami = col().querySelector('footer.jami')!
      const [teamless, all] = [...jami.querySelectorAll('dd')].map((d) => som(d.textContent!))
      return { teams: som(jami.querySelector('.jami__v')!.textContent!), teamless: teamless!, all: all! }
    }

    const fakt2 = read()
    expect(fakt2.teams + fakt2.teamless).toBe(fakt2.all)
    expect(fakt2.all).toBe(LEDGER.rows.reduce((sum, r) => sum + r.won.amount, 0))

    press('FAKT 1')
    const fakt1 = read()
    expect(col().querySelector('.jami__k')!.textContent).toBe('4 komanda jami · FAKT 1')
    expect(fakt1).toEqual({ teams: 600_850_000, teamless: 36_000_000, all: 636_850_000 })
    expect(fakt1.teams + fakt1.teamless).toBe(fakt1.all)
    expect(fakt1.all).toBe(LEDGER.rows.reduce((sum, r) => sum + r.ordered.amount, 0))

    const teams = LEDGER.teams.map(fromTeam)
    const sellers = LEDGER.rows.map(fromSeller)
    for (const onDelivered of [true, false]) {
      const t = teamTotals(teams, sellers, onDelivered)
      expect(t.teams + t.teamless).toBe(t.all)
    }
  })

  it('komandasiz sotuvchi bo‘lmasa «Komandasiz» juftligi chizilmaydi, jami va izoh qoladi', () => {
    render(<Teams data={TEAM_FALLBACK} />)
    const jami = col().querySelector('footer.jami')!
    expect(jami.textContent).not.toContain('Komandasiz')
    expect(jami.querySelector('.jami__k')!.textContent).toBe('4 komanda jami · FAKT 1')
    expect(jami.querySelector('.jami__v')!.textContent).toBe(`58${S}000${S}000`)
    expect(jami.querySelector('.jami__o span')!.textContent).toBe('—')
    expect(jami.querySelector('.jami__note')!.textContent).toBe('Ulush 4 komanda jamidan hisoblanadi')
  })
})
