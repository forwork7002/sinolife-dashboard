'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { BarList } from '@/components/charts/BarList'
import { Card } from '@/components/ui/Card'
import { Meter, SectionHeader, StatTile, StatusChip } from '@/components/ui/Stat'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type CommandCentreDto, type DeltaDto, apiGet } from '@/lib/api'
import { formatCompactUzs, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'


/**
 * The command centre — the one screen above the nine modules.
 *
 * It answers three questions in order, and the order is the design: what came
 * in, whether anything is wrong right now, and where the business rests. Each
 * block ends in the module that explains it, so this page never becomes the
 * place people try to do the analysis.
 *
 * THE HEADLINE IS ORDER INTAKE, NOT REVENUE, and that is not a stylistic
 * choice. Revenue is bucketed by close date and the median order takes ~24
 * days to close, so a revenue comparison reads this month's closures against
 * last month's — measured on this data it produced "+478% growth" in a month
 * whose intake FELL. Revenue is still shown, because it is what the company
 * earned; it is shown without a growth arrow, next to the lag that explains
 * why it cannot have one.
 */
export function CommandCentrePage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['command', apiParams],
    queryFn: ({ signal }) => apiGet<CommandCentreDto>('/dashboard/command', apiParams, signal),
    // The confirmation queue moves during the working day and this is the
    // screen left open on a wall. Two minutes is slow enough not to thrash
    // ten queries and fast enough that the alarm strip means something.
    refetchInterval: 120_000,
  })

  const d = query.data?.data
  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'

  return (
    <PageShell
      title={t.nav.overview}
      description="Kompaniya bir ekranda — nima kirdi, nima nosoz, nima ustida turibdi"
      meta={query.data?.meta}
      accent="var(--series-1)"
    >
      <IntakeBand data={d} status={status} />
      <AlarmStrip data={d} status={status} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <CohortCard data={d} status={status} />
        <ExecutionCard data={d} status={status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProductRiskCard data={d} status={status} />
        <RegionCard data={d} status={status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CustomerCard data={d} status={status} />
        <TeamCard data={d} status={status} />
      </div>

      <NotConnected data={d} />
    </PageShell>
  )
}

type Status = 'loading' | 'error' | 'ready'
interface BlockProps {
  data: CommandCentreDto | undefined
  status: Status
}

// ---------------------------------------------------------------------------
// 1 — What came in
// ---------------------------------------------------------------------------

function IntakeBand({ data, status }: BlockProps) {
  const intake = data?.intake
  const revenue = data?.revenue

  return (
    <section className="space-y-2.5">
      <SectionHeader
        title="Bu davrda nima kirdi"
        hint="Buyurtma OLINGAN sana boʻyicha — ikkala oy ham toʻliq, shuning uchun taqqoslash haqiqatni aytadi"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Buyurtma olindi"
          value={intake?.orders.value ?? null}
          unit="count"
          status={status}
          context={<Delta delta={intake?.orders.delta} />}
          hint="Yaratilgan sana boʻyicha, takroriy База yozuvlarisiz"
        />
        <StatTile
          label="Bron qilingan summa"
          value={intake ? Number(intake.booked.amount) : null}
          unit="money"
          status={status}
          context={<Delta delta={intake?.bookedDelta} />}
          hint="Shu buyurtmalarning umumiy qiymati"
        />
        <StatTile
          label="Oʻrtacha buyurtma"
          value={intake ? Number(intake.averageOrder.amount) : null}
          unit="money"
          status={status}
          context={<Delta delta={intake?.averageOrderDelta} />}
          hint="Eng barqaror pul koʻrsatkichi — u qimirlasa, sabab bor"
        />
        {/*
          Deliberately arrow-free.

          Every other tile in this row carries a delta because its clock is the
          creation date and both windows are complete. This one is bucketed by
          close date, so its previous-period figure is a different population,
          not a baseline. The lag is printed instead of a percentage: it is the
          honest version of the number people want.
        */}
        <StatTile
          label="Yopilgan daromad"
          value={revenue ? Number(revenue.delivered.amount) : null}
          unit="money"
          status={status}
          hint="Yopilgan sana boʻyicha"
          context={
            revenue?.closeLagDays != null ? (
              <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                oʻrtacha {formatNumber(revenue.closeLagDays)} kundan keyin yopiladi — shuning
                uchun oʻsish foizi koʻrsatilmaydi
              </span>
            ) : undefined
          }
        />
        {/*
          The counterweight, and — like the revenue tile beside it — with no
          arrow. An older window has had longer to drain, so it always shows
          less still open: August against July reads "+186%" for that reason
          alone. Same survivorship artifact as the close lag, different hat.
        */}
        <StatTile
          label="Hali yoʻlda"
          value={intake?.open ?? null}
          unit="count"
          status={status}
          hint="Shu davrda olingan, hali yopilmagan buyurtmalar"
          context={
            revenue ? (
              <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {formatCompactUzs(Number(revenue.openPipeline.amount))} soʻm hali yoʻlda
              </span>
            ) : undefined
          }
        />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 2 — Is anything wrong right now
// ---------------------------------------------------------------------------

/**
 * The rejection-share control chart.
 *
 * The single operational alarm on this page, and the only one that earns the
 * position: it is daily, it is complete the same day, and it is attached to
 * money. It is graded against the period's OWN mean plus two standard
 * deviations rather than a round number somebody picked — measured over 24
 * working days the band sits near 18%, and it was breached on 2 days. A limit
 * that fires on 4% of days is an alarm; one that fires every afternoon is
 * furniture.
 *
 * Sundays are out of the baseline, not out of the reading. Sunday takes a
 * third of a weekday's orders and swings twice as widely; blended in, every
 * Sunday trips the alarm and the alarm stops meaning anything.
 */
function AlarmStrip({ data, status }: BlockProps) {
  const c = data?.confirmation
  const today = c?.rejectionToday ?? null
  const limit = c?.rejectionLimit ?? 0

  const breached = today !== null && limit > 0 && today > limit
  const tone = status !== 'ready' ? 'neutral' : breached ? 'critical' : 'good'

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Rad etish ulushi — bugun
            </p>
            {status === 'ready' && (
              <StatusChip tone={tone}>
                {breached ? 'Meʼyordan yuqori' : 'Meʼyorda'}
              </StatusChip>
            )}
          </div>

          <p className="mt-1 flex items-baseline gap-2">
            <span
              className="display text-2xl font-semibold tabular-nums"
              style={{
                color: breached ? 'var(--status-critical)' : 'var(--ink-primary)',
              }}
            >
              {today === null ? '—' : formatPercent(today)}
            </span>
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {c?.rejectionDays ?? 0} ish kunidan oʻlchangan
            </span>
          </p>

          <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Chegara — shu davrning oʻz oʻrtachasi + 2σ, {c?.rejectionDays ?? 0} ish kuni boʻyicha.
            Yakshanba bazadan chiqarilgan: u kuni buyurtma uch barobar kam va tarqalish ikki
            barobar keng.
          </p>
        </div>

        <div className="w-full max-w-[340px] shrink-0">
          <ControlBar value={today} mean={c?.rejectionMean ?? 0} limit={limit} />
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 3 — Where the cohort got to
// ---------------------------------------------------------------------------

/** The HHI band, in the interface's own language rather than the domain's. */
const BAND_LABELS: Record<string, string> = {
  concentrated: 'jamlangan',
  moderate: 'oʻrtacha',
  diversified: 'tarqoq',
}

const STEP_LABELS: Record<string, string> = {
  created: 'Buyurtma olindi',
  queued: 'Tasdiqlash navbatiga tushdi',
  confirmed: 'Tasdiqlandi',
  shipped: 'Yoʻlga chiqdi',
  delivered: 'Yetkazildi',
}

/**
 * One cohort of orders, followed through the company.
 *
 * NOT drawn as a funnel, and the reason is in the data: `shipped` (2,392)
 * exceeds `confirmed` (2,345), because orders reach a shipping stage without a
 * confirmation stage ever being recorded. A tapering funnel would draw that as
 * a rise and invite the reader to compute a conversion between two steps that
 * do not nest. Bars against one shared denominator say what is true — how many
 * of the SAME orders ever reached each stage — and nothing more.
 */
function CohortCard({ data, status }: BlockProps) {
  const steps = data?.funnel ?? []
  const created = steps[0]?.orders ?? 0

  return (
    <Card>
      <div className="space-y-3 px-4 py-3.5">
        <SectionHeader
          title="Shu davr buyurtmalari qayergacha yetdi"
          hint={`Barchasi bitta maxrajdan — ${formatNumber(created)} ta olingan buyurtmadan`}
        />

        {status !== 'ready' ? (
          <Skeleton rows={5} />
        ) : (
          <div className="space-y-2.5">
            {/*
              Label, count, then the bar — one row each.

              Meter prints its own percentage beside the track, so the row must
              NOT print one too: the first draft showed 98.0% twice, once in
              the header line and again under the bar, which reads as two
              different measurements that happen to agree.
            */}
            {steps.map((step) => (
              <div key={step.key} className="flex items-center gap-3">
                <span
                  className="w-44 shrink-0 truncate text-xs"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {STEP_LABELS[step.key] ?? step.key}
                </span>
                <span
                  className="w-14 shrink-0 text-right text-xs tabular-nums"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {formatNumber(step.orders)}
                </span>
                <div className="min-w-0 flex-1">
                  <Meter value={step.sharePercent} tone="neutral" />
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Bosqichlar bir-birining ichida emas — buyurtma tasdiqlashsiz ham joʻnatilishi mumkin,
          shuning uchun bu voronka emas, qamrov. Yetkazilmaganlarning koʻpi hali yoʻlda.
        </p>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 4 — Execution health
// ---------------------------------------------------------------------------

function ExecutionCard({ data, status }: BlockProps) {
  const c = data?.confirmation
  const l = data?.logistics

  return (
    <Card>
      <div className="space-y-3 px-4 py-3.5">
        <SectionHeader title="Bajarish holati" hint="Tasdiqlash va logistika" />

        <dl className="space-y-2.5">
          <Row
            label="Tasdiqlash ulushi"
            value={status === 'ready' ? formatPercent(c?.confirmedRate ?? null) : '…'}
            meta={c ? `${formatNumber(c.orders)} ta navbatdan` : undefined}
          />
          <Row
            label="Rad etilgan"
            value={status === 'ready' ? formatNumber(c?.rejected ?? 0) : '…'}
          />
          <Row
            label="Yetkazish ulushi"
            value={status === 'ready' ? formatPercent(l?.deliveryRate ?? null) : '…'}
            meta="hal boʻlgan buyurtmalardan"
          />
          <Row
            label="Yoʻlda"
            value={status === 'ready' ? formatNumber(l?.inFlight ?? 0) : '…'}
          />
          <Row
            label="Erta bekor qilingan"
            value={status === 'ready' ? formatNumber(l?.cancelledEarly ?? 0) : '…'}
          />
        </dl>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 5 — What the business rests on
// ---------------------------------------------------------------------------

/**
 * Product concentration — the largest single risk this database can show.
 *
 * One product is around two thirds of the month's revenue. That is not a
 * curiosity; it is the answer to "what happens if a supplier misses a month",
 * and no other screen in the product asks it — the concentration module
 * indexes by source and by region, never by product.
 *
 * The coverage line is not decoration. These shares are of the revenue that
 * carries line items, and stating what fraction that is turns the number from
 * a claim into a measurement.
 */
function ProductRiskCard({ data, status }: BlockProps) {
  const p = data?.products
  const top = p?.topSharePercent ?? null

  return (
    <Card>
      <div className="space-y-3 px-4 py-3.5">
        <SectionHeader
          title="Daromad nimaga tayanadi"
          hint="Mahsulotlar boʻyicha, shu davrda yopilgan daromaddan"
          action={
            status === 'ready' && top !== null ? (
              <StatusChip tone={top >= 50 ? 'warning' : 'neutral'}>
                eng kattasi {formatPercent(top)}
              </StatusChip>
            ) : undefined
          }
        />

        {status !== 'ready' ? (
          <Skeleton rows={4} />
        ) : (
          <BarList
            items={(p?.rows ?? []).map((r) => ({
              id: r.label,
              label: r.label,
              value: Number(r.revenue.amount),
              sharePercent: r.sharePercent,
            }))}
          />
        )}

        {p?.coveragePercent != null && (
          <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {p.coveragePercent >= 95
              ? 'Daromadning deyarli hammasi mahsulot satrlari bilan yozilgan — ulushlar butun daromaddan.'
              : `Ulushlar daromadning ${formatPercent(p.coveragePercent)} qismidan — qolganida mahsulot satri yoʻq.`}
          </p>
        )}
      </div>
    </Card>
  )
}

function RegionCard({ data, status }: BlockProps) {
  const regions = data?.logistics.regions ?? []

  return (
    <Card>
      <div className="space-y-3 px-4 py-3.5">
        <SectionHeader
          title="Hududlar"
          hint="Buyurtma soni boʻyicha eng yiriklari"
        />

        {status !== 'ready' ? (
          <Skeleton rows={4} />
        ) : (
          <BarList
            items={regions.map((r) => ({
              id: r.label,
              label: r.label,
              value: r.orders,
              meta: (
                <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {formatPercent(r.deliveryRate)} yetkazildi
                </span>
              ),
            }))}
            valueFormatter={formatNumber}
          />
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 6 — People, on both sides of the counter
// ---------------------------------------------------------------------------

function CustomerCard({ data, status }: BlockProps) {
  const c = data?.customers
  const conc = data?.concentration

  return (
    <Card>
      <div className="space-y-3 px-4 py-3.5">
        <SectionHeader title="Mijozlar" hint="Birinchi xaridi shu davrga tushganlar — yangi" />

        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="Xarid qilgan mijozlar"
            value={c?.ordering.value ?? null}
            unit="count"
            status={status}
            context={<Delta delta={c?.ordering.delta} />}
          />
          <StatTile
            label="Yangi mijozlar"
            value={c?.fresh.value ?? null}
            unit="count"
            status={status}
            context={<Delta delta={c?.fresh.delta} />}
          />
        </div>

        <dl className="space-y-2.5">
          <Row
            label="Qaytgan mijozlar"
            value={status === 'ready' ? formatNumber(c?.returning ?? 0) : '…'}
            meta={
              c?.returningSharePercent != null
                ? `${formatPercent(c.returningSharePercent)} ulush`
                : undefined
            }
          />
          <Row
            label="Ikkinchi xaridgacha"
            value={
              status === 'ready' && conc?.repeatMedianDays != null
                ? `${formatNumber(conc.repeatMedianDays)} kun`
                : '—'
            }
            meta="mediana"
          />
          <Row
            label="Manbalar konsentratsiyasi"
            value={status === 'ready' ? formatNumber(conc?.sourceHhi ?? 0) : '…'}
            meta={conc?.sourceBand ? BAND_LABELS[conc.sourceBand] : undefined}
          />
        </dl>
      </div>
    </Card>
  )
}

function TeamCard({ data, status }: BlockProps) {
  const team = data?.team

  return (
    <Card>
      <div className="space-y-3 px-4 py-3.5">
        <SectionHeader title="Jamoa" hint="Bitrix24 dagi tuzilma boʻyicha" />

        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="Xodimlar"
            value={team?.employees ?? null}
            unit="count"
            status={status}
            hint={team ? `${formatNumber(team.departments)} ta boʻlim` : undefined}
          />
          {/*
            The number worth a director's attention, and the reason this card
            is not just a headcount: how many of the people marked active
            actually made a call or won a deal in the window. Headcount alone
            never moves; this does.
          */}
          <StatTile
            label="Shu davrda ishlagan"
            value={team?.working ?? null}
            unit="count"
            status={status}
            hint={
              team && team.active > 0
                ? `${formatNumber(team.active)} faol xodimdan`
                : undefined
            }
            tone={
              team && team.active > 0 && team.working / team.active < 0.6
                ? 'warning'
                : 'neutral'
            }
          />
        </div>

        <dl className="space-y-2.5">
          <Row
            label="Faol xodimlar"
            value={status === 'ready' ? formatNumber(team?.active ?? 0) : '…'}
            meta={
              team && team.employees > 0
                ? `${formatPercent((team.active / team.employees) * 100)} roʻyxatdan`
                : undefined
            }
          />
          <Row
            label="Ishlaganlar ulushi"
            value={
              status === 'ready' && team && team.active > 0
                ? formatPercent((team.working / team.active) * 100)
                : '—'
            }
            meta="faol xodimlardan"
          />
          <Row
            label="Boʻlimlar"
            value={status === 'ready' ? formatNumber(team?.departments ?? 0) : '…'}
          />
        </dl>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 7 — What this screen cannot show
// ---------------------------------------------------------------------------

/**
 * Stated, not hidden.
 *
 * A missing card leaves the reader unable to tell whether the dashboard forgot
 * the warehouse or the warehouse is empty — and the difference decides who
 * gets called. Each entry says what is missing and what would connect it, so
 * the answer to "why is there no stock figure" is on the screen rather than in
 * somebody's memory.
 */
function NotConnected({ data }: { data: CommandCentreDto | undefined }) {
  const items = data?.unavailable ?? []
  if (items.length === 0) return null

  return (
    <section className="space-y-2.5">
      <SectionHeader
        title="Hali ulanmagan"
        hint="Bu raqamlar nol emas — ular hali mavjud emas"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div key={item.key} className="card flex flex-col gap-1.5 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <p
                className="truncate text-[12.5px] font-medium"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {item.label}
              </p>
              <StatusChip tone="neutral">ulanmagan</StatusChip>
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              {item.reason}
            </p>
            <p className="mt-auto text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Kerak: {item.needed}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------

/**
 * The period-over-period arrow.
 *
 * Renders nothing while the request is in flight rather than a placeholder
 * arrow — a trend indicator that appears before its number has arrived is a
 * claim nobody made. TrendIndicator itself already handles the awkward cases
 * the domain models: no baseline, unchanged, and a base too small to divide.
 */
/**
 * Today's reading against its own control band.
 *
 * Purpose-built rather than a `Meter`, because a meter draws a value against a
 * fixed 0–100 track and the whole question here is where the value falls
 * relative to two moving landmarks — the mean and the 2-sigma limit. Those are
 * marks on the track, not the track itself, and no existing component can draw
 * them.
 *
 * The scale runs to a quarter past the limit rather than to 100: a rejection
 * share lives between 5% and 20%, and a 0–100 track would compress the entire
 * interesting range into its first fifth.
 */
function ControlBar({
  value,
  mean,
  limit,
}: {
  value: number | null
  mean: number
  limit: number
}) {
  if (value === null || limit <= 0) {
    return (
      <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        Maʼlumot yetarli emas
      </span>
    )
  }

  const scale = Math.max(limit * 1.25, value * 1.1)
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`
  const breached = value > limit

  return (
    <div className="space-y-1.5">
      <div
        className="relative h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--track)' }}
        role="img"
        aria-label={`Bugun ${formatPercent(value)}, chegara ${formatPercent(limit)}`}
      >
        {/* The normal band — everything up to the limit — as a calm ground the
            reading sits on, so "inside the band" is visible without reading a
            number. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: pct(limit),
            background: 'color-mix(in oklab, var(--status-good) 18%, transparent)',
          }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: pct(value),
            background: breached ? 'var(--status-critical)' : 'var(--seq-450)',
            transition: 'width var(--duration-enter) var(--ease-out)',
          }}
        />
        {/* The limit itself, drawn as a hard tick. A band with no edge is just
            a gradient, and the edge is the entire decision. */}
        <div
          className="absolute inset-y-0 w-0.5"
          style={{ left: pct(limit), background: 'var(--ink-secondary)' }}
        />
      </div>

      <div className="flex justify-between text-[10px]" style={{ color: 'var(--ink-muted)' }}>
        <span>odatda {formatPercent(mean)}</span>
        <span>chegara {formatPercent(limit)}</span>
      </div>
    </div>
  )
}

function Delta({ delta }: { delta: DeltaDto | undefined }) {
  if (!delta) return null
  return <TrendIndicator delta={delta} />
}

function Row({ label, value, meta }: { label: string; value: ReactNode; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
         style={{ borderColor: 'var(--grid)' }}>
      <dt className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </dt>
      <dd className="text-right">
        <span className="text-sm font-medium tabular-nums" style={{ color: 'var(--ink-primary)' }}>
          {value}
        </span>
        {meta && (
          <span className="ml-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {meta}
          </span>
        )}
      </dd>
    </div>
  )
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2.5" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-8 animate-pulse rounded" style={{ background: 'var(--grid)' }} />
      ))}
    </div>
  )
}
