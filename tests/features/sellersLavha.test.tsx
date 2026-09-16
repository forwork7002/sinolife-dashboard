// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Lavha } from '@/features/sellers/Lavha'
import { Medal } from '@/features/sellers/Medal'
import { MedalDefs } from '@/features/sellers/MedalDefs'
import { LADDER, MEDALS, MEDAL_ORDER, MEDAL_UNLOCK_LEVEL, dativeOf, levelTitle, mlnLabel } from '@/features/sellers/medalCatalog'

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
