// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Crest } from '@/features/sellers/Crest'
import { Halo, metalOfRank } from '@/features/sellers/Halo'
import { MedalDefs } from '@/features/sellers/MedalDefs'
import { MedalMark } from '@/features/sellers/MedalMark'
import { TierLegend } from '@/features/sellers/TierLegend'
import { RowMedals } from '@/features/sellers/RowMedals'
import { SeatCard, splitSeatName } from '@/features/sellers/SeatCard'
import {
  HIDDEN_IN_ROWS,
  LADDER,
  MEDALS,
  MEDAL_ORDER,
  MEDAL_SYMBOL,
  MONTH_NUMERAL,
  RARE_MEDALS,
  metalOfMedal,
  nextLevelSentence,
  progressOf,
  sortMedals,
  thresholdSomOf,
} from '@/features/sellers/medalCatalog'
import type { SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { NARROW_NBSP } from '@/lib/format'

/**
 * EFIR belgilari (spec §2, §3): gerb — olti chevron, daraja `--tier` orqali;
 * medal — bitta metall, gravyura; halqa — rank raqami metallda; legenda —
 * olti pog'ona to'liq so'mda. Bu yerda faqat komponentlar; taxtaga ulanish
 * `sellersTvBoard.test.tsx` da.
 */
const S = NARROW_NBSP

/*
  jsdom da `matchMedia` yo'q; `AnimatedNumber` (o'rindiq raqami) uni chaqiradi.
  Kamaytirilgan harakat «ha»: raqam bir marta yakuniy qiymatini yozadi.
*/
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
  delivered: uzs(173_000_000),
  levelFloor: uzs(100_000_000),
  nextLevelAt: uzs(300_000_000),
  nextTitle: 'Ustoz',
  promotedOn: null,
  medals: [],
  ...over,
})

const ZERO = row({ level: 0, rankTitle: null, delivered: uzs(0), levelFloor: uzs(0), nextLevelAt: uzs(0.01), nextTitle: 'Yangi' })
const LEGENDA = row({
  level: 6,
  legendaTier: 1,
  rankTitle: 'Legenda',
  delivered: uzs(1_413_000_000),
  levelFloor: uzs(1_000_000_000),
  nextLevelAt: uzs(2_000_000_000),
  nextTitle: 'Legenda II',
})

/** Mock'dagi chempion — «Shahtiyarovna 197 Marjona», FAKT 2 79 600 000, FAKT 1 103 200 000. */
const SEAT = {
  rank: 1,
  place: 1 as const,
  name: 'Shahtiyarovna 197 Marjona',
  team: 'Marjona',
  won: 79_600_000,
  ordered: 103_200_000,
  onDelivered: true,
}

describe('MedalDefs — sahifaga bir marta o‘rnatiladigan belgilar to‘plami', () => {
  it('#ch chevroni va 12 ta #m-* belgisi — 14 kod uchun (Oy oilasi bitta diskni bo‘lishadi)', () => {
    const { container } = render(<MedalDefs />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('path#ch')).not.toBeNull()
    expect(container.querySelector('path#ch')!.getAttribute('d')).toBe('M0 0H7L12 10L7 20H0L5 10Z')
    const ids = new Set(Object.values(MEDAL_SYMBOL))
    expect(ids.size).toBe(12)
    for (const id of ids) expect(container.querySelector(`symbol#${id}`), id).not.toBeNull()
    expect(container.querySelectorAll('symbol')).toHaveLength(12)
    // Eski lavha va lentali medal belgilari yo'q.
    expect(container.querySelector('#khatam')).toBeNull()
    expect(container.querySelector('#medal-month-gold')).toBeNull()
  })
})

