'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { BarList } from '@/components/charts/BarList'
import { Sparkline } from '@/components/charts/Sparkline'
import { ChartSkeleton } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card } from '@/components/ui/Card'
import { GaugeTile, Meter, RingGauge, SectionHeader, StatTile, StatusChip } from '@/components/ui/Stat'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { IntakeTrendChart } from '@/features/overview/IntakeTrendChart'
import { RejectionControlChart } from '@/features/overview/RejectionControlChart'
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
 *
 * THE AUGUST 2026 REDESIGN made the screen instrumental rather than tabular:
 * the headline leads a hero panel whose daily intake chart is the same count
 * spread over its days, the rejection alarm grew from a one-day bar into the
 * full control chart it was always graded on, and every headline rate wears
 * the ring the design system prescribes for tiles. No number changed meaning;
 * each got the shape that lets a reader judge it without reading it.
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
      <HeroBand data={d} status={status} />
      <MoneyTiles data={d} status={status} />

      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <AlarmCard data={d} status={status} />
        <GaugeColumn data={d} status={status} />
      </div>

      <CohortCard data={d} status={status} />

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
// 1 — What came in: the hero panel
// ---------------------------------------------------------------------------

/**
 * The lead instrument: the period's order count above the daily series it is
 * the sum of. Figure and chart are one panel, so the number is never a blank
 * tile and the chart is never an unheadlined plot — the hero-band rule.
 * `.card-hero` + `.brackets` mark it as the flagship; nothing else on this
 * page wears either class.
 */
