import { describe, expect, it } from 'vitest'

import { boardSummaryKey } from '@/features/confirmation/summaryKey'

/**
 * THE TILE BAND DOES NOT FOLLOW ITS OWN SELECTION, so a click on one of them
 * cannot change a figure above the table — and the page must not act as though
 * it did.
 *
 * It used to mark the whole response stale on `isPlaceholderData`, which is
 * true for any key change at all: picking «Кутилмоқда» dropped six tiles to
 * skeletons and brought them back a second later with the identical numbers.
 * Every time. The reader saw the board reload and reasonably concluded it was
 * fetching something it needed.
 *
 * This key is what separates "another question" from "the same question, cut
 * differently". Get it wrong in one direction and the flicker comes back; get
 * it wrong in the other and a window change leaves last window's totals on
 * screen with nothing saying so.
 */
describe('the board summary key', () => {
  const base = { preset: 'today', rop: 'Sevinch', q: '944' }

  it('ignores the state selection, which the tiles do not read', () => {
    expect(boardSummaryKey({ ...base, outcomes: 'CONFIRM_NEW' })).toBe(
      boardSummaryKey({ ...base, outcomes: 'REJECTED,NO_ANSWER' }),
    )
    expect(boardSummaryKey({ ...base, outcomes: 'CONFIRMED' })).toBe(boardSummaryKey(base))
  })

  it('changes with the window, which moves every figure on the board', () => {
    expect(boardSummaryKey({ ...base, preset: 'yesterday' })).not.toBe(boardSummaryKey(base))
    expect(boardSummaryKey({ preset: 'custom', from: '2026-08-01', to: '2026-08-31' })).not.toBe(
      boardSummaryKey({ preset: 'custom', from: '2026-08-01', to: '2026-08-30' }),
    )
  })

  it('changes with the ROP and the search box, which narrow the tiles too', () => {
    expect(boardSummaryKey({ ...base, rop: 'Lola' })).not.toBe(boardSummaryKey(base))
    expect(boardSummaryKey({ ...base, q: '945' })).not.toBe(boardSummaryKey(base))
    // Cleared is not the same question as set — the tiles widen when it goes.
    expect(boardSummaryKey({ preset: 'today' })).not.toBe(boardSummaryKey({ ...base, rop: 'x' }))
  })

  it('does not depend on the order the filters were built in', () => {
    /*
      `useDashboardFilters` assembles `apiParams` conditionally, so a filter
      cleared and set again arrives with its keys in another order. Two objects
      holding the same filters are the same question however they were built —
      without this, clearing and re-picking one ROP would blink the band.
    */
    expect(boardSummaryKey({ preset: 'today', rop: 'Sevinch', q: '944' })).toBe(
      boardSummaryKey({ q: '944', preset: 'today', rop: 'Sevinch' }),
    )
  })

  it('ignores the queue mode nowhere: the backlog is a different population', () => {
    // `queue=backlog` drops the window entirely and lists what is waiting, so
    // the totals under it are a different set of orders.
    expect(boardSummaryKey({ preset: 'today', queue: 'backlog' })).not.toBe(
      boardSummaryKey({ preset: 'today' }),
    )
  })
})
