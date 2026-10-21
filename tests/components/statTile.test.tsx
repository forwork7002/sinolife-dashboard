// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PhoneGlyph } from '@/components/ui/Icons'
import { StatTile } from '@/components/ui/Stat'
import { formatFullUzs } from '@/lib/format'

/**
 * THE RICHER TILE — chip and sparkline, each optional (2026-09-28).
 *
 * Nothing in tests/ imported Stat.tsx directly before this; the tile was only
 * ever exercised through page renders, which pin figures and never the tile's
 * own contract. Four of that contract's rules are invisible when they break:
 * a tile with none of the new props must render exactly as before, a
 * sparkline must never draw below two points (Sparkline's own em dash under a
 * figure reads as a second, missing value), a series of nothing but zeros
 * draws no line at all (the callers hand over zero-filled calendar days, so
 * an empty window would otherwise draw a flat placeholder under a «0»), and
 * the sparkline may not appear on a skeleton or under «Olinmadi».
 */

/*
  jsdom has no `matchMedia`, and `AnimatedNumber` (inside every count and
  money tile) asks it whether the reader wants motion. Answering "yes,
  reduced" is the honest answer for a test: the figure is printed once rather
  than counted up. Same stub `faktQueueBand.test.tsx` installs.
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

afterEach(cleanup)

describe('StatTile', () => {
  it('renders exactly as before with none of the new props', () => {
    const { container } = render(<StatTile label="Qoʻngʻiroqlar" value={42} unit="count" />)

    expect(screen.getByText('42')).toBeDefined()
    expect(container.querySelector('.stat-chip')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('wears the chip, hidden from readers', () => {
    const { container } = render(
      <StatTile label="Qoʻngʻiroqlar" value={42} unit="count" icon={PhoneGlyph} />,
    )

    const chip = container.querySelector('.stat-chip')
    expect(chip).not.toBeNull()
    expect(chip!.getAttribute('aria-hidden')).toBe('true')
    expect(chip!.querySelector('svg')).not.toBeNull()
  })

  it('draws the sparkline only from two points, never its dash', () => {
    const one = render(
      <StatTile label="Qoʻngʻiroqlar" value={5} unit="count" spark={[5]} sparkLabel="Kunlik qoʻngʻiroqlar" />,
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText('—')).toBeNull()
    one.unmount()

    render(
      <StatTile
        label="Qoʻngʻiroqlar"
        value={12}
        unit="count"
        spark={[5, 7]}
        sparkLabel="Kunlik qoʻngʻiroqlar"
      />,
    )
    expect(screen.getByRole('img', { name: 'Kunlik qoʻngʻiroqlar' })).toBeDefined()
  })

  it('draws no line under a figure whose every day is zero', () => {
    render(
      <StatTile
        label="Leadlar"
        value={0}
        unit="count"
        spark={[0, 0, 0, 0, 0, 0, 0]}
        sparkLabel="Kunlik leadlar"
      />,
    )
    expect(screen.getByText('0')).toBeDefined()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('keeps the sparkline off the skeleton and the error', () => {
    const loading = render(
      <StatTile
        label="Qoʻngʻiroqlar"
        value={null}
        unit="count"
        status="loading"
        spark={[5, 7]}
        sparkLabel="Kunlik qoʻngʻiroqlar"
      />,
    )
    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.queryByRole('img')).toBeNull()
    loading.unmount()

    render(
      <StatTile
        label="Qoʻngʻiroqlar"
        value={null}
        unit="count"
        status="error"
        spark={[5, 7]}
        sparkLabel="Kunlik qoʻngʻiroqlar"
      />,
    )
    expect(screen.getByText('Olinmadi')).toBeDefined()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('still holds a full soʻm figure under the chip', () => {
    render(
      <StatTile
        label="Bonus jamgʻarmasi"
        value={40_123_456_789}
        unit="money"
        money="full"
        icon={PhoneGlyph}
      />,
    )

    const figure = screen.getByText(formatFullUzs(40_123_456_789))
    expect(figure.closest('p')?.classList.contains('figure-sum')).toBe(true)
  })
})
