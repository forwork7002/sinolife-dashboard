// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/*
  The page imports `useDashboardFilters`, which reads the address bar. The tile
  itself does not, but importing it pulls the module in — the same stub
  `confirmationHistory.test.tsx` installs for `OutcomeCell`.
*/
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/confirmation',
  useSearchParams: () => new URLSearchParams(''),
}))

const { OutcomeTile } = await import('@/features/confirmation/ConfirmationPage')

/**
 * THE SUM UNDER EACH TILE, PRINTED TO THE LAST DIGIT.
 *
 * The client asked for the figure on 2026-09-09 and asked for it in full:
 * «aniq summani yoz toʻliq raqam koʻrinishda qisqartirilgan emas». That is not
 * a preference about taste. This board is read beside the floor's own Bitrix24
 * kanban and the Telegram channel the bot posts to, both of which print the
 * sum out digit for digit — «17 mln» beside «17,650,000» is not a shorter
 * reading of one number, it is a number that cannot be reconciled without
 * opening something else.
 *
 * `formatCompactUzs` is right for a chart axis and wrong here, and the two
 * live one import apart in `src/lib/format.ts`, so this test names the
 * symptom rather than the call.
 */

const money = (amount: number) => ({
  amountMinor: String(amount * 100),
  currency: 'UZS',
  amount,
})

const tile = (props: Partial<Parameters<typeof OutcomeTile>[0]> = {}) =>
  render(
    <OutcomeTile
      label="ТАСДИҚЛАНДИ"
      count={7}
      amount={money(17_650_000)}
      color="var(--status-good)"
      status="ready"
      active={false}
      onSelect={() => {}}
      {...props}
    />,
  )

describe('every tile in the state band carries its money', () => {
  it('prints the sum in full, with its unit beside it', () => {
    tile()

    expect(screen.getByText('17,650,000')).toBeTruthy()
    expect(screen.getByText('soʻm')).toBeTruthy()
  })

  it('never compacts it', () => {
    const { container } = tile({ amount: money(1_240_000_000) })
    const text = container.textContent ?? ''

    expect(text).toContain('1,240,000,000')
    // The three suffixes `formatCompactUzs` can produce. Any of them here
    // means the wrong formatter was reached for.
    for (const unit of [' mln', ' mlrd', ' ming']) expect(text).not.toContain(unit)
  })

  it('keeps the count as the headline and the sum under it', () => {
    const { container } = tile()
    const text = container.textContent ?? ''

    // Reading order: the figure, the state it belongs to, then what it is
    // worth. A sum above the label would read as the label's own number.
    expect(text.indexOf('7')).toBeLessThan(text.indexOf('ТАСДИҚЛАНДИ'))
    expect(text.indexOf('ТАСДИҚЛАНДИ')).toBeLessThan(text.indexOf('17,650,000'))
  })

  it('prints a measured zero rather than an em dash', () => {
    // A state nobody reached is worth nothing, and that is a measurement. The
    // dash is for an answer that never arrived.
    tile({ count: 0, amount: money(0) })

    // Two of them: the count and the sum. `getAllByText` rather than
    // `getByText`, which throws on a second match.
    expect(screen.getAllByText('0')).toHaveLength(2)
    expect(screen.getByText('soʻm')).toBeTruthy()
  })

  it('shows a skeleton for the sum while the window is loading', () => {
    /*
      Two skeletons, not one. The tile used to have a single bar for the count,
      and leaving the money line to render `—` under it put a dash on screen
      that means "no data" on a tile whose data was simply in flight.
    */
    const { container } = tile({ status: 'loading' })

    expect(container.querySelectorAll('.skeleton')).toHaveLength(2)
    expect(container.textContent).not.toContain('17,650,000')
  })

  it('drops the whole money line when the request failed', () => {
    /*
      «Olinmadi» answers for the tile. An em dash under it would read as a
      third state — count unavailable, sum merely empty — and the tile has no
      figure to print either way.
    */
    const { container } = tile({ status: 'error', amount: null })

    expect(screen.getByText('Olinmadi')).toBeTruthy()
    expect(container.textContent).not.toContain('soʻm')
    expect(container.textContent).not.toContain('—')
  })
})