describe('Crest — gerb', () => {
  it('yoniq katakchalar soni = daraja; qolganlari o‘chiq; data-tier va aria', () => {
    const { container } = render(<Crest level={4} size="row" />)
    const svg = container.querySelector('svg.crest.crest--row')!
    expect(svg.getAttribute('data-tier')).toBe('4')
    expect(svg.getAttribute('viewBox')).toBe('0 -1 66 22')
    expect(svg.querySelectorAll('use[href="#ch"]')).toHaveLength(6)
    expect(svg.querySelectorAll('use.on')).toHaveLength(4)
    expect(svg.querySelectorAll('use.off')).toHaveLength(2)
    expect(svg.getAttribute('aria-label')).toBe('4-daraja · Usta')
    expect(svg.querySelector('.crest__crown')).toBeNull()
  })

  it('katakchalar x = 0/11/22/33/44/55', () => {
    const { container } = render(<Crest level={2} size="row" />)
    expect([...container.querySelectorAll('use')].map((u) => u.getAttribute('x'))).toEqual([
      '0', '11', '22', '33', '44', '55',
    ])
  })

  it('o‘lchamlar: qator 60×20, o‘rindiq 78×26, legenda 42×14', () => {
    const { container } = render(
      <>
        <Crest level={1} size="row" />
        <Crest level={1} size="seat" />
        <Crest level={1} size="legend" />
      </>,
    )
    const [row, seat, legend] = container.querySelectorAll('svg.crest')
    expect([row!.getAttribute('width'), row!.getAttribute('height')]).toEqual(['60', '20'])
    expect([seat!.getAttribute('width'), seat!.getAttribute('height')]).toEqual(['78', '26'])
    expect([legend!.getAttribute('width'), legend!.getAttribute('height')]).toEqual(['42', '14'])
    expect(seat!.classList.contains('crest--seat')).toBe(true)
  })

  it('Legenda: oltita yoniq va oltinchi katakcha ustida toj; Legenda II aria', () => {
    const { container } = render(<Crest level={6} legendaTier={2} size="seat" />)
    const svg = container.querySelector('svg.crest')!
    expect(svg.querySelectorAll('use.on')).toHaveLength(6)
    expect(svg.querySelector('path.crest__crown')).not.toBeNull()
    expect(svg.getAttribute('aria-label')).toBe('6-daraja · Legenda II')
  })

  it('0-daraja: hammasi o‘chiq, data-tier="0", «Hali darajasiz»', () => {
    const { container } = render(<Crest level={0} size="row" />)
    const svg = container.querySelector('svg.crest')!
    expect(svg.getAttribute('data-tier')).toBe('0')
    expect(svg.querySelectorAll('use.on')).toHaveLength(0)
    expect(svg.querySelectorAll('use.off')).toHaveLength(6)
    expect(svg.getAttribute('aria-label')).toBe('Hali darajasiz')
  })

  it('animate — faqat ENG YANGI katakcha to‘lish sinfini oladi', () => {
    const { container } = render(<Crest level={4} size="seat" animate />)
    const fills = container.querySelectorAll('use.crest__cell--fill')
    expect(fills).toHaveLength(1)
    expect(fills[0]!.getAttribute('x')).toBe('33')
    expect(fills[0]!.classList.contains('on')).toBe(true)
  })
})

