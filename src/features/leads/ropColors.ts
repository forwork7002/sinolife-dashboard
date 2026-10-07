/**
 * The ROP teams' colours on «Lidlar»'s day cards: the split's bars and grid
 * read the same list, so a team is one colour on the page. «ROP otchet» (on
 * «RNP jadvali» since 2026-10-07) takes its slots in its own order.
 *
 * Nine teams against seven usable series slots (--series-8 sits on
 * --status-critical): the last two are mixes, picked by eye in both themes to
 * stand apart from the seven.
 */
export const ROP_COLORS: readonly string[] = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-7)',
  'var(--series-6)',
  'color-mix(in oklab, var(--series-8) 50%, var(--series-7))',
  'color-mix(in oklab, var(--series-5) 45%, var(--series-6))',
]

/**
 * The ink a label takes ON each of those fills, index for index — measured per
 * fill in both themes (`--ink-on-series` in globals.css has every figure). The
 * split bar printed white on all nine: in light that failed teal, amber, pink
 * and the pink/olive mix, and in dark it failed every one of them.
 */
const ROP_INKS: readonly string[] = [
  'var(--ink-on-series)',
  'var(--ink-on-series)',
  'var(--ink-on-series-bright)',
  'var(--ink-on-series-bright)',
  'var(--ink-on-series-bright)',
  'var(--ink-on-series)',
  'var(--ink-on-series)',
  // red/violet: light 4.66 (white) · dark 5.53
  'var(--ink-on-series)',
  // pink/olive: light 4.77 · dark 5.20, dark ink in both
  'var(--ink-on-series-bright)',
]

/** The label ink for a fill from ROP_COLORS; any other fill takes `--ink-on-series`. */
export function ropInk(color: string): string {
  const at = ROP_COLORS.indexOf(color)
  return at < 0 ? 'var(--ink-on-series)' : ROP_INKS[at]!
}
