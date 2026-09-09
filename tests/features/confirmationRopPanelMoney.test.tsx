// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/*
  The page imports `useDashboardFilters`, which reads the address bar. The
  panel itself does not, but importing it pulls the module in — the same stub
  `confirmationAmountTiles.test.tsx` installs for `OutcomeTile`.
*/
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/confirmation',
  useSearchParams: () => new URLSearchParams(''),
}))

const { RopPanel } = await import('@/features/confirmation/ConfirmationPage')

/**
 * СТАТИСТИКА — РОП КЕСИМИДА, in orders AND in money.
 *
 * The client asked on 2026-09-09: «har bir rop jami va qaysi boʻlimda qancha
 * pul borligi ham koʻrinsin jadvalda, jami summa degan narsalar boʻlsin». Two
 * demands — a sum in every state cell, and a ЖАМИ that adds them up — and
 * three of the properties below are invisible when they break, which is why
 * they are pinned by a rendered panel rather than by a unit test on a helper.
 *
 *   1. FULL DIGITS. `formatCompactUzs` and `formatFullUzs` live one import
 *      apart, and «17 mln» beside «17,650,000» is not a shorter reading of one
 *      number — it is a number that cannot be reconciled against the Bitrix24
 *      kanban and the Telegram channel this board is read beside.
 *   2. ЖАМИ IS THE ROWS ON SCREEN, NOT `totals`. The panel is handed the
 *      UNFILTERED breakdown while `totals` is cut by the ROP filter, so the
 *      moment anybody picks a ROP a `totals`-fed footer would equal ONE of the
 *      lines above it. Both figures would be correct measurements of different
 *      populations printed under one word — the fault this page has already
 *      been burned by once.
 *   3. THE COUNT LEADS. The count is the tile band's headline and it is this
 *      table's too; a sum printed first would answer a question nobody asked
 *      first.
 */

const money = (amount: number) => ({
  amountMinor: String(amount * 100),
  currency: 'UZS',
  amount,
})

type PanelRows = Parameters<typeof RopPanel>[0]['rows']

const row = (
  rop: string,
  counts: {
    pending: number
    noAnswer: number
    confirmed: number
    rejected: number
    unconfirmedShipped: number
  },
  sums: {
    pending: number
    noAnswer: number
    confirmed: number
    rejected: number
    unconfirmedShipped: number
  },
) => ({
  rop,
  orders:
    counts.pending +
    counts.noAnswer +
    counts.confirmed +
    counts.rejected +
    counts.unconfirmedShipped,
  ...counts,
  amounts: {
    CONFIRM_NEW: money(sums.pending),
    NO_ANSWER: money(sums.noAnswer),
    CONFIRMED: money(sums.confirmed),
    REJECTED: money(sums.rejected),
    UNCONFIRMED_SHIPPED: money(sums.unconfirmedShipped),
  },
  amountTotal: money(
    sums.pending + sums.noAnswer + sums.confirmed + sums.rejected + sums.unconfirmedShipped,
  ),
})

const SEVINCH = row(
  'Sevinch',
  { pending: 1, noAnswer: 2, confirmed: 47, rejected: 3, unconfirmedShipped: 0 },
  {
    pending: 4_000_000,
    noAnswer: 250_000,
    confirmed: 1_240_000_000,
    rejected: 900_000,
    unconfirmedShipped: 0,
  },
)

const AZIZBEK = row(
  'Azizbek',
  { pending: 2, noAnswer: 1, confirmed: 12, rejected: 0, unconfirmedShipped: 1 },
  {
    pending: 1_100_000,
    noAnswer: 70_000,
    confirmed: 380_000_000,
    // A count of nought whose money is nought — the ordinary case.
    rejected: 0,
    unconfirmedShipped: 2_500_000,
  },
)

const panel = (rows: PanelRows, backlog = false) => (
  <RopPanel rows={rows} status="ready" backlog={backlog} />
)

/** The `<tr>` a ROP's name leads, by its row header. */
const lineOf = (name: string | RegExp) => screen.getByRole('row', { name })