describe('MedalMark — bitta medal', () => {
  it('kod data-medal da, belgi href da, metall data-metal da; nomi bir marta', () => {
    const { container } = render(<MedalMark code="streak-fire" />)
    const svg = container.querySelector('svg.medal')!
    expect(svg.getAttribute('data-medal')).toBe('streak-fire')
    expect(svg.getAttribute('data-metal')).toBe('gold')
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('width')).toBe('24')
    expect(svg.querySelector('use')!.getAttribute('href')).toBe('#m-fire')
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Olov seriyasi')
    expect(svg.querySelector('text')).toBeNull()
    expect(container.querySelector('.medal-count')).toBeNull()
  })

  it('Oy oilasi: bitta disk, o‘yma 1/2/3 raqami, o‘z metalli', () => {
    const { container } = render(
      <>
        <MedalMark code="month-gold" />
        <MedalMark code="month-silver" />
        <MedalMark code="month-bronze" />
      </>,
    )
    const [g, s, b] = container.querySelectorAll('svg.medal')
    for (const m of [g, s, b]) expect(m!.querySelector('use')!.getAttribute('href')).toBe('#m-month')
    expect(g!.querySelector('text.medal__num')!.textContent).toBe('1')
    expect(s!.querySelector('text.medal__num')!.textContent).toBe('2')
    expect(b!.querySelector('text.medal__num')!.textContent).toBe('3')
    expect(g!.querySelector('text')!.getAttribute('text-anchor')).toBe('middle')
    expect([g, s, b].map((m) => m!.getAttribute('data-metal'))).toEqual(['gold', 'silver', 'bronze'])
    expect(g!.getAttribute('aria-label')).toBe('Oy chempioni')
  })

  it('×N faqat count > 1 da, svg TASHQARISIDA; aria nomga ×N qo‘shadi', () => {
    const { container, rerender } = render(<MedalMark code="day-winner" count={4} />)
    const group = container.querySelector('.medal-group')!
    expect(group.querySelector('svg.medal')).not.toBeNull()
    expect(group.querySelector('b.medal-count')!.textContent).toBe('×4')
    expect(group.querySelector('svg .medal-count')).toBeNull()
    expect(group.querySelector('svg')!.getAttribute('aria-label')).toBe('Kun gʻolibi ×4')
    rerender(<MedalMark code="day-winner" count={1} />)
    expect(container.querySelector('.medal-group')).toBeNull()
    expect(container.querySelector('.medal-count')).toBeNull()
  })

  it('nodir yettilik `rare` sinfini oladi, qolganlari olmaydi', () => {
    const { container } = render(
      <>
        <MedalMark code="day-record" />
        <MedalMark code="work-month" />
      </>,
    )
    const [rare, plain] = container.querySelectorAll('svg.medal')
    expect(rare!.classList.contains('rare')).toBe(true)
    expect(plain!.classList.contains('rare')).toBe(false)
  })

  it('yangi medal sinfi va o‘lcham', () => {
    const { container } = render(<MedalMark code="jump" isNew size={32} />)
    const svg = container.querySelector('svg.medal')!
    expect(svg.classList.contains('medal--new')).toBe(true)
    expect(svg.getAttribute('height')).toBe('32')
  })
})

describe('Halo — rank halqasi', () => {
  it('raqam, o‘lcham sinfi va metall: 1 oltin, 2 kumush, 3 bronza, qolgani none', () => {
    const { container } = render(
      <>
        <Halo rank={1} size="lg" />
        <Halo rank={2} size="md" />
        <Halo rank={3} size="md" />
        <Halo rank={7} size="md" />
      </>,
    )
    const halos = [...container.querySelectorAll('.halo')]
    expect(halos.map((h) => h.textContent)).toEqual(['1', '2', '3', '7'])
    expect(halos.map((h) => h.getAttribute('data-metal'))).toEqual(['gold', 'silver', 'bronze', 'none'])
    expect(halos[0]!.classList.contains('halo--lg')).toBe(true)
    expect(halos[1]!.classList.contains('halo--md')).toBe(true)
    expect(metalOfRank(2)).toBe('silver')
  })
})

/*
  LEGENDA BIR QATOR BO‘LISHI KERAK, VA U YAGONA JOY BO‘LIB QOLADI
  QAYERDA OSTONA QISQA YOZILADI.

  Spec §1 butun sahifada to‘liq so‘mni talab qiladi, §2 esa kalitning o‘zi
  uchun istisno qiladi: 1920 da ustun ichi 1053 px, to‘liq so‘mli kalit esa
  ~1154 px — ya'ni ikkinchi qator, ya'ni narvon cho‘qqisi ko‘zdan pastda.
  Shuning uchun bu yerda `thresholdLabel` («10 mln» … «1 mlrd») chiziladi,
  Yangi pog‘onasida esa hech narsa (uning ostonasi — «birinchi so‘m»), va
  sarlavha yo‘q. Test IKKALA tomonni ham ushlaydi: yorliqlar katalogdan
  keladi, va kalitda TO‘LIQ SO‘M RAQAMI umuman uchramaydi — aks holda
  birov qisqartirishni «tuzatib», qatorni yana o‘rab qo‘yadi.
*/
describe('TierLegend — 28 px kalit qatori', () => {
  it('olti pog‘ona, so‘z va qisqa ostona; Yangi yorliqsiz; sarlavhasiz; Legendada toj', () => {
    const { container } = render(<TierLegend />)
    const rungs = container.querySelectorAll('.legend__rung')
    expect(rungs).toHaveLength(6)
    expect([...rungs].map((r) => r.querySelector('b')!.textContent)).toEqual([
      'Yangi', 'Sotuvchi', 'Katta sotuvchi', 'Usta', 'Ustoz', 'Legenda',
    ])
    // Yangi — yorliq elementi YO‘Q; qolgan beshtasi katalogning o‘z yorlig‘i.
    expect(rungs[0]!.querySelector('i')).toBeNull()
    for (let i = 1; i <= 5; i += 1) {
      expect(rungs[i]!.querySelector('i')!.textContent).toBe(LADDER[i]!.thresholdLabel)
    }
    expect(rungs[5]!.querySelector('i')!.textContent).toBe('1 mlrd')
    expect(rungs[5]!.querySelector('svg.crest--legend')!.getAttribute('data-tier')).toBe('6')
    expect(rungs[5]!.querySelector('.crest__crown')).not.toBeNull()
    expect(rungs[3]!.querySelectorAll('use.on')).toHaveLength(4)
    expect(container.querySelector('.tv-legend')!.getAttribute('role')).toBe('list')
    // Sarlavha yo‘q — na element, na so‘z.
    expect(container.querySelector('.tv-legend__title')).toBeNull()
    expect(screen.queryByText('Daraja')).toBeNull()
    // Va kalitda to‘liq so‘m raqami yo‘q (`79 600 000` shakli).
    expect(container.textContent).not.toMatch(new RegExp(`\\d{1,3}(${S}\\d{3}){2,}`))
  })
})

