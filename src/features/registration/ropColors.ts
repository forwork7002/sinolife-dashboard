/**
 * The ROP teams' colours on «Registratsiya»: the split's bars and grid and
 * «ROP otchet» read the same list, so a team is one colour on the page.
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
