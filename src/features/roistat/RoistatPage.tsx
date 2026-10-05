'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { type ReactNode, useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { type CategoryBarRow, CategoryBarList } from '@/components/charts/CategoryBarList'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { Card, ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { StatTile } from '@/components/ui/Stat'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { apiGet } from '@/lib/api'
import { formatCents, formatDateTime, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

import { ROISTAT_DIMS, type RoistatCountersDto, type RoistatDim, type RoistatOverviewDto } from './roistatApi'
import { type RoistatCurrency, deriveMetrics, fromUsd, fromUzs, toDelta } from './roistatMetrics'
import { DIM_LABEL, RoistatTable, dayLabel } from './RoistatTable'

/** recharts rides with the chart, not with the page — see CallsPage. */
const RoistatDailyChart = dynamic(
  () => import('./RoistatCharts').then((m) => m.RoistatDailyChart),
  { ssr: false, loading: () => <ChartSkeleton height={280} /> },
)

type Status = 'loading' | 'error' | 'ready'

/** Which table is on screen: a cut, and for the Meta drill the row it was opened from. */
interface View {
  readonly dim: RoistatDim
  readonly parent: string | null
}

/**
 * «Roistat — skvoznaya analitika»: Meta Ads spend to Bitrix24 sales, end to end.
 *
 * Modelled on the client's static Roistat page (rustamov0277-cmd.github.io/
 * roistat) — the same tiles, the same twelve cuts, the same columns, badges
 * and thresholds — drawn in this dashboard's own design system and fed by
 * `/roistat/overview` instead of a 5.5 MB literal.
 *
 * ONE REQUEST, ONE CLOCK. The tiles (`kpi` / `kpiPrevious`), the table
 * (`rows` / `total`) and the chart (`daily`) all come from the same answer,
 * keyed on the dashboard window plus the cut. Every ratio is derived here, in
 * `roistatMetrics.ts`, from raw counters — so ИТОГО is the ratio of its sums.
 *
 * THE CURRENCY IS A READING, NOT A QUESTION. сум / $ converts at the CBU rate
 * the response carries; no parameter, no refetch. It is remembered per
 * browser.
 *
 * Switching cuts keeps the previous answer on screen (dimmed through
 * `stale`) until the new one lands, so the page does not collapse to
 * skeletons on every tab.
 */
export function RoistatPage() {
  const { apiParams } = useDashboardFilters()
  const [view, setView] = useState<View>({ dim: 'camp', parent: null })
  const [currency, setCurrency] = useCurrency()

  const params = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset, dim: view.dim }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    if (view.parent !== null) out.parent = view.parent
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to, view.dim, view.parent])

  const overview = useQuery({
    queryKey: ['roistat-overview', params],
    queryFn: ({ signal }) => apiGet<RoistatOverviewDto>('/roistat/overview', params, signal),
    placeholderData: keepPreviousData,
  })

  const data = overview.data?.data
  // A failed BACKGROUND refetch keeps the numbers already on screen; the error
  // card is for having nothing to show at all.
  const status: Status = overview.isPending ? 'loading' : !data ? 'error' : 'ready'
  const errorMessage = overview.error instanceof Error ? overview.error.message : undefined
  const retry = () => void overview.refetch()

  const drill = useCallback((dim: RoistatDim, key: string) => {
    if (dim === 'camp') setView({ dim: 'adset', parent: key })
    else if (dim === 'adset') setView({ dim: 'ad', parent: key })
  }, [])

  const rate = data?.rate ?? null
  const lastDay = data?.daily[data.daily.length - 1]?.date
  const settling = data !== undefined && lastDay !== undefined && lastDay >= data.freshFrom
  const emptyWindow = status === 'ready' && data !== undefined && isEmptyWindow(data.kpi)
  /*
    The Meta cuts read the ad grain, imported apart from the campaign grain
    the tiles read. Below it by more than a dollar and a percent, the ad grain
    is still filling — the hour after a deploy, or an account Meta refused —
    and the table's ИТОГО would otherwise contradict the Расход tile in silence.
  */
  const adGrainShort =
    data !== undefined &&
    data.dim === 'camp' &&
    data.parent === null &&
    data.campaignSpendUsd - data.total.spendUsd > Math.max(1, data.campaignSpendUsd * 0.01)

  return (
    <PageShell
      title={t.modules.roistat.title}
      description={t.modules.roistat.lead}
      accent="var(--series-2)"
      meta={overview.data?.meta}
      stale={overview.isPlaceholderData}
      toolbar={
        <>
          <SegmentedControl<RoistatCurrency>
            ariaLabel="Valyuta"
            value={currency}
            options={[
              { value: 'uzs', label: 'сум' },
              { value: 'usd', label: '$' },
            ]}
            onChange={setCurrency}
          />
          <RateLine rate={rate} status={status} />
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {status === 'error' ? (
          <Card className="p-5">
            <ErrorState message={errorMessage} onRetry={retry} />
          </Card>
        ) : emptyWindow ? (
          <Card className="p-5">
            <EmptyState
              title="Bu davrda maʼlumot yoʻq"
              body="Tanlangan davrda na Meta rasxodi, na Bitrix24 lidi topildi."
              hint="Davrni kengaytirib koʻring."
            />
          </Card>
        ) : (
          <>
            {settling && (
              <Note tone="warning">
                ⏳ <b>Oxirgi 7 kun hali toʻliq emas</b> — sotuvlar keyinroq yopiladi, bu kunlardagi
                past ROAS normal.
              </Note>
            )}
            {adGrainShort && (
              <Note tone="warning">
                Meta eʼlon darajasidagi maʼlumot hali toʻliq yuklanmagan: kampaniyalar jadvalida{' '}
                <b>{formatUsdPlain(data.total.spendUsd)}</b>, rasxod kartasida{' '}
                <b>{formatUsdPlain(data.campaignSpendUsd)}</b>. Import har soatda toʻldiradi.
              </Note>
            )}
            {status === 'ready' && rate === null && (
              <Note tone="warning">
                CBU kursi olinmadi — soʻm va dollar orasidagi hisoblar (ROAS, soʻmdagi rasxod)
                hozircha chiqmaydi.
              </Note>
            )}

            <KpiTiles data={data} status={status} currency={currency} />

            <Card className="p-0">
              <header className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:px-5">
                <DimTabs
                  value={view.dim}
                  onChange={(dim) => setView({ dim, parent: null })}
                />
                <div className="min-w-0">
                  <h2
                    className="text-sm font-semibold tracking-tight"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    Анализ по: {DIM_LABEL[view.dim]}
                  </h2>
                  <Breadcrumb view={view} data={data} onGo={setView} />
                </div>
              </header>
              <div className="px-3 pb-3 sm:px-4">
                <RoistatTable
                  key={`${data?.dim ?? view.dim}:${data?.parent?.key ?? ''}`}
                  data={data}
                  status={status}
                  currency={currency}
                  errorMessage={errorMessage}
                  onRetry={retry}
                  onDrill={drill}
                />
              </div>
            </Card>

            <div className="grid gap-3 xl:grid-cols-3">
              <ChartCard title="Воронка" hint="Lid → toza → kval → buyurtma → sotuv. Foiz — lidlarga nisbatan.">
                <CategoryBarList rows={funnelRows(data?.kpi)} mode="magnitude" status={status} />
              </ChartCard>
              <ChartCard
                title="Динамика: расход и ROAS"
                hint="Har kungi Meta rasxodi va shu kun kelgan lidlardan tushgan tushumning ROAS i."
                className="xl:col-span-2"
              >
                {status === 'loading' || !data ? (
                  <ChartSkeleton height={280} />
                ) : data.daily.length === 0 ? (
                  <EmptyState title="Bu davrda kunlik maʼlumot yoʻq" />
                ) : (
                  <RoistatDailyChart
                    days={data.daily}
                    currency={currency}
                    uzsPerUsd={rate?.uzsPerUsd ?? null}
                    freshFrom={data.freshFrom}
                  />
                )}
              </ChartCard>
            </div>

            <footer className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              <p>
                Качество = чистые / лиды · QL% = квал / лиды · Выкуп = продажи / заказы · ROAS =
                выручка / расход · CAC = расход / новые клиенты
              </p>
              <p>
                Manba: Meta Ads + Bitrix24. Tushum lid sanasiga bogʻlangan.
                {data?.metaImportedAt && (
                  <> Meta oxirgi marta {formatDateTime(data.metaImportedAt)} da olingan.</>
                )}
              </p>
            </footer>
          </>
        )}
      </div>
    </PageShell>
  )
}