describe('katalog', () => {
  it('14 kod, tartib motor bilan bir xil; belgi va nom hammasida', () => {
    expect(MEDAL_ORDER).toHaveLength(14)
    for (const code of MEDAL_ORDER) {
      expect(MEDALS[code].name).toBeTruthy()
      expect(MEDAL_SYMBOL[code]).toMatch(/^m-[a-z]+$/)
    }
  })

  it('nodir yettilik, qatorda yashirin first-sale, Oy raqamlari, metall', () => {
    expect([...RARE_MEDALS].sort()).toEqual([
      'conversion-master', 'day-record', 'month-bronze', 'month-gold', 'month-silver', 'streak-fire', 'year-champion',
    ])
    expect(HIDDEN_IN_ROWS).toEqual(['first-sale'])
    expect(MONTH_NUMERAL).toEqual({ 'month-gold': '1', 'month-silver': '2', 'month-bronze': '3' })
    expect(metalOfMedal('month-silver')).toBe('silver')
    expect(metalOfMedal('month-bronze')).toBe('bronze')
    expect(metalOfMedal('year-champion')).toBe('gold')
    expect(metalOfMedal('first-sale')).toBe('gold')
  })

  it('narvon ostonalari so‘mda; Legenda bosqichi milliardlab', () => {
    expect(LADDER.map((r) => r.thresholdSom)).toEqual([
      null, 10_000_000, 30_000_000, 100_000_000, 300_000_000, 1_000_000_000,
    ])
    expect(thresholdSomOf(4, 0)).toBe(100_000_000)
    expect(thresholdSomOf(1, 0)).toBeNull()
    expect(thresholdSomOf(6, 1)).toBe(1_000_000_000)
    expect(thresholdSomOf(6, 2)).toBe(2_000_000_000)
  })

  it('sortMedals — MEDAL_ORDER bo‘yicha, yashirinlar filtrlanadi, kirish o‘zgarmaydi', () => {
    const m = (code: SellerMedalDto['code']): SellerMedalDto => ({
      code, count: 1, at: null, amount: null, orders: null, percent: null,
    })
    const input = [m('first-sale'), m('day-winner'), m('month-gold'), m('clean-month')]
    const sorted = sortMedals(input, HIDDEN_IN_ROWS)
    expect(sorted.map((x) => x.code)).toEqual(['month-gold', 'clean-month', 'day-winner'])
    expect(sortMedals(input).map((x) => x.code)).toEqual(['month-gold', 'clean-month', 'day-winner', 'first-sale'])
    expect(input[0]!.code).toBe('first-sale')
  })
})

