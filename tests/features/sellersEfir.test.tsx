// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Crest } from '@/features/sellers/Crest'
import { Halo, metalOfRank } from '@/features/sellers/Halo'
import { MedalDefs } from '@/features/sellers/MedalDefs'
import { MedalMark } from '@/features/sellers/MedalMark'
import { TierLegend } from '@/features/sellers/TierLegend'
import {
  HIDDEN_IN_ROWS,
  LADDER,
  MEDALS,
  MEDAL_ORDER,
  MEDAL_SYMBOL,
  MONTH_NUMERAL,
  RARE_MEDALS,
  metalOfMedal,
  sortMedals,
  thresholdSomOf,
} from '@/features/sellers/medalCatalog'
import type { SellerMedalDto } from '@/lib/api'
import { NARROW_NBSP } from '@/lib/format'

/**
 * EFIR belgilari (spec §2, §3): gerb — olti chevron, daraja `--tier` orqali;
 * medal — bitta metall, gravyura; halqa — rank raqami metallda; legenda —
 * olti pog'ona to'liq so'mda. Bu yerda faqat komponentlar; taxtaga ulanish
 * `sellersTvBoard.test.tsx` da.
 */
const S = NARROW_NBSP

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

describe('TierLegend — 28 px «DARAJA» qatori', () => {
  it('olti pog‘ona, so‘z va to‘liq so‘m ostona; Yangi raqamsiz; Legendada toj', () => {
    const { container } = render(<TierLegend />)
    const rungs = container.querySelectorAll('.legend__rung')
    expect(rungs).toHaveLength(6)
    expect([...rungs].map((r) => r.querySelector('b')!.textContent)).toEqual([
      'Yangi', 'Sotuvchi', 'Katta sotuvchi', 'Usta', 'Ustoz', 'Legenda',
    ])
    expect(rungs[0]!.querySelector('i')).toBeNull()
    expect(rungs[1]!.querySelector('i')!.textContent).toBe(`10${S}000${S}000`)
    expect(rungs[5]!.querySelector('i')!.textContent).toBe(`1${S}000${S}000${S}000`)
    expect(rungs[5]!.querySelector('svg.crest--legend')!.getAttribute('data-tier')).toBe('6')
    expect(rungs[5]!.querySelector('.crest__crown')).not.toBeNull()
    expect(rungs[3]!.querySelectorAll('use.on')).toHaveLength(4)
    expect(container.querySelector('.tv-legend')!.getAttribute('role')).toBe('list')
    expect(screen.getByText('Daraja')).toBeTruthy()
    expect(container.textContent).not.toMatch(/mln|mlrd/)
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