/*
  The ЖАМИ line is found by its SECOND line, «барча РОП», because «ЖАМИ» alone
  also names the total COLUMN's header cell one row above it — which is the
  very ambiguity the second line exists to settle for the reader.
*/
const totalLineOf = () => screen.getByRole('row', { name: /барча РОП/ })

describe('the ROP panel prints what each state is worth', () => {
  it('prints every sum to the last digit, never compacted', () => {
    render(panel([SEVINCH]))

    const text = lineOf(/Sevinch/).textContent ?? ''

    expect(text).toContain('1,240,000,000')
    // The symptom, not the call: `formatCompactUzs` would print one of these.
    expect(text).not.toContain(' mln')
    expect(text).not.toContain(' mlrd')
    expect(text).not.toContain(' ming')
  })

  it('reads count first and sum second inside one cell', () => {
    render(panel([SEVINCH]))

    const text = lineOf(/Sevinch/).textContent ?? ''

    /*
      The same reading order the tile band pins. The count keeps the state's
      colour and the row's size; the sum sits under it a step quieter.
    */
    expect(text.indexOf('47')).toBeLessThan(text.indexOf('1,240,000,000'))
  })

  it('adds the rows on screen up into a ЖАМИ line', () => {
    render(panel([SEVINCH, AZIZBEK]))

    const total = totalLineOf()
    const text = total.textContent ?? ''

    // 69 orders: 53 + 16.
    expect(text).toContain('69')
    // ЖАМИ money: 1 245 150 000 + 383 670 000.
    expect(text).toContain('1,628,820,000')
    // And per state — CONFIRMED across both groups.
    expect(text).toContain('1,620,000,000')
    // The population is named, so it cannot be read as the tile above it.
    expect(within(total).getByText('барча РОП')).toBeTruthy()
  })

  it('follows the rows it was given, so it cannot disagree with the column above it', () => {
    /*
      PROPERTY 2, MEASURED RATHER THAN ASSERTED ABOUT THE SIGNATURE. The footer
      has to be a function of `rows` alone: a `totals` handed down from the page
      is cut by the ROP filter while this panel deliberately is not, so the two
      would part company the moment anybody picked a group — and both figures
      would be correct measurements of different populations under one word.

      Two renders of two different row sets. A footer fed from anywhere but its
      own rows would print the same figure twice.
    */
    const one = render(panel([SEVINCH]))
    expect(totalLineOf().textContent).toContain('1,245,150,000')
    one.unmount()

    render(panel([SEVINCH, AZIZBEK]))
    expect(totalLineOf().textContent).toContain('1,628,820,000')
    expect(totalLineOf().textContent).not.toContain('1,245,150,000')
  })

  it('prints one figure and not two where a state holds nothing', () => {
    render(panel([AZIZBEK]))

    const rejected = within(lineOf(/Azizbek/)).getAllByRole('cell')
    /*
      Column order: ЖАМИ, then the five states in the band's own order —
      Кутилмоқда, Кутармади (нд), Тасдиқланди, Тасдиқланмади, Тасдиқланмай
      чиқди — then ТАСДИҚЛАНИШ %. REJECTED is the fifth cell after the header.
      Its money is nought by construction and saying so twice is noise in a
      panel already mostly zero.
    */
    expect(rejected[4]?.textContent).toBe('0')
  })

  it('drops the five states in backlog mode and keeps the money', () => {
    render(panel([SEVINCH], true))

    expect(screen.getByText('ҲОЗИР КУТИЛМОҚДА')).toBeTruthy()
    expect(screen.queryByText('Тасдиқланди')).toBeNull()
    expect(screen.queryByText('ТАСДИҚЛАНИШ %')).toBeNull()
    // What survives still carries both readings — the whole point of the mode.
    expect(lineOf(/Sevinch/).textContent).toContain('1,245,150,000')
  })

  it('renders no total over no groups', () => {
    render(panel([]))

    expect(screen.getByText('РОП маълумоти йўқ')).toBeTruthy()
    // No table at all, so not even the column header — and no footer to invent
    // a total over nothing.
    expect(screen.queryByText('барча РОП')).toBeNull()
    expect(screen.queryByText('ЖАМИ')).toBeNull()
  })
})
