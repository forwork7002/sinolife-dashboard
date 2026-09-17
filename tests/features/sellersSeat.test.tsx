// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SeatCard, medalWhen } from '@/features/sellers/SeatCard'
import type { SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { NARROW_NBSP } from '@/lib/format'

/**
 * O'rindiq — EFIR Premium (spec §4, delta 8–8j). Ism `parseSellerName`
 * orqali (kod 2-qatorda sokin), plastinali gerb, daraja so'zi, komanda;
 * pul BITTA matn tuguni; boshqa fakt faqat > 0; progress + «Avgustdan beri»;
 * tokcha `seatMedals` bilan (P1 4 × 48, P2/P3 3 × 40), ×N FAQAT o'rindiqda;
 * izoh — eng yuqori medal nomi va sanasi, «hozircha» YO'Q.
 */
const S = NARROW_NBSP

/* jsdom da `matchMedia` yo'q; `AnimatedNumber` uni chaqiradi. Kamaytirilgan
   harakat «ha»: raqam bir marta yakuniy qiymatini yozadi. */
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

const uzs = (amount: number) => ({ amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount })

const medal = (over: Partial<SellerMedalDto> & { code: SellerMedalDto['code'] }): SellerMedalDto => ({
  count: 1,
  at: '2026-08-01',
  amount: null,
  orders: null,
  percent: null,
  ...over,
})

const row = (over: Partial<SellerMedalRowDto> = {}): SellerMedalRowDto => ({
  employeeId: 'e1',
  level: 4,
  legendaTier: 0,
  rankTitle: 'Usta',
  delivered: uzs(172_990_000),
  levelFloor: uzs(100_000_000),
  nextLevelAt: uzs(300_000_000),
  nextTitle: 'Ustoz',
  promotedOn: null,
  medals: [],
  ...over,
})

const ZERO = row({ level: 0, rankTitle: null, delivered: uzs(0), levelFloor: uzs(0), nextLevelAt: uzs(0.01), nextTitle: 'Yangi' })

/** Mock'dagi chempion — «Shahtiyarovna 197 Marjona», FAKT 2 79 600 000, FAKT 1 109 800 000. */
const SEAT = {
  rank: 1,
  place: 1 as const,
  name: 'Shahtiyarovna 197 Marjona',
  team: 'Marjona',
  won: 79_600_000,
  ordered: 109_800_000,
  onDelivered: true,
}

const nameLines = (root: ParentNode) =>
  [...root.querySelectorAll('.seat__name > span')].map((s) => s.textContent)

describe('SeatCard — tuzilma (mock final-month.html)', () => {
  it('P1: tanga dafna bilan, ikki qatorli ism + kod, plastinali gerb, so‘z, komanda, pul, FAKT, progress, tokcha', () => {
    const { container } = render(
      <SeatCard
        {...SEAT}
        medal={row({
          medals: [
            medal({ code: 'day-winner', count: 4, at: '2026-09-05' }),
            medal({ code: 'first-sale' }),
            medal({ code: 'clean-month' }),
            medal({ code: 'day-record', at: '2026-09-09' }),
          ],
        })}
      />,
    )
    const seat = container.querySelector('article.seat.seat--1')!
    expect(seat.getAttribute('data-tier')).toBe('4')
    expect(seat.getAttribute('data-metal')).toBe('gold')
    expect(seat.getAttribute('data-seat-name')).toBe('Shahtiyarovna 197 Marjona')
    expect(seat.getAttribute('aria-label')).toBe('1-oʻrin')
    expect(seat.querySelector(':scope > .seat__band')).not.toBeNull()
    // Ramka yo'q — eski `.seat::before` o'rniga inley tasma.
    expect([...seat.querySelectorAll('.seat__id svg.halo use')].map((u) => u.getAttribute('href'))).toEqual([
      '#halo-laurel', '#halo-1',
    ])
    expect(seat.querySelector('.seat__id .halo-box')!.getAttribute('style')).toContain('width: 66px')

    expect(nameLines(seat)).toEqual(['Shahtiyarovna', 'Marjona 197'])
    expect(seat.querySelector('.seat__name .code')!.textContent).toBe('197')

    const meta = seat.querySelector('.seat__meta')!
    const crest = meta.querySelector('svg.crest')!
    expect(crest.getAttribute('height')).toBe('20')
    expect([...crest.querySelectorAll('use')].map((u) => u.getAttribute('href'))).toEqual(['#crest-plate', '#crest-4'])
    expect(meta.querySelectorAll('b.lvl')).toHaveLength(1)
    expect(meta.querySelector('b.lvl')!.textContent).toBe('Usta')
    expect(meta.querySelector('.team')!.textContent).toBe('Marjona')
    // Tartib: gerb · so'z · komanda — komanda oxirida, sig'masa butunlay tushadi.
    expect([...meta.children].map((c) => c.getAttribute('class'))).toEqual(['crest', 'lvl', 'team'])

    expect(seat.querySelector('.seat__money')!.textContent).toBe(`79${S}600${S}000`)
    expect(seat.querySelector('.seat__money')!.hasAttribute('data-digits')).toBe(false)
    expect(seat.querySelector('.seat__fakt > span > b')!.textContent).toBe('FAKT 2')
    expect(seat.querySelector('.seat__other')!.textContent).toBe(`FAKT 1 109${S}800${S}000`)

    expect(seat.querySelector('.seat__left')!.textContent).toBe(`Ustozga 127${S}010${S}000 qoldi`)
    expect(seat.querySelector('.seat__left em')!.textContent).toBe(`127${S}010${S}000`)
    expect((seat.querySelector('.meter i') as HTMLElement).style.width).toBe('36.5%')

    // Tokcha: day-record (nodir) → clean-month, day-winner (gilt); first-sale tushadi.
    const rack = [...seat.querySelectorAll('.seat__rack svg.medal')]
    expect(rack.map((m) => m.getAttribute('data-medal'))).toEqual(['day-record', 'clean-month', 'day-winner'])
    expect(rack.map((m) => m.getAttribute('width'))).toEqual(['48', '48', '48'])
    expect(seat.querySelector('.seat__cap')!.textContent).toBe('Kun rekordi9-sentabr')
    expect(seat.querySelector('.seat__cap b')!.textContent).toBe('Kun rekordi')
    expect(seat.querySelector('.seat__cap i')!.textContent).toBe('9-sentabr')

    // Buyurtma soni, konversiya, birlik va «mln» o'rindiqda yo'q.
    expect(seat.textContent).not.toMatch(/mln|soʻm|so‘m|buyurtma|%/)
  })

  it('P2/P3: 56 px tanga dafnasiz, 18 px gerb, kumush / bronza metall', () => {
    const { container } = render(
      <>
        <SeatCard {...SEAT} rank={2} place={2} medal={row()} />
        <SeatCard {...SEAT} rank={3} place={3} medal={row()} />
      </>,
    )
    const [p2, p3] = [...container.querySelectorAll('article.seat')]
    expect(p2!.getAttribute('data-metal')).toBe('silver')
    expect(p3!.getAttribute('data-metal')).toBe('bronze')
    const halo = p2!.querySelector('svg.halo')!
    expect(halo.getAttribute('width')).toBe('56')
    expect([...halo.querySelectorAll('use')].map((u) => u.getAttribute('href'))).toEqual(['#halo-2'])
    expect(p3!.querySelector('svg.crest')!.getAttribute('height')).toBe('18')
  })

  it('teng rank: 2-o‘rindiqdagi 1-rank oltin tanga va oltin metall oladi', () => {
    const { container } = render(<SeatCard {...SEAT} rank={1} place={2} medal={row()} />)
    const seat = container.querySelector('article.seat.seat--2')!
    expect(seat.getAttribute('data-metal')).toBe('gold')
    expect([...seat.querySelectorAll('svg.halo use')].map((u) => u.getAttribute('href'))).toEqual(['#halo-1'])
  })
})

describe('SeatCard — ism uch shaklda (parseSellerName)', () => {
  it('Familiya Kod Ism → Familiya / Ism Kod', () => {
    const { container } = render(<SeatCard {...SEAT} medal={null} />)
    expect(nameLines(container)).toEqual(['Shahtiyarovna', 'Marjona 197'])
    expect(container.querySelector('.code')!.textContent).toBe('197')
  })

  it('Kod Ism Familiya → Ism / Familiya Kod', () => {
    const { container } = render(<SeatCard {...SEAT} name="268 Ozoda Yuldosheva" medal={null} />)
    expect(nameLines(container)).toEqual(['Ozoda', 'Yuldosheva 268'])
    expect(container.querySelector('.code')!.textContent).toBe('268')
  })

  it('kodsiz ism — kod tokeni yo‘q; bitta so‘z — ikkinchi qator yo‘q; faqat raqam — ism o‘zi', () => {
    const { container, rerender } = render(<SeatCard {...SEAT} name="Содиков Мурод" medal={null} />)
    expect(nameLines(container)).toEqual(['Содиков', 'Мурод'])
    expect(container.querySelector('.code')).toBeNull()

    rerender(<SeatCard {...SEAT} name="Karimova" medal={null} />)
    expect(nameLines(container)).toEqual(['Karimova'])

    rerender(<SeatCard {...SEAT} name="197" medal={null} />)
    expect(nameLines(container)).toEqual(['197'])
    expect(container.querySelector('.code')).toBeNull()

    // Bitta so'z + kod — kod ikkinchi qatorda yolg'iz.
    rerender(<SeatCard {...SEAT} name="154 Marjona" medal={null} />)
    expect(nameLines(container)).toEqual(['Marjona', '154'])
    // data-seat-name xom ismda qoladi.
    expect(container.querySelector('article.seat')!.getAttribute('data-seat-name')).toBe('154 Marjona')
  })

  /*
    1366 AUDITI (2026-09-17): tor o'rindiqda ikkinchi qator bitta ellipsisli span
    edi — «Davlatbek 11…», «Niginabon…», kod yarmida kesilgan. Endi ikkinchi qator
    o'raladigan uya: ism (`.nm`) va kod (`.code`) ALOHIDA bolalar, kod sig'masa
    butunlay yashirin qatorga tushadi (CSS `efirCss`/`tvBoardLayout` pinlaydi).
  */
  it('ikkinchi qator: ism va kod alohida bolalar — kod ismdan oldin tushadi', () => {
    const { container, rerender } = render(<SeatCard {...SEAT} name="Sirojov 115 Davlatbek" medal={null} />)
    const line = container.querySelector('.seat__name > .seat__name2')!
    expect([...line.children].map((c) => c.className)).toEqual(['nm', 'code'])
    expect(line.querySelector('.nm')!.textContent).toBe('Davlatbek')
    expect(line.textContent).toBe('Davlatbek 115')

    rerender(<SeatCard {...SEAT} name="154 Marjona" medal={null} />)
    expect([...container.querySelector('.seat__name2')!.children].map((c) => c.className)).toEqual(['code'])
  })
})

describe('SeatCard — pul va FAKT qatori', () => {
  it('o‘rindiqning textContent i qahramon raqamni AYNAN bir marta tashiydi', () => {
    const { container } = render(<SeatCard {...SEAT} medal={row({ medals: [medal({ code: 'jump' })] })} />)
    const text = container.querySelector('article.seat')!.textContent!
    const hero = `79${S}600${S}000`
    expect(text.split(hero)).toHaveLength(2)
    // Pul uyasi bitta matn tuguni.
    const money = container.querySelector('.seat__money span')!
    expect(money.childNodes).toHaveLength(1)
    expect(money.firstChild!.nodeType).toBe(Node.TEXT_NODE)
  })

  it('boshqa fakt 0 bo‘lsa uning yarmi chizilmaydi — FAKT yorlig‘i qoladi', () => {
    const { container } = render(<SeatCard {...SEAT} ordered={0} medal={row()} />)
    expect(container.querySelector('.seat__other')).toBeNull()
    expect(container.querySelector('.seat__fakt')!.textContent).toBe('FAKT 2')
  })

  it('FAKT 1 rejimida raqam va yorliqlar almashadi', () => {
    const { container } = render(<SeatCard {...SEAT} onDelivered={false} medal={row()} />)
    expect(container.querySelector('.seat__money')!.textContent).toBe(`109${S}800${S}000`)
    expect(container.querySelector('.seat__fakt > span > b')!.textContent).toBe('FAKT 1')
    expect(container.querySelector('.seat__other')!.textContent).toBe(`FAKT 2 79${S}600${S}000`)
  })

  it('9 va 10 xonali raqam `data-digits` oladi (torroq `cqi` — kesilmaydi)', () => {
    const { container, rerender } = render(<SeatCard {...SEAT} won={172_990_000} medal={null} />)
    expect(container.querySelector('.seat__money')!.getAttribute('data-digits')).toBe('9')
    rerender(<SeatCard {...SEAT} won={1_298_091_698} medal={null} />)
    expect(container.querySelector('.seat__money')!.getAttribute('data-digits')).toBe('10')
    rerender(<SeatCard {...SEAT} won={99_999_999} medal={null} />)
    expect(container.querySelector('.seat__money')!.hasAttribute('data-digits')).toBe(false)
  })
})

describe('SeatCard — progress va «Avgustdan beri»', () => {
  it('«Avgustdan beri {delivered} / {nextLevelAt}» medal qatoridan, to‘liq so‘mda', () => {
    const { container } = render(<SeatCard {...SEAT} medal={row()} />)
    const life = container.querySelector('.seat__life')!
    expect(life.textContent).toBe(`Avgustdan beri172${S}990${S}000 / 300${S}000${S}000`)
    expect(life.querySelector('em')!.textContent).toBe(`172${S}990${S}000`)
    expect(life.children[0]!.textContent).toBe('Avgustdan beri')
    expect(life.children[1]!.textContent).toBe(`172${S}990${S}000 / 300${S}000${S}000`)
  })

  it('Legenda: keyingi milliardgacha', () => {
    const { container } = render(
      <SeatCard
        {...SEAT}
        medal={row({
          level: 6,
          legendaTier: 1,
          rankTitle: 'Legenda',
          delivered: uzs(1_413_000_000),
          levelFloor: uzs(1_000_000_000),
          nextLevelAt: uzs(2_000_000_000),
          nextTitle: 'Legenda II',
        })}
      />,
    )
    expect(container.querySelector('.seat__life')!.textContent).toBe(
      `Avgustdan beri1${S}413${S}000${S}000 / 2${S}000${S}000${S}000`,
    )
    expect(container.querySelector('.seat__left')!.textContent).toBe(`Legenda II ga 587${S}000${S}000 qoldi`)
  })

  it('ostonadan oshgan lahza — qalin «0» emas, xira chiziqcha', () => {
    const { container } = render(<SeatCard {...SEAT} medal={row({ delivered: uzs(400_000_000) })} />)
    const em = container.querySelector('.seat__left em')!
    expect(em.textContent).toBe('—')
    expect(em.classList.contains('seat__none')).toBe(true)
    expect((container.querySelector('.meter i') as HTMLElement).style.width).toBe('100%')
  })

  it('0-daraja: gerb bo‘sh, so‘z yo‘q, «Birinchi savdo kutilmoqda», «Avgustdan beri» yo‘q, tokcha yo‘q', () => {
    const { container } = render(<SeatCard {...SEAT} medal={ZERO} />)
    const seat = container.querySelector('article.seat')!
    expect(seat.getAttribute('data-tier')).toBe('0')
    expect(seat.querySelector('svg.crest use[href="#crest-0"]')).not.toBeNull()
    expect(seat.querySelector('.lvl')).toBeNull()
    expect(seat.querySelector('.seat__left')!.textContent).toBe('Birinchi savdo kutilmoqda')
    expect((seat.querySelector('.meter i') as HTMLElement).style.width).toBe('0%')
    expect(seat.querySelector('.seat__life')).toBeNull()
    expect(seat.querySelector('.seat__rack')).toBeNull()
  })

  it('medal qatori kelmagan (yuklanish): tanga, ism, komanda, pul — gerb, progress, tokcha yo‘q', () => {
    const { container } = render(<SeatCard {...SEAT} medal={null} />)
    const seat = container.querySelector('article.seat')!
    expect(seat.getAttribute('data-tier')).toBe('0')
    expect(seat.querySelector('.halo')).not.toBeNull()
    expect(seat.querySelector('.team')!.textContent).toBe('Marjona')
    expect(seat.querySelector('.seat__money')).not.toBeNull()
    expect(seat.querySelector('.crest')).toBeNull()
    expect(seat.querySelector('.seat__prog')).toBeNull()
    expect(seat.querySelector('.seat__rack')).toBeNull()
  })

  it('komandasiz sotuvchi komanda uyasini chizmaydi; gerb va so‘z o‘z joyida', () => {
    const { container } = render(<SeatCard {...SEAT} team={null} medal={row()} />)
    expect(container.querySelector('.team')).toBeNull()
    expect(container.querySelector('.seat__meta svg.crest')).not.toBeNull()
    expect(container.querySelector('.seat__meta .lvl')!.textContent).toBe('Usta')
  })
})

describe('SeatCard — tokcha', () => {
  const many = [
    medal({ code: 'work-month' }),
    medal({ code: 'rookie' }),
    medal({ code: 'jump', count: 2 }),
    medal({ code: 'clean-month' }),
    medal({ code: 'month-silver', count: 3 }),
    medal({ code: 'streak-fire' }),
    medal({ code: 'first-sale' }),
  ]

  it('P1: eng ko‘pi 4 ta, 48 px; P2/P3: eng ko‘pi 3 ta, 40 px; seat + count uzatiladi', () => {
    const { container } = render(
      <>
        <SeatCard {...SEAT} medal={row({ medals: many })} />
        <SeatCard {...SEAT} rank={2} place={2} medal={row({ medals: many })} />
      </>,
    )
    const [p1, p2] = [...container.querySelectorAll('article.seat')]
    const r1 = [...p1!.querySelectorAll('.seat__rack svg.medal')]
    expect(r1.map((m) => m.getAttribute('data-medal'))).toEqual(['month-silver', 'streak-fire', 'clean-month', 'jump'])
    expect(r1.map((m) => m.getAttribute('width'))).toEqual(['48', '48', '48', '48'])
    const r2 = [...p2!.querySelectorAll('.seat__rack svg.medal')]
    expect(r2.map((m) => m.getAttribute('data-medal'))).toEqual(['month-silver', 'streak-fire', 'clean-month'])
    expect(r2.map((m) => m.getAttribute('width'))).toEqual(['40', '40', '40'])
    // Oy medali o'rindiqda dafna oladi; ×N plastinkasi SVG ichida.
    expect(r2[0]!.querySelector('use')!.getAttribute('href')).toBe('#m-laurel-silver')
    expect(r2[0]!.getAttribute('aria-label')).toBe('Kumush oy ×3')
    expect(r2[0]!.querySelector('rect.medal__plate-rim')).not.toBeNull()
    expect(r1[3]!.getAttribute('aria-label')).toBe('Sakrash ×2')
    // «+N» yo'q.
    expect(container.textContent).not.toMatch(/\+\d/)
  })

  it('izoh: eng yuqori medal nomi ×N bilan va oyi — «hozircha» hech qachon', () => {
    const { container } = render(<SeatCard {...SEAT} medal={row({ medals: many })} />)
    expect(container.querySelector('.seat__cap b')!.textContent).toBe('Kumush oy ×3')
    expect(container.querySelector('.seat__cap i')!.textContent).toBe('avgust')
    expect(container.textContent).not.toMatch(/hozircha/)
  })

  it('×N faqat o‘rindiqda: tokchada bitta ×1 medal — plastinka yo‘q, aria sanoqsiz', () => {
    const { container } = render(<SeatCard {...SEAT} medal={row({ medals: [medal({ code: 'month-bronze' })] })} />)
    const m = container.querySelector('.seat__rack svg.medal')!
    expect(m.getAttribute('aria-label')).toBe('Bronza oy')
    expect(m.querySelector('rect')).toBeNull()
    expect(container.querySelector('.seat__cap b')!.textContent).toBe('Bronza oy')
  })

  it('medalsiz — tokcha yo‘q, progress bor', () => {
    const { container } = render(<SeatCard {...SEAT} medal={row({ medals: [] })} />)
    expect(container.querySelector('.seat__rack')).toBeNull()
    expect(container.querySelector('.seat__prog')).not.toBeNull()
  })

  it('rise — gerbning eng yangi katakchasi to‘ladi; yangi medal sinfi', () => {
    const { container } = render(
      <SeatCard {...SEAT} rise medal={row({ medals: [medal({ code: 'jump' })] })} newKeys={new Set(['jump'])} />,
    )
    expect(container.querySelectorAll('use.crest__cell--fill')).toHaveLength(1)
    expect(container.querySelector('.seat__rack svg.medal--new[data-medal="jump"]')).not.toBeNull()
  })

  it('medalWhen: kun medali kun bilan, yil chempioni yil, qolgani oy; null — sanasiz', () => {
    expect(medalWhen(medal({ code: 'day-winner', at: '2026-09-05' }))).toBe('5-sentabr')
    expect(medalWhen(medal({ code: 'day-record', at: '2026-08-21' }))).toBe('21-avgust')
    expect(medalWhen(medal({ code: 'month-gold', at: '2026-08-01' }))).toBe('avgust')
    expect(medalWhen(medal({ code: 'year-champion', at: '2026-12-01' }))).toBe('2026')
    expect(medalWhen(medal({ code: 'jump', at: null }))).toBeNull()
    const { container } = render(<SeatCard {...SEAT} medal={row({ medals: [medal({ code: 'jump', at: null })] })} />)
    expect(container.querySelector('.seat__cap i')).toBeNull()
  })
})