/** Nothing anywhere in the window: no spend, no lead, no order. */
function isEmptyWindow(k: RoistatCountersDto): boolean {
  return k.spendUsd === 0 && k.leads === 0 && k.orders === 0 && k.sold === 0 && k.impressions === 0
}

function Note({ tone, children }: { tone: 'warning'; children: ReactNode }) {
  const colour = tone === 'warning' ? 'var(--status-warning)' : 'var(--ink-secondary)'
  return (
    <p
      role="note"
      className="rounded-lg px-3 py-2 text-xs"
      style={{
        background: `color-mix(in oklab, ${colour} 12%, transparent)`,
        borderLeft: `3px solid ${colour}`,
        color: 'var(--ink-primary)',
      }}
    >
      {children}
    </p>
  )
}

/** «Kurs: 11 773 soʻm (03.10.2026)» — the rate every conversion on the page used. */
function RateLine({ rate, status }: { rate: RoistatOverviewDto['rate']; status: Status }) {
  if (status !== 'ready') return null
  return (
    <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
      {rate
        ? `Kurs: ${formatFullUzs(Math.round(rate.uzsPerUsd))} soʻm (${dayLabel(rate.date)})`
        : 'Kurs: CBU javob bermadi'}
    </span>
  )
}

/** The twelve cuts. Scrolls sideways on a phone rather than wrapping into a wall of buttons. */
function DimTabs({ value, onChange }: { value: RoistatDim; onChange: (dim: RoistatDim) => void }) {
  return (
    <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
      <div className="w-max">
        <SegmentedControl<RoistatDim>
          ariaLabel="Kesim"
          value={value}
          options={ROISTAT_DIMS.map((dim) => ({ value: dim, label: DIM_LABEL[dim] }))}
          onChange={onChange}
        />
      </div>
    </div>
  )
}

