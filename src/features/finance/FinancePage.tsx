'use client'

import { useQuery } from '@tanstack/react-query'

import { BarList } from '@/components/charts/BarList'
import { CollectionChart, type CollectionPointDto } from '@/components/charts/CollectionChart'
import { ChartSkeleton, ErrorState, UnavailableState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card, ChartCard } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Meter } from '@/components/ui/Stat'
import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet, type DeltaDto, type MoneyDto } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatDateShort, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

interface FinancePayload {
  readonly summary: {
    readonly invoiced: MoneyDto
    readonly collected: MoneyDto
    readonly outstanding: MoneyDto
    readonly collectionRatePercent: number | null
    readonly paidCount: number
    readonly partialCount: number
    readonly unpaidCount: number
    readonly debtorCount: number
  }
  readonly deltas: {
    readonly invoiced: DeltaDto
    readonly collected: DeltaDto
    readonly outstanding: DeltaDto
    readonly collectionRate: DeltaDto
  }
  readonly trend: readonly CollectionPointDto[]
  readonly byMethod: readonly { readonly method: string; readonly amount: MoneyDto; readonly count: number }[]
  readonly ageing: readonly { readonly bucket: string; readonly amount: MoneyDto; readonly count: number }[]
  readonly byEmployee: readonly {
    readonly employeeId: string
    readonly fullName: string
    readonly outstanding: MoneyDto
    readonly dealCount: number
  }[]
  readonly debtors: readonly {
    readonly id: string
    readonly title: string
    readonly employee: { readonly id: string; readonly fullName: string }
    readonly customer: { readonly id: string; readonly name: string } | null
    readonly closedAt: string | null
    readonly outstanding: number
    readonly status: string
  }[]
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Naqd',
  BANK_TRANSFER: 'Bank oʻtkazmasi',
  CARD: 'Karta',
  OTHER: 'Boshqa',
}

