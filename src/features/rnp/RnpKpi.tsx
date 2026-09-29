'use client'

import type { ReactNode } from 'react'

import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { StatusChip } from '@/components/ui/Stat'
import { NO_VALUE, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import { formatUsd } from './rnpFigures'
import type { RnpRowDto, RnpUnit } from './rnpApi'
import { dayMonth, indexTone } from './rnpDerive'

/**
 * One KPI of the sheet, read off its row: the fact large, the plan and the
 * forecast small, and — when a plan exists — a bar of fact ÷ plan with a tick
 * where the forecast will land. The index badge carries the judgement (glyph
 * and colour, by the row's `better`); the bar itself stays in the neutral
 * sequential hue, because the width is a magnitude, not a verdict.
 *
 * The house tile's anatomy (`StatTile`): the same card, label voice and
 * figure size — built here rather than passed through it because a sheet row
 * also comes in dollars and one-decimal headcounts, which `StatTile` does not
 * speak.
 */
export function RnpKpiCard({
  label,
  row,
  note,
  status = 'ready',
}: {
  label: string
  row: RnpRowDto | null
  /** One muted line under the figure — a caveat or a companion figure. */
  note?: ReactNode
  status?: 'loading' | 'ready'
}) {
  const reliable = row?.reliableFrom ? `${dayMonth(row.reliableFrom)} dan` : null
  return (
    <div className="card @container flex min-w-0 flex-col px-4 py-3.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }} title={label}>
          {label}
        </p>
        {row && row.index !== null && (
          <StatusChip tone={indexTone(row.index, row.better)}>
            <span className="tabular">{formatPercent(row.index)}</span>
            <span className="sr-only"> — reja indeksi</span>
          </StatusChip>
        )}
      </div>

      {status === 'loading' ? (
        <div className="skeleton mt-2 h-[26px] w-2/3 sm:h-[30px]" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : (
        <Figure value={row?.fact ?? null} unit={row?.unit ?? 'count'} additive={row?.additive ?? true} />
      )}

      {(note || reliable) && (
        <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
          {[reliable, note].filter(Boolean).map((part, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {part}
            </span>
          ))}
        </p>
      )}

      {status === 'ready' && row && <PlanMeter row={row} />}
    </div>
  )
}

function Figure({ value, unit, additive }: { value: number | null; unit: RnpUnit; additive: boolean }) {
  const size = 'figure figure-wrap mt-2 text-[24px] leading-none font-semibold sm:text-[28px]'
  if (value === null) {
    return (
      <p className={size} style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </p>
    )
  }
  if (unit === 'uzs') {
    // To the last soʻm (the client, 2026-09-29: «sonlar to'liq yozilishi
    // kerak»). Thirteen grouped digits do not fit a 28px figure in a sixth of
    // a laptop or half a phone, so the size follows the TILE's width (`cqi`,
    // the card is a size container) divided by the figure's own length — a
    // tabular digit is ~0.62em, the separators less — and tops out at the
    // other tiles' 28px. «soʻm» drops under the figure rather than pushing it
    // out of the card.
    const fit = (100 / (formatFullUzs(value).length * 0.62)).toFixed(2)
    return (
      <p
        className="figure figure-wrap mt-2 leading-none font-semibold"
        style={{ color: 'var(--ink-primary)', fontSize: `min(28px, ${fit}cqi)` }}
      >
        <AnimatedNumber value={value} format={formatFullUzs} />
        <span className="ml-1 inline-block text-xs font-normal tracking-normal" style={{ color: 'var(--ink-muted)' }}>
          soʻm
        </span>
      </p>
    )
  }
  return (
    <p className={size} style={{ color: 'var(--ink-primary)' }}>
      <AnimatedNumber value={value} format={(v) => formatValue(v, unit, additive)} />
    </p>
  )
}

/** A figure in its unit — a snapshot count (headcount) keeps one decimal. */
export function formatValue(value: number, unit: RnpUnit, additive = true): string {
  switch (unit) {
    case 'uzs':
      return formatFullUzs(value)
    case 'usd':
      return formatUsd(value)
    case 'percent':
      return formatPercent(value)
    case 'count':
      return formatNumber(additive ? Math.round(value) : Math.round(value * 10) / 10)
  }
}

/**
 * Fact ÷ plan as a bar, the forecast ÷ plan as a tick. A rate has no
 * forecast, so it gets the bar alone; a row with no plan says so in words
 * rather than drawing an empty track that reads as zero.
 */
function PlanMeter({ row }: { row: RnpRowDto }) {
  const plan = row.plan
  const forecastText = row.forecast !== null ? `Prognoz ${formatValue(row.forecast, row.unit, row.additive)}` : null
  if (plan === null || plan <= 0) {
    return (
      <p className="tabular mt-2.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {[forecastText, 'reja yoʻq'].filter(Boolean).join(' · ')}
      </p>
    )
  }
  const factShare = row.fact === null ? 0 : Math.max(0, Math.min(1, row.fact / plan))
  const forecastShare = row.forecast === null ? null : Math.max(0, Math.min(1, row.forecast / plan))
  const aria = [
    `Fakt rejaning ${formatPercent(row.fact === null ? 0 : (row.fact / plan) * 100)}`,
    row.forecast !== null ? `prognoz ${formatPercent((row.forecast / plan) * 100)}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="mt-2.5">
      <div className="relative h-1.5 w-full rounded-full" style={{ background: 'var(--track)' }} role="img" aria-label={aria}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${factShare * 100}%`,
            background: 'var(--seq-450)',
            transition: 'width var(--duration-enter) var(--ease-out)',
          }}
        />
        {forecastShare !== null && (
          <span
            aria-hidden="true"
            className="absolute top-1/2 block h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${forecastShare * 100}%`,
              background: 'var(--ink-primary)',
              boxShadow: '0 0 0 1.5px var(--surface-raised)',
            }}
          />
        )}
      </div>
      <p className="tabular mt-1.5 flex flex-wrap gap-x-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        <span>Reja {formatValue(plan, row.unit, row.additive)}</span>
        {forecastText && <span>{forecastText}</span>}
      </p>
    </div>
  )
}

/** The tile's silhouette while the payload is on its way. */
export function RnpKpiSkeleton() {
  return (
    <div className="card flex flex-col px-4 py-3.5" aria-hidden="true">
      <div className="skeleton h-3 w-24" />
      <div className="skeleton mt-3 h-[26px] w-2/3 sm:h-[30px]" />
      <div className="skeleton mt-3 h-1.5 w-full" />
      <div className="skeleton mt-2 h-3 w-32" />
    </div>
  )
}
