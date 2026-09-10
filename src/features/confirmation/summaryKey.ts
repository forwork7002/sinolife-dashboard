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
 * Which POPULATION the board is measuring — the window, the search box, the
 * region and the сумма range, and nothing else.
 *
 * ONE STEP WIDER THAN `boardSummaryKey`, and the extra step is the ROP
 * selection. The two differ in what they are used for, which is why they are
 * two functions and not one:
 *
 *   * `boardSummaryKey` says whether the tiles are still CORRECT. Ticking a
 *     ROP changes what they should read, so it is in that key.
 *   * this one says whether they are still ABOUT the same thing. Ticking a ROP
 *     narrows a population that is already on screen — the new figures are a
 *     subset of the ones being shown, in the same units, over the same window —
 *     so it is not in this one.
 *
 * WHAT THE DIFFERENCE BUYS. A tile band that drops to six skeletons is a claim
 * that the numbers coming back could be anything, which is true when the window
 * moves and false when a group is ticked. The client asked for these filters to
 * behave «exceldagi filtrga oʻxshab» — you tick, you glance, you tick again —
 * and rebuilding the whole band from grey on every tick made a two-second job
 * out of a comparison the reader was holding in their head. Between these two
 * keys the band DIMS instead: the figures stay legible and stay marked as one
 * selection behind, which is exactly what they are, and is the same signal the
 * rows under them already use.
 */
export function boardCohortKey(params: Record<string, string | number>): string {
  const { outcomes: _states, rops: _groups, rop: _legacy, ...cohort } = params
  return stable(cohort)
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
