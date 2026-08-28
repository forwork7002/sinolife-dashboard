'use client'

import type { MarketingFunnelStepDto } from './marketingApi'
import { formatNumber, formatPercent } from '@/lib/format'

/**
 * The lead funnel: lidlar -> toza -> kvalifikatsiya -> buyurtmalar -> sotuvlar.
 *
 * Their page draws this as five bars in five arbitrary hues — blue, cyan,
 * amber, orange, green — which says the five steps are unrelated categories
 * and hands the last one the colour our palette reserves for "good". The steps
 * are ORDERED, so this is the house funnel language instead: one sequential
 * hue stepping darker along the chain, the previous step's reach drawn as a
 * pale ghost behind each bar, and the drop-off stated in figures beside it.
 *
 * Not `components/charts/FunnelChart` itself, and the reason is the DTO rather
 * than the drawing: that component is built for Bitrix24 pipeline stages —
 * every step carries a stage id, a WON/LOST category and a money value, and
 * this funnel has none of the three. Three of its five steps (leads, clean,
 * qualified) have no amount attached at all, so passing a zero MoneyDto to
 * satisfy the type would put "0 soʻm" in a tooltip on a step that has no
 * amount to state. The visual grammar below is deliberately identical; only
 * the data contract differs.
 *
 * `reachedPercent` is share of the FIRST step, which is what the label claims,
 * so the bar and the number beside it state the same quantity.
 */

/** The ordinal ramp, starting at the lightest step that clears 2:1 on a card. */
const ORDINAL_RAMP = [
  'var(--seq-250)',
  'var(--seq-350)',
  'var(--seq-450)',
  'var(--seq-550)',
  'var(--seq-650)',
]

/** Real minus (U+2212), not a hyphen: hyphens jitter in tabular columns. */
const MINUS = '−'

const STEP_LABELS: Readonly<Record<MarketingFunnelStepDto['key'], string>> = Object.freeze({
  leads: 'Lidlar', //        Лиды
  clean: 'Toza', //          Чистые
  kval: 'Kvalifikatsiya', // Квал
  orders: 'Buyurtmalar', //  Заказы
  sold: 'Sotuvlar', //       Продажи
})

export function MarketingFunnel({ steps }: { steps: readonly MarketingFunnelStepDto[] }) {
  return (
    <ul className="space-y-2.5">
      {steps.map((step, index) => {
        const previous = index > 0 ? steps[index - 1] : undefined
        const width = step.reachedPercent ?? 0
        const color = ORDINAL_RAMP[Math.min(index, ORDINAL_RAMP.length - 1)]!

        /*
          The ghost is the previous step's reach in the same hue at low alpha,
          drawn only when that step was LARGER. This funnel is not monotonic —
          the sheet records more orders than qualified leads, because an order
          can arrive from a lead nobody qualified — and a ghost narrower than
          its own bar would simply disappear underneath it.

          The drop-off annotation is suppressed under five, where a percentage
          off a handful of rows is arithmetic rather than information.
        */
        const ghostWidth = previous?.reachedPercent ?? null
        const drop = previous ? previous.count - step.count : 0
        const dropPercent =
          previous && previous.count >= 5 && drop > 0 ? (drop / previous.count) * 100 : null

        const label = STEP_LABELS[step.key]

        return (
          <li key={step.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
                {label}
              </span>
              <span className="tabular shrink-0 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {formatNumber(step.count)}
                <span className="ml-1.5" style={{ color: 'var(--ink-muted)' }}>
                  {step.reachedPercent === null ? '—' : formatPercent(step.reachedPercent, 0)}
                </span>
                {dropPercent !== null && (
                  <span className="ml-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {MINUS}
                    {formatNumber(drop)} · {MINUS}
                    {formatPercent(dropPercent, 0)}
                  </span>
                )}
              </span>
            </div>

            <div
              className="relative mt-1 h-2 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--track)' }}
              role="img"
              aria-label={`${label}: ${formatNumber(step.count)}${
                step.reachedPercent === null
                  ? ''
                  : `, lidlarning ${formatPercent(step.reachedPercent, 0)}`
              }${
                dropPercent === null
                  ? ''
                  : `, oldingi bosqichdan ${MINUS}${formatNumber(drop)} (${MINUS}${formatPercent(
                      dropPercent,
                      0,
                    )})`
              }`}
            >
              {ghostWidth !== null && ghostWidth > width && (
                <div
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${ghostWidth}%`,
                    background: `color-mix(in oklab, ${color} 18%, transparent)`,
                  }}
                />
              )}
              <div
                className="grow-x relative h-full rounded-full"
                style={{
                  width: `${Math.max(width, step.count > 0 ? 1.5 : 0)}%`,
                  background: color,
                }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