describe('splitSeatName — ism ikki qatorga', () => {
  it('Familiya Raqam Ism → Familiya / Raqam Ism', () => {
    expect(splitSeatName('Shahtiyarovna 197 Marjona')).toEqual(['Shahtiyarovna', '197 Marjona'])
  })

  it('Raqam Ism Familiya → Raqam Ism / Familiya', () => {
    expect(splitSeatName('268 Ozoda Yuldosheva')).toEqual(['268 Ozoda', 'Yuldosheva'])
  })

  it('boshqa shakllar: birinchi so‘z / qolgani; bitta so‘z — ikkinchi qator bo‘sh', () => {
    expect(splitSeatName('Karimova Aziza Botirovna')).toEqual(['Karimova', 'Aziza Botirovna'])
    expect(splitSeatName('Karimova')).toEqual(['Karimova', ''])
    expect(splitSeatName('154')).toEqual(['154', ''])
    expect(splitSeatName('  Ali   Valiyev ')).toEqual(['Ali', 'Valiyev'])
  })
})

describe('progressOf va nextLevelSentence — to‘liq so‘m', () => {
  it('173 mln Usta → 0,365; «Ustozga 127 000 000 qoldi»', () => {
    expect(progressOf(row())).toBeCloseTo(0.365, 3)
    expect(nextLevelSentence(row())).toBe(`Ustozga 127${S}000${S}000 qoldi`)
  })

  it('qisish: 0,03 dan kam emas, 1 dan ko‘p emas; oshib ketgan — nol qoldi, manfiy emas', () => {
    expect(progressOf(row({ delivered: uzs(100_100_000) }))).toBe(0.03)
    expect(progressOf(row({ delivered: uzs(400_000_000) }))).toBe(1)
    expect(nextLevelSentence(row({ delivered: uzs(400_000_000) }))).toBe('Ustozga 0 qoldi')
  })

  it('0-daraja — bo‘sh yo‘l va «Birinchi savdo kutilmoqda»', () => {
    expect(progressOf(ZERO)).toBe(0)
    expect(nextLevelSentence(ZERO)).toBe('Birinchi savdo kutilmoqda')
  })

  it('Legenda: «Legenda II ga 587 000 000 qoldi»', () => {
    expect(nextLevelSentence(LEGENDA)).toBe(`Legenda II ga 587${S}000${S}000 qoldi`)
  })
})

