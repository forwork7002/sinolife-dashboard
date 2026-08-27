'use client'

import { useQuery } from '@tanstack/react-query'

import { ChartCard } from '@/components/ui/Card'
import { DataTable, InitialChip, type Column } from '@/components/ui/DataTable'
import { GaugeTile, Meter, RingGauge, StatTile, StatusChip } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type ConfirmationDto, type ConfirmationRowDto, apiGet } from '@/lib/api'
import { formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Order confirmation, per operator.
 *
 * Built from the `Успешно заказ` stage, not from the confirmation field —
 * that field is filled on 17 deals out of 16 618 and a report on it would look
 * like an outage. The stage is what operators actually use.
 *
 * The second rate is the one that matters. A confirmation rate on its own
 * rewards marking orders confirmed to clear a queue; putting "of those
 * confirmed, how many actually arrived" directly beside it makes that
 * behaviour visible instead of invisible. An operator with 98% confirmed and
 * 40% delivered is not performing well, and no single column would say so.
 */
export function ConfirmationPage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['confirmations', apiParams],
    queryFn: ({ signal }) =>
      apiGet<ConfirmationDto>('/insights/confirmations', apiParams, signal),
  })

  /** One derivation, so no tile can disagree with its own page. */

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'


  const data = query.data?.data
  const totals = data?.totals

  const columns: Column<ConfirmationRowDto>[] = [
    {
      key: 'name',
      // The row's name: what a screen reader announces the row BY.
      rowHeader: true,
      header: 'Operator',
      // The chip anchors each row the way an avatar would — 92 rows of bare
      // names give the scanning eye nothing to land on. aria-hidden inside
      // the chip: the visible name right beside it is the accessible text.
      render: (row) => (
        <span className="flex items-center gap-2">
          <InitialChip name={row.employeeName} />
          <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
            {row.employeeName}
          </span>
        </span>
      ),
    },
    {
      key: 'orders',
      header: 'Buyurtma',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.orders),
    },
    {
      key: 'confirmed',
      header: 'Tasdiqlangan',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.confirmed),
    },
    {
      key: 'coverage',
      header: 'Tasdiqlash qamrovi',
      width: '160px',
      render: (row) => <Meter value={row.coverage} tone="neutral" label={row.employeeName} />,
    },
    {
      key: 'delivered',
      header: 'Yetkazildi',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.delivered),
    },
    {
      key: 'failed',
      header: 'Qaytdi / bekor',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.failed === 0 ? (
          <span style={{ color: 'var(--ink-muted)' }}>0</span>
        ) : (
          <span style={{ color: 'var(--status-critical)' }}>{formatNumber(row.failed)}</span>
        ),
    },
    {
      key: 'deliveryRate',
      header: 'Yetkazish %',
      width: '150px',
      render: (row) => <Meter value={row.deliveryRate} label={row.employeeName} />,
    },
    {
      key: 'stickRate',
      // One word longer than the column was wide — the only wrapped header in
      // the table put its baseline a line below every neighbour's.
      header: 'Tasdiqdan soʻng',
      align: 'right',
      numeric: true,
      width: '132px',
      /*
        A number, not a meter.
        
        This column used to be exactly 100.0% in 89 of 92 rows — a bar chart of
        a constant, 150px of identical full green bars. The rows that deviate
        are the entire point of the column, and a number makes them findable
        where a meter buried them. The meter stays on Qamrov, which genuinely
        varies from operator to operator.
      */
      render: (row) =>
        row.confirmed === 0 ? (
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            tasdiq yoʻq
          </span>
        ) : (
          <span
            /*
              Plain ink until the house threshold actually trips.
              
              The old branch was written when this column was a constant 100%
              and anything else was an anomaly worth amber. On the real
              confirmation ladder the column varies — and it was painting a
              93% stick rate as a warning, 22 of the first 25 rows amber. A
              rate is ordinary until it is genuinely low.
            */
            style={{
              color:
                row.stickRate < 60
                  ? 'var(--status-critical)'
                  : row.stickRate < 85
                    ? 'var(--status-warning)'
                    : 'var(--ink-secondary)',
              fontWeight: row.stickRate < 85 ? 600 : 400,
            }}
          >
            {formatPercent(row.stickRate)}
          </span>
        ),
    },
    {
      key: 'verdict',
      header: 'Baho',
      render: (row) => <Verdict row={row} />,
    },
  ]

  return (
    <PageShell
      title={t.modules.confirmation.title}
      description={t.modules.confirmation.lead}
      accent="var(--series-4)"
      meta={query.data?.meta}
    >
      {/*
        The coverage ring is the page's lead instrument.

        Coverage is the number this team owns end to end — every other figure
        on the row is either its numerator, its leftover, or what happened
        after it. So it wears the one hero treatment (.card-hero + .brackets,
        once per page) at ring size 104, and the four supporting tiles sit in
        a subordinate 2×2 to its right. Datadog rule: the hero is never a bare
        number — the confirmed/orders fraction it divides is printed beside
        the ring, from the same payload, so the two cannot drift apart.
      */}
      <div className="stagger grid gap-3 lg:grid-cols-3">
        <article className="card-hero brackets flex flex-col px-5 py-4">
          <p
            className="text-[12.5px] font-medium"
            style={{ color: 'var(--ink-secondary)' }}
          >
            Tasdiqlash qamrovi
          </p>

          <div className="mt-3 flex flex-1 items-center gap-5">
            {tileStatus === 'loading' ? (
              // Sized to the ring, so ready never reflows loading.
              <div className="skeleton h-[104px] w-[104px] shrink-0 rounded-full" role="status">
                <span className="sr-only">Yuklanmoqda</span>
              </div>
            ) : tileStatus === 'error' ? (
              <span
                className="text-base font-medium"
                style={{ color: 'var(--status-critical)' }}
                // Decorative — it only repeats the visible word.
                title="Maʼlumot olinmadi"
              >
                Olinmadi
              </span>
            ) : (
              <RingGauge
                value={totals?.coverage ?? null}
                size={104}
                thickness={8}
                /*
                  Neutral, as the old tile was: nobody has agreed what share
                  of the queue OUGHT to be worked, and the banner below
                  already splits the shortfall into "not yet" vs "skipped".
                  Grading it would assert a target that does not exist.
                */
                tone="neutral"
                label="Tasdiqlash qamrovi"
              />
            )}

            <div className="min-w-0">
              {tileStatus === 'ready' && totals && (
                <p
                  className="figure tabular text-lg font-semibold"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {formatNumber(totals.confirmed)}
                  <span className="font-normal" style={{ color: 'var(--ink-muted)' }}>
                    {' '}
                    / {formatNumber(totals.orders)}
                  </span>
                </p>
              )}
              <p
                className="mt-0.5 text-[11px] leading-snug"
                style={{ color: 'var(--ink-muted)' }}
              >
                Navbatga tushgan buyurtmalardan tasdiqlangani
              </p>
            </div>
          </div>
        </article>

        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
          <StatTile
            status={tileStatus}
            // Not "all orders": the cohort is what entered the confirmation
            // queue in this window, which is the only denominator a confirmation
            // rate can honestly divide by.
            label="Navbatga tushdi"
            value={totals?.orders ?? null}
            unit="count"
            hint="Tasdiqlash bosqichiga kirgan buyurtmalar"
          />
          {/* A count is a fact, not a judgement — the coverage ring beside it
              carries the evaluation. */}
          <StatTile
            status={tileStatus}
            label="Tasdiqlangan"
            value={totals?.confirmed ?? null}
            unit="count"
          />
          <StatTile
            status={tileStatus}
            label="Bogʻlanilmadi"
            value={totals?.unreachable ?? null}
            unit="count"
            tone={totals && totals.unreachable > 0 ? 'warning' : 'neutral'}
          />
          <GaugeTile
            status={tileStatus}
            label="Tasdiqdan keyin yetkazildi"
            value={totals?.stickRate ?? null}
            tone="auto"
            hint="Tasdiq haqiqatan ish berdimi"
          />
        </div>
      </div>

      {/*
        Why coverage is short, split into the two reasons it can be.

        An order still sitting in the queue has not been SKIPPED, it has not
        been worked yet; one that left the queue unconfirmed is the real gap.
        Merged, the sentence read as an indictment of the operators for
        something the calendar was doing, and it got worse the further into a
        month you looked.

        Both numbers come from the same query as the denominator, so the
        sentence cannot drift away from the figure above it.
      */}
      {totals && totals.coverage < 90 && totals.orders > 0 && (
        <div
          className="rounded-[var(--radius-panel)] border px-4 py-3 text-xs"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border)',
            color: 'var(--ink-secondary)',
          }}
        >
          <strong style={{ color: 'var(--ink-primary)' }}>
            Navbatga tushgan buyurtmalarning {totals.coverage}% qismi tasdiqlangan.
          </strong>{' '}
          {totals.unconfirmedOpen > 0 && (
            <>
              Qolganlaridan {formatNumber(totals.unconfirmedOpen)} tasi hali navbatda — ular
              oʻtkazib yuborilmagan, hali ishlanmagan.{' '}
            </>
          )}
          {totals.unconfirmedClosed > 0 && (
            <>
              {formatNumber(totals.unconfirmedClosed)} tasi esa tasdiqlanmay yakunlangan —
              haqiqiy qamrov boʻshligʻi shu.
            </>
          )}
        </div>
      )}

      <ChartCard
        title="Operatorlar"
        hint="Qamrov — operator buyurtmalarining qanchasi tasdiqlash bosqichidan oʻtgani. Yetkazish % — yakunlangan buyurtmalari ichida yetib borganlari. Tasdiqdan keyin — tasdiqlaganlaridan qanchasi haqiqatan yetgani."
      >
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(row) => row.employeeId}
          /*
            A bounded scroll container instead of the 25-row disclosure.

            The cap existed because 92 rows made this page 4,457px tall; a
            640px container solves the same problem while keeping every
            operator reachable by scroll instead of behind a click — and it
            is what lets the sticky header engage: the column names pin to
            the container's top edge while the rows slide under them, so row
            60 is still labelled.
          */
          maxHeight={640}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
          emptyTitle="Tasdiqlash maʼlumoti yoʻq"
          emptyBody="Bu davrda hech bir buyurtmada tasdiqlash maydoni toʻldirilmagan."
          minWidth={1320}
        />
      </ChartCard>
    </PageShell>
  )
}

