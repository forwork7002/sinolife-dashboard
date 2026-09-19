'use client'

import { useMemo, useState } from 'react'

import { type Column, DataTable } from '@/components/ui/DataTable'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'

import type { TargetGroupDto } from './targetApi'

/**
 * One row per source, targetolog or creative — leads, what they became, money.
 *
 * THE LEAD HALF AND THE SALE HALF ARE DIFFERENT DEALS. «Leadlar» and
 * «Uzatildi» count Регистрация deals; «Buyurtma», «Yetkazildi» and «Qaytdi»
 * count the seller's deals the portal opened for the same contacts, cut by
 * the source and targetolog the portal copied onto them. So «Buyurtma %» is
 * orders over leads — how many leads it takes to make one order — and not a
 * share of one set of deals.
 *
 * Money is printed compact with the exact figure on hover, the way every
 * scanned table here does; a reconciled one would print it in full.
 */

type SortKey =
  | 'leads'
  | 'passPercent'
  | 'orders'
  | 'orderPercent'
  | 'ordered'
  | 'delivered'
  | 'deliveredMoney'
  | 'returned'
  | 'buyoutPercent'
  | 'revenuePerLead'

const SORT_VALUE: Readonly<Record<SortKey, (row: TargetGroupDto) => number>> = {
  leads: (r) => r.leads,
  passPercent: (r) => r.passPercent ?? -1,
  orders: (r) => r.orders,
  orderPercent: (r) => r.orderPercent ?? -1,
  ordered: (r) => r.ordered.amount,
  delivered: (r) => r.delivered,
  deliveredMoney: (r) => r.deliveredMoney.amount,
  returned: (r) => r.returned,
  buyoutPercent: (r) => r.buyoutPercent ?? -1,
  revenuePerLead: (r) => r.revenuePerLead?.amount ?? -1,
}

export function TargetGroupTable({
  rows,
  keyHeader,
  notStated,
  status,
  errorMessage,
  onRetry,
  onPick,
  emptyTitle,
}: {
  rows: readonly TargetGroupDto[]
  keyHeader: string
  /** The label an empty value is filed under — drawn muted. */
  notStated: string
  status: 'loading' | 'error' | 'ready'
  errorMessage?: string
  onRetry?: () => void
  /** Clicking a row narrows the lead list below to it. */
  onPick?: (key: string) => void
  emptyTitle?: string
}) {
  const [sort, setSort] = useState<SortKey>('leads')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    const value = SORT_VALUE[sort]
    const factor = order === 'desc' ? -1 : 1
    return [...rows].sort((a, b) => factor * (value(a) - value(b)) || a.key.localeCompare(b.key, 'ru'))
  }, [rows, sort, order])

  const leadPeak = rows.reduce((max, r) => Math.max(max, r.leads), 0)

  return (
    <DataTable<TargetGroupDto>
      columns={columns(keyHeader, notStated, leadPeak)}
      rows={sorted}
      rowKey={(row) => row.key}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      onRowClick={onPick ? (row) => onPick(row.key) : undefined}
      sort={sort}
      order={order}
      onSort={(key) => {
        if (key === sort) setOrder((o) => (o === 'desc' ? 'asc' : 'desc'))
        else {
          setSort(key as SortKey)
          setOrder('desc')
        }
      }}
      emptyTitle={emptyTitle ?? 'Bu davrda lead yoʻq'}
      emptyBody="Tanlangan davrda bu manbalardan hech narsa kelmagan."
      minWidth={1080}
      maxHeight="55dvh"
      stickyColumns={1}
    />
  )
}

function muted(text: string) {
  return (
    <span className="ml-1.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
      {text}
    </span>
  )
}

function money(amount: number) {
  return <span title={formatUzs(amount)}>{formatCompactUzs(amount)}</span>
}

function columns(
  keyHeader: string,
  notStated: string,
  leadPeak: number,
): readonly Column<TargetGroupDto>[] {
  return [
    {
      key: 'key',
      header: keyHeader,
      rowHeader: true,
      render: (row) =>
        row.key === notStated ? (
          <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>{row.key}</span>
        ) : (
          <span className="block max-w-[280px] truncate" title={row.key}>
            {row.key}
          </span>
        ),
    },
    {
      key: 'leads',
      header: 'Leadlar',
      sortKey: 'leads',
      render: (row) => {
        const width = leadPeak > 0 ? Math.max(2, (row.leads / leadPeak) * 100) : 0
        return (
          <span className="flex min-w-[120px] flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2 tabular-nums">
              <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                {formatNumber(row.leads)}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {formatNumber(row.leadCustomers)} kishi
              </span>
            </span>
            <span
              aria-hidden
              className="block h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--track)' }}
            >
              <span
                className="block h-full rounded-full"
                style={{ width: `${width}%`, background: 'var(--series-1)' }}
              />
            </span>
          </span>
        )
      },
    },
    {
      key: 'pass',
      header: 'Uzatildi',
      sortKey: 'passPercent',
      align: 'right',
      numeric: true,
      render: (row) => (
        <>
          {formatNumber(row.leadWon)}
          {muted(formatPercent(row.passPercent))}
        </>
      ),
    },
    {
      key: 'orders',
      header: 'Buyurtma',
      sortKey: 'orders',
      align: 'right',
      numeric: true,
      render: (row) => (
        <>
          {formatNumber(row.orders)}
          {muted(formatPercent(row.orderPercent))}
        </>
      ),
    },
    {
      key: 'ordered',
      header: 'Buyurtma summasi',
      sortKey: 'ordered',
      align: 'right',
      numeric: true,
      render: (row) => money(row.ordered.amount),
    },
    {
      key: 'delivered',
      header: 'Yetkazildi',
      sortKey: 'delivered',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.delivered),
    },
    {
      key: 'deliveredMoney',
      header: 'Tushum',
      sortKey: 'deliveredMoney',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {money(row.deliveredMoney.amount)}
        </span>
      ),
    },
    {
      key: 'returned',
      header: 'Qaytdi',
      sortKey: 'returned',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.returned === 0 ? (
          <span style={{ color: 'var(--ink-muted)' }}>0</span>
        ) : (
          <>
            {formatNumber(row.returned)}
            {muted(formatCompactUzs(row.returnedMoney.amount))}
          </>
        ),
    },
    {
      key: 'buyout',
      header: 'Sotib olish',
      sortKey: 'buyoutPercent',
      align: 'right',
      numeric: true,
      render: (row) => formatPercent(row.buyoutPercent),
    },
    {
      key: 'perLead',
      header: '1 lead tushumi',
      sortKey: 'revenuePerLead',
      align: 'right',
      numeric: true,
      render: (row) => (row.revenuePerLead ? money(row.revenuePerLead.amount) : NO_VALUE),
    },
  ]
}
