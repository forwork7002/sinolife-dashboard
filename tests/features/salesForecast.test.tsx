// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SellerBoardDto, SellerBoardRowDto } from '@/lib/api'
import { formatFullUzs } from '@/lib/format'

/**
 * PROGNOZ — what the block promises, and the three absences it must name.
 *
 * A projection is the one figure on this screen that is not a measurement, and
 * every way it can mislead is quiet: a total printed under a forecast heading
 * once the period is over, a zero printed for a seller who simply has not
 * delivered yet, or a horizon the reader is left to assume. None of the three
 * throws, and all three are read off the screen as facts about the month.
 *
 * The block is rendered directly rather than through `ForecastSection`, which
 * is one `useQuery` and nothing worth asserting — see `ForecastBand`.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/analytics/sales',
  useSearchParams: () => new URLSearchParams(''),
}))

/*
  jsdom has no `matchMedia`, and `AnimatedNumber` inside every money tile asks
  it whether the reader wants motion. Answering "yes, reduced" is also the
  honest answer for a test: the figure is printed once rather than counted up,
  so what `getAllByText` reads is the final value instead of whichever frame it
  caught. Same stub `faktQueueBand.test.tsx` installs, for the same reason.
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

// Auto-cleanup is not in force here, and every case below renders the same
// fixture: without this the second one fails with "found multiple" on a figure
// the first also printed.
afterEach(cleanup)

const { ForecastBand } = await import('@/features/sales/ForecastSection')

function money(amount: number) {
  return { amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount }
}

/** A money figure prints twice — the animated copy and the `sr-only` one. */
const figure = (value: string) => screen.getAllByText(value).length

function seller(over: {
  employeeId: string
  ordered: number
  won: number
  forecast: { fakt1: number | null; fakt2: number | null }
}): SellerBoardRowDto {
  return {
    rank: 1,
    employeeId: over.employeeId,
    fullName: over.employeeId,
    rop: 'Lola',
    ordered: money(over.ordered),
    won: money(over.won),
    forecast: {
      fakt1: over.forecast.fakt1 === null ? null : money(over.forecast.fakt1),
      fakt2: over.forecast.fakt2 === null ? null : money(over.forecast.fakt2),
    },
  } as unknown as SellerBoardRowDto
}

/** Only the fields `ForecastBand` reads; the DTO carries two dozen more. */
function board(over: {
  elapsedPercent: number
  fakt1: number | null
  fakt2: number | null
  rows?: readonly SellerBoardRowDto[]
}): SellerBoardDto {
  return {
    rows: over.rows ?? [],
    teams: [],
    basis: 'confirmation_queue',
    totals: {
      ordered: money(1_103_710_001),
      won: money(666_820_000),
    },
    forecast: {
      elapsedPercent: over.elapsedPercent,
      // 1 October in Tashkent — the first instant NOT projected.
      windowEnd: '2026-09-30T19:00:00.000Z',
      fakt1: over.fakt1 === null ? null : money(over.fakt1),
      fakt2: over.fakt2 === null ? null : money(over.fakt2),
      buckets: [],
    },
  } as unknown as SellerBoardDto
}

/** September 2026 at 27.9% elapsed — the shape the service returns live. */
const RUNNING = board({
  elapsedPercent: 27.9,
  fakt1: 3_954_158_426,
  fakt2: 2_389_000_000,
})

describe('the projection states its method and its horizon', () => {
  it('prints both facts projected, each beside what has already landed', () => {
    render(<ForecastBand data={RUNNING} status="ready" />)

    /*
      FAKT 1 AND FAKT 2 TOGETHER, which is the whole point of the block. The
      payload carried only the second until 2026-09-16, and on this cohort that
      is the half that moves last — delivery lags the arrival it is projected
      from by about two days, so a board projecting only FAKT 2 reported every
      team behind on every morning of a normal month.
    */
    expect(figure(formatFullUzs(3_954_158_426))).toBeGreaterThan(0)
    expect(figure(formatFullUzs(2_389_000_000))).toBeGreaterThan(0)

    // And the measured pair it is made from, so neither figure stands alone.
    expect(screen.getByText(`hozir ${formatFullUzs(1_103_710_001)}`)).toBeDefined()
    expect(screen.getByText(`hozir ${formatFullUzs(666_820_000)}`)).toBeDefined()
  })

  it('names how much of the period the claim rests on, and the date it runs to', () => {
    render(<ForecastBand data={RUNNING} status="ready" />)

    // «28%» alone does not say WHICH month, and on «Shu hafta» it is not a
    // month at all. The horizon is printed as the last day INSIDE the window —
    // 30-sen, never the half-open bound of 1-okt.
    expect(screen.getByText('28%')).toBeDefined()
    expect(screen.getByText(/prognoz 30-sen gacha/)).toBeDefined()
    expect(screen.getByText(/Shu surʼatda davom etsa/)).toBeDefined()
  })

  it('states what is still to come, not only where the period lands', () => {
    render(<ForecastBand data={RUNNING} status="ready" />)

    // «The month ends at 3.9 mlrd» is a verdict; «2.8 mlrd still to find» is a
    // target somebody can be given this morning.
    expect(screen.getAllByText('prognoz minus hozirgi').length).toBe(2)
  })
})

describe('the three absences are named, never printed as a zero', () => {
  it('says a finished period is a result rather than showing it as a forecast', () => {
    render(
      <ForecastBand
        data={board({ elapsedPercent: 100, fakt1: null, fakt2: null })}
        status="ready"
      />,
    )

    expect(screen.getByText(/Davr yakunlangan — bu allaqachon natija/)).toBeDefined()
    expect(screen.queryByText(/Shu surʼatda davom etsa/)).toBeNull()
  })

  it('says it is too early rather than dividing by a sliver of a month', () => {
    /*
      At 00:30 on the 1st, dividing half an hour of orders by 0.07% of the
      month "projects" whatever the night shift took, multiplied by 1400.
      `PROJECTION_ELAPSED_FLOOR` refuses below 2% and the screen says which
      refusal this is — the wording differs from the finished case because the
      action differs: one reader should come back later, the other should not.
    */
    render(
      <ForecastBand data={board({ elapsedPercent: 1, fakt1: null, fakt2: null })} status="ready" />,
    )

    expect(screen.getByText(/prognoz uchun erta/)).toBeDefined()
    expect(screen.queryByText(/Davr yakunlangan/)).toBeNull()
  })

  it('prints an em dash for a seller with no projection, and never 0 soʻm', () => {
    render(
      <ForecastBand
        data={board({
          elapsedPercent: 27.9,
          fakt1: 3_954_158_426,
          fakt2: 2_389_000_000,
          rows: [
            seller({
              employeeId: 'Sotuvchi A',
              ordered: 100_000_000,
              won: 40_000_000,
              forecast: { fakt1: 358_000_000, fakt2: 143_000_000 },
            }),
            seller({
              employeeId: 'Sotuvchi B',
              ordered: 0,
              won: 0,
              forecast: { fakt1: null, fakt2: null },
            }),
          ],
        })}
        status="ready"
      />,
    )

    expect(screen.getByText('Sotuvchi A')).toBeDefined()
    expect(figure(formatFullUzs(358_000_000))).toBeGreaterThan(0)

    /*
      «0 soʻm» under a column headed «prognoz» tells a seller who took an order
      this morning that their month ends at nothing. Two em dashes — one per
      projection column — is the honest rendering, and the zeros beside them
      are the MEASURED columns, which really are zero.
    */
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })
})