function HeroBand({ data, status }: BlockProps) {
  const intake = data?.intake
  const daily = intake?.daily ?? []

  return (
    <Card className="card-hero brackets reveal" as="section">
      <header className="flex items-start justify-between gap-4 px-5 pt-4">
        <div className="min-w-0">
          <h2
            className="text-sm font-semibold tracking-tight"
            style={{ color: 'var(--ink-primary)' }}
          >
            Buyurtma oqimi
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
            Buyurtma OLINGAN sana boʻyicha — ikkala davr ham toʻliq, shuning uchun taqqoslash
            haqiqatni aytadi
          </p>
        </div>
      </header>

      <div className="grid gap-x-8 gap-y-4 px-5 pt-3 pb-5 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
            Buyurtma olindi
          </p>

          {status === 'loading' ? (
            <div className="skeleton mt-1.5 h-10 w-40" role="status">
              <span className="sr-only">Yuklanmoqda</span>
            </div>
          ) : status === 'error' ? (
            <p className="mt-1.5 text-base font-medium" style={{ color: 'var(--status-critical)' }}>
              Olinmadi
            </p>
          ) : intake ? (
            <>
              <p className="figure-hero mt-1.5" style={{ color: 'var(--ink-primary)' }}>
                <AnimatedNumber value={intake.orders.value} format={formatNumber} duration={900} />
                <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                  ta
                </span>
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Delta delta={intake.orders.delta} />
                {intake.orders.previous !== null && (
                  <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    oʻtgan davrda {formatNumber(intake.orders.previous)} ta
                  </span>
                )}
              </div>

              {/* The hero-band rule: a big number carries the thing it was
                  computed beside — here, what the same orders are worth. */}
              <p className="mt-3 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {formatCompactUzs(Number(intake.booked.amount))} soʻm bron qilindi
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                takroriy База yozuvlarisiz
              </p>
            </>
          ) : null}
        </div>

        <div className="min-w-0">
          {status === 'loading' ? (
            <ChartSkeleton height={240} />
          ) : status === 'error' ? (
            <p className="py-16 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
              Grafik uchun maʼlumot olinmadi
            </p>
          ) : daily.length >= 2 ? (
            <IntakeTrendChart
              data={daily}
              previousDailyOrders={intake?.previousDailyOrders ?? null}
              height={240}
            />
          ) : (
            <p className="py-16 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
              Bu davr hali grafik chizishga yetarli kun koʻrmadi
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 2 — The money the intake carries
// ---------------------------------------------------------------------------

function MoneyTiles({ data, status }: BlockProps) {
  const intake = data?.intake
  const revenue = data?.revenue
  const daily = intake?.daily ?? []

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Bron qilingan summa"
        value={intake ? Number(intake.booked.amount) : null}
        unit="money"
        status={status}
        hint="Shu davrda olingan buyurtmalarning umumiy qiymati"
        context={
          <div className="space-y-1.5">
            <Delta delta={intake?.bookedDelta} />
            {daily.length >= 2 && (
              <Sparkline
                values={daily.map((d) => d.booked)}
                label="Kunlik bron summa"
              />
            )}
          </div>
        }
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

        The tiles above carry deltas because their clock is the creation date
        and both windows are complete. This one is bucketed by close date, so
        its previous-period figure is a different population, not a baseline.
        The lag is printed instead of a percentage: it is the honest version
        of the number people want.
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
  )
}

// ---------------------------------------------------------------------------
// 3 — Is anything wrong right now
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
 * Sundays are out of the baseline, not out of the reading — the chart draws
 * them hollow. Sunday takes a third of a weekday's orders and swings twice as
 * widely; blended in, every Sunday trips the alarm and the alarm stops
 * meaning anything.
 */
function AlarmCard({ data, status }: BlockProps) {
  const c = data?.confirmation
  const today = c?.rejectionToday ?? null
  const limit = c?.rejectionLimit ?? 0
  const series = c?.days ?? []

  /*
    Sunday cannot breach. The limit is computed WITHOUT Sundays — a different
    regime with a third of the orders and twice the spread — so grading a
    Sunday reading against it is exactly the false alarm the baseline
    exclusion exists to prevent, and the chart below already refuses it
    (hollow dot, no red). The headline follows the same rule or the two
    halves of one card contradict each other.
  */
  const todayIsSunday = series.at(-1)?.sunday === true
  const breached = today !== null && limit > 0 && !todayIsSunday && today > limit
  const tone = status !== 'ready' ? 'neutral' : breached ? 'critical' : 'good'

  return (
    <Card className="reveal">
      <div className="flex h-full flex-col px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Rad etish ulushi — kunlik nazorat
              </p>
              {/* Only while a norm EXISTS: under five working days the limit
                  is 0 and "Meʼyorda" would assert a norm the footnote below
                  says was never computed. Sunday gets its own words — inside
                  or outside the band, the band was not built for it. */}
              {status === 'ready' && today !== null && limit > 0 && (
                todayIsSunday ? (
                  <StatusChip tone="neutral">Yakshanba — baza tashqarisida</StatusChip>
                ) : (
                  <StatusChip tone={tone}>
                    {breached ? 'Meʼyordan yuqori' : 'Meʼyorda'}
                  </StatusChip>
                )
              )}
            </div>
            {/* Loading, failure and a genuine null are THREE renderings —
                an em dash during a 500 would state "no data", a claim nobody
                measured. The genuine null is real here: a stale sync leaves
                today without a reading until the worker catches up. */}
            {status === 'loading' ? (
              <div className="skeleton mt-1.5 h-8 w-28" role="status">
                <span className="sr-only">Yuklanmoqda</span>
              </div>
            ) : status === 'error' ? (
              <p className="mt-1 text-base font-medium" style={{ color: 'var(--status-critical)' }}>
                Olinmadi
              </p>
            ) : (
              <p className="mt-1 flex items-baseline gap-2">
                <span
                  className="display text-2xl font-semibold"
                  style={{
                    color: breached ? 'var(--status-critical)' : 'var(--ink-primary)',
                  }}
                >
                  {today === null ? '—' : formatPercent(today)}
                </span>
                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {today === null
                    ? 'bugungi oʻlchov hali tushmagan'
                    : `bugun · ${c?.rejectionDays ?? 0} ish kunidan oʻlchangan`}
                </span>
              </p>
            )}
          </div>
        </div>

        <div className="mt-3">
          {status === 'loading' ? (
            <ChartSkeleton height={240} />
          ) : status === 'error' ? (
            <p className="py-16 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
              Grafik uchun maʼlumot olinmadi
            </p>
          ) : series.length >= 2 && limit > 0 ? (
            <RejectionControlChart
              data={series}
              mean={c?.rejectionMean ?? 0}
              limit={limit}
              height={240}
            />
          ) : (
            <p className="py-16 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
              Chegara chizishga hali ish kuni yetarli emas
            </p>
          )}
        </div>

        <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Chegara — shu davrning oʻz oʻrtachasi + 2σ, {c?.rejectionDays ?? 0} ish kuni boʻyicha.
          Yakshanba (boʻsh nuqtalar) bazadan chiqarilgan: u kuni buyurtma uch barobar kam va
          tarqalish ikki barobar keng.
        </p>
      </div>
    </Card>
  )
}

/**
 * The headline rates, each drawn as the ring the design system prescribes
 * for tiles — and each stating the fraction it was computed from, because a
 * rate without its fraction is a claim, not a measurement.
 *
 * Confirmation and returning-customer share wear NEUTRAL rings: the house
 * 85/60 thresholds describe delivery-grade rates, and nobody has set a norm
 * for how much of a queue should confirm or how many customers should come
 * back — a ring that painted 55% critical would be a judgement nobody made.
 * Delivery keeps the graded ring; that scale is what the thresholds are for.
 */
function GaugeColumn({ data, status }: BlockProps) {
  const c = data?.confirmation
  const l = data?.logistics
  const cust = data?.customers

  return (
    <div className="grid content-start gap-3">
      <GaugeTile
        label="Tasdiqlash ulushi"
        value={c?.confirmedRate ?? null}
        tone="neutral"
        status={status}
        hint={c ? `${formatNumber(c.confirmed)} / ${formatNumber(c.orders)} navbatdan` : undefined}
        context={
          c ? (
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Rad etilgan: {formatNumber(c.rejected)} ta
            </p>
          ) : undefined
        }
      />
      <GaugeTile
        label="Yetkazish ulushi"
        value={l?.deliveryRate ?? null}
        tone="auto"
        status={status}
        hint={
          l ? `${formatNumber(l.delivered)} / ${formatNumber(l.resolved)} hal boʻlganidan` : undefined
        }
        context={
          l ? (
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Yoʻlda {formatNumber(l.inFlight)} · erta bekor {formatNumber(l.cancelledEarly)}
            </p>
          ) : undefined
        }
      />
      <GaugeTile
        label="Qaytgan mijozlar ulushi"
        value={cust?.returningSharePercent ?? null}
        tone="neutral"
        status={status}
        hint={
          cust
            ? `${formatNumber(cust.returning)} / ${formatNumber(cust.ordering.value)} mijozdan`
            : undefined
        }
        context={
          <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Yangilar «Mijozlar» kartasida
          </p>
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4 — Where the cohort got to
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
    <Card className="reveal">
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
    <Card className="reveal">
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
    <Card className="reveal">
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
    <Card className="reveal">
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
          {/* The share itself is the ring in the gauge column — this row
              carries the count, so the two never state the same number twice. */}
          <Row
            label="Qaytgan mijozlar"
            value={status === 'ready' ? formatNumber(c?.returning ?? 0) : '…'}
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
  const workingShare =
    team && team.active > 0 ? Math.round((team.working / team.active) * 1000) / 10 : null

  return (
    <Card className="reveal">
      <div className="space-y-3 px-4 py-3.5">
        <SectionHeader title="Jamoa" hint="Bitrix24 dagi tuzilma boʻyicha" />

        {/*
          The number worth a director's attention, drawn as the ring tiles
          get: how many of the people marked active actually made a call or
          won a deal in the window. Headcount alone never moves; this does.
          Graded with the page's own judgement — under 60% earns the warning —
          because the house 85/60 scale was written for delivery rates, not
          for how much of a payroll works in any given window.
        */}
        <div className="flex items-center gap-3.5">
          {status === 'loading' ? (
            <div className="skeleton h-[68px] w-[68px] shrink-0 rounded-full" role="status">
              <span className="sr-only">Yuklanmoqda</span>
            </div>
          ) : status === 'error' ? (
            // Not a null ring: an em dash here would file a failed fetch
            // under "no active employees", a confident claim nobody measured.
            <span
              className="text-base font-medium"
              style={{ color: 'var(--status-critical)' }}
              title="Maʼlumot olinmadi"
            >
              Olinmadi
            </span>
          ) : (
            <RingGauge
              value={workingShare}
              tone={workingShare !== null && workingShare < 60 ? 'warning' : 'neutral'}
              label="Ishlaganlar ulushi"
            />
          )}
          <div className="min-w-0">
            <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Ishlaganlar ulushi
            </p>
            {status === 'ready' && (
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {team && team.active > 0
                  ? `${formatNumber(team.active)} faol xodimdan ${formatNumber(team.working)} tasi shu davrda qoʻngʻiroq qildi yoki bitim yopdi`
                  : 'Faol xodimlar topilmadi'}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile
            label="Xodimlar"
            value={team?.employees ?? null}
            unit="count"
            status={status}
            hint={team ? `${formatNumber(team.departments)} ta boʻlim` : undefined}
          />
          <StatTile
            label="Faol xodimlar"
            value={team?.active ?? null}
            unit="count"
            status={status}
            hint={
              team && team.employees > 0
                ? `${formatPercent((team.active / team.employees) * 100)} roʻyxatdan`
                : undefined
            }
          />
        </div>
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
