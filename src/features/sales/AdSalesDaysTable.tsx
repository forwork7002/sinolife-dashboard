'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { RoistatDaysDto } from '@/features/roistat/roistatApi'
import { RoistatTable, dayLabel } from '@/features/roistat/RoistatTable'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { apiGet } from '@/lib/api'
import { formatFullUzs } from '@/lib/format'

/**
 * «Kunlar boʻyicha» — Roistat's «Дни» cut, drawn here as the client's
 * dashboard draws it (2026-10-05: «dashboarddagi Дни qanday boʻlsa, shunday
 * boʻlishi kerak»): Расход · Лиды · Чистые · Качество · CPL · Квал · QL % ·
 * CPQL · Заказы · Продажи · Выкуп · CPO · Ср.чек · ROAS, newest day first, in
 * soʻm. The same `RoistatTable` and the same server rows as /roistat
 * (`RoistatService.days`), so the two can never disagree. Its own path,
 * `/analytics/sales-days`: the morning's table answered `/analytics/ad-sales-days`
 * in another shape, and a tab still running that bundle must get a 404 it
 * survives, not rows it would crash on. It replaced the
 * day's ad $ / FAKT 1 / Первичка / База table of the same morning.
 *
 * A LEAD COHORT, not the queue cohort the rest of this page reads: a sale
 * sits on its origin lead's day, so «Продажи» here is not FAKT 1 and the
 * caption says so.
 *
 * THE WINDOW AND THE BRAND ONLY. Meta money has no employee, department or
 * source, so the page's other filters do not reach this table; the Collagen /
 * Zextra switch does (Roistat's rule — the ad account, the lead's brand, the
 * selling team). Rendered for a company-wide account
 * only — the endpoint refuses a narrowed one (`ForecastSection` decides).
 */
export function AdSalesDaysTable() {
  const { apiParams, activeCount } = useDashboardFilters()

  const params = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    if (apiParams.brand !== undefined) out.brand = apiParams.brand
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to, apiParams.brand])

  const query = useQuery({
    queryKey: ['sales-days', params],
    queryFn: ({ signal }) => apiGet<RoistatDaysDto>('/analytics/sales-days', params, signal),
    placeholderData: keepPreviousData,
  })

  const data = query.data?.data
  // A failed BACKGROUND refetch keeps the rows on screen; the error state is for having none.
  const status = query.isPending ? 'loading' : !data ? 'error' : 'ready'

  return (
    <div
      className="space-y-2"
      style={{ opacity: query.isPlaceholderData ? 0.6 : 1, transition: 'opacity 150ms var(--ease-out)' }}
      aria-busy={query.isPlaceholderData || undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
          Kunlar boʻyicha · Дни
        </h3>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Roistat «Дни» · sotuv lid kelgan kunga yoziladi (FAKT 1 emas) · Расход — Meta, ishga olishsiz
          {data?.rate && ` · kurs ${formatFullUzs(Math.round(data.rate.uzsPerUsd))} soʻm (${dayLabel(data.rate.date)})`}
          {activeCount > 0 && ' · filtrlar bu jadvalga taʼsir qilmaydi, butun kompaniya'}
        </p>
      </div>
      {data && data.rate === null && (
        <p
          role="note"
          className="rounded-lg px-3 py-2 text-xs"
          style={{
            background: 'color-mix(in oklab, var(--status-warning) 12%, transparent)',
            borderLeft: '3px solid var(--status-warning)',
            color: 'var(--ink-primary)',
          }}
        >
          CBU kursi olinmadi — soʻmdagi Расход, CPL, CPQL, CPO va ROAS hozircha chiqmaydi.
        </p>
      )}
      <RoistatTable
        data={data}
        status={status}
        currency="uzs"
        errorMessage={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        emptyTitle="Bu davrda kun yoʻq"
        emptyBody="Tanlangan davrda na Meta rasxodi, na Bitrix24 lidi topildi."
      />
    </div>
  )
}
