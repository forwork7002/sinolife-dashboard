// @vitest-environment jsdom
import { readFileSync } from 'node:fs'

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ConfirmationOrderDto, ConfirmationVisitDto } from '@/lib/api'

/**
 * AN ORDER THAT CAME BACK STILL HAS TO SHOW WHERE IT WAS.
 *
 * The Тасдиклаш board is one row per order, dated by its LAST arrival in
 * `C4:NEW`. That is deliberate — their bot and their own dashboard both keep
 * one entry per deal, and a board that counted visits would let «тасдиқланиш
 * %» exceed the orders it divides — but it has a cost the floor met head-on:
 * deal 834920 arrived on 2026-08-29, was confirmed the same afternoon, was
 * pulled back into Тасдиклаш on the 31st and refused there. The row moved to
 * the 31st, and the 29th, whose Telegram channel had announced the order that
 * morning, showed nothing. Six of the 127 orders that arrived on 2026-08-29
 * moved off the day the same way.
 *
 * So the row carries its earlier visits down the СТАТУС cell. The whole risk
 * in that is arithmetic: an earlier visit that reads as a state of its own is
 * one order counted twice. These tests hold both halves — the history is
 * VISIBLE, and it is COUNTED NOWHERE.
 */

// The page reads the URL through `useDashboardFilters` at module scope.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/confirmation',
  useSearchParams: () => new URLSearchParams(''),
}))

const { OutcomeCell } = await import('@/features/confirmation/ConfirmationPage')

function visit(over: Partial<ConfirmationVisitDto> & { no: number }): ConfirmationVisitDto {
  return {
    queuedAt: '2026-08-29T12:05:46.000Z',
    outcome: 'CONFIRMED',
    decidedAt: null,
    ...over,
  }
}

/** Only the fields `OutcomeCell` reads; the row itself carries twenty more. */
function row(queueHistory: ConfirmationVisitDto[]): ConfirmationOrderDto {
  return {
    outcome: queueHistory[0]?.outcome ?? 'CONFIRM_NEW',
    queueHistory,
  } as unknown as ConfirmationOrderDto
}

/*
  Deal 834920, as the portal holds it. Tashkent is UTC+5, so 12:05Z is the
  afternoon of the 29th and 13:18Z the evening of the 31st.
*/
const RETURNED = row([
  visit({ no: 2, outcome: 'REJECTED', queuedAt: '2026-08-31T13:18:28.000Z' }),
  visit({ no: 1, outcome: 'CONFIRMED', queuedAt: '2026-08-29T12:05:46.000Z' }),
])

