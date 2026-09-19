'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { useMemo, useRef, useState } from 'react'

import { type CategoryBarRow, CategoryBarList } from '@/components/charts/CategoryBarList'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { Card, ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { SectionHeader, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { apiGet } from '@/lib/api'
import { formatCompactUzs, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

import { TargetAds } from './TargetAds'
import { TargetGroupTable } from './TargetGroupTable'
import { EMPTY_FILTERS, type LeadFilters, TargetLeadTable } from './TargetLeadTable'
import type {
  TargetCountersDto,
  TargetLeadsDto,
  TargetOverviewDto,
  TargetScope,
  TargetStageDto,
} from './targetApi'

/** recharts rides with the chart, not with the page — see CallsPage. */
const TargetDailyChart = dynamic(
  () => import('./TargetDailyChart').then((m) => m.TargetDailyChart),
  { ssr: false, loading: () => <ChartSkeleton height={260} /> },
)

type Status = 'loading' | 'error' | 'ready'
type Cut = 'source' | 'targetolog' | 'creative'

const PAGE_SIZE = 50

/**
 * «Target tahlili» — the leads the ad pages brought in, and what they became.
 *
 * Asked for on 2026-09-19: «targetingni toʻliq qanday boʻlayapti koʻrish
 * uchun… pul maʼlumotlari va boshqalar toʻliq leadlar haqida maʼlumotlar». The
 * client's «Target» sheet could not be read (it is private), so the screen is
 * built from what that sheet is itself built from: the portal's Регистрация
 * deals on the seven target SOURCE_IDs, with the targetolog, creative and
 * first-source fields the target team fills in — and, below them, the ad
 * ledger's spend and campaigns.
 *
 * READING ORDER: the money first (tiles), then how the leads thin out into
 * orders (funnel, daily), then WHO — by page, by targetolog, by creative —
 * then where the leads and the sales stand now, then what the ads cost, and
 * last every lead, one row each. Clicking a row in the «who» table narrows
 * the lead list to it.
 *
 * TWO REQUESTS FOR THE PORTAL HALF, one clock. The overview is every counter
 * from one GROUPING SETS scan, so the tiles, the tables and the chart sum to
 * each other; the lead list is its own paged request with the same window
 * and scope.
 */
export function TargetPage() {
  const { apiParams } = useDashboardFilters()
  const [scope, setScope] = useState<TargetScope>('target')
  const [cut, setCut] = useState<Cut>('source')
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const leadListRef = useRef<HTMLDivElement>(null)

  const windowParams = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset, scope }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to, scope])

  const overview = useQuery({
    queryKey: ['target-overview', windowParams],
    queryFn: ({ signal }) => apiGet<TargetOverviewDto>('/target/overview', windowParams, signal),
  })

  const leadParams = useMemo(() => {
    const out: Record<string, string | number> = { ...windowParams, page, pageSize: PAGE_SIZE }
    if (filters.source) out.source = filters.source
    if (filters.targetolog) out.targetolog = filters.targetolog
    if (filters.stage) out.stage = filters.stage
    if (filters.q) out.q = filters.q
    return out
  }, [windowParams, filters, page])

  const leads = useQuery({
    queryKey: ['target-leads', leadParams],
    queryFn: ({ signal }) => apiGet<TargetLeadsDto>('/target/leads', leadParams, signal),
    placeholderData: keepPreviousData,
  })

  const status: Status = overview.isPending ? 'loading' : overview.isError ? 'error' : 'ready'
  const leadStatus: Status = leads.isPending ? 'loading' : leads.isError ? 'error' : 'ready'
  const data = overview.data?.data

  const changeFilters = (next: LeadFilters) => {
    setFilters(next)
    setPage(1)
  }

  /** A row in the «who» table narrows the lead list, and takes the reader there. */
  const pick = (key: string) => {
    const next = { ...EMPTY_FILTERS }
    if (cut === 'source') next.source = key
    else if (cut === 'targetolog') next.targetolog = key
    else return // creative is not a lead-list filter
    changeFilters({ ...next, q: filters.q })
    leadListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const targetSources = data?.sources.filter((s) => s.isTarget).map((s) => s.name) ?? []

  return (
    <PageShell
      title={t.modules.target.title}
      description={t.modules.target.lead}
      accent="var(--series-7)"
      meta={overview.data?.meta}
      stale={overview.isPlaceholderData}
      toolbar={
        <SegmentedControl<TargetScope>
          ariaLabel="Qaysi manbalar"
          value={scope}
          options={[
            { value: 'target', label: 'Target manbalari' },
            { value: 'all', label: 'Barcha manbalar' },
          ]}
          onChange={(next) => {
            setScope(next)
            setFilters(EMPTY_FILTERS)
            setPage(1)
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {status === 'error' ? (
          <Card className="p-5">
            <ErrorState
              message={overview.error instanceof Error ? overview.error.message : undefined}
              onRetry={() => void overview.refetch()}
            />
          </Card>
        ) : (
          <>
            <SourcesLine scope={scope} names={targetSources} />

            <MoneyTiles total={data?.total} status={status} />

            <div className="grid gap-3 xl:grid-cols-3">
              <ChartCard
                title="Voronka"
                hint="Leaddan tushumgacha. Foizlar — leadlar soniga nisbatan."
              >
                <div className="px-5 pb-5">
                  <CategoryBarList rows={funnelRows(data?.total)} mode="magnitude" status={status} />
                </div>
              </ChartCard>
              <ChartCard
                title="Kunlar boʻyicha"
                hint="Har kuni kelgan leadlar va shu kuni ochilgan buyurtmalar, Toshkent vaqti."
                className="xl:col-span-2"
              >
                <div className="px-5 pb-5">
                  {status === 'loading' ? (
                    <ChartSkeleton height={260} />
                  ) : data && data.total.leads + data.total.sales > 0 ? (
                    <TargetDailyChart days={data.days} />
                  ) : (
                    <EmptyState
                      title="Bu davrda lead yoʻq"
                      body="Tanlangan davrda target manbalaridan hech narsa kelmagan."
                    />
                  )}
                </div>
              </ChartCard>
            </div>

            <section className="flex flex-col gap-3">
              <SectionHeader
                title="Kimdan va qayerdan"
                hint="Qatorni bossangiz, pastdagi leadlar roʻyxati shu qatorga filtrlanadi."
                action={
                  <SegmentedControl<Cut>
                    ariaLabel="Kesim"
                    value={cut}
                    options={[
                      { value: 'source', label: 'Manbalar' },
                      { value: 'targetolog', label: 'Targetologlar' },
                      { value: 'creative', label: 'Kreativlar' },
                    ]}
                    onChange={setCut}
                  />
                }
              />
              <Card className="p-0">
                <TargetGroupTable
                  rows={
                    cut === 'source'
                      ? (data?.bySource ?? [])
                      : cut === 'targetolog'
                        ? (data?.byTargetolog ?? [])
                        : (data?.byCreative ?? [])
                  }
                  keyHeader={
                    cut === 'source' ? 'Manba' : cut === 'targetolog' ? 'Targetolog' : 'Kreativ'
                  }
                  notStated={data?.notStated ?? ''}
                  status={status}
                  onRetry={() => void overview.refetch()}
                  onPick={cut === 'creative' ? undefined : pick}
                />
              </Card>
              <CoverageNote cut={cut} data={data} />
            </section>

            <div className="grid gap-3 lg:grid-cols-2">
              <ChartCard
                title="Leadlar qayerda turibdi"
                hint="Регистрация voronkasidagi bosqichlar — registrator leadni qayerda qoldirgani."
              >
                <div className="px-5 pb-5">
                  <CategoryBarList
                    rows={stageRows(data?.stages ?? [], 'lead', data?.total.leads ?? 0)}
                    mode="magnitude"
                    status={status}
                    emptyBody="Bu davrda lead yoʻq."
                  />
                </div>
              </ChartCard>
              <ChartCard
                title="Sotuv bitimlari qayerda"
                hint="Leaddan ochilgan sotuv bitimlari hozir qaysi voronka va bosqichda. Summalar — bitim summasi."
              >
                <div className="px-5 pb-5">
                  <CategoryBarList
                    rows={stageRows(data?.stages ?? [], 'sale', data?.total.sales ?? 0)}
                    mode="magnitude"
                    status={status}
                    emptyBody="Bu davrda sotuv bitimi ochilmagan."
                  />
                </div>
              </ChartCard>
            </div>

            <TargetAds ads={data?.ads} bitrixLeads={data?.total.leads ?? null} status={status} />
          </>
        )}

        <section ref={leadListRef} className="flex scroll-mt-4 flex-col gap-3">
          <SectionHeader
            title="Leadlar roʻyxati"
            hint="Har bir lead: mijoz, manba, targetolog, registrator qoldirgan bosqich va undan ochilgan sotuv bitimi. ID Bitrix24 dagi bitimni ochadi."
          />
          <Card className="pt-4">
            <TargetLeadTable
              rows={leads.data?.data.items ?? []}
              status={leadStatus}
              errorMessage={leads.error instanceof Error ? leads.error.message : undefined}
              onRetry={() => void leads.refetch()}
              page={page}
              totalPages={leads.data?.data.pagination.totalPages ?? 1}
              totalItems={leads.data?.data.pagination.totalItems ?? 0}
              onPage={setPage}
              filters={filters}
              onFilters={changeFilters}
              sourceOptions={data?.bySource.map((r) => r.key) ?? []}
              targetologOptions={data?.byTargetolog.map((r) => r.key) ?? []}
              stageOptions={
                data?.stages.filter((s) => s.kind === 'lead').map((s) => s.stage) ?? []
              }
            />
          </Card>
        </section>
      </div>
    </PageShell>
  )
}

/** Which pages «Target manbalari» means, named — a scope nobody can see is a guess. */
function SourcesLine({ scope, names }: { scope: TargetScope; names: readonly string[] }) {
  return (
    <p className="text-xs" style={{ color: 'var(--ink-muted)' }} data-testid="target-sources">
      {scope === 'target'
        ? names.length > 0
          ? `Target manbalari: ${names.join(', ')}.`
          : 'Target manbalari portalda topilmadi.'
        : 'Barcha manbalar — target boʻlmaganlari ham (Входящий, qayta murojaat va boshqalar).'}
    </p>
  )
}

function MoneyTiles({ total, status }: { total: TargetCountersDto | undefined; status: Status }) {
  return (
    <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatTile
        status={status}
        label="Leadlar"
        value={total?.leads ?? null}
        unit="count"
        hint={total ? `${formatNumber(total.leadCustomers)} ta alohida mijoz` : undefined}
      />
      <StatTile
        status={status}
        label="Sotuvchiga uzatildi"
        value={total?.passPercent ?? null}
        unit="percent"
        hint={total ? `${formatNumber(total.leadWon)} ta «Сделка успешна»` : undefined}
      />
      <StatTile
        status={status}
        label="Buyurtmalar"
        value={total?.orders ?? null}
        unit="count"
        hint={total ? `leadlarning ${formatPercent(total.orderPercent)} i` : undefined}
      />
      <StatTile
        status={status}
        label="Buyurtma summasi"
        value={total?.ordered.amount ?? null}
        unit="money"
        hint="Tasdiqlash va Доставка ga yetgan bitimlar"
      />
      <StatTile
        status={status}
        label="Tushum (yetkazildi)"
        value={total?.deliveredMoney.amount ?? null}
        unit="money"
        tone={total && total.deliveredMoney.amount > 0 ? 'good' : 'neutral'}
        hint={
          total
            ? `${formatNumber(total.delivered)} ta · sotib olish ${formatPercent(total.buyoutPercent)}`
            : undefined
        }
      />
      <StatTile
        status={status}
        label="1 lead tushumi"
        value={total?.revenuePerLead?.amount ?? null}
        unit="money"
        hint={
          total?.averageCheque
            ? `oʻrtacha chek ${formatCompactUzs(total.averageCheque.amount)} soʻm`
            : 'tushum ÷ leadlar'
        }
      />
    </div>
  )
}

/** The funnel as bars — each step against the leads it started from. */
export function funnelRows(total: TargetCountersDto | undefined): CategoryBarRow[] {
  if (!total) return []
  const share = (n: number) => (total.leads > 0 ? ` · ${formatPercent((n / total.leads) * 100)}` : '')
  return [
    { key: 'leads', label: 'Leadlar', value: total.leads, display: formatNumber(total.leads) },
    {
      key: 'won',
      label: 'Sotuvchiga uzatildi',
      value: total.leadWon,
      display: `${formatNumber(total.leadWon)}${share(total.leadWon)}`,
    },
    {
      key: 'orders',
      label: 'Buyurtma boʻldi',
      value: total.orders,
      display: `${formatNumber(total.orders)}${share(total.orders)}`,
      meta: `${formatCompactUzs(total.ordered.amount)} soʻm`,
    },
    {
      key: 'delivered',
      label: 'Yetkazildi',
      value: total.delivered,
      display: `${formatNumber(total.delivered)}${share(total.delivered)}`,
      meta: `${formatCompactUzs(total.deliveredMoney.amount)} soʻm tushum`,
    },
    {
      key: 'returned',
      label: 'Qaytdi / bekor',
      value: total.returned,
      display: formatNumber(total.returned),
      meta:
        total.returned > 0 ? `${formatCompactUzs(total.returnedMoney.amount)} soʻm` : undefined,
    },
  ]
}

/** Stage bars, in the portal's own order and words; a sale names its pipeline. */
export function stageRows(
  stages: readonly TargetStageDto[],
  kind: 'lead' | 'sale',
  total: number,
): CategoryBarRow[] {
  return stages
    .filter((s) => s.kind === kind && s.deals > 0)
    .map((s) => ({
      key: `${s.pipeline}|${s.stage}`,
      label: kind === 'sale' ? `${s.pipeline} · ${s.stage}` : s.stage,
      value: s.deals,
      display: `${formatNumber(s.deals)}${total > 0 ? ` · ${formatPercent((s.deals / total) * 100)}` : ''}`,
      meta: kind === 'sale' && s.amount.amount > 0 ? `${formatCompactUzs(s.amount.amount)} soʻm` : undefined,
    }))
}

/**
 * How much of the table is «Koʻrsatilmagan», said under it.
 *
 * The targetolog field is filled on a minority of leads and the creative one
 * was added in September, so most rows of those two cuts land in one bucket.
 * Printing that share keeps the bucket from reading as a person.
 */
function CoverageNote({ cut, data }: { cut: Cut; data: TargetOverviewDto | undefined }) {
  if (!data || cut === 'source' || data.total.leads === 0) return null
  const rows = cut === 'targetolog' ? data.byTargetolog : data.byCreative
  const missing = rows.find((r) => r.key === data.notStated)?.leads ?? 0
  if (missing === 0) return null
  const field = cut === 'targetolog' ? '«Таргетолог»' : '«Креатив»'
  return (
    <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
      Leadlarning {formatPercent((missing / data.total.leads) * 100)} ida Bitrix24 dagi {field}{' '}
      maydoni toʻldirilmagan — ular «{data.notStated}» qatorida. Maydon toʻldirilgan sari bu jadval
      aniqlashadi.
    </p>
  )
}
