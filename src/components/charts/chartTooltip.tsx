'use client'

/**
 * The one tooltip surface for every Recharts chart.
 *
 * Each chart used to carry its own tooltip markup, and the two of them had
 * already drifted (one had a swatchless row, both duplicated the row layout).
 * A tooltip is the single most-repeated piece of chart chrome, so it is the
 * first place inconsistency shows: June aligned ONE tooltip design across
 * their whole app and it reads as craft. This panel is that design here.
 *
 * The panel takes ROWS AS DATA, not a Recharts payload. Charts compute rows
 * the payload does not contain — the collection chart's "Farq" is a derived
 * quantity that exists in no series — and mapping payload → rows inside the
 * chart keeps that arithmetic beside the chart that owns it. The panel only
 * knows how to draw.
 *
 * Anatomy, fixed on purpose:
 *   header — the x value (a date), 11px muted, so the eye finds "when" first;
 *   rows   — 8px series dot + label in secondary ink + right-aligned tabular
 *            value in primary ink. The value wears TEXT ink, never the series
 *            colour: the dot carries identity, the ink carries legibility.
 */

export interface ChartTooltipRow {
  /**
   * Identity dot, same colour as the series mark. Omitted for computed rows
   * ("Farq") that correspond to no drawn series — a dot there would promise a
   * mark the chart does not have.
   */
  readonly swatch?: string
  readonly label: string
  /** Already formatted: the panel renders text, it does not know about money. */
  readonly value: string
}

export function ChartTooltipPanel({
  header,
  rows,
}: {
  header: string
  rows: readonly ChartTooltipRow[]
}) {
  return (
    <div
      className="px-3 py-2 text-xs"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-panel-sm)',
        /* Ambient, not directional: aliases --shadow-float in light; in dark it
           is the zero-offset glow stack — floating chrome hums, it doesn't fall. */
        boxShadow: 'var(--shadow-ambient)',
        color: 'var(--ink-primary)',
      }}
    >
      <p className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
        {header}
      </p>
      <dl className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-6">
            <dt className="flex items-center gap-1.5" style={{ color: 'var(--ink-secondary)' }}>
              {row.swatch && (
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: row.swatch }}
                />
              )}
              {row.label}
            </dt>
            <dd className="tabular font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
