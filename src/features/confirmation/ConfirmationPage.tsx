'use client'

import { useQuery } from '@tanstack/react-query'

import { ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Meter, StatTile, StatusChip } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type ConfirmationDto, type ConfirmationRowDto, apiGet } from '@/lib/api'
import { formatNumber } from '@/lib/format'
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

  const data = query.data?.data
  const totals = data?.totals

  const columns: Column<ConfirmationRowDto>[] = [
    {
      key: 'name',
      header: 'Operator',
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.employeeName}
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
      header: 'Tasdiqdan keyin',
      width: '150px',
      render: (row) =>
        row.confirmed === 0 ? (
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            tasdiq yoʻq
          </span>
        ) : (
          <Meter value={row.stickRate} label={row.employeeName} />
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Jami buyurtma" value={totals?.orders ?? null} unit="count" />
        <StatTile
          label="Tasdiqlangan"
          value={totals?.confirmed ?? null}
          unit="count"
          tone="good"
        />
        <StatTile
          label="Bogʻlanilmadi"
          value={totals?.unreachable ?? null}
          unit="count"
          tone={totals && totals.unreachable > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          /*
            Coverage, not the confirmation rate.

            The rate is 100% for every operator every month — almost nobody
            records a failed attempt, so the denominator is the numerator. How
            much of the order flow goes through the step at all runs 20–60%
            and is the number that separates one operator from another.
          */
          label="Tasdiqlash qamrovi"
          value={totals?.coverage ?? null}
          unit="percent"
          hint="Buyurtmalarning qanchasi bosqichdan oʻtgan"
          context={<Meter value={totals?.coverage ?? null} tone="accent" />}
        />
        <StatTile
          label="Tasdiqdan keyin yetkazildi"
          value={totals?.stickRate ?? null}
          unit="percent"
          hint="Tasdiq haqiqatan ish berdimi"
          tone={
            totals === undefined
              ? 'neutral'
              : totals.stickRate >= 85
                ? 'good'
                : totals.stickRate >= 60
                  ? 'warning'
                  : 'critical'
          }
          context={<Meter value={totals?.stickRate ?? null} />}
        />
      </div>

      {totals && totals.coverage < 90 && totals.orders > 0 && (
        <div
          className="rounded-[var(--radius)] border px-4 py-3 text-xs"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border)',
            color: 'var(--ink-secondary)',
          }}
        >
          <strong style={{ color: 'var(--ink-primary)' }}>
            Tasdiqlash bosqichi buyurtmalarning {totals.coverage}% qismida ishlatilgan.
          </strong>{' '}
          Qolganlari «Успешно заказ» bosqichidan oʻtmay toʻgʻridan-toʻgʻri yetkazishga ketgan. Shuning
          uchun tasdiqlash foizi barcha buyurtmalarga emas, faqat qoʻngʻiroq qilinganlariga nisbatan
          hisoblanadi — aks holda jarayon buzilgandek koʻrinardi.
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
