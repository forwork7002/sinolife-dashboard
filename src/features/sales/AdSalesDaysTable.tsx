'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { type Column, DataTable } from '@/components/ui/DataTable'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type AdSalesDayDto, type AdSalesDaysDto, apiGet } from '@/lib/api'
import { formatCents, formatFullUzs } from '@/lib/format'

/**
 * «Kunlar boʻyicha» — Сана · Реклама жами · Жами савдо факт1 · Первичка · База.
 *
 * Asked for on 2026-10-05 in place of Roistat's «Дни» cut, which dated a sale
 * by its origin lead's day and so never matched the FAKT 1 on this page. Here
 * FAKT 1 is the hero's own (the queue cohort, /rnp's «Сумма ФАКТ 1»), split by
 * the selling team: База = the БАЗА teams, Первичка = everyone else. The ad
 * money is /rnp's «Жами бюджет»: Meta, Collagen + Zextra, hiring left out.
 * See domain/sales/adSalesDays.ts.
 *
 * THE WINDOW ONLY. Meta money has no employee, department or source, so the
 * page's filters do not reach this table and the caption says so when one is
 * set. Rendered for a company-wide account only — the endpoint refuses a
 * narrowed one (`ForecastSection` decides).
 */

type Line = { readonly kind: 'day' | 'total'; readonly row: AdSalesDayDto }

const TOTAL_KEY = '__total__'

/** «05.10.2026» from `YYYY-MM-DD`. */
function dayLabel(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
}

const strong = (line: Line, text: string) => (line.kind === 'total' ? <strong>{text}</strong> : text)

function columns(openDay: string | null): readonly Column<Line>[] {
  return [
    {
      key: 'date',
      header: 'Сана',
      rowHeader: true,
      render: (line) =>
        line.kind === 'total' ? (
          <span className="eyebrow">Жами</span>
        ) : (
          <span className="whitespace-nowrap">
            {dayLabel(line.row.date)}
            {line.row.date === openDay && (
              <span className="ml-1" title="Kun hali yopilmagan — reklama va FAKT 1 hali tushmoqda">
                ⏳<span className="sr-only"> kun hali yopilmagan</span>
              </span>
            )}
          </span>
        ),
    },
    {
      key: 'spend',
      header: 'Реклама жами, $',
      align: 'right',
      numeric: true,
      render: (line) => strong(line, formatCents(line.row.spendUsd)),
    },
    {
      key: 'fakt1',
      header: 'Жами савдо факт1',
      align: 'right',
      numeric: true,
      render: (line) => strong(line, formatFullUzs(line.row.fakt1)),
    },
    {
      key: 'primary',
      header: 'Первичка',
      align: 'right',
      numeric: true,
      render: (line) => strong(line, formatFullUzs(line.row.primary)),
    },
    {
      key: 'base',
      header: 'База',
      align: 'right',
      numeric: true,
      render: (line) => strong(line, formatFullUzs(line.row.base)),
    },
  ]
}

export function AdSalesDaysTable() {
  const { apiParams, activeCount } = useDashboardFilters()

  const params = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const query = useQuery({
    queryKey: ['ad-sales-days', params],
    queryFn: ({ signal }) => apiGet<AdSalesDaysDto>('/analytics/ad-sales-days', params, signal),
    placeholderData: keepPreviousData,
  })

  const data = query.data?.data
  // A failed BACKGROUND refetch keeps the rows on screen; the error state is for having none.
  const status = query.isPending ? 'loading' : !data ? 'error' : 'ready'
  const lines: Line[] = data
    ? [
        ...data.rows.map((row) => ({ kind: 'day' as const, row })),
        ...(data.rows.length > 1 ? [{ kind: 'total' as const, row: { ...data.total, date: TOTAL_KEY } }] : []),
      ]
    : []

  return (
    <div
      className="space-y-2"
      style={{ opacity: query.isPlaceholderData ? 0.6 : 1, transition: 'opacity 150ms var(--ease-out)' }}
      aria-busy={query.isPlaceholderData || undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
          Kunlar boʻyicha · reklama va FAKT 1
        </h3>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Реклама — Meta (Collagen + Zextra, ishga olishsiz) · База — БАЗА jamoalari, Первичка — qolganlari
          {activeCount > 0 && ' · filtrlar bu jadvalga taʼsir qilmaydi, butun kompaniya'}
        </p>
      </div>
      <DataTable
        columns={columns(data?.openDay ?? null)}
        rows={lines}
        rowKey={(line) => line.row.date}
        status={status}
        errorMessage={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        emptyTitle="Bu davrda kun yoʻq"
        stickyLastRow={lines.length > 1}
        stickyColumns={1}
        minWidth={640}
      />
    </div>
  )
}
