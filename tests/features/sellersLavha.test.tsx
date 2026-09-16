// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Lavha } from '@/features/sellers/Lavha'
import { LevelBlock, isNearNextLevel, nextLevelSentence } from '@/features/sellers/LevelBlock'
import { Medal } from '@/features/sellers/Medal'
import { MedalDefs } from '@/features/sellers/MedalDefs'
import { MedalRail } from '@/features/sellers/MedalRail'
import { Narvon } from '@/features/sellers/Narvon'
import { RowMedals } from '@/features/sellers/RowMedals'
import { SpeakingMedal } from '@/features/sellers/SpeakingMedal'
import { LADDER, MEDALS, MEDAL_ORDER, MEDAL_UNLOCK_LEVEL, dativeOf, levelTitle, mlnLabel } from '@/features/sellers/medalCatalog'
import { medalReason } from '@/features/sellers/medalReason'
import type { SellerMedalDto, SellerMedalRowDto } from '@/lib/api'

describe('MedalDefs — sahifaga bir marta o‘rnatiladigan belgilar to‘plami', () => {
  it('lavha, xatam va 14 medal belgisini id bilan chizadi', () => {
    const { container } = render(<MedalDefs />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    for (const id of ['khatam', 'lavha-stars-1', 'lavha-stars-3', 'lavha-plate-3x1', 'lavha-plate-seat', 'lavha-rim-seat', 'lavha-hi-seat']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull()
    }
    for (const code of MEDAL_ORDER) expect(container.querySelector(`#medal-${code}`), code).not.toBeNull()
    expect(container.querySelector('#medal-locked')).not.toBeNull()
    expect(container.querySelector('#medal-club')).toBeNull()
  })
})

describe('Lavha', () => {
  it('qator lavhasi: sinf data-level da, yulduz bandi <use> bilan, yozuvsiz', () => {
    const { container } = render(<Lavha level={3} size="row" />)
    const svg = container.querySelector('svg.lavha.lavha--row')!
    expect(svg.getAttribute('data-level')).toBe('3')
    expect(svg.getAttribute('viewBox')).toBe('0 0 78 26')
    expect(svg.querySelector('use[href="#lavha-plate-3x1"]')).not.toBeNull()
    expect(svg.querySelector('use[href="#lavha-stars-3"]')).not.toBeNull()
    expect(svg.querySelector('text')).toBeNull()
    expect(svg.getAttribute('aria-label')).toBe('3-daraja · Katta sotuvchi')
  })

  it('faxriy lavha (4–5) bir xil siluet, yulduz soni 1 va 2', () => {
    const { container } = render(<><Lavha level={4} size="row" /><Lavha level={5} size="row" /></>)
    const [usta, ustoz] = container.querySelectorAll('svg.lavha')
    expect(usta!.querySelector('use[href="#lavha-stars-1"]')).not.toBeNull()
    expect(ustoz!.querySelector('use[href="#lavha-stars-2"]')).not.toBeNull()
  })

  it('Legenda: ichki o‘yma rom + bitta xatam; sharpada rom yo‘q', () => {
    const { container } = render(<><Lavha level={6} legendaTier={1} size="row" /><Lavha level={6} legendaTier={1} size="row" ghost /></>)
    const [real, ghost] = container.querySelectorAll('svg.lavha')
    expect(real!.querySelector('use[href="#lavha-rim-3x1"]')).not.toBeNull()
    expect(real!.querySelector('use[href="#khatam"]')).not.toBeNull()
    expect(ghost!.hasAttribute('data-ghost')).toBe(true)
    expect(ghost!.querySelector('use[href="#lavha-rim-3x1"]')).toBeNull()
    expect(ghost!.querySelector('use[href="#khatam"]')).not.toBeNull()
  })

  it('0-daraja: faqat plastina, yulduzsiz, «Hali darajasiz»', () => {
    const { container } = render(<Lavha level={0} size="row" />)
    const svg = container.querySelector('svg.lavha')!
    expect(svg.getAttribute('data-level')).toBe('0')
    expect(svg.querySelector('use[href^="#lavha-stars"]')).toBeNull()
    expect(svg.querySelector('use[href="#khatam"]')).toBeNull()
    expect(svg.getAttribute('aria-label')).toBe('Hali darajasiz')
  })

  it('seat lavhasi ikki qavatli: bevel chiziqlari, yulduz bandi va O‘YMA UNVON', () => {
    const { container } = render(<Lavha level={3} size="seat" />)
    const svg = container.querySelector('svg.lavha--seat')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 280 88')
    expect(svg.querySelector('use[href="#lavha-hi-seat"]')).not.toBeNull()
    expect(svg.querySelector('use[href="#lavha-lo-seat"]')).not.toBeNull()
    const band = svg.querySelector('use[href="#lavha-stars-3"]')!
    expect(band.getAttribute('x')).toBe('83.1')
    expect(band.getAttribute('width')).toBe('98')
    expect(svg.querySelector('text.lavha__title')!.textContent).toBe('KATTA SOTUVCHI')
    expect(svg.querySelector('text')!.getAttribute('text-anchor')).toBe('middle')
  })

  it('seat: Legenda II yozuvi va katta yulduz; 0-darajada yozuv yo‘q', () => {
    const { container } = render(<><Lavha level={6} legendaTier={2} size="seat" /><Lavha level={0} size="seat" /></>)
    const [leg, zero] = container.querySelectorAll('svg.lavha--seat')
    expect(leg!.querySelector('text')!.textContent).toBe('LEGENDA II')
    expect(leg!.querySelector('use[href="#khatam"]')!.getAttribute('width')).toBe('36')
    expect(zero!.querySelector('text')).toBeNull()
    expect(zero!.querySelector('use[href="#lavha-hi-seat"]')).toBeNull()
  })

  it('animate — har yulduz alohida <use>, tushish sinfi va 80 ms kechikish bilan', () => {
    const { container } = render(<Lavha level={3} size="seat" animate />)
    const stars = container.querySelectorAll('use.lavha__star--drop')
    expect(stars).toHaveLength(3)
    expect((stars[2] as HTMLElement).style.animationDelay).toBe('160ms')
    expect(container.querySelector('use[href="#lavha-stars-3"]')).toBeNull()
  })
})

describe('Medal', () => {
  it('kod data-medal va href da; o‘lcham sinfda; ekran o‘qiydigan nomi bor', () => {
    const { container } = render(<Medal code="streak-fire" size="row" />)
    const svg = container.querySelector('svg.medal.medal--row')!
    expect(svg.getAttribute('data-medal')).toBe('streak-fire')
    expect(svg.getAttribute('viewBox')).toBe('0 0 32 40')
    expect(svg.querySelector('use')!.getAttribute('href')).toBe('#medal-streak-fire')
    expect(screen.getByText('Olov seriyasi', { selector: '.sr-only' })).toBeTruthy()
  })

  it('×N faqat seat va gapiruvchi o‘lchamda — qatorda yo‘q', () => {
    const { container, rerender } = render(<Medal code="day-winner" size="seat" count={5} />)
    expect(container.querySelector('.medal-count')!.textContent).toBe('×5')
    rerender(<Medal code="day-winner" size="row" count={5} />)
    expect(container.querySelector('.medal-count')).toBeNull()
    rerender(<Medal code="day-winner" size="speaking" count={1} />)
    expect(container.querySelector('.medal-count')).toBeNull()
  })

  it('lentasiz variant — kesilgan viewBox va medal--bare', () => {
    const { container } = render(<Medal code="month-gold" size="row" bare />)
    const svg = container.querySelector('svg.medal--bare')!
    expect(svg.getAttribute('viewBox')).toBe('0 8 32 32')
  })

  it('qulflangan medal — data-medal="locked", nomi «Ochilmagan medal»', () => {
    const { container } = render(<Medal code="year-champion" size="speaking" locked />)
    expect(container.querySelector('svg')!.getAttribute('data-medal')).toBe('locked')
    expect(screen.getByText('Ochilmagan medal', { selector: '.sr-only' })).toBeTruthy()
  })

  it('label={false} sr-only nomni chizmaydi (gapiruvchi karta nomni o‘zi yozadi)', () => {
    const { container } = render(<Medal code="jump" size="speaking" label={false} />)
    expect(container.querySelector('.sr-only')).toBeNull()
  })

  it('yangi medal sinfi', () => {
    const { container } = render(<Medal code="jump" size="seat" isNew />)
    expect(container.querySelector('.medal-slot.medal-slot--new')).not.toBeNull()
  })
})

describe('katalog', () => {
  it('14 medal, hammasi nomli va oilali; tartib va eshik motor bilan bir xil', () => {
    expect(Object.keys(MEDALS)).toHaveLength(14)
    expect(MEDAL_ORDER).toHaveLength(14)
    expect(MEDAL_ORDER[0]).toBe('year-champion')
    expect(MEDAL_ORDER[13]).toBe('first-sale')
    expect(MEDAL_UNLOCK_LEVEL['streak-fire']).toBe(4)
    expect(MEDAL_UNLOCK_LEVEL['first-sale']).toBe(1)
    expect(MEDALS['month-gold']).toEqual({ name: 'Oy chempioni', family: 'oy' })
  })

  it('narvon — olti pog‘ona, aytiladigan ostonalar', () => {
    expect(LADDER.map((r) => r.title)).toEqual(['Yangi', 'Sotuvchi', 'Katta sotuvchi', 'Usta', 'Ustoz', 'Legenda'])
    expect(LADDER.map((r) => r.thresholdLabel)).toEqual(['birinchi soʻm', '10 mln', '30 mln', '100 mln', '300 mln', '1 mlrd'])
  })

  it('unvon: 0 → null, Legenda II', () => {
    expect(levelTitle(0, 0)).toBeNull()
    expect(levelTitle(4, 0)).toBe('Usta')
    expect(levelTitle(6, 1)).toBe('Legenda')
    expect(levelTitle(6, 3)).toBe('Legenda III')
  })

  it('jo‘nalish kelishigi — rim raqamli unvonda «ga» alohida', () => {
    expect(dativeOf('Ustoz')).toBe('Ustozga')
    expect(dativeOf('Katta sotuvchi')).toBe('Katta sotuvchiga')
    expect(dativeOf('Legenda II')).toBe('Legenda II ga')
  })

  it('mln yorlig‘i', () => {
    expect(mlnLabel(127_000_000)).toBe('127 mln')
    expect(mlnLabel(9_100_000)).toBe('9.1 mln')
    expect(mlnLabel(1_240_000_000)).toBe('1.2 mlrd')
  })
})

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

describe('LevelBlock — seat bloki', () => {
  it('lavha, shtamplar va «… ga N mln qoldi»: 173 mln Usta → 3 shtamp, Ustozga 127 mln', () => {
    const { container } = render(<LevelBlock row={row()} ghost={false} />)
    expect(container.querySelector('svg.lavha--seat')!.getAttribute('data-level')).toBe('4')
    expect(container.querySelectorAll('.lv-stamps i')).toHaveLength(10)
    expect(container.querySelectorAll('.lv-stamps i.on')).toHaveLength(3)
    expect(screen.getByText('Ustozga 127 mln qoldi')).toBeTruthy()
    expect(container.querySelector('.lv-ghost')).toBeNull()
  })

  it('sharpa faqat so‘ralganda (chempion seat), keyingi lavha va ostonasi bilan', () => {
    const { container } = render(<LevelBlock row={row()} ghost />)
    const ghost = container.querySelector('.lv-ghost')!
    const svg = ghost.querySelector('svg.lavha--ghost')!
    expect(svg.hasAttribute('data-ghost')).toBe(true)
    expect(svg.getAttribute('data-level')).toBe('5')
    expect(ghost.textContent).toContain('Ustoz')
    expect(ghost.textContent).toContain('300 mln')
  })

  it('90% dan oshganda «yaqin» — 9 shtamp va ko‘k matn', () => {
    const near = row({ level: 3, rankTitle: 'Katta sotuvchi', delivered: uzs(95_000_000), levelFloor: uzs(30_000_000), nextLevelAt: uzs(100_000_000), nextTitle: 'Usta' })
    const { container } = render(<LevelBlock row={near} ghost={false} />)
    expect(container.querySelectorAll('.lv-stamps i.on')).toHaveLength(9)
    expect(container.querySelector('.lv-qoldi--near')!.textContent).toBe('Ustaga 5 mln qoldi')
  })

  it('0-daraja: shtrix lavha, shtamplar bo‘sh, «Birinchi savdo kutilmoqda»', () => {
    const zero = row({ level: 0, rankTitle: null, delivered: uzs(0), levelFloor: uzs(0), nextLevelAt: uzs(0.01), nextTitle: 'Yangi' })
    const { container } = render(<LevelBlock row={zero} ghost />)
    expect(container.querySelector('svg.lavha--seat')!.getAttribute('data-level')).toBe('0')
    expect(container.querySelectorAll('.lv-stamps i.on')).toHaveLength(0)
    expect(screen.getByText('Birinchi savdo kutilmoqda')).toBeTruthy()
    expect(container.querySelector('.lv-ghost')!.textContent).toContain('birinchi soʻm')
  })

  it('Legenda: keyingi milliardgacha, «Legenda II ga … qoldi»', () => {
    const leg = row({ level: 6, legendaTier: 1, rankTitle: 'Legenda', delivered: uzs(1_413_000_000), levelFloor: uzs(1_000_000_000), nextLevelAt: uzs(2_000_000_000), nextTitle: 'Legenda II' })
    render(<LevelBlock row={leg} ghost={false} />)
    expect(screen.getByText('Legenda II ga 587 mln qoldi')).toBeTruthy()
  })

  it('rise — plastina ko‘tarilish sinfi va yaltirash qatlami', () => {
    const { container } = render(<LevelBlock row={row()} ghost={false} rise />)
    expect(container.querySelector('.lv-plate.lv-plate--rise')).not.toBeNull()
    expect(container.querySelector('.lv-sheen')).not.toBeNull()
    expect(container.querySelectorAll('use.lavha__star--drop')).toHaveLength(1)
  })
})

/**
 * DARAJA QOIDASI BITTA. Seat bloki ham, jadval qatori ham shu ikki funksiyani
 * o'qiydi — nusxa bo'lganda bir odam bir ekranda «yaqin», ikkinchisida
 * «yaqin emas» bo'lib chiqishi mumkin edi, va hech narsa xato bermasdi.
 */
describe('isNearNextLevel va nextLevelSentence', () => {
  it('«yaqin» 90% dan boshlanadi; 0-daraja hech qachon yaqin emas', () => {
    // 173 mln, 100..300 oralig'ida — 36.5%.
    expect(isNearNextLevel(row())).toBe(false)
    // 95 mln, 30..100 oralig'ida — 92.9%.
    expect(
      isNearNextLevel(row({ level: 3, delivered: uzs(95_000_000), levelFloor: uzs(30_000_000), nextLevelAt: uzs(100_000_000) })),
    ).toBe(true)
    // Ostonadan oshib ketgan qator ham yaqin: ulush qisiladi, aylanib ketmaydi.
    expect(isNearNextLevel(row({ delivered: uzs(400_000_000) }))).toBe(true)
    expect(isNearNextLevel(row({ level: 0, rankTitle: null, delivered: uzs(0), levelFloor: uzs(0), nextLevelAt: uzs(0.01) }))).toBe(false)
  })

  it('jumla « qoldi» siz keladi — gapni seat tugatadi, chase chizig‘i esa yo‘q', () => {
    expect(nextLevelSentence(row())).toBe('Ustozga 127 mln')
    expect(
      nextLevelSentence(row({ level: 3, rankTitle: 'Katta sotuvchi', delivered: uzs(81_300_000), levelFloor: uzs(30_000_000), nextLevelAt: uzs(100_000_000), nextTitle: 'Usta' })),
    ).toBe('Ustaga 18.7 mln')
    expect(
      nextLevelSentence(row({ level: 0, rankTitle: null, delivered: uzs(0), levelFloor: uzs(0), nextLevelAt: uzs(0.01), nextTitle: 'Yangi' })),
    ).toBe('Birinchi savdo kutilmoqda')
    // Ostonadan oshgan sotuvchi manfiy pul emas, nol ko'radi.
    expect(nextLevelSentence(row({ delivered: uzs(400_000_000) }))).not.toContain('-')
  })

  it('seat bloki o‘sha jumlani gap qilib tugatadi', () => {
    render(<LevelBlock row={row()} ghost={false} />)
    expect(screen.getByText(`${nextLevelSentence(row())} qoldi`)).toBeTruthy()
  })
})

describe('MedalRail va RowMedals', () => {
  const seven = [
    medal({ code: 'month-gold', count: 2 }),
    medal({ code: 'streak-fire' }),
    medal({ code: 'conversion-master' }),
    medal({ code: 'day-record' }),
    medal({ code: 'clean-month' }),
    medal({ code: 'day-winner', count: 5 }),
    medal({ code: 'first-sale' }),
  ]

  it('tokcha 5 ta chizadi, qolgani +N, ×N pill seat o‘lchamida bor', () => {
    const { container } = render(<MedalRail medals={seven} />)
    expect(container.querySelectorAll('.medal-rail svg.medal--seat')).toHaveLength(5)
    expect(screen.getByText('+2')).toBeTruthy()
    expect(container.querySelector('.medal-count')!.textContent).toBe('×2')
  })

  it('medalsiz tokcha chizilmaydi — karta qisqaradi', () => {
    const { container } = render(<MedalRail medals={[]} />)
    expect(container.querySelector('.medal-rail')).toBeNull()
  })

  it('qatorda 3 ta + N, pill yo‘q, yangi medal sinfi', () => {
    const { container } = render(<RowMedals medals={seven} newKeys={new Set(['streak-fire'])} />)
    expect(container.querySelectorAll('.tv-rowmedals svg.medal--row')).toHaveLength(3)
    expect(screen.getByText('+4')).toBeTruthy()
    expect(container.querySelector('.medal-count')).toBeNull()
    expect(container.querySelector('.medal-slot--new svg[data-medal="streak-fire"]')).not.toBeNull()
  })
})

describe('SpeakingMedal va Narvon', () => {
  it('gapiruvchi karta — 64 px medal, nom va sabab; nom ikki marta emas', () => {
    const { container } = render(<SpeakingMedal medal={medal({ code: 'conversion-master', percent: 82, orders: 41 })} />)
    expect(container.querySelector('svg.medal--speaking')).not.toBeNull()
    expect(screen.getByText('Konversiya ustasi', { selector: '.medal-speak-name' })).toBeTruthy()
    expect(screen.getAllByText('Konversiya ustasi')).toHaveLength(1)
    expect(container.querySelector('.medal-speak-why')!.textContent).toContain('82')
  })

  it('narvon — olti pog‘ona, unvon va ostona, Legenda ko‘k', () => {
    const { container } = render(<Narvon />)
    const rungs = container.querySelectorAll('.narvon-rung')
    expect(rungs).toHaveLength(6)
    expect(rungs[0]!.textContent).toContain('Yangi')
    expect(rungs[0]!.textContent).toContain('birinchi soʻm')
    expect(rungs[5]!.querySelector('svg.lavha--narvon')!.getAttribute('data-level')).toBe('6')
    expect(rungs[5]!.textContent).toContain('1 mlrd')
  })
})

describe('medalReason', () => {
  it('oy medali — oy nomi, summa va buyurtma', () => {
    const text = medalReason(medal({ code: 'month-gold', amount: uzs(128_550_000), orders: 74 }))
    expect(text).toContain('Avgust 2026')
    expect(text).toContain('74')
  })

  it('🚀 ning orders maydoni o‘rin deb chiziladi, buyurtma deb emas', () => {
    const text = medalReason(medal({ code: 'rookie', at: '2026-10-01', orders: 7 }))
    expect(text).toContain('7-oʻrin')
    expect(text).not.toContain('7 buyurtma')
  })

  it('📅 «ishchan oy» — «N kun · davomat NN%», buyurtma emas', () => {
    const text = medalReason(medal({ code: 'work-month', orders: 24, percent: 77 }))
    expect(text).toContain('24 kun')
    expect(text).toContain('davomat')
    expect(text).not.toContain('24 buyurtma')
  })

  it('faqat oyi bor medal o‘sha oyni yozadi; hech narsasi yo‘q medal o‘z nomini', () => {
    expect(medalReason(medal({ code: 'streak-fire', at: '2026-11-01' }))).toBe('Noyabr 2026')
    expect(medalReason(medal({ code: 'streak-fire', at: null }))).toBe('Olov seriyasi')
  })
})
