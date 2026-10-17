'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { ErrorState, LoadingSkeleton, statusOf } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { ApiClientError, apiGet } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/** Mirrors `NutritionistCount` in `src/server/domain/sverka/nutritionist.ts` — nothing checks the mirror. */
interface NutritionistCountDto {
  readonly bitrix: number
  readonly moysklad: number
  readonly bitrixUsd: number
  readonly moyskladUsd: number
}

/** Mirrors `NutritionistPay`. */
interface NutritionistPayDto {
  readonly usdPerOrder: number
  readonly fakt1: NutritionistCountDto
  readonly fakt2: NutritionistCountDto
}

const usd = (value: number) => `${formatNumber(value)} $`

/**
 * «Нутрицолог · Collagen» (the client, 2026-10-17): Collagen's FAKT 1 and
 * FAKT 2 order counts, Bitrix24 against MoySklad, each priced at the
 * nutritionist's dollars per order.
 *
 * ON THE DASHBOARD WINDOW, unlike the plans below it, and company-wide: the
 * employee / department filters do not narrow it — MoySklad names no employee
 * of ours. An account the endpoint refuses (a narrowed one) gets no card.
 */
export function NutritionistCard() {
  const { apiParams } = useDashboardFilters()

  const windowParams = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const query = useQuery({
    queryKey: ['kpi-nutritionist', windowParams],
    queryFn: ({ signal }) => apiGet<NutritionistPayDto>('/kpi/nutritionist', windowParams, signal),
    placeholderData: (previous) => previous,
  })

  if (query.error instanceof ApiClientError && query.error.status === 403) return null

  const status = statusOf(query)
  const data = query.data?.data
  const rate = data?.usdPerOrder ?? 2

  return (
    <ChartCard
      title="Нутрицолог · Collagen"
      hint={`Collagen buyurtmalari soni, Bitrix24 va MoySklad · 1 ta buyurtma = ${rate} $ · FAKT 1 / FAKT 2 «Sverka» va Savdo dinamikasi qoidasida · tanlangan davr, butun kompaniya`}
    >
      <div className="px-5 pb-4">
        {status === 'loading' ? (
          <LoadingSkeleton rows={3} />
        ) : status === 'error' || !data ? (
          <ErrorState
            message={query.error instanceof ApiClientError ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs tabular-nums">
              <thead>
                <tr style={{ color: 'var(--ink-muted)' }}>
                  <th className="py-1 pr-3 text-left font-medium" />
                  <th className="py-1 pr-3 text-right font-medium">Bitrix24 soni</th>
                  <th className="py-1 pr-3 text-right font-medium">MoySklad soni</th>
                  <th className="py-1 pr-3 text-right font-medium">Farq</th>
                  <th className="py-1 pr-3 text-right font-medium">Bitrix24 × {rate} $</th>
                  <th className="py-1 text-right font-medium">MoySklad × {rate} $</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['FAKT 1', data.fakt1],
                    ['FAKT 2', data.fakt2],
                  ] as const
                ).map(([label, row]) => {
                  const gap = row.moysklad - row.bitrix
                  return (
                    <tr key={label} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                      <th scope="row" className="py-1.5 pr-3 text-left font-medium" style={{ color: 'var(--ink-primary)' }}>
                        {label}
                      </th>
                      <td className="py-1.5 pr-3 text-right" style={{ color: 'var(--ink-primary)' }}>
                        {formatNumber(row.bitrix)}
                      </td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: 'var(--ink-primary)' }}>
                        {formatNumber(row.moysklad)}
                      </td>
                      <td
                        className="py-1.5 pr-3 text-right"
                        style={{ color: gap === 0 ? 'var(--ink-muted)' : 'var(--status-critical)' }}
                      >
                        {gap > 0 ? `+${formatNumber(gap)}` : formatNumber(gap)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-semibold" style={{ color: 'var(--ink-primary)' }}>
                        {usd(row.bitrixUsd)}
                      </td>
                      <td className="py-1.5 text-right font-semibold" style={{ color: 'var(--ink-primary)' }}>
                        {usd(row.moyskladUsd)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ChartCard>
  )
}