/**
 * «Кампании / <campaign> / <adset>». Labels come from the RESPONSE (`parent`,
 * `grandParent`) — only while it answers the view on screen; between a click
 * and its answer the crumb says «…» rather than naming the previous row.
 */
function Breadcrumb({
  view,
  data,
  onGo,
}: {
  view: View
  data: RoistatOverviewDto | undefined
  onGo: (view: View) => void
}) {
  if (view.dim !== 'adset' && view.dim !== 'ad') return null
  const current = data && data.dim === view.dim && (data.parent?.key ?? null) === view.parent
  const parentLabel = view.parent === null ? null : current ? (data.parent?.label ?? view.parent) : '…'
  const grand = view.dim === 'ad' && current ? data.grandParent : null

  const link = 'focusable rounded underline-offset-2 hover:underline'
  return (
    <nav aria-label="Drill" className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">
      <button
        type="button"
        className={link}
        style={{ color: 'var(--accent-ink)' }}
        onClick={() => onGo({ dim: 'camp', parent: null })}
      >
        Кампании
      </button>
      {grand && (
        <>
          <span aria-hidden style={{ color: 'var(--ink-muted)' }}>/</span>
          <button
            type="button"
            className={`${link} max-w-[240px] truncate`}
            style={{ color: 'var(--accent-ink)' }}
            title={grand.label}
            onClick={() => onGo({ dim: 'adset', parent: grand.key })}
          >
            {grand.label}
          </button>
        </>
      )}
      {parentLabel !== null && (
        <>
          <span aria-hidden style={{ color: 'var(--ink-muted)' }}>/</span>
          <span
            className="max-w-[280px] truncate"
            style={{ color: 'var(--ink-secondary)' }}
            title={parentLabel}
            aria-current="page"
          >
            {parentLabel}
          </span>
        </>
      )}
    </nav>
  )
}

/**
 * The twelve headline tiles, current window against the one before it.
 *
 * Cost metrics (CPL, CPO, CAC, Deal Time) read `inverted`: the arrow still
 * points the way the number moved, and a fall is coloured as the good news it
 * is — where the reference swapped the pair instead, which also changed the
 * size of the percentage it printed.
 */
