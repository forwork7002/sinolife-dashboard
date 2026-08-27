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

/** Real minus (U+2212), not a hyphen: hyphens jitter in tabular columns. */
const MINUS = '−'

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
   * Empty stages are dropped, except terminal ones in a LIVE pipeline.
   *
   * A pipeline carries stages that nothing is sitting in this month — a
   * regional hub with no dispatches, a chase queue that stayed empty. Printing
   * every one of them at zero buries the dozen rows that have anything in them
   * under thirty that do not.
   *
   * Won and lost stay at zero because "nothing was refused" is itself a
   * result — but only where the pipeline did anything at all. Ecommerce moved
   * nothing this window, and its three terminal rows printed «0 · 0%» at the
   * bottom of every funnel: not a result, just the shape of an idle pipeline.
   * The pipeline is the prefix on the stage name.
   */
  const pipelineOf = (name: string) => name.split(' · ')[0] ?? name
  const activePipelines = new Set(
    steps.filter((s) => s.dealCount > 0).map((s) => pipelineOf(s.stageName)),
  )

  const visible = steps.filter(
    (step) =>
      step.dealCount > 0 ||
      ((step.category === 'WON' || step.category === 'LOST') &&
        activePipelines.has(pipelineOf(step.stageName))),
  )

  const pipelineSteps = visible.filter(
    (s) => s.category === 'NEW' || s.category === 'IN_PROGRESS',
  )

  /**
   * Each pipeline stage remembers the stage BEFORE it — in the same pipeline.
   *
   * That predecessor is what the ghost region and the drop-off annotation are
   * measured against (the Amplitude trick: the pale remainder above a funnel
   * bar is the previous step's reach, so drop-off is visible as unfilled
   * track rather than deduced by mental subtraction). The pairing must stay
   * inside one pipeline: the funnel interleaves several, and "previous row"
   * across a pipeline boundary would compare unrelated processes.
   *
   * WON/LOST rows get no ghost — LOST *is* the drop-off, and painting a
   * remainder over a reserved status colour would dilute exactly the two hues
   * the app promises never to touch.
   */
  const prevStageById = new Map<string, FunnelStepDto>()
  let prev: FunnelStepDto | null = null
  let prevPipeline: string | null = null
  for (const step of pipelineSteps) {
    const pipeline = pipelineOf(step.stageName)
    if (prev && pipeline === prevPipeline) prevStageById.set(step.stageId, prev)
    prev = step
    prevPipeline = pipeline
  }

  return (
    <ul className="space-y-2.5">
      {visible.map((step) => {
        /**
         * The bar and the number state the SAME quantity.
         *
         * The bar used to be `dealCount / max` — share of the largest stage —
         * while the percentage beside it was `reachedPercent`, share of the
         * whole funnel. Two different measures in one row, and the bar is the
         * one the eye reads: "В пути" drew at 71% of the track above a label
         * saying 31%, and "Доставлено" filled the track above a label saying
         * 41%. Every row overstated itself by roughly 2.3×.
         *
         * `reachedPercent` wins because it is the one the label already
         * claims and the one a funnel is asking about.
         */
        const width = step.reachedPercent ?? 0
        const color = colorFor(step, pipelineSteps.indexOf(step), pipelineSteps.length)

        /**
         * Ghost + drop-off, only where they mean something.
         *
         * The ghost is the previous stage drawn in the SAME hue at low alpha
         * — same measure as the bar (reachedPercent), so the bar/label
         * honesty rule holds for it too. It only appears when the previous
         * stage was LARGER: this funnel is a snapshot of where deals sit
         * now, so a later stage can legitimately hold more deals, and a
         * ghost smaller than the bar would just vanish underneath it.
         *
         * The annotation is suppressed for tiny predecessors: a drop from
         * 3 to 2 prints as −33%, a precision the sample cannot carry. Five
         * is the floor where a percentage stops being coin-flip noise.
         */
        const prevStep = prevStageById.get(step.stageId)
        const ghostWidth = prevStep?.reachedPercent ?? null
        const drop = prevStep ? prevStep.dealCount - step.dealCount : 0
        const dropPercent =
          prevStep && prevStep.dealCount >= 5 && drop > 0
            ? (drop / prevStep.dealCount) * 100
            : null

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
              aria-label={`${step.stageName}: ${step.dealCount} ta bitim${
                step.reachedPercent === null ? '' : `, jamining ${formatPercent(step.reachedPercent, 0)}`
              }${
                dropPercent === null
                  ? ''
                  : `, oldingi bosqichdan ${MINUS}${formatNumber(drop)} (${MINUS}${formatPercent(dropPercent, 0)})`
              }`}
            >
              {/* The ghost: previous stage's reach, same hue at low alpha.
                  Absolute and first, so the solid bar (position: relative,
                  later in DOM order) always paints over it. Not animated —
                  the context appears settled, only the data grows in. */}
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