/**
 * A one-word reading of the row.
 *
 * Deliberately blunt, and deliberately not a score: the thresholds exist so a
 * manager scanning ninety rows lands on the three that need a conversation,
 * and the columns beside it carry the detail that conversation needs.
 *
 * It judges OUTCOME first. Whether someone fills in a confirmation stage is a
 * process habit; whether their orders reach the customer is the job.
 */
function Verdict({ row }: { row: ConfirmationRowDto }) {
  // Fewer than ten resolved orders is not a pattern, and labelling it as one
  // would put someone on a list because of a slow week.
  if (row.delivered + row.failed < 10) {
    return <StatusChip tone="neutral">Maʼlumot kam</StatusChip>
  }

  if (row.deliveryRate < 70) {
    return <StatusChip tone="critical">Koʻp qaytyapti</StatusChip>
  }
  if (row.confirmed >= 10 && row.stickRate < 70) {
    return <StatusChip tone="critical">Tasdiq puch</StatusChip>
  }
  if (row.deliveryRate >= 90 && row.coverage >= 30) {
    return <StatusChip tone="good">Ishonchli</StatusChip>
  }
  if (row.coverage < 10) {
    return <StatusChip tone="warning">Tasdiqlamaydi</StatusChip>
  }
  return <StatusChip tone="neutral">Oʻrtacha</StatusChip>
}
