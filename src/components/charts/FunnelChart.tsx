'use client'

import type { FunnelStepDto } from '@/lib/api'
import { formatNumber, formatPercent, formatUzs } from '@/lib/format'

/**
 * Pipeline stage distribution.
 *
 * Built from plain HTML bars rather than a charting library: the form is a
 * labelled proportion per row, and a library adds a dependency, an SVG layer
 * and a tooltip system for something a flex row does better and keeps
 * selectable and screen-reader friendly.
 *
 * Colour is ORDINAL — one hue, stepping darker along the funnel — because the
 * stages are ordered. Categorical hues would imply the stages are unrelated
 * categories. Won and lost break out of the ramp into reserved status colours,
 * each with a text label so the meaning never rests on colour alone.
 *
 * The ordinal ramp starts at step 250, the lightest step that still clears 2:1
 * against the surface; anything lighter would recede into the background.
 */

const ORDINAL_RAMP = [
  'var(--seq-250)',
  'var(--seq-350)',
  'var(--seq-450)',
  'var(--seq-550)',
  'var(--seq-650)',
]

function colorFor(
  step: FunnelStepDto,
  pipelineIndex: number,
  pipelineLength: number,
): string {
  if (step.category === 'WON') return 'var(--status-good)'
  if (step.category === 'LOST') return 'var(--status-critical)'

  // Spread the pipeline stages across the ramp regardless of how many there are.
  const position = pipelineLength <= 1 ? 0 : pipelineIndex / (pipelineLength - 1)
  const slot = Math.round(position * (ORDINAL_RAMP.length - 1))
  return ORDINAL_RAMP[slot]!
}

export function FunnelChart({ steps }: { steps: readonly FunnelStepDto[] }) {
  /**
   * Empty stages are dropped, except the terminal ones.
   *
   * A pipeline carries stages that nothing is sitting in this month — a
   * regional hub with no dispatches, a chase queue that stayed empty. Printing
   * every one of them at zero buries the dozen rows that have anything in them
   * under thirty that do not.
   *
   * Won and lost stay whatever their count, because "nothing was refused" is
   * itself a result and its absence would read as missing data.
   */
  const visible = steps.filter(
    (step) => step.dealCount > 0 || step.category === 'WON' || step.category === 'LOST',
  )

  const pipelineSteps = visible.filter(
    (s) => s.category === 'NEW' || s.category === 'IN_PROGRESS',
  )
  const max = Math.max(1, ...visible.map((s) => s.dealCount))

  return (
    <ul className="space-y-2.5">
      {visible.map((step) => {
        const width = (step.dealCount / max) * 100
        const color = colorFor(step, pipelineSteps.indexOf(step), pipelineSteps.length)

        return (
          <li key={step.stageId}>
            <div className="flex items-baseline justify-between gap-3">
              <span
                title={step.stageName}
                className="truncate text-xs font-medium"
                style={{ color: 'var(--ink-primary)' }}
              >
                {step.stageName}
              </span>
              <span
                className="tabular shrink-0 text-xs"
                style={{ color: 'var(--ink-secondary)' }}
                title={formatUzs(Number(step.value.amountMinor) / 100)}
              >
                {formatNumber(step.dealCount)}
                <span className="ml-1.5" style={{ color: 'var(--ink-muted)' }}>
                  {step.reachedPercent === null ? '—' : formatPercent(step.reachedPercent, 0)}
                </span>
              </span>
            </div>

            <div
              className="mt-1 h-2 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--grid)' }}
              role="img"
              aria-label={`${step.stageName}: ${step.dealCount} ta bitim`}
            >
              <div
                className="grow-x h-full rounded-full"
                style={{
                  width: `${Math.max(width, step.dealCount > 0 ? 1.5 : 0)}%`,
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