describe('the СТАТУС cell', () => {
  it('shows one chip and nothing else for an order that came once', () => {
    /*
      121 of those 127 rows. A table that grew a second line on every row to
      serve the other six would have made the exception invisible by charging
      the whole board for it.
    */
    render(<OutcomeCell row={row([visit({ no: 1, outcome: 'CONFIRMED' })])} />)

    expect(screen.getByText('Тасдиқланди')).toBeDefined()
    expect(screen.queryByText(/1-марта/)).toBeNull()
    expect(screen.queryByText(/2026-08-29/)).toBeNull()
  })

  it('shows the current state and the one before it, each with its day', () => {
    render(<OutcomeCell row={RETURNED} />)

    // Where it stands now — the chip it has always been.
    expect(screen.getByText('Тасдиқланмади')).toBeDefined()
    // Where it stood on the day it left, which is the fact that was lost.
    expect(screen.getByText('Тасдиқланди')).toBeDefined()
    expect(screen.getByText(/1-марта · 2026-08-29 17:05/)).toBeDefined()
  })

  it('puts the current state FIRST, so the cell reads as a state with a past', () => {
    /*
      Not a list of two equals. The row is filed under `queueHistory[0]`
      everywhere else on the screen — the tiles, the panel, the state filter,
      the bell — so the eye has to land on it first.
    */
    const { container } = render(<OutcomeCell row={RETURNED} />)
    const text = container.textContent ?? ''

    expect(text.indexOf('Тасдиқланмади')).toBeLessThan(text.indexOf('Тасдиқланди'))
  })

  it('names the earlier state for a screen reader, which cannot see the pill', () => {
    /*
      Sighted readers get the hierarchy from the chip's shape and the hairline
      under it. Without the prefix a screen reader hears «Тасдиқланмади
      Тасдиқланди 1-марта · 2026-08-29 17:05» — two state names in the one
      column an operator reads the row's state from.
    */
    render(<OutcomeCell row={RETURNED} />)

    expect(screen.getByText(/Аввалги ҳолат/)).toBeDefined()
  })

  it('chains a visit even when 🔁 is silent about it', () => {
    /*
      THE MARK'S THRESHOLD IS ELAPSED TIME; THE BOARD IS CUT INTO DAYS.

      Gating this cell on `queueReturns` was written and reverted. An order
      that arrives 2026-09-02 22:00, is confirmed at 23:00 and comes back at
      01:00 has a two-hour gap, so «🔁 ҚАЙТА ТУШДИ» stays silent — and its row
      still leaves the 2nd for the 3rd, because the cohort dates it by the last
      arrival. That operator needs the chain MORE than the marked rows do, not
      less: it is the only thing standing between them and deal 834920's
      failure wearing a different clock.
    */
    const straddled = row([
      visit({ no: 2, outcome: 'CONFIRM_NEW', queuedAt: '2026-09-02T20:00:00.000Z' }),
      visit({ no: 1, outcome: 'CONFIRMED', queuedAt: '2026-09-02T18:00:00.000Z' }),
    ])
    render(<OutcomeCell row={{ ...straddled, queueReturns: 0, queueEntries: 2 }} />)

    // Tashkent is UTC+5: 18:00Z is 23:00 on the 2nd, 20:00Z is 01:00 on the 3rd.
    expect(screen.getByText('Кутилмоқда')).toBeDefined()
    expect(screen.getByText(/1-марта · 2026-09-02 23:00/)).toBeDefined()
  })

  it('does not call a finished visit «Кутилмоқда»', () => {
    /*
      Only five stages speak. An order that went C4:NEW → «Счёт» → C4:NEW
      reached no signal inside its first visit, so the repository reports that
      visit as CONFIRM_NEW — true of the signal, false of the world: the order
      is not waiting in a queue it demonstrably left. 19 of the 192 orders
      that came back in a month have at least one such visit.

      The current state keeps the word, because there it is true.
    */
    render(
      <OutcomeCell
        row={row([
          visit({ no: 2, outcome: 'CONFIRM_NEW', queuedAt: '2026-08-31T13:00:00.000Z' }),
          visit({ no: 1, outcome: 'CONFIRM_NEW', queuedAt: '2026-08-29T12:00:00.000Z' }),
        ])}
      />,
    )

    expect(screen.getByText('Кутилмоқда')).toBeDefined()
    expect(screen.getByText('Ҳал бўлмаган')).toBeDefined()
  })

  it('falls back to the row\'s own outcome when the list did not arrive', () => {
    // The chip is the load-bearing half and must not vanish because an older
    // client, or a cached answer, carried no history.
    render(<OutcomeCell row={row([])} />)

    expect(screen.getByText('Кутилмоқда')).toBeDefined()
  })
})

/** Assertions about source read the code, never the prose explaining it. */
const bare = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\/[^\n]*/g, '')

describe('the cell renders the list, it does not edit it', () => {
  it('never re-derives the return rule the server already applied', () => {
    /*
      A component that filtered the list on its own would be a second copy of
      REPEAT_GAP_HOURS, free to drift from the mark two columns to its left —
      and the version of that filter which was actually written re-introduced
      the bug this feature exists to fix. The rule lives in one place; this
      cell shows what it is given.
    */
    const page = readFileSync('src/features/confirmation/ConfirmationPage.tsx', 'utf8')

    expect(page).not.toContain('REPEAT_GAP_HOURS')
    expect(page).not.toMatch(/queueHistory[\s\S]{0,80}\.filter\(/)
    expect(page).not.toMatch(/queueReturns[\s\S]{0,40}queueHistory/)
  })
})

describe('the history is shown and never summed', () => {
  const page = bare('src/features/confirmation/ConfirmationPage.tsx')
  const service = bare('src/server/services/insightsService.ts')

  it('reads queueHistory in the status cell and nowhere else on the page', () => {
    /*
      The five tiles come from `totals.byOutcome`, the Статистика panel from
      `byRop`, and both are summed server-side from the ONE outcome per order
      the cohort agreed on. A tile that learned to walk `queueHistory` would
      count an order confirmed in August and refused in September twice.
    */
    const uses = page.match(/queueHistory/g) ?? []
    expect(uses).toHaveLength(1) // destructured in OutcomeCell, and nowhere else

    expect(page).toContain('const [current, ...earlier] = row.queueHistory')
    expect(page).toContain('if (earlier.length === 0)')
  })

  it('keeps the totals on the single outcome the cohort agreed on', () => {
    for (const key of ['pending', 'confirmed', 'noAnswer', 'rejected', 'unconfirmedShipped']) {
      expect(service).toContain(`r.${key}`)
    }
    // The tiles are the ROP breakdown summed down its columns — not a pass
    // over any per-visit list.
    expect(service).not.toContain('queueHistory.filter')
    expect(service).not.toContain('queueHistory.reduce')
  })
})
