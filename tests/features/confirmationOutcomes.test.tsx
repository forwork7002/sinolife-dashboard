// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { SellerBoardTotalsDto } from '@/lib/api'
import { formatFullUzs, formatNumber } from '@/lib/format'

/**
 * WHERE THE WHOLE QUEUE WENT — the five states of the confirmation cohort,
 * as a partition of one total, on Savdo dinamikasi.
 *
 * Asked for on 2026-09-15: «tasdiqlanganlar, tasdiqlanmay chiqdilar bilan
 * tasdiqlanmaganlar nisbati». The hero above it prints FAKT 1 with the two
 * shipped states already folded together; this block is the fold undone, in
 * the Тасдиқлаш board's own vocabulary and colours, so a reader can carry a
 * number from one screen to the other without translating it.
 *
 * What is pinned: the five parts are printed with their COUNT, their SHARE
 * of the cohort and their MONEY, the shares are of `cohortOrders` (not of
 * FAKT 1), and the two states of "not measured here" and "nothing came in"
 * are said in words rather than drawn as an empty bar.
 */

afterEach(cleanup)

const { OutcomePartition } = await import('@/features/sales/ConfirmationOutcomeSection')

function money(amount: number) {
  return { amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount }
}

/** August 2026 on production, to the order. */
const AUGUST = {
  cohortOrders: 3222,
  orders: 2890,
  confirmedRate: 89.2,
  outcomes: {
    CONFIRMED: { orders: 2873, amount: money(4_675_200_000) },
    UNCONFIRMED_SHIPPED: { orders: 17, amount: money(31_200_000) },
    REJECTED: { orders: 331, amount: money(562_900_000) },
    NO_ANSWER: { orders: 0, amount: money(0) },
    CONFIRM_NEW: { orders: 1, amount: money(1_600_000) },
  },
} as unknown as SellerBoardTotalsDto

describe('OutcomePartition', () => {
  it('prints every state with its count, its share of the cohort and its money', () => {
    render(<OutcomePartition totals={AUGUST} status="ready" />)

    expect(screen.getByText('Тасдиқланди')).toBeTruthy()
    expect(screen.getByText('Тасдиқланмай чиқди')).toBeTruthy()
    expect(screen.getByText('Тасдиқланмади')).toBeTruthy()
    expect(screen.getByText('Кутармади (нд)')).toBeTruthy()
    expect(screen.getByText('Кутилмоқда')).toBeTruthy()

    expect(screen.getByText(`${formatNumber(2873)} ta`)).toBeTruthy()
    expect(screen.getByText(`${formatNumber(331)} ta`)).toBeTruthy()
    expect(screen.getByText(`${formatNumber(17)} ta`)).toBeTruthy()

    // Shares are of everything that entered the queue — 3 222 — not of FAKT 1.
    expect(screen.getByText('89.2%')).toBeTruthy()
    expect(screen.getByText('10.3%')).toBeTruthy()
    expect(screen.getByText('0.5%')).toBeTruthy()

    expect(screen.getByText(formatFullUzs(4_675_200_000))).toBeTruthy()
    expect(screen.getByText(formatFullUzs(562_900_000))).toBeTruthy()
  })

  it('draws the bar as the five shares of one cohort', () => {
    render(<OutcomePartition totals={AUGUST} status="ready" />)

    const bar = screen.getByRole('img')
    // The accessible name is the partition in words, in the same order.
    expect(bar.getAttribute('aria-label')).toContain('Тасдиқланди 89.2%')
    expect(bar.getAttribute('aria-label')).toContain('Тасдиқланмади 10.3%')
    // A state with nothing in it draws no segment — 0% is 0px, never a sliver.
    expect(bar.querySelectorAll('div')).toHaveLength(4)
  })

  it('says so when nothing entered the queue, rather than drawing an empty rail', () => {
    // An empty window on the queue basis: five states of nothing, cohort 0.
    const none = { orders: 0, amount: money(0) }
    render(
      <OutcomePartition
        totals={
          {
            ...AUGUST,
            cohortOrders: 0,
            confirmedRate: null,
            outcomes: {
              CONFIRMED: none,
              UNCONFIRMED_SHIPPED: none,
              REJECTED: none,
              NO_ANSWER: none,
              CONFIRM_NEW: none,
            },
          } as unknown as SellerBoardTotalsDto
        }
        status="ready"
      />,
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/navbatga buyurtma tushmagan/)).toBeTruthy()
  })

  it('says the states are not measured on the intake basis, where the payload carries null', () => {
    render(
      <OutcomePartition
        totals={{ ...AUGUST, outcomes: null, confirmedRate: null } as unknown as SellerBoardTotalsDto}
        status="ready"
      />,
    )
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/oʻlchanmaydi/)).toBeTruthy()
  })

  it('shows a skeleton while loading and a failure in words', () => {
    const { unmount } = render(<OutcomePartition totals={undefined} status="loading" />)
    expect(screen.getByRole('status')).toBeTruthy()
    unmount()

    render(<OutcomePartition totals={undefined} status="error" />)
    expect(screen.getByText('Olinmadi')).toBeTruthy()
  })
})
