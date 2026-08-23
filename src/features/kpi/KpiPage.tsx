'use client'

import { useQuery } from '@tanstack/react-query'

import { Card, ChartCard } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet, type MoneyDto } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

interface KpiItem {
  readonly kpiId: string
  readonly employeeId: string | null
  readonly fullName: string
  readonly metric: string
  readonly unit: 'money' | 'count' | 'percent'
  readonly target: MoneyDto | null
  readonly actual: MoneyDto | null
  readonly targetValue: number
  readonly actualValue: number
  readonly achievementPercent: number | null
  readonly status: string
}

interface KpiPayload {
  readonly elapsedPercent: number
  readonly overallPercent: number | null
  readonly counts: {
    readonly achieved: number
    readonly onTrack: number
    readonly atRisk: number
    readonly behind: number
  }
  readonly items: readonly KpiItem[]
}

const METRIC_LABELS: Record<string, string> = {
  REVENUE: 'Tushum',
  DEALS_WON: 'Yopilgan bitimlar',
  DEALS_CREATED: 'Yangi bitimlar',
  AVERAGE_DEAL: 'Oʻrtacha bitim',
  CONVERSION_RATE: 'Konversiya',
}

export function KpiPage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['kpi', apiParams],
    queryFn: ({ signal }) => apiGet<KpiPayload>('/kpi', apiParams, signal),
    placeholderData: (previous) => previous,
  })

  const data = query.data?.data

  const formatValue = (item: KpiItem, which: 'target' | 'actual') => {
    const money = which === 'target' ? item.target : item.actual
    const raw = which === 'target' ? item.targetValue : item.actualValue

    if (item.unit === 'money') return money ? formatCompactUzs(money.amount) : NO_VALUE
    if (item.unit === 'percent') return formatPercent(raw / 100)
    return formatNumber(raw)
  }

  const columns: Column<KpiItem>[] = [
    {
      key: 'employee',
      header: t.table.employee,
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.fullName}
        </span>
      ),
    },
    {
      key: 'metric',
      header: 'Koʻrsatkich',
      render: (row) => METRIC_LABELS[row.metric] ?? row.metric,
    },
    {
      key: 'target',
      header: 'Reja',
      align: 'right',
      numeric: true,
      render: (row) => formatValue(row, 'target'),
    },
    {
      key: 'actual',
      header: 'Haqiqiy',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: 'var(--ink-primary)' }}>{formatValue(row, 'actual')}</span>
      ),
    },
    {
      key: 'progress',
      header: 'Bajarilishi',
      width: '160px',
      render: (row) => <ProgressBar percent={row.achievementPercent} expected={data?.elapsedPercent ?? 0} />,
    },
    {
      key: 'status',
      header: t.table.status,
      render: (row) => <StatusBadge status={row.status} />,
    },
  ]

  return (
    <PageShell
      title={t.nav.kpi}
      description={
        data ? `Davrning ${formatPercent(data.elapsedPercent, 0)} qismi oʻtdi` : undefined
      }
      meta={query.data?.meta}
      filters={{ employees: true, departments: true }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="px-4 py-3.5">
          <p className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
            {t.cards.kpiAchievement}
          </p>
          <p
            className="mt-1.5 text-2xl leading-none font-semibold tracking-tight"
            style={{ color: 'var(--ink-primary)' }}
          >
            {formatPercent(data?.overallPercent ?? null, 0)}
          </p>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Kutilgan: {formatPercent(data?.elapsedPercent ?? null, 0)}
          </p>
        </Card>

        <CountCard label={t.kpiStatus.ACHIEVED} value={data?.counts.achieved} tone="good" />
        <CountCard label={t.kpiStatus.ON_TRACK} value={data?.counts.onTrack} tone="good" />
        <CountCard label={t.kpiStatus.AT_RISK} value={data?.counts.atRisk} tone="warning" />
        <CountCard label={t.kpiStatus.BEHIND} value={data?.counts.behind} tone="critical" />
      </div>

      <ChartCard title="KPI rejalari" hint="Davr ichida oʻtgan vaqtga nisbatan baholanadi">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.kpiId}
          status={query.isError ? 'error' : query.isPending ? 'loading' : 'ready'}
          errorMessage={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          emptyBody="Tanlangan davr uchun KPI rejalari belgilanmagan."
          minWidth={860}
        />
      </ChartCard>
    </PageShell>
  )
}

function CountCard({
  label,
  value,
  tone,
}: {
  label: string
  value?: number
  tone: 'good' | 'warning' | 'critical'
}) {
  const color =
    tone === 'good'
      ? 'var(--status-good)'
      : tone === 'warning'
        ? 'var(--status-warning)'
        : 'var(--status-critical)'

  return (
    <Card className="px-4 py-3.5">
      <p
        className="flex items-center gap-1.5 text-xs font-medium"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: color }}
        />
        {label}
      </p>
      <p
        className="mt-1.5 text-2xl leading-none font-semibold tracking-tight"
        style={{ color: 'var(--ink-primary)' }}
      >
        {value === undefined ? NO_VALUE : formatNumber(value)}
      </p>
    </Card>
  )
}

/**
 * Attainment bar with an expected-pace marker.
 *
 * The marker is the point of it: 40% of a monthly target on the 12th is ahead,
 * and on the 28th it is a problem. A bare percentage cannot express that, so
 * the bar carries the pace line and the colour follows the comparison.
 */
function ProgressBar({ percent, expected }: { percent: number | null; expected: number }) {
  if (percent === null) {
    return (
      <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </span>
    )
  }

  const clamped = Math.min(100, Math.max(0, percent))
  const onPace = percent >= expected
  const color = percent >= 100 ? 'var(--status-good)' : onPace ? 'var(--seq-450)' : 'var(--status-warning)'

  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-2 flex-1 overflow-hidden rounded-full"
        style={{ background: 'var(--grid)' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, background: color }}
        />
        {expected > 0 && expected < 100 && (
          <span
            className="absolute top-0 h-full w-px"
            style={{ left: `${expected}%`, background: 'var(--ink-muted)' }}
            title={`Kutilgan: ${Math.round(expected)}%`}
            aria-hidden="true"
          />
        )}
      </div>
      <span className="tabular w-11 text-right text-xs" style={{ color: 'var(--ink-primary)' }}>
        {formatPercent(percent, 0)}
      </span>
    </div>
  )
}
