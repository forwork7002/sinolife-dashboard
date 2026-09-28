'use client'

import { Card, ChartCard } from '@/components/ui/Card'
import { formatNumber, formatPercent } from '@/lib/format'

import { dayCount } from './RnpCompanyView'
import { RnpBlockTable } from './RnpBlockTable'
import { RnpDailyChart } from './RnpDailyChart'
import { RnpKpiCard } from './RnpKpi'
import { BaseTag } from './RnpRopRail'
import type { RnpOverviewDto } from './rnpApi'
import { type RnpTeamSummary, rowByKey } from './rnpDerive'
import { muted } from '@/features/reklama/reklamaUi'

/**
 * One ROP: who and where it stands, its month as cards, its days as two
 * charts (counts, then money — never on one axis), and then its own block of
 * the sheet and its logistics block, open.
 */
export function RnpTeamView({
  data,
  summary,
  count,
  onSelect,
  prev,
  next,
}: {
  data: RnpOverviewDto
  summary: RnpTeamSummary
  /** How many teams are ranked. */
  count: number
  onSelect: (rop: string | null) => void
  prev: string | null
  next: string | null
}) {
  const { team, block, logistics } = summary
  const k = `team:${team.rop}`
  const perCall = rowByKey(block, `${k}:per_call`)
  const conv2 = rowByKey(block, `${k}:conv2`)
  const orders2 = rowByKey(block, `${k}:orders2`)
  const refusedPct = rowByKey(logistics, `lg:${team.rop}:refused_pct`)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="p-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="display truncate text-xl font-semibold" style={{ color: 'var(--ink-primary)' }}>
                {team.rop}
              </h2>
              {team.isBase && <BaseTag />}
              <span
                className="tabular rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
                style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
                title="FAKT 1 boʻyicha"
              >
                {summary.rank}-oʻrin / {count}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs" style={muted}>
              {team.head ?? 'Rahbar koʻrsatilmagan'}
              {team.isBase ? ' · mavjud mijozlar, qoʻngʻiroqlar boʻyicha' : ''}
            </p>
          </div>
          <nav aria-label="Boshqa ROP" className="flex items-center gap-1.5">
            <NavButton label="Butun kompaniya" onClick={() => onSelect(null)} />
            <NavButton label="‹" aria={prev ? `Oldingi ROP: ${prev}` : 'Oldingi ROP yoʻq'} disabled={!prev} onClick={() => prev && onSelect(prev)} />
            <NavButton label="›" aria={next ? `Keyingi ROP: ${next}` : 'Keyingi ROP yoʻq'} disabled={!next} onClick={() => next && onSelect(next)} />
          </nav>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <RnpKpiCard label={team.isBase ? 'Дозвон' : 'РОП олган лид'} row={summary.reach} />
        <RnpKpiCard
          label="Konversiya %"
          row={summary.conversion}
          note={conv2?.fact != null ? `FAKT 2 boʻyicha ${formatPercent(conv2.fact)}` : undefined}
        />
        <RnpKpiCard label="Buyurtma (FAKT 1)" row={summary.orders} />
        <RnpKpiCard label="FAKT 1" row={summary.fakt1} />
        {summary.planPct ? (
          <RnpKpiCard label="План бажарилиши, %" row={summary.planPct} note="FAKT 1 ÷ lid × lid qiymati" />
        ) : (
          <RnpKpiCard label="Дозвонга ўртача сумма" row={perCall} />
        )}
        <RnpKpiCard
          label="FAKT 2"
          row={summary.fakt2}
          note={orders2?.fact != null ? `${formatNumber(Math.round(orders2.fact))} ta tranzaksiya` : undefined}
        />
        <RnpKpiCard
          label="Успешность %"
          row={summary.success}
          note={refusedPct?.fact != null ? `Отказ ${formatPercent(refusedPct.fact)}` : undefined}
        />
        <RnpKpiCard label="Ходим сони" row={summary.headcount} note="oy boʻyicha kunlik oʻrtacha" />
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <ChartCard title={team.isBase ? 'Дозвон va buyurtma' : 'Lid va buyurtma'} hint="Kunma-kun, dona" className="min-w-0">
          <RnpDailyChart
            days={data.days}
            today={data.today}
            unit="count"
            bar={{ label: team.isBase ? 'Дозвон' : 'РОП олган лид', color: 'var(--series-1)', row: summary.reach }}
            line={{ label: 'Buyurtma (FAKT 1)', color: 'var(--series-2)', row: summary.orders }}
            dayPlan={summary.reach?.dayPlan ?? null}
            extraRows={(i) => {
              const v = summary.conversion?.days[i] ?? null
              return v === null ? [] : [{ label: 'Konversiya', value: formatPercent(v) }]
            }}
          />
        </ChartCard>
        <ChartCard title="FAKT 1 / FAKT 2 kunlik" hint="Tasdiqlash navbatiga tushgan kun boʻyicha" className="min-w-0">
          <RnpDailyChart
            days={data.days}
            today={data.today}
            unit="uzs"
            bar={{ label: 'FAKT 1', color: 'var(--series-2)', row: summary.fakt1 }}
            line={{ label: 'FAKT 2', color: 'var(--series-3)', row: summary.fakt2 }}
            dayPlan={summary.fakt1?.dayPlan ?? null}
            extraRows={(i) => dayCount('Buyurtma', summary.orders, i)}
          />
        </ChartCard>
      </div>

      {block && <RnpBlockTable block={block} days={data.days} today={data.today} />}
      {logistics && <RnpBlockTable block={logistics} days={data.days} today={data.today} />}
    </div>
  )
}

function NavButton({
  label,
  aria,
  disabled = false,
  onClick,
}: {
  label: string
  aria?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      className="focusable inline-flex h-11 min-w-11 items-center justify-center rounded-[var(--radius-panel-sm)] border px-3 text-xs font-medium transition-colors enabled:hover:bg-[var(--grid)] disabled:opacity-40 sm:h-8 sm:min-w-8"
      style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-raised)', color: 'var(--ink-primary)' }}
    >
      {label}
    </button>
  )
}
