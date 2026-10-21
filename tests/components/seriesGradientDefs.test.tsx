// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  BAR_BASE_OPACITY,
  BAR_RADIUS,
  type BarSeriesSlot,
  SeriesGradientDefs,
  seriesColour,
  seriesGradientFill,
} from '@/components/charts/SeriesGradientDefs'

/**
 * The bar gradient is a contrast promise, not a look: every stop of a data
 * mark clears 3:1 against the raised card in both themes. Nothing on screen
 * reports a base stop that slipped under, so the numbers are recomputed here
 * from globals.css — a re-tint that lowers a slot or lifts the card fails
 * this test, not the client's eye.
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
/**
 * The three theme blocks, in globals.css order: light, system-dark,
 * forced-dark. Read by OPENER rather than by counting declarations: the
 * `.card-hero` block restates the whole dark palette for its own subtree
 * (theme.test.ts pins that copy to the forced-dark block), so a bare count of
 * `--series-N:` lines is four, and the fourth is not a theme.
 */
const THEME_BLOCKS = [
  ':root {',
  ':root:where(:not([data-theme="light"])) {',
  ':root[data-theme="dark"] {',
] as const
const block = (opener: string) => {
  const at = CSS.indexOf(opener)
  expect(at, opener).toBeGreaterThan(-1)
  return CSS.slice(at, CSS.indexOf('\n}', at))
}
/** Token values in theme-block order: [light, system-dark, forced-dark]. */
const declared = (token: string) =>
  THEME_BLOCKS.map((opener) => {
    const m = new RegExp(`^\\s*${token}: ([^;]+);`, 'm').exec(block(opener))
    expect(m, `${token} in ${opener}`).not.toBeNull()
    return m![1]!.trim()
  })

const OFFERED: readonly BarSeriesSlot[] = [1, 2, 3, 5, 7, 8]

const channels = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16))
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
/** sRGB source-over: what the browser paints for a stop at `alpha` on the card. */
const composite = (fg: string, bg: string, alpha: number) =>
  '#' +
  channels(fg)
    .map((v, i) =>
      Math.round(v * alpha + channels(bg)[i]! * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

describe('SeriesGradientDefs — bir chart, har slot uchun bitta gradient', () => {
  it('slot tokenidan ikki stop, vertikal, color-mix yoʻq', () => {
    const { container } = render(
      <svg>
        <SeriesGradientDefs prefix="t" slots={[1, 3]} />
      </svg>,
    )
    const gradients = [...container.querySelectorAll('linearGradient')]
    expect(gradients.map((g) => g.id)).toEqual(['t-series-1', 't-series-3'])
    for (const g of gradients) {
      expect([
        g.getAttribute('x1'),
        g.getAttribute('y1'),
        g.getAttribute('x2'),
        g.getAttribute('y2'),
      ]).toEqual(['0', '0', '0', '1'])
      expect(g.hasAttribute('gradientUnits')).toBe(false)
      const stops = [...g.querySelectorAll('stop')]
      expect(stops).toHaveLength(2)
      const slot = g.id.slice(-1)
      expect(stops[0]!.getAttribute('stop-color')).toBe(`var(--series-${slot})`)
      expect(stops[0]!.getAttribute('stop-opacity')).toBe('1')
      expect(stops[1]!.getAttribute('stop-color')).toBe(`var(--series-${slot})`)
      expect(stops[1]!.getAttribute('stop-opacity')).toBe(String(BAR_BASE_OPACITY))
    }
    expect(container.innerHTML).not.toContain('color-mix')
  })

  it('fill url va legend rangi bitta slotdan', () => {
    expect(seriesGradientFill('t', 3)).toBe('url(#t-series-3)')
    expect(seriesColour(2)).toBe('var(--series-2)')
    expect(BAR_RADIUS).toEqual([6, 6, 0, 0])
  })

  it('har stop ikkala mavzuda --surface-raised ga nisbatan ≥ 3:1', () => {
    const cards = declared('--surface-raised')
    expect(cards).toHaveLength(3)
    for (const slot of OFFERED) {
      const values = declared(`--series-${slot}`)
      expect(values, `--series-${slot}`).toHaveLength(3)
      for (const theme of [0, 1] as const) {
        const series = values[theme]!
        const card = cards[theme]!
        expect(
          contrast(series, card),
          `slot ${slot} top ${theme ? 'dark' : 'light'}`,
        ).toBeGreaterThanOrEqual(3)
        const base = composite(series, card, BAR_BASE_OPACITY)
        expect(
          contrast(base, card),
          `slot ${slot} base ${theme ? 'dark' : 'light'} ${base}`,
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