describe('SeatCard — o‘rindiq (spec §4)', () => {
  it('halqa, ikki qatorli ism, komanda · gerb · so‘z, raqam, FAKT 1 satri, progress, medallar ×N bilan', () => {
    const { container } = render(
      <SeatCard
        {...SEAT}
        medal={row({
          medals: [medal({ code: 'day-winner', count: 4 }), medal({ code: 'first-sale' }), medal({ code: 'day-record' })],
        })}
      />,
    )
    const seat = container.querySelector('article.seat.seat--1')!
    expect(seat.getAttribute('data-tier')).toBe('4')
    expect(seat.getAttribute('data-seat-name')).toBe('Shahtiyarovna 197 Marjona')
    expect(seat.getAttribute('aria-label')).toBe('1-oʻrin')
    expect(seat.querySelector('.halo.halo--lg')!.textContent).toBe('1')
    expect([...seat.querySelectorAll('.seat__name span')].map((s) => s.textContent)).toEqual([
      'Shahtiyarovna',
      '197 Marjona',
    ])
    expect(seat.querySelector('.seat__team')!.textContent).toBe('Marjona')
    expect(seat.querySelector('svg.crest--seat')!.getAttribute('data-tier')).toBe('4')
    expect(seat.querySelectorAll('.seat__level')).toHaveLength(1)
    expect(seat.querySelector('.seat__level')!.textContent).toBe('Usta')
    expect(seat.querySelector('.seat__figure')!.textContent).toContain(`79${S}600${S}000`)
    expect(seat.querySelector('.seat__cap')!.textContent).toBe('FAKT 2')
    expect(seat.querySelector('.seat__other')!.textContent).toBe(`FAKT 1 103${S}200${S}000`)
    expect((seat.querySelector('.seat__bar i') as HTMLElement).style.width).toBe('36.5%')
    expect(seat.querySelector('.seat__next')!.textContent).toBe(`Ustozga 127${S}000${S}000 qoldi`)
    // MEDAL_ORDER bo'yicha: day-record, day-winner ×4, first-sale — O'RINDIQDA first-sale BOR.
    expect([...seat.querySelectorAll('.seat__medals svg.medal')].map((m) => m.getAttribute('data-medal'))).toEqual([
      'day-record',
      'day-winner',
      'first-sale',
    ])
    expect(seat.querySelectorAll('.medal-count')).toHaveLength(1)
    expect(seat.querySelector('.medal-count')!.textContent).toBe('×4')
    // Buyurtma soni, konversiya, birlik va «mln» o'rindiqda yo'q.
    expect(seat.textContent).not.toMatch(/mln|soʻm|so‘m|buyurtma|%/)
  })

  it('2- va 3-o‘rin: kichik halqa', () => {
    const { container } = render(<SeatCard {...SEAT} rank={2} place={2} medal={row()} />)
    expect(container.querySelector('.seat--2 .halo--md')!.textContent).toBe('2')
    expect(container.querySelector('.halo--lg')).toBeNull()
  })

  it('FAKT 1 rejimida raqam va yorliqlar almashadi', () => {
    const { container } = render(<SeatCard {...SEAT} onDelivered={false} medal={row()} />)
    expect(container.querySelector('.seat__figure')!.textContent).toContain(`103${S}200${S}000`)
    expect(container.querySelector('.seat__cap')!.textContent).toBe('FAKT 1')
    expect(container.querySelector('.seat__other')!.textContent).toBe(`FAKT 2 79${S}600${S}000`)
  })

  it('boshqa fakt nol bo‘lsa uning satri chizilmaydi', () => {
    const { container } = render(<SeatCard {...SEAT} ordered={0} medal={row()} />)
    expect(container.querySelector('.seat__other')).toBeNull()
    expect(container.querySelector('.seat__cap')!.textContent).toBe('FAKT 2')
  })

  it('progress qisiladi: 3,0 % va 100,0 %', () => {
    const { container, rerender } = render(<SeatCard {...SEAT} medal={row({ delivered: uzs(100_100_000) })} />)
    expect((container.querySelector('.seat__bar i') as HTMLElement).style.width).toBe('3%')
    rerender(<SeatCard {...SEAT} medal={row({ delivered: uzs(400_000_000) })} />)
    expect((container.querySelector('.seat__bar i') as HTMLElement).style.width).toBe('100%')
  })

  it('0-daraja: bo‘sh gerb, data-tier="0", bo‘sh yo‘l, so‘z yo‘q, «Birinchi savdo kutilmoqda»', () => {
    const { container } = render(<SeatCard {...SEAT} medal={ZERO} />)
    const seat = container.querySelector('article.seat')!
    expect(seat.getAttribute('data-tier')).toBe('0')
    expect(seat.querySelectorAll('svg.crest use.on')).toHaveLength(0)
    expect(seat.querySelector('.seat__level')).toBeNull()
    expect((seat.querySelector('.seat__bar i') as HTMLElement).style.width).toBe('0%')
    expect(seat.querySelector('.seat__next')!.textContent).toBe('Birinchi savdo kutilmoqda')
    expect(seat.querySelector('.seat__medals')).toBeNull()
  })

  it('Legenda II: so‘z, toj, jumla', () => {
    const { container } = render(<SeatCard {...SEAT} medal={{ ...LEGENDA, legendaTier: 2, rankTitle: 'Legenda II', nextTitle: 'Legenda III', nextLevelAt: uzs(3_000_000_000), levelFloor: uzs(2_000_000_000), delivered: uzs(2_413_000_000) }} />)
    const seat = container.querySelector('article.seat')!
    expect(seat.getAttribute('data-tier')).toBe('6')
    expect(seat.querySelector('.seat__level')!.textContent).toBe('Legenda II')
    expect(seat.querySelector('.crest__crown')).not.toBeNull()
    expect(seat.querySelector('.seat__next')!.textContent).toBe(`Legenda III ga 587${S}000${S}000 qoldi`)
  })

  it('medal qatori bo‘lmagan sotuvchi (yuklanish): faqat halqa, ism, komanda, raqam', () => {
    const { container } = render(<SeatCard {...SEAT} medal={null} />)
    const seat = container.querySelector('article.seat')!
    expect(seat.getAttribute('data-tier')).toBe('0')
    expect(seat.querySelector('.halo')).not.toBeNull()
    expect(seat.querySelector('.seat__name')).not.toBeNull()
    expect(seat.querySelector('.seat__team')!.textContent).toBe('Marjona')
    expect(seat.querySelector('.seat__figure')).not.toBeNull()
    expect(seat.querySelector('.crest')).toBeNull()
    expect(seat.querySelector('.seat__level')).toBeNull()
    expect(seat.querySelector('.seat__prog')).toBeNull()
    expect(seat.querySelector('.seat__medals')).toBeNull()
  })

  /*
    Komandasiz sotuvchi — komanda uyasi YO‘Q, so‘z ham yo‘q. 308 px o‘rindiqda
    komanda · gerb · daraja so‘zi bir satrda turadi va qisqaradigan yagona uya
    komanda (`overflow: hidden`), yaʼni «komandasiz» gerb yonida «kom…» bo‘lib
    qolardi. Haqiqiy nom (≤ 10 harf) o‘z joyida chiziladi.
  */
  it('komandasiz sotuvchi komanda uyasini chizmaydi; medalsiz — medal qatori yo‘q, progress bor', () => {
    const { container, rerender } = render(<SeatCard {...SEAT} team={null} medal={row({ medals: [] })} />)
    expect(container.querySelector('.seat__team')).toBeNull()
    expect(container.querySelector('.seat__sub')!.textContent).not.toContain('komandasiz')
    // Gerb va daraja so'zi o'z joyida — satr bo'shab qolmaydi.
    expect(container.querySelector('.seat__sub svg.crest--seat')).not.toBeNull()
    expect(container.querySelector('.seat__level')!.textContent).toBe('Usta')
    expect(container.querySelector('.seat__prog')).not.toBeNull()
    expect(container.querySelector('.seat__medals')).toBeNull()
    rerender(<SeatCard {...SEAT} team="Sadriddin" medal={row({ medals: [] })} />)
    expect(container.querySelector('.seat__team')!.textContent).toBe('Sadriddin')
  })

  it('rise — gerbning eng yangi katakchasi to‘ladi; yangi medal sinfi', () => {
    const { container } = render(
      <SeatCard {...SEAT} rise medal={row({ medals: [medal({ code: 'jump' })] })} newKeys={new Set(['jump'])} />,
    )
    expect(container.querySelectorAll('use.crest__cell--fill')).toHaveLength(1)
    expect(container.querySelector('.seat__medals svg.medal--new[data-medal="jump"]')).not.toBeNull()
  })
})