function KpiTiles({
  data,
  status,
  currency,
}: {
  data: RoistatOverviewDto | undefined
  status: Status
  currency: RoistatCurrency
}) {
  const rate = data?.rate?.uzsPerUsd ?? null
  const k = data?.kpi
  const p = data?.kpiPrevious
  const cur = k ? deriveMetrics(k, rate) : null
  const prev = p ? deriveMetrics(p, rate) : null
  const moneyUnit = currency === 'uzs' ? 'money' : 'usd'
  const usd = (v: number | null | undefined) => fromUsd(v ?? null, currency, rate)
  const uzs = (v: number | null | undefined) => fromUzs(v ?? null, currency, rate)

  const trend = (
    c: number | null | undefined,
    pv: number | null | undefined,
    opts: { inverted?: boolean; points?: boolean } = {},
  ) =>
    status === 'ready' && c !== undefined && pv !== undefined ? (
      <TrendIndicator
        delta={toDelta(c, pv)}
        inverted={opts.inverted}
        points={opts.points ? { current: c, previous: pv } : undefined}
      />
    ) : undefined

  return (
    <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      <StatTile
        status={status}
        label="Расход"
        value={usd(k?.spendUsd)}
        unit={moneyUnit}
        hint="Meta Ads"
        context={trend(k?.spendUsd, p?.spendUsd)}
      />
      <StatTile
        status={status}
        label="Лиды"
        value={k?.leads ?? null}
        unit="count"
        hint={k ? `toza: ${formatNumber(k.clean)}` : undefined}
        context={trend(k?.leads, p?.leads)}
      />
      <StatTile
        status={status}
        label="CPL"
        value={usd(cur?.cpl)}
        unit={moneyUnit}
        hint="цена лида"
        context={trend(cur?.cpl, prev?.cpl, { inverted: true })}
      />
      <StatTile
        status={status}
        label="Квал"
        value={k?.kval ?? null}
        unit="count"
        hint={cur ? `QL ${formatPercent(cur.ql)}` : undefined}
        context={trend(k?.kval, p?.kval)}
      />
      <StatTile
        status={status}
        label="Продажи"
        value={k?.sold ?? null}
        unit="count"
        hint={cur ? `выкуп ${formatPercent(cur.buy)}` : undefined}
        context={trend(k?.sold, p?.sold)}
      />
      <StatTile
        status={status}
        label="CPO"
        value={usd(cur?.cpo)}
        unit={moneyUnit}
        hint="цена продажи"
        context={trend(cur?.cpo, prev?.cpo, { inverted: true })}
      />
      <StatTile
        status={status}
        label="CAC"
        value={usd(cur?.cac)}
        unit={moneyUnit}
        hint="новый клиент"
        context={trend(cur?.cac, prev?.cac, { inverted: true })}
      />
      <StatTile
        status={status}
        label="Конверсия"
        value={cur?.conv ?? null}
        unit="percent"
        hint="лид → продажа"
        context={trend(cur?.conv, prev?.conv, { points: true })}
      />
      <StatTile
        status={status}
        label="Средний чек"
        value={uzs(cur?.avg)}
        unit={moneyUnit}
        context={trend(cur?.avg, prev?.avg)}
      />
      <StatTile
        status={status}
        label="ARPL"
        value={uzs(cur?.arpl)}
        unit={moneyUnit}
        hint="выручка с лида"
        context={trend(cur?.arpl, prev?.arpl)}
      />
      <StatTile
        status={status}
        label="Deal Time"
        value={cur?.dealDays ?? null}
        unit="days"
        hint="лид → продажа"
        context={trend(cur?.dealDays, prev?.dealDays, { inverted: true })}
      />
      <StatTile
        status={status}
        label="Выручка"
        value={uzs(k?.soldUzs)}
        unit={moneyUnit}
        fill="good"
        hint={cur ? `ROAS ${cur.roas === null ? '—' : `${formatCents(cur.roas)}x`}` : undefined}
        context={trend(k?.soldUzs, p?.soldUzs)}
      />
    </div>
  )
}

/** The reference's funnel — each step as a bar, its share of the leads beside it. */
function funnelRows(k: RoistatCountersDto | undefined): CategoryBarRow[] {
  if (!k) return []
  const share = (n: number) => (k.leads > 0 ? ` · ${formatPercent((n / k.leads) * 100)}` : '')
  const step = (key: string, label: string, n: number, first = false): CategoryBarRow => ({
    key,
    label,
    value: n,
    display: `${formatNumber(n)}${first ? '' : share(n)}`,
  })
  return [
    step('leads', 'Лиды', k.leads, true),
    step('clean', 'Чистые', k.clean),
    step('kval', 'Квал', k.kval),
    step('orders', 'Заказы', k.orders),
    step('sold', 'Продажи', k.sold),
  ]
}

/*
  THE CURRENCY, REMEMBERED PER BROWSER — through `useSyncExternalStore` for
  the reason `theme.ts` and `periodMemory` are: the server render has no
  storage and says сум, the browser then reads what was chosen, and React
  reconciles the two without a hydration warning. Storage can throw (a
  private window, blocked site data); the choice then lives in memory for the
  visit and simply is not remembered.
*/
const CURRENCY_KEY = 'sinolife.roistat.currency.v1'
const currencyListeners = new Set<() => void>()
let currencyInMemory: RoistatCurrency | null = null

function readCurrency(): RoistatCurrency {
  if (currencyInMemory !== null) return currencyInMemory
  try {
    return window.localStorage.getItem(CURRENCY_KEY) === 'usd' ? 'usd' : 'uzs'
  } catch {
    return 'uzs'
  }
}

function subscribeCurrency(onChange: () => void): () => void {
  currencyListeners.add(onChange)
  return () => {
    currencyListeners.delete(onChange)
  }
}

function useCurrency(): [RoistatCurrency, (next: RoistatCurrency) => void] {
  const value = useSyncExternalStore(subscribeCurrency, readCurrency, () => 'uzs' as const)
  const set = useCallback((next: RoistatCurrency) => {
    currencyInMemory = next
    try {
      window.localStorage.setItem(CURRENCY_KEY, next)
    } catch {
      // Still switches; it just will not be remembered next visit.
    }
    for (const listener of currencyListeners) listener()
  }, [])
  return [value, set]
}

/** Dollars for a sentence: whole, thin-spaced, unit after — «20 694 $». */
function formatUsdPlain(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} $`
}
