'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { ErrorState, LoadingSkeleton, statusOf } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { DeltaBadge, gapIsZero, ReconcileChip, RowMark, rowTint } from '@/features/kpi/reconcile'
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

/** Mirrors `NutritionistBrandPay`. */
interface NutritionistBrandPayDto {
  readonly brand: 'Collagen' | 'Zextra'
  readonly fakt1: NutritionistCountDto
  readonly fakt2: NutritionistCountDto
}

/** Mirrors `NutritionistPay`. */
interface NutritionistPayDto {
  readonly usdPerOrder: number
  readonly brands: readonly NutritionistBrandPayDto[]
}

const usd = (value: number) => `${formatNumber(value)} $`

/**
 * «Нутрицолог» (the client, 2026-10-17; Zextra beside Collagen since
 * 2026-10-20): each brand's FAKT 1 and FAKT 2 order counts, Bitrix24 against
 * MoySklad, each priced at the nutritionist's dollars per order.
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
      title="Нутрицолог · Collagen va Zextra"
      hint={`Har bir brend buyurtmalari soni, Bitrix24 va MoySklad · 1 ta buyurtma = ${rate} $ · brend boshqa ekranlardagi Collagen / Zextra tugmasi qoidasida, brendsiz buyurtmalar kirmaydi · FAKT 1 / FAKT 2 «Sverka» va Savdo dinamikasi qoidasida · tanlangan davr, butun kompaniya`}
    >
      <div className="px-5 pb-4">
        {status === 'loading' ? (
          <LoadingSkeleton rows={6} />
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
              {data.brands.map((brand) => {
                const fakts = [
                  ['FAKT 1', brand.fakt1],
                  ['FAKT 2', brand.fakt2],
                ] as const
                const mismatches = fakts.reduce((n, [, row]) => (gapIsZero(row.moysklad - row.bitrix) ? n : n + 1), 0)
                return (
                  <tbody key={brand.brand}>
                    <tr className="border-t" style={{ borderColor: 'var(--grid)' }}>
                      <th
                        scope="rowgroup"
                        colSpan={6}
                        className="pt-2.5 pb-1 text-left text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--ink-secondary)' }}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span>{brand.brand}</span>
                          <ReconcileChip mismatches={mismatches} />
                        </span>
                      </th>
                    </tr>
                    {fakts.map(([label, row]) => {
                      const gap = row.moysklad - row.bitrix
                      const matched = gapIsZero(gap)
                      const tint = rowTint(matched)
                      return (
                        <tr key={label} className="border-t" style={{ borderColor: 'var(--grid)', background: tint }}>
                          <th scope="row" className="py-1.5 pr-3 text-left font-medium" style={{ color: 'var(--ink-primary)' }}>
                            <RowMark matched={matched}>{label}</RowMark>
                          </th>
                          <td className="py-1.5 pr-3 text-right" style={{ color: 'var(--ink-primary)' }}>
                            {formatNumber(row.bitrix)}
                          </td>
                          <td className="py-1.5 pr-3 text-right" style={{ color: 'var(--ink-primary)' }}>
                            {formatNumber(row.moysklad)}
                          </td>
                          <td className="py-1.5 pr-3 text-right">
                            <DeltaBadge value={gap} format={formatNumber} />
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
                )
              })}
            </table>
          </div>
        )}
      </div>
    </ChartCard>
  )
}
