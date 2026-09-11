'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'

import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Meter } from '@/components/ui/Stat'
import type { LogisticsDayDto } from '@/lib/api'
import { LOGISTICS_BUCKETS } from '@/lib/logisticsBuckets'
import { formatCompactUzs, formatDateShort, formatNumber } from '@/lib/format'

/**
 * THE ONLY RECHARTS ON THIS SCREEN, AND IT IS LOADED SEPARATELY.
 *
 * Logistika ships no charting library today; recharts is 379 KB over the wire.
 * The four other comparisons on this page are hand-drawn, so pulling the
 * library into the page bundle to draw one line chart would make the whole
 * screen slower to open for the sake of the block furthest down it. `ssr:
 * false` because Recharts measures the DOM, and the skeleton is sized to the
 * chart's own height so nothing reflows when it arrives — the same treatment
 * `sales/SalesPage.tsx` gives its chart.
 */
const DailyOutcomeChart = dynamic(
  () => import('@/components/charts/DailyOutcomeChart').then((m) => m.DailyOutcomeChart),
  { ssr: false, loading: () => <ChartSkeleton height={280} /> },
)

type Unit = 'orders' | 'money'

/**
 * The client's sheet, day by day: the trend without a click, the exact rows
 * one click away.
 *
 * THE TABLE IS THE DOCUMENT AND THE CHART IS THE READING OF IT. Their Google
 * Sheet has one row per day and they read it every morning; the chart answers
 * "is coverage moving" at a glance, and the table under it is what gets
 * reconciled against Bitrix24. Neither replaces the other, so the chart is
 * always visible and the table is a disclosure — open by default would push
 * every block below it off the first screen, and gone entirely would remove
 * the thing they actually came for.
 *
 * THE UNIT SWITCH READS ONE ANSWER TWO WAYS. Both figures are already on every
 * row, so it costs no request and no cache key — and it stays component state
 * rather than URL state, because nobody links anyone to a unit preference and
 * every extra key is paid for by the dozen components sharing that hook.
 */
export function DailySection({
  days,
  status,
  errorMessage,
  onRetry,
  open,
  onToggle,
}: {
  days: readonly LogisticsDayDto[]
  status: 'loading' | 'error' | 'ready'
  errorMessage?: string
  onRetry: () => void
  open: boolean
  onToggle: (open: boolean) => void
}) {
  const [unit, setUnit] = useState<Unit>('orders')

  const points = useMemo(
    () =>
      days.map((day) => {
        const done = day.buckets.find((bucket) => bucket.key === 'DONE')
        const lost = day.buckets.find((bucket) => bucket.key === 'REFUSED')
        return {
          date: day.date,
          deliveredOrders: done?.orders ?? 0,
          deliveredAmount: done?.amount.amount ?? 0,
          refusedOrders: lost?.orders ?? 0,
          refusedAmount: lost?.amount.amount ?? 0,
          orders: day.orders,
          amount: day.amount.amount,
        }
      }),
    [days],
  )

  /*
    Columns are built once per unit rather than per render: this table can run
    to a year of rows and it re-renders on every disclosure toggle.

    ONE `rowHeader` COLUMN, and `stickyColumns={1}` so the date stays put while
    the six columns scroll — at 1180px minimum width the table scrolls on any
    laptop, and a row of numbers whose date has scrolled away is unreadable.
  */
  const columns = useMemo<Column<LogisticsDayDto>[]>(() => {
    const value = (amount: number, orders: number) =>
      unit === 'money' ? formatCompactUzs(amount) : formatNumber(orders)

    return [
      {
        key: 'date',
        header: 'Sana',
        rowHeader: true,
        width: '96px',
        render: (row) => <span className="whitespace-nowrap">{formatDateShort(row.date)}</span>,
      },
      {
        key: 'ordered',
        header: 'ЗАКАЗ',
        align: 'right',
        numeric: true,
        render: (row) => value(row.amount.amount, row.orders),
      },
      ...LOGISTICS_BUCKETS.map<Column<LogisticsDayDto>>((spec) => ({
        key: spec.key,
        header: spec.label,
        align: 'right',
        numeric: true,
        render: (row) => {
          const bucket = row.buckets.find((b) => b.key === spec.key)
          return value(bucket?.amount.amount ?? 0, bucket?.orders ?? 0)
        },
      })),
      {
        key: 'coverage',
        header: 'Qamrov',
        align: 'right',
        width: '132px',
        // A bar, not a ring: «tiles wear rings, table rows wear bars».
        render: (row) => <Meter value={row.coveragePercent} tone="auto" />,
      },
    ]
  }, [unit])

  const body =
    status === 'loading' ? (
      <ChartSkeleton height={280} />
    ) : status === 'error' ? (
      <ErrorState message={errorMessage ?? 'Olinmadi'} onRetry={onRetry} />
    ) : points.length === 0 ? (
      <EmptyState
        title="Bu davrda kun yoʻq"
        body="Tanlangan oynada tasdiqlash navbatiga tushgan buyurtma topilmadi."
      />
    ) : (
      <DailyOutcomeChart data={points} unit={unit} height={280} />
    )

  return (
    <ChartCard
      title="Kunlar boʻyicha"
      hint="Успешно va Отказ — kunlar kesimida. Kun — buyurtma tasdiqlash navbatiga TUSHGAN sana, yetkazilgan sana emas."
      action={
        <SegmentedControl<Unit>
          value={unit}
          options={[
            { value: 'orders', label: 'Buyurtma' },
            { value: 'money', label: 'Summa' },
          ]}
          onChange={setUnit}
          ariaLabel="Oʻlchov birligi"
        />
      }
    >
      {body}

      <div className="mt-4">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={() => onToggle(!open)}
          aria-expanded={open}
        >
          {open ? 'Kunlik jadvalni yopish' : `Kunlik jadval (${formatNumber(days.length)} kun)`}
        </Button>
      </div>

      {open && (
        <div className="mt-3">
          <DataTable<LogisticsDayDto>
            columns={columns}
            rows={days}
            rowKey={(row) => row.date}
            status={status}
            errorMessage={errorMessage}
            onRetry={onRetry}
            emptyTitle="Kun topilmadi"
            emptyBody="Tanlangan oynada tasdiqlash navbatiga tushgan buyurtma yoʻq."
            minWidth={1180}
            stickyColumns={1}
            maxHeight={440}
          />
          <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Qamrov = Успешно / ЗАКАЗ.{' '}
            {unit === 'money' ? 'Summalar qisqartirilgan' : 'Buyurtma soni'} — birlikni yuqoridagi
            tugmadan almashtiring.
          </p>
        </div>
      )}
    </ChartCard>
  )
}

