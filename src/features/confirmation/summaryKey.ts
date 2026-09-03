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
  /*
    Sorted, so two objects that differ only in the order their keys were built
    in cannot read as two different questions — `useDashboardFilters` builds
    `apiParams` conditionally, and a filter cleared and set again arrives with
    its keys in another order.
  */
  return JSON.stringify(
    Object.fromEntries(Object.entries(summary).sort(([a], [b]) => a.localeCompare(b))),
  )
}