export function FinancePage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['finance', apiParams],
    queryFn: ({ signal }) => apiGet<FinancePayload>('/finance/overview', apiParams, signal),
    placeholderData: (previous) => previous,
    // A pending integration and a refusal are both permanent states, not
    // blips worth retrying.
    retry: (count, error) =>
      error instanceof ApiClientError &&
      (error.code === 'INTEGRATION_PENDING' || error.code === 'FORBIDDEN')
        ? false
        : count < 1,
  })

  const pending =
    query.error instanceof ApiClientError && query.error.code === 'INTEGRATION_PENDING'

  // The nav hides this page from roles that cannot read finance, but the URL
  // is still typeable. A bare "failed to load" would read as a fault; this is
  // a deliberate refusal and should say so.
  const forbidden =
    query.error instanceof ApiClientError && query.error.code === 'FORBIDDEN'

  const data = query.data?.data

  if (pending || forbidden) {
    return (
      <PageShell title={t.nav.finance} meta={query.data?.meta}>
        <Card>
          {forbidden ? (
            <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="10" width="16" height="10" rx="2" stroke="var(--ink-muted)" strokeWidth="1.6" />
                <path d="M8 10V7a4 4 0 118 0v3" stroke="var(--ink-muted)" strokeWidth="1.6" />
              </svg>
              <p className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>
                Ruxsat yoʻq
              </p>
              <p className="max-w-xs text-xs" style={{ color: 'var(--ink-secondary)' }}>
                Moliyaviy maʼlumotlarni koʻrish uchun sizda ruxsat yoʻq.
              </p>
            </div>
          ) : (
            <UnavailableState hint="Toʻlov maʼlumotlari manbasi hali ulanmagan. Bitrix24 sozlangach, bu sahifa avtomatik ishlaydi." />
          )}
        </Card>
      </PageShell>
    )
  }

  const debtorColumns: Column<FinancePayload['debtors'][number]>[] = [
    {
      key: 'title',
      header: t.table.deal,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: 'var(--ink-primary)' }}>
            {row.title}
          </p>
          {row.customer && (
            <p className="truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {row.customer.name}
            </p>
          )}
        </div>
      ),
    },
    { key: 'employee', header: t.table.employee, render: (row) => row.employee.fullName },
    {
      key: 'closed',
      header: t.table.closed,
      align: 'right',
      numeric: true,
      render: (row) => (row.closedAt ? formatDateShort(row.closedAt) : NO_VALUE),
    },
    {
      key: 'outstanding',
      header: 'Qoldiq',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: 'var(--status-critical)' }} title={formatUzs(row.outstanding)}>
          {formatCompactUzs(row.outstanding)}
        </span>
      ),
    },
    { key: 'status', header: t.table.status, render: (row) => <StatusBadge status={row.status} /> },
  ]

  return (
    <PageShell
      title={t.nav.finance}
      description="Yopilgan bitimlar boʻyicha hisob-kitob"
      meta={query.data?.meta}
      filters={{ employees: true, departments: true, sources: true }}
    >
      {/*
        The lead instrument — the page's one hero, the only panel wearing the
        registration brackets.

        Finance starts from what was BILLED: every other number on the page —
        collected, outstanding, the rate — is a fate of that figure. So
        invoiced takes the hero size, and the panel's context strip states how
        much of it came back as a drawn fraction, because a hero number with
        no reference beside it is a poster, not an instrument. The remaining
        cards stand below at tile size, each keeping its own delta.
      */}
      <section className="card-hero brackets reveal px-5 py-5 sm:px-6" aria-label="Hisoblangan">
        {!data && query.isError ? (
          <ErrorState
            message={query.error instanceof ApiClientError ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Hisoblangan
              </p>

              {!data ? (
                // Sized to the hero figure below, so ready never reflows loading.
                <div className="skeleton mt-2 h-[40px] w-64" role="status">
                  <span className="sr-only">Yuklanmoqda</span>
                </div>
              ) : (
                /*
                  The exact soʻm amount rides the Tooltip primitive, not a
                  native `title`: hover, focus AND touch. The figure is a tab
                  stop — the full ten-digit number is otherwise unreachable
                  without a mouse.
                */
                <div className="mt-2">
                  <Tooltip
                    content={<span className="tabular">{formatUzs(data.summary.invoiced.amount)}</span>}
                  >
                    <span
                      tabIndex={0}
                      className="focusable figure-hero block w-fit rounded-[var(--radius-panel-sm)]"
                      style={{ color: 'var(--ink-primary)' }}
                    >
                      <AnimatedNumber
                        value={data.summary.invoiced.amount}
                        format={formatCompactUzs}
                        duration={900}
                      />
                      <span
                        className="ml-1.5 text-sm font-normal"
                        style={{ color: 'var(--ink-muted)' }}
                      >
                        soʻm
                      </span>
                    </span>
                  </Tooltip>
                </div>
              )}

              {data && (
                <div className="mt-2.5 flex items-center gap-2">
                  <TrendIndicator delta={data.deltas.invoiced} />
                  <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    oldingi davrga nisbatan
                  </span>
                </div>
              )}
            </div>

            {/*
              The context the hero owes its reader: of what was billed, how
              much is in hand. The meter draws the same rate the "Yigʻilish
              darajasi" tile below grades with its delta — one quantity, one
              caption naming both sides of the fraction.
            */}
            {data && (
              <div className="w-full sm:max-w-xs">
                <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  Yigʻilgan: {formatCompactUzs(data.summary.collected.amount)} soʻm
                </p>
                <div className="mt-1.5">
                  <Meter
                    value={data.summary.collectionRatePercent}
                    tone="neutral"
                    label="Yigʻilish darajasi"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <MoneyCard
          label="Yigʻilgan"
          money={data?.summary.collected}
          delta={data?.deltas.collected}
        />
        <MoneyCard
          label="Qoldiq (qarz)"
          money={data?.summary.outstanding}
          delta={data?.deltas.outstanding}
          // Debt going up is bad news, so the arrow colour is inverted.
          invertDelta
          emphasis
        />
        <Card className="px-4 py-3.5">
          <p className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
            Yigʻilish darajasi
          </p>
          <p
            className="mt-1.5 text-2xl leading-none font-semibold tracking-tight"
            style={{ color: 'var(--ink-primary)' }}
          >
            {formatPercent(data?.summary.collectionRatePercent ?? null)}
          </p>
          <div className="mt-2">
            {data && <TrendIndicator delta={data.deltas.collectionRate} />}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Toʻliq toʻlangan" value={data?.summary.paidCount} tone="good" />
        <Stat label="Qisman" value={data?.summary.partialCount} tone="warning" />
        <Stat label="Toʻlanmagan" value={data?.summary.unpaidCount} tone="critical" />
        <Stat label="Qarzdor bitimlar" value={data?.summary.debtorCount} />
      </div>

      {/*
        `fill` + a heightless CollectionChart: the chart measures its card the
        same way Overview's revenue trend does (absolute-fill sandwich, 280px
        floor), so the two flagship trend cards sit at the same height across
        pages instead of each page hard-coding its own. The "Farq" band
        between the lines arrives from the chart kit itself.
      */}
      <ChartCard
        title="Hisoblangan va yigʻilgan"
        hint="Bir oʻlchovda, bir oʻqda — chiziqlar orasi hali yigʻilmagan pul"
        fill
      >
        {!data ? <ChartSkeleton height={280} /> : <CollectionChart data={data.trend} />}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Qarz muddati" hint="Bitim yopilgan kundan boshlab">
          <BarList
            items={(data?.ageing ?? []).map((row) => ({
              id: row.bucket,
              label: `${row.bucket} kun`,
              value: row.amount.amount,
              meta: (
                <span className="tabular text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {formatNumber(row.count)} ta
                </span>
              ),
            }))}
            emptyLabel="Qarz yoʻq"
          />
        </ChartCard>

        <ChartCard title="Toʻlov usullari">
          <BarList
            items={(data?.byMethod ?? []).map((row) => ({
              id: row.method,
              label: METHOD_LABELS[row.method] ?? row.method,
              value: row.amount.amount,
              meta: (
                <span className="tabular text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {formatNumber(row.count)} ta
                </span>
              ),
            }))}
            emptyLabel="Toʻlov yoʻq"
          />
        </ChartCard>

        <ChartCard title="Xodimlar boʻyicha qarz">
          <BarList
            items={(data?.byEmployee ?? []).map((row) => ({
              id: row.employeeId,
              label: row.fullName,
              value: row.outstanding.amount,
              meta: (
                <span className="tabular text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {formatNumber(row.dealCount)} ta
                </span>
              ),
            }))}
            emptyLabel="Qarz yoʻq"
          />
        </ChartCard>
      </div>

      <ChartCard title="Eng katta qarzlar" hint="Qoldiq boʻyicha tartiblangan">
        <DataTable
          columns={debtorColumns}
          rows={data?.debtors ?? []}
          rowKey={(row) => row.id}
          status={query.isError ? 'error' : query.isPending ? 'loading' : 'ready'}
          errorMessage={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          emptyTitle="Qarzdorlik yoʻq"
          emptyBody="Tanlangan davrda barcha yopilgan bitimlar toʻliq toʻlangan."
          minWidth={820}
        />
      </ChartCard>
    </PageShell>
  )
}

function MoneyCard({
  label,
  money,
  delta,
  invertDelta,
  emphasis,
}: {
  label: string
  money?: MoneyDto
  delta?: DeltaDto
  invertDelta?: boolean
  emphasis?: boolean
}) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      <p
        className="mt-1.5 text-2xl leading-none font-semibold tracking-tight"
        style={{ color: emphasis ? 'var(--status-critical)' : 'var(--ink-primary)' }}
        title={money ? formatUzs(money.amount) : undefined}
      >
        {money ? formatCompactUzs(money.amount) : NO_VALUE}
        {money && (
          <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
            soʻm
          </span>
        )}
      </p>
      <div className="mt-2">{delta && <TrendIndicator delta={delta} inverted={invertDelta} />}</div>
    </Card>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value?: number
  tone?: 'good' | 'warning' | 'critical'
}) {
  const color =
    tone === 'good'
      ? 'var(--status-good)'
      : tone === 'warning'
        ? 'var(--status-warning)'
        : tone === 'critical'
          ? 'var(--status-critical)'
          : 'var(--ink-muted)'

  return (
    <Card className="px-4 py-3">
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
        className="tabular mt-1 text-lg leading-none font-semibold"
        style={{ color: 'var(--ink-primary)' }}
      >
        {value === undefined ? NO_VALUE : formatNumber(value)}
      </p>
    </Card>
  )
}
