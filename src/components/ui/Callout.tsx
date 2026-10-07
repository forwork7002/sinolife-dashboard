import type { ReactNode } from 'react'

/**
 * A sentence that qualifies the figures beside it — «CBU kursi olinmadi»,
 * «Marja tushumning 82% qismi boʻyicha hisoblandi».
 *
 * ONE RECIPE. There were four: a 12% amber wash with a left rule (Roistat,
 * Savdo «Kunlar boʻyicha»), a rule with no wash (Margin), and a wash with
 * amber text (Users). Margin's is the one kept, for the reason its comment
 * measured: a wash of a saturated amber mixed into a dark surface is a muddy
 * brown at 1.12:1 that neither reads as a warning nor stays out of the way. A
 * full-strength rule down the leading edge is unambiguous at any surface
 * lightness, and the panel keeps the card's own glass — no translucent colour
 * of its own, so the transparency fallback reaches it through the token.
 *
 * The rule is decoration; the words carry the warning (`role="note"`), so the
 * meaning never rests on colour alone.
 */
export function Callout({
  tone = 'warning',
  children,
  className = '',
}: {
  tone?: 'warning'
  children: ReactNode
  className?: string
}) {
  const rule = tone === 'warning' ? 'var(--status-warning)' : 'var(--border-strong)'
  return (
    <div
      role="note"
      className={`rounded-[var(--radius-panel-sm)] border px-4 py-2.5 text-xs ${className}`}
      style={{
        background: 'var(--glass-card)',
        borderColor: 'var(--glass-edge)',
        borderInlineStartWidth: 3,
        borderInlineStartColor: rule,
        color: 'var(--ink-secondary)',
      }}
    >
      {children}
    </div>
  )
}
