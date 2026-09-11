/**
 * Which question the board's SUMMARY answers — the tiles, the ROP panel and
 * the ROP filter's options.
 *
 * THE STATE SELECTION IS NOT IN IT, and that is the whole point. The tile band
 * deliberately does not follow its own selection: a band whose figures moved to
 * match the state you picked could not be used to compare one state against
 * another, which is the only reason to put six of them side by side. The ROP
 * panel and the ROP options ignore it for the same reason.
 *
 * So an answer already on screen stays CORRECT when the only thing that changed
 * is which states the table is narrowed to. Without a way to say that, the page
 * marked the whole response stale on every click of «Кутилмоқда» — six tiles
 * dropped to skeletons and came back with the identical numbers, a second
 * later, every time. The reader saw the screen reload and reasonably concluded
 * it was fetching something.
 *
 * Nor is the page number, the page size or the sort: they cut and order the
 * rows and cannot move a total.
 *
 * The value travels WITH the answer — the fetch stamps what it was asked for —
 * because that is the only way to know what the data on screen belongs to. A
 * placeholder response from the previous key looks identical otherwise, and
 * `isPlaceholderData` says "this is not from the current key" without saying
 * whether the difference mattered.
 */
export function boardSummaryKey(params: Record<string, string | number>): string {
  const { outcomes: _states, ...summary } = params
  return stable(summary)
}

/**
 * Which COHORT the board is measuring — the window and the mode, and nothing
 * else: the orders that arrived in `C4:NEW` in the selected period (or, in
 * backlog mode, everything still waiting). That is this board's cohort in the
 * sense CLAUDE.md uses the word.
 *
 * EVERY FILTER NARROWS INSIDE IT — the ROP, the search box, the region, the
 * сумма range. Ticking one of them, or clearing it, moves between a population
 * and a part of it: the figures that come back are over the same window, in
 * the same units, and are a subset or a superset of the ones on screen. So the
 * tiles DIM and keep their figures, the same signal the rows under them use.
 *
 * Only a moved WINDOW blanks them, because there the next figures genuinely
 * could be anything. It used to be the search, region and сумма too, and
 * «Filtrlarni tozalash» after a region filter then dropped six tiles to grey
 * and faded the whole page at once — the client read it as the page reloading
 * into something else (2026-09-11). The client asked for these filters to
 * behave «exceldagi filtrga oʻxshab»: you tick, you glance, you tick again.
 *
 * `boardSummaryKey` is the narrower question — whether the tiles are still
 * CORRECT — and every filter is in that one, so they are still refetched.
 */
export function boardCohortKey(params: Record<string, string | number>): string {
  const { preset, from, to, queue } = params
  // `JSON.stringify` omits undefined, so an absent key and a missing one agree.
  return stable({ preset, from, to, queue } as Record<string, string | number>)
}

/**
 * Sorted, so two objects that differ only in the order their keys were built
 * in cannot read as two different questions — `useDashboardFilters` builds
 * `apiParams` conditionally, and a filter cleared and set again arrives with
 * its keys in another order.
 */
function stable(params: Record<string, string | number>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))),
  )
}