describe('RowMedals — qator medallari (spec §3)', () => {
  const seven = [
    medal({ code: 'month-gold', count: 2 }),
    medal({ code: 'streak-fire' }),
    medal({ code: 'conversion-master' }),
    medal({ code: 'day-record' }),
    medal({ code: 'clean-month' }),
    medal({ code: 'day-winner', count: 5 }),
    medal({ code: 'first-sale' }),
  ]

  it('first-sale yashirin, MEDAL_ORDER bo‘yicha 3 ta, qolgani «+N», ×N yo‘q', () => {
    const { container } = render(<RowMedals medals={[...seven].reverse()} />)
    expect([...container.querySelectorAll('.row__medals svg.medal')].map((m) => m.getAttribute('data-medal'))).toEqual([
      'month-gold',
      'streak-fire',
      'conversion-master',
    ])
    expect(container.querySelector('.row__more')!.textContent).toBe('+3')
    expect(container.querySelector('.medal-count')).toBeNull()
    expect(container.querySelector('.medal-group')).toBeNull()
    expect(container.querySelector('svg[data-medal="month-gold"]')!.getAttribute('aria-label')).toBe('Oy chempioni')
  })

  it('uchta yoki kamroq — «+N» yo‘q', () => {
    const { container } = render(<RowMedals medals={seven.slice(0, 3)} />)
    expect(container.querySelectorAll('svg.medal')).toHaveLength(3)
    expect(container.querySelector('.row__more')).toBeNull()
  })

  it('faqat first-sale — uya bo‘sh, lekin konteyner grid uchun qoladi', () => {
    const { container } = render(<RowMedals medals={[medal({ code: 'first-sale' })]} />)
    expect(container.querySelector('.row__medals')).not.toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('.row__more')).toBeNull()
  })

  it('yangi medal sinfi — faqat o‘sha medalda', () => {
    const { container } = render(<RowMedals medals={seven} newKeys={new Set(['streak-fire'])} />)
    expect(container.querySelector('svg.medal--new[data-medal="streak-fire"]')).not.toBeNull()
    expect(container.querySelectorAll('.medal--new')).toHaveLength(1)
  })
})
