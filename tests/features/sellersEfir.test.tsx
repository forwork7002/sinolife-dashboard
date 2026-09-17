// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Crest } from '@/features/sellers/Crest'
import { Halo, metalOfRank } from '@/features/sellers/Halo'
import { MedalDefs } from '@/features/sellers/MedalDefs'
import { MedalMark } from '@/features/sellers/MedalMark'
import { TierLegend } from '@/features/sellers/TierLegend'
import { RowMedals } from '@/features/sellers/RowMedals'
import {
  HIDDEN_IN_ROWS,
  LADDER,
  MEDALS,
  MEDAL_METAL,
  MEDAL_ORDER,
  RARE_MEDALS,
  nextLevelSentence,
  progressOf,
  seatMedals,
  sortMedals,
  thresholdSomOf,
} from '@/features/sellers/medalCatalog'
import type { SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { NARROW_NBSP } from '@/lib/format'

/**
 * EFIR Premium «ZARB» belgilari (spec §3): gerb — bitta `#crest-N`, daraja
 * `--tier` orqali; medal — metall belgining ichida, o'rindiqda dafna va ×N
 * plastinkasi; tanga — zarb qilingan rank; legenda — olti pog'ona. Bu yerda
 * faqat komponentlar; taxtaga ulanish `sellersTvBoard.test.tsx` da.
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

describe('MedalDefs — sahifaga bir marta o‘rnatiladigan belgilar to‘plami', () => {
  it('bitta yashirin <svg>: 14 ta `m-<code>`, dafnalar, gerb 0…6, tangalar va #ch', () => {
    const { container } = render(<MedalDefs />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect((svg as unknown as HTMLElement).style.position).toBe('absolute')
    expect(container.querySelector('path#ch')!.getAttribute('d')).toBe('M0 0H7L12 10L7 20H0L5 10Z')
    for (const code of MEDAL_ORDER) expect(container.querySelector(`symbol#m-${code}`), code).not.toBeNull()
    for (const m of ['gold', 'silver', 'bronze']) expect(container.querySelector(`symbol#m-laurel-${m}`)).not.toBeNull()
    for (let n = 0; n <= 6; n += 1) expect(container.querySelector(`symbol#crest-${n}`)).not.toBeNull()
    for (const id of ['halo-1', 'halo-sm-3', 'halo-laurel', 'halo-ghost', 'crest-plate', 'crest-plate-6']) {
      expect(container.querySelector(`symbol#${id}`), id).not.toBeNull()
    }
    // Eski umumiy oy diski va lavha belgilari yo'q.
    expect(container.querySelector('#m-month')).toBeNull()
    expect(container.querySelector('#khatam')).toBeNull()
  })
})

describe('Crest — gerb', () => {
  it('bitta <use href="#crest-N">, data-tier va aria; viewBox 72×26; balandlik 20 standart', () => {
    const { container } = render(<Crest level={4} />)
    const svg = container.querySelector('svg.crest')!
    expect(svg.getAttribute('data-tier')).toBe('4')
    expect(svg.getAttribute('viewBox')).toBe('-3 -3 72 26')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.getAttribute('width')).toBe('55.38')
    expect([...svg.querySelectorAll('use')].map((u) => u.getAttribute('href'))).toEqual(['#crest-4'])
    expect(svg.getAttribute('aria-label')).toBe('4-daraja · Usta')
  })

  it('balandlik: legenda 15 → 41.54, o‘rindiq 18 → 49.85; Legenda 88/26 quti', () => {
    const { container } = render(
      <>
        <Crest level={1} height={15} />
        <Crest level={2} height={18} />
        <Crest level={6} legendaTier={1} height={15} />
      </>,
    )
    const [legend, seat, top] = container.querySelectorAll('svg.crest')
    expect([legend!.getAttribute('width'), legend!.getAttribute('height')]).toEqual(['41.54', '15'])
    expect([seat!.getAttribute('width'), seat!.getAttribute('height')]).toEqual(['49.85', '18'])
    expect(top!.getAttribute('viewBox')).toBe('-3 -3 88 26')
    expect([top!.getAttribute('width'), top!.getAttribute('height')]).toEqual(['50.77', '15'])
  })

  it('plated — plastinka gerbdan OLDIN; 6-darajada keng plastinka; Legenda II aria', () => {
    const { container } = render(
      <>
        <Crest level={3} height={18} plated />
        <Crest level={6} legendaTier={2} height={20} plated />
      </>,
    )
    const [three, six] = container.querySelectorAll('svg.crest')
    expect([...three!.querySelectorAll('use')].map((u) => u.getAttribute('href'))).toEqual(['#crest-plate', '#crest-3'])
    expect([...six!.querySelectorAll('use')].map((u) => u.getAttribute('href'))).toEqual(['#crest-plate-6', '#crest-6'])
    expect(six!.getAttribute('aria-label')).toBe('6-daraja · Legenda II')
  })

  it('0-daraja: #crest-0, data-tier="0", «Hali darajasiz»; 6 dan katta — 6', () => {
    const { container } = render(
      <>
        <Crest level={0} />
        <Crest level={9} />
      </>,
    )
    const [zero, over] = container.querySelectorAll('svg.crest')
    expect(zero!.getAttribute('data-tier')).toBe('0')
    expect(zero!.querySelector('use')!.getAttribute('href')).toBe('#crest-0')
    expect(zero!.getAttribute('aria-label')).toBe('Hali darajasiz')
    expect(over!.getAttribute('data-tier')).toBe('6')
  })

  it('animate — eng yangi katakcha ustida bitta #ch qoplamasi; 0-darajada yo‘q', () => {
    const { container, rerender } = render(<Crest level={4} height={18} animate />)
    const fills = container.querySelectorAll('use.crest__cell--fill')
    expect(fills).toHaveLength(1)
    expect(fills[0]!.getAttribute('href')).toBe('#ch')
    expect(fills[0]!.getAttribute('x')).toBe('33')
    expect((fills[0] as unknown as HTMLElement).style.fill).toBe('currentcolor')
    rerender(<Crest level={0} animate />)
    expect(container.querySelector('use.crest__cell--fill')).toBeNull()
  })
})

describe('MedalMark — bitta medal', () => {
  it('32 birlik quti, bitta <use href="#m-<code>">, 28 px standart; nomi bir marta', () => {
    const { container } = render(<MedalMark code="streak-fire" />)
    const svg = container.querySelector('svg.medal')!
    expect(svg.getAttribute('data-medal')).toBe('streak-fire')
    expect(svg.getAttribute('viewBox')).toBe('0 0 32 32')
    expect(svg.getAttribute('width')).toBe('28')
    expect([...svg.querySelectorAll('use')].map((u) => u.getAttribute('href'))).toEqual(['#m-streak-fire'])
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Olov seriyasi')
    expect(svg.querySelector('text')).toBeNull()
    expect(svg.classList.contains('rare')).toBe(false)
  })

  it('oy oilasi: o‘rindiqda ≥ 40 px dafna o‘z metallida, tanadan OLDIN; qatorda va 32 px da yo‘q', () => {
    const { container } = render(
      <>
        <MedalMark code="month-silver" size={40} seat />
        <MedalMark code="month-bronze" size={48} seat />
        <MedalMark code="month-gold" size={32} seat />
        <MedalMark code="month-gold" size={48} />
        <MedalMark code="day-record" size={48} seat />
      </>,
    )
    const hrefs = [...container.querySelectorAll('svg.medal')].map((m) =>
      [...m.querySelectorAll('use')].map((u) => u.getAttribute('href')),
    )
    expect(hrefs).toEqual([
      ['#m-laurel-silver', '#m-month-silver'],
      ['#m-laurel-bronze', '#m-month-bronze'],
      ['#m-month-gold'],
      ['#m-month-gold'],
      ['#m-day-record'],
    ])
  })

  it('×N plastinkasi — faqat o‘rindiqda va count > 1 da, SVG ICHIDA; aria nomga ×N qo‘shadi', () => {
    const { container } = render(<MedalMark code="day-winner" size={48} count={4} seat />)
    const svg = container.querySelector('svg.medal')!
    expect(svg.getAttribute('aria-label')).toBe('Kun gʻolibi ×4')
    const rim = svg.querySelector('rect.medal__plate-rim')!
    expect([rim.getAttribute('x'), rim.getAttribute('y'), rim.getAttribute('width'), rim.getAttribute('height')]).toEqual([
      '16.80', '21.2', '15', '10.6',
    ])
    // Po'lat tana — rim gradienti tana metallida; raqam belgi metallida (gilt).
    expect(rim.getAttribute('fill')).toBe('url(#mg-steel-rim)')
    expect(svg.querySelector('rect.medal__plate-well')!.getAttribute('x')).toBe('17.90')
    const count = svg.querySelector('g.medal__count')!
    expect(count.getAttribute('data-dev')).toBe('gilt')
    expect([...count.querySelectorAll('use')].map((u) => [u.getAttribute('href'), u.getAttribute('transform')])).toEqual([
      ['#nx', 'translate(21.85 26.7) scale(0.421)'],
      ['#n4', 'translate(26.75 26.7) scale(0.540)'],
    ])
    // Tashqarida HTML sanoq yo'q.
    expect(container.querySelector('.medal-count')).toBeNull()
    expect(container.querySelector('.medal-group')).toBeNull()
  })

  it('ikki raqam — keng plastinka; 99 da qisiladi; qatorda (seat yo‘q) plastinka yo‘q, aria baribir ×N', () => {
    const { container } = render(
      <>
        <MedalMark code="month-gold" size={48} count={12} seat />
        <MedalMark code="rookie" size={40} count={140} seat />
        <MedalMark code="jump" count={3} />
        <MedalMark code="jump" size={48} count={1} seat />
      </>,
    )
    const [twelve, many, row, one] = container.querySelectorAll('svg.medal')
    expect(twelve!.querySelector('rect.medal__plate-rim')!.getAttribute('width')).toBe('19.8')
    expect(twelve!.querySelector('rect.medal__plate-rim')!.getAttribute('fill')).toBe('url(#mg-gold-rim)')
    expect(twelve!.querySelector('g.medal__count')!.getAttribute('data-dev')).toBe('gold')
    expect([...many!.querySelectorAll('g.medal__count use')].map((u) => u.getAttribute('href'))).toEqual(['#nx', '#n9', '#n9'])
    expect(row!.querySelector('rect')).toBeNull()
    expect(row!.getAttribute('aria-label')).toBe('Sakrash ×3')
    expect(one!.querySelector('rect')).toBeNull()
  })

  it('yangi medal sinfi va o‘lcham', () => {
    const { container } = render(<MedalMark code="jump" isNew size={32} />)
    const svg = container.querySelector('svg.medal')!
    expect(svg.classList.contains('medal--new')).toBe(true)
    expect(svg.getAttribute('height')).toBe('32')
  })
})

describe('Halo — rank tangasi', () => {
  it('1–3: quti + 64 birlik tanga SVG, `#halo-N`; P1 dafna bilan; kichik — `#halo-sm-N`', () => {
    const { container } = render(
      <>
        <Halo rank={1} size={66} wreath />
        <Halo rank={2} size={56} />
        <Halo rank={3} size={30} small />
      </>,
    )
    const boxes = [...container.querySelectorAll('span.halo-box')] as HTMLElement[]
    expect(boxes.map((b) => [b.style.width, b.style.height])).toEqual([
      ['66px', '66px'], ['56px', '56px'], ['30px', '30px'],
    ])
    const svgs = boxes.map((b) => b.querySelector('svg.halo')!)
    for (const svg of svgs) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 64 64')
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
    expect(svgs[0]!.getAttribute('width')).toBe('66')
    expect([...svgs[0]!.querySelectorAll('use')].map((u) => u.getAttribute('href'))).toEqual(['#halo-laurel', '#halo-1'])
    const laurel = svgs[0]!.querySelector('use')!
    expect(['x', 'y', 'width', 'height'].map((a) => laurel.getAttribute(a))).toEqual(['-10', '-10', '84', '84'])
    expect([...svgs[1]!.querySelectorAll('use')].map((u) => u.getAttribute('href'))).toEqual(['#halo-2'])
    expect([...svgs[2]!.querySelectorAll('use')].map((u) => u.getAttribute('href'))).toEqual(['#halo-sm-3'])
    // Raqam matn emas — yo'l-raqam belgining ichida.
    expect(container.textContent).toBe('')
  })

  it('3 dan katta rank — hech narsa chizilmaydi; metalOfRank', () => {
    const { container } = render(<Halo rank={7} size={56} />)
    expect(container.innerHTML).toBe('')
    expect([1, 2, 3, 4].map(metalOfRank)).toEqual(['gold', 'silver', 'bronze', 'none'])
  })
})

/*
  LEGENDA BIR QATOR BO‘LISHI KERAK, VA U YAGONA JOY BO‘LIB QOLADI
  QAYERDA OSTONA QISQA YOZILADI.

  Spec §1 butun sahifada to‘liq so‘mni talab qiladi, legenda esa kalitning
  o‘zi uchun istisno: to‘liq so‘mli kalit ustun enidan oshadi — ya'ni ikkinchi
  qator, ya'ni narvon cho‘qqisi ko‘zdan pastda. Shuning uchun bu yerda
  `thresholdLabel` («10 mln» … «1 mlrd») chiziladi, Yangi pog‘onasida esa hech
  narsa (uning ostonasi — «birinchi so‘m»), va sarlavha yo‘q. Test IKKALA
  tomonni ham ushlaydi: yorliqlar katalogdan keladi, va kalitda TO‘LIQ SO‘M
  RAQAMI umuman uchramaydi.
*/
describe('TierLegend — 36 px kalit tasmasi', () => {
  it('olti pog‘ona, 15 px gerb, so‘z va qisqa ostona; Yangi yorliqsiz; sarlavhasiz', () => {
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
    for (const [i, rung] of [...rungs].entries()) {
      const crest = rung.querySelector('svg.crest')!
      expect(crest.getAttribute('height')).toBe('15')
      expect(crest.getAttribute('data-tier')).toBe(String(i + 1))
      expect(crest.querySelector('use')!.getAttribute('href')).toBe(`#crest-${i + 1}`)
      expect(crest.querySelector('use[href^="#crest-plate"]')).toBeNull()
    }
    expect(container.querySelector('.tv-legend')!.getAttribute('role')).toBe('list')
    // Sarlavha yo‘q — na element, na so‘z.
    expect(container.querySelector('.tv-legend__title')).toBeNull()
    expect(screen.queryByText('Daraja')).toBeNull()
    // Va kalitda to‘liq so‘m raqami yo‘q (`79 600 000` shakli).
    expect(container.textContent).not.toMatch(new RegExp(`\\d{1,3}(${S}\\d{3}){2,}`))
  })
})

describe('katalog', () => {
  it('14 kod, tartib motor bilan bir xil: haqiqiy metall avval, keyin gilt, keyin po‘lat', () => {
    expect(MEDAL_ORDER).toEqual([
      'year-champion', 'month-gold', 'month-silver', 'month-bronze', 'streak-fire', 'conversion-master',
      'day-record', 'streak-steady', 'clean-month', 'jump', 'rookie', 'day-winner', 'work-month', 'first-sale',
    ])
    for (const code of MEDAL_ORDER) expect(MEDALS[code].name).toBeTruthy()
  })

  it('MEDAL_METAL: oltin beshlik, kumush/bronza oy, gilt beshlik, po‘lat ikkilik; tana hech qachon gilt emas', () => {
    const by = (body: string, dev: string) =>
      MEDAL_ORDER.filter((c) => MEDAL_METAL[c].body === body && MEDAL_METAL[c].dev === dev).sort()
    expect(by('gold', 'gold')).toEqual(['conversion-master', 'day-record', 'month-gold', 'streak-fire', 'year-champion'])
    expect(by('silver', 'silver')).toEqual(['month-silver'])
    expect(by('bronze', 'bronze')).toEqual(['month-bronze'])
    expect(by('steel', 'gilt')).toEqual(['clean-month', 'day-winner', 'jump', 'rookie', 'streak-steady'])
    expect(by('steel', 'steel')).toEqual(['first-sale', 'work-month'])
    // Tartib = metall: nodir yettilik birinchi yettita.
    expect([...RARE_MEDALS].sort()).toEqual([...MEDAL_ORDER.slice(0, 7)].sort())
    expect(HIDDEN_IN_ROWS).toEqual(['first-sale'])
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
    const input = [m('first-sale'), m('day-winner'), m('streak-fire'), m('month-silver'), m('clean-month')]
    expect(sortMedals(input, HIDDEN_IN_ROWS).map((x) => x.code)).toEqual([
      'month-silver', 'streak-fire', 'clean-month', 'day-winner',
    ])
    expect(sortMedals(input).map((x) => x.code)).toEqual([
      'month-silver', 'streak-fire', 'clean-month', 'day-winner', 'first-sale',
    ])
    expect(input[0]!.code).toBe('first-sale')
  })

  it('seatMedals — nodir yoki gilt bor bo‘lsa first-sale va work-month tushadi; cap bo‘yicha kesiladi', () => {
    const m = (code: SellerMedalDto['code']): SellerMedalDto => ({
      code, count: 1, at: null, amount: null, orders: null, percent: null,
    })
    const commons = [m('work-month'), m('first-sale')]
    expect(seatMedals(commons, 4).map((x) => x.code)).toEqual(['work-month', 'first-sale'])
    expect(seatMedals([...commons, m('rookie')], 4).map((x) => x.code)).toEqual(['rookie'])
    expect(seatMedals([...commons, m('day-record')], 4).map((x) => x.code)).toEqual(['day-record'])
    const many = [m('first-sale'), m('jump'), m('day-winner'), m('month-gold'), m('clean-month'), m('streak-fire')]
    expect(seatMedals(many, 3).map((x) => x.code)).toEqual(['month-gold', 'streak-fire', 'clean-month'])
    expect(seatMedals(many, 4).map((x) => x.code)).toEqual(['month-gold', 'streak-fire', 'clean-month', 'jump'])
    expect(seatMedals([], 4)).toEqual([])
    expect(many[0]!.code).toBe('first-sale')
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

  it('first-sale yashirin, MEDAL_ORDER bo‘yicha eng ko‘pi 3 ta, 28 px; «+N» yo‘q, ×N yo‘q', () => {
    const { container } = render(<RowMedals medals={[...seven].reverse()} />)
    const shown = [...container.querySelectorAll('.row__medals svg.medal')]
    expect(shown.map((m) => m.getAttribute('data-medal'))).toEqual(['month-gold', 'streak-fire', 'conversion-master'])
    expect(shown.map((m) => m.getAttribute('width'))).toEqual(['28', '28', '28'])
    // Har medalga AYNAN bitta <use> — dafna yo'q, plastinka yo'q.
    for (const m of shown) {
      expect(m.querySelectorAll('use')).toHaveLength(1)
      expect(m.querySelector('rect')).toBeNull()
    }
    // Sanoq aria'da ham yo'q (count berilmaydi).
    expect(shown[0]!.getAttribute('aria-label')).toBe('Oy chempioni')
    expect(container.textContent).not.toMatch(/\+\d/)
    expect(container.querySelector('.row__more')).toBeNull()
    expect(container.querySelector('.medal-count')).toBeNull()
  })

  it('haqiqiy metall avval: kumush oy olov seriyasidan, gilt po‘latdan oldin', () => {
    const { container } = render(
      <RowMedals
        medals={[medal({ code: 'work-month' }), medal({ code: 'rookie' }), medal({ code: 'streak-fire' }), medal({ code: 'month-silver' })]}
      />,
    )
    expect([...container.querySelectorAll('svg.medal')].map((m) => m.getAttribute('data-medal'))).toEqual([
      'month-silver', 'streak-fire', 'rookie',
    ])
  })

  it('faqat first-sale — uya bo‘sh, lekin konteyner grid uchun qoladi', () => {
    const { container } = render(<RowMedals medals={[medal({ code: 'first-sale' })]} />)
    expect(container.querySelector('.row__medals')).not.toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('yangi medal sinfi — faqat o‘sha medalda', () => {
    const { container } = render(<RowMedals medals={seven} newKeys={new Set(['streak-fire'])} />)
    expect(container.querySelector('svg.medal--new[data-medal="streak-fire"]')).not.toBeNull()
    expect(container.querySelectorAll('.medal--new')).toHaveLength(1)
  })
})
