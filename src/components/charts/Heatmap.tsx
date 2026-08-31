'use client'

import { formatPercent } from '@/lib/format'

/**
 * A cohort matrix.
 *
 * Magnitude is encoded on ONE hue, light to dark, because the value is a
 * quantity and not a category — a rainbow here would invent boundaries the
 * data does not have. The value is printed in every cell as well, so the
 * reading never depends on judging a shade, and a null cell is left blank
 * rather than painted at zero: a cohort three months old has no twelve-month
 * column, and drawing one at 0% would report a collapse that has not happened.
 *
 * Ink flips to white on the darkest two steps to stay above the contrast
 * floor; a fixed ink colour fails at one end of any sequential ramp.
 */
export function CohortHeatmap({
  rows,
  maxColumns = 13,
}: {
  readonly rows: readonly {
    readonly cohort: string
    readonly size: number
    readonly retention: readonly (number | null)[]
  }[]
  maxColumns?: number
}) {
  if (rows.length === 0) return null

  const columns = Math.min(
    maxColumns,
    rows.reduce((max, r) => Math.max(max, r.retention.length), 0),
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: '2px' }}>
        <caption className="sr-only">
          Kogorta bo‘yicha ushlab qolish: har bir qator — birinchi xarid oyi, har bir ustun — o‘sha
          oydan keyingi oylar.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 px-2 py-1.5 text-left text-[11px] font-medium"
              style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}
            >
              Kogorta
            </th>
            <th
              scope="col"
              className="px-2 py-1.5 text-right text-[11px] font-medium"
              style={{ color: 'var(--ink-muted)' }}
            >
              Mijoz
            </th>
            {Array.from({ length: columns }, (_, i) => (
              <th
                key={i}
                scope="col"
                className="tabular px-1 py-1.5 text-center text-[11px] font-medium"
                style={{ color: 'var(--ink-muted)' }}
              >
                {i === 0 ? '0' : `+${i}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.cohort}>
              <th
                scope="row"
                className="tabular sticky left-0 z-10 px-2 py-1 text-left text-xs font-medium whitespace-nowrap"
                style={{ background: 'var(--surface-raised)', color: 'var(--ink-secondary)' }}
              >
                {row.cohort.slice(0, 7)}
              </th>
              <td
                className="tabular px-2 py-1 text-right text-xs"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {row.size}
              </td>
              {Array.from({ length: columns }, (_, i) => (
                <HeatCell key={i} value={row.retention[i] ?? null} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HeatCell({ value }: { value: number | null }) {
  if (value === null) {
    return <td className="px-1 py-1" aria-label="maʼlumot yoʻq" />
  }

  /**
   * Five steps, not a continuous gradient.
   *
   * Banding is a feature: it makes "roughly the same" cells read as the same,
   * which is how a matrix is actually scanned. A continuous ramp invites the
   * eye to distinguish 4% from 5%, a difference that is noise at these cohort
   * sizes.
   *
   * The thresholds are set to THIS business, not to a textbook. Monthly repeat
   * purchase here runs 1–16%; the usual SaaS bands (40/25/12/4) would paint
   * every cell in the lightest step and the matrix would read as a blank grid
   * with a 100% column down the left.
   */
  const step =
    value >= 12 ? 4 : value >= 7 ? 3 : value >= 4 ? 2 : value >= 2 ? 1 : 0

  const backgrounds = [
    'color-mix(in oklab, var(--seq-250) 22%, var(--surface))',
    'color-mix(in oklab, var(--seq-250) 55%, var(--surface))',
    'var(--seq-350)',
    'var(--seq-550)',
    'var(--seq-650)',
  ]

  return (
    <td
      data-heat=""
      className="tabular rounded px-1 py-1 text-center text-[11px] font-medium"
      style={{
        background: backgrounds[step],
        /*
          The ink flips at step 3, not step 2.
          
          White on --seq-350 is 2.83:1 — under the 3:1 floor for any text. Dark
          ink on that same step is 7.4:1, so the later flip is better on both
          sides of the boundary. `--surface` rather than a literal white, so
          the pale ink follows the theme instead of staying white on a light
          card in dark mode.
        */
        color: step >= 3 ? 'var(--surface)' : 'var(--ink-primary)',
        minWidth: 40,
      }}
      title={formatPercent(value)}
    >
      {/*
        A middot for a true zero, "<1" for a cohort that did come back but
        rounds below one percent, the whole number otherwise. Math.round alone
        printed "0" for nine cells with real returning customers — the same
        glyph a reader uses to mean nobody, one column away from cells that
        genuinely were nobody.
      */}
      {value === 0 ? '·' : value < 1 ? '<1' : Math.round(value)}
    </td>
  )
}
