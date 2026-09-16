// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { CallRowTable } from '@/features/customers/CallRowTable'
import type { CallRowDto } from '@/lib/api'
import { NO_VALUE } from '@/lib/format'

/**
 * The call block cannot be seen locally — `call_record` is EMPTY on the demo
 * seed (0 rows, checked 2026-09-16), so every local render is an empty state and
 * the only place this table has ever drawn is production. That is exactly the
 * case a test has to carry: the rows below are the «Baza / Baza emas» split read
 * from production above the data floor on 2026-09-16.
 *
 * What it pins is the claim the table makes that a reader would otherwise take
 * on trust: the MEAN and the MEDIAN are both printed, and they differ. An edit
 * that keeps one «to save a column» removes the reason this block reports a
 * distribution at all.
 */
const SIDES: CallRowDto[] = [
  {
    key: 'BAZA',
    label: 'Baza mijozi',
    calls: 2_261,
    connected: 680,
    connectPercent: 30.1,
    talkSec: 101_705, // mean 149.6 s → 2:30
    medianSec: 86, //                 → 1:26
    p90Sec: 372,
    customers: 1_783,
  },
  {
    key: 'NOT_BAZA',
    label: 'Baza emas',
    calls: 8_834,
    connected: 2_538,
    connectPercent: 28.7,
    talkSec: 429_587, // mean 169.3 s → 2:49
    medianSec: 46, //                 → 46 s
    p90Sec: 557,
    customers: 5_579,
  },
  {
    // A team that dialled and reached nobody — «Hayot», two calls, on the same
    // production read. The row that breaks a table computing its own mean
    // without a guard.
    key: 'Hayot',
    label: 'Hayot',
    calls: 2,
    connected: 0,
    connectPercent: 0,
    talkSec: 0,
    medianSec: null,
    p90Sec: null,
    customers: 2,
  },
]

/*
  jsdom HAS NO ResizeObserver, and `DataTable`'s pinned-column measurement
  constructs one unguarded — no other test renders a table with
  `stickyColumns`, which is why nothing tripped on it before. Stubbed HERE and
  not guarded in `DataTable.tsx`: that file reaches «Tasdiqlash navbati», which
  the client has put out of bounds for unasked changes, and a browser always has
  the real thing.
*/
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

function rowOf(name: string): HTMLElement {
  const header = screen.getByRole('rowheader', { name })
  const row = header.closest('tr')
  expect(row).not.toBeNull()
  return row as HTMLElement
}

describe('the call row table', () => {
  it('prints the mean AND the median, and they are allowed to disagree', () => {
    render(<CallRowTable rows={SIDES} nameHeader="Mijoz turi" status="ready" />)

    const baza = within(rowOf('Baza mijozi'))
    expect(baza.getByText('2:30')).toBeTruthy()
    expect(baza.getByText('1:26')).toBeTruthy()

    const notBaza = within(rowOf('Baza emas'))
    expect(notBaza.getByText('2:49')).toBeTruthy()
    expect(notBaza.getByText('46 s')).toBeTruthy()
  })

  it('never divides by zero — a row that reached nobody prints no durations', () => {
    render(<CallRowTable rows={SIDES} nameHeader="Komanda" status="ready" />)

    const row = rowOf('Hayot')
    // Mean, median and p90 all absent — three em dashes, not «0 s» three
    // times, which would state three measurements nobody made.
    expect(within(row).getAllByText(NO_VALUE)).toHaveLength(3)
    // A whole cell reading «0 s» — not a substring, which «0 soat» would match.
    expect(within(row).queryByText('0 s')).toBeNull()
  })

  it('keeps the order it was given — the server ranked it', () => {
    render(<CallRowTable rows={SIDES} nameHeader="Mijoz turi" status="ready" />)
    const names = screen.getAllByRole('rowheader').map((cell) => cell.textContent)
    expect(names).toEqual(['Baza mijozi', 'Baza emas', 'Hayot'])
  })

  it('has loading, error and empty renderings, and they are three different things', () => {
    const { rerender } = render(
      <CallRowTable rows={[]} nameHeader="Operator" status="loading" />,
    )
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()

    rerender(
      <CallRowTable rows={[]} nameHeader="Operator" status="error" errorMessage="Olinmadi — qayta urinib koʻring" />,
    )
    expect(screen.getByText('Olinmadi — qayta urinib koʻring')).toBeTruthy()

    rerender(<CallRowTable rows={[]} nameHeader="Operator" status="ready" />)
    expect(screen.getByText('Bu davrda qoʻngʻiroq yoʻq')).toBeTruthy()
  })
})
