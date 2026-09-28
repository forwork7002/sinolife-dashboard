'use client'

import { ChartCard } from '@/components/ui/Card'
import { formatNumber, formatPercent } from '@/lib/format'

import { type RnpFunnel as Funnel, dayMonth } from './rnpDerive'

/**
 * Lead to delivery, one bar per step, each bar's length its share of the
 * first step and the conversion from the step before it printed between.
 * One hue — the bars are magnitudes of one quantity, not categories.
 *
 * The window is part of the title's hint and not a footnote: the steps are
 * summed over the days «ROP larga tarqatildi» can be trusted on, and the
 * numbers only reconcile with the sheet once that is known.
 */
export function RnpFunnel({ funnel }: { funnel: Funnel }) {
  const first = funnel.steps[0]?.value ?? 0
  const window =
    funnel.from && funnel.to
      ? `${dayMonth(funnel.from)} – ${dayMonth(funnel.to)} · ${formatNumber(funnel.days)} kun`
      : 'Hisoblanadigan kun yoʻq'

  return (
    <ChartCard
      title="Lid voronkasi"
      hint={`${window} — ROP lid Bitrix24 da toʻliq boʻlgan kunlar. Buyurtmalar БАЗА jamoalarisiz.`}
      fill
    >
      <ol className="flex flex-col gap-1" aria-label="Lid voronkasi bosqichlari">
        {funnel.steps.map((step, i) => {
          const share = first > 0 ? Math.max(0, Math.min(1, step.value / first)) : 0
          return (
            <li key={step.key} className="flex flex-col">
              {i > 0 && (
                <p className="tabular py-0.5 pl-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {/*
                    A step LARGER than the one before is not a conversion: ROP
                    teams are handed leads the registrar never qualified (a
                    seller's own, a returning customer), so on production
                    «ROP larga tarqatildi» ran at 114% of «Kval lid». An arrow
                    down over 113.9% reads as a broken number; say what it is.
                  */}
                  {step.conversion !== null && step.conversion > 100 ? (
                    <>
                      <span aria-hidden="true">↑ </span>
                      {formatPercent(step.conversion)} — Registratsiyadan tashqari ham lid tushadi
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">↓ </span>
                      {step.conversion === null ? '—' : formatPercent(step.conversion)}
                    </>
                  )}
                  <span className="sr-only"> oldingi bosqichdan</span>
                </p>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                  {step.label}
                </span>
                <span className="tabular shrink-0 text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  {formatNumber(step.value)}
                </span>
              </div>
              <div className="mt-1 h-2.5 w-full rounded-full" style={{ background: 'var(--track)' }} aria-hidden="true">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(share * 100, step.value > 0 ? 1.5 : 0)}%`,
                    background: 'var(--seq-450)',
                    transition: 'width var(--duration-enter) var(--ease-out)',
                  }}
                />
              </div>
            </li>
          )
        })}
      </ol>
    </ChartCard>
  )
}
