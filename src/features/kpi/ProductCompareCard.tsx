'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ErrorState, LoadingSkeleton, statusOf } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { DeltaBadge, gapIsZero, ReconcileChip, RowMark, rowTint } from '@/features/kpi/reconcile'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import type { SverkaProductDto } from '@/features/sverka/sverkaApi'
import { ApiClientError, apiGet } from '@/lib/api'
import { formatFullUzs, formatNumber } from '@/lib/format'

/** Mirrors `BrandProductsDto` in `src/server/services/sverkaService.ts` — nothing checks the mirror. */
interface BrandProductsDto {
  readonly brand: 'Collagen' | 'Zextra'
  readonly fakt1: readonly SverkaProductDto[]
  readonly fakt2: readonly SverkaProductDto[]
}

/** Mirrors `KpiProductsDto`. */
interface KpiProductsDto {
  readonly brands: readonly BrandProductsDto[]
}

type Basis = 'fakt1' | 'fakt2'

const BASIS_OPTIONS: readonly { readonly value: Basis; readonly label: string }[] = [
  { value: 'fakt1', label: 'FAKT 1' },
  { value: 'fakt2', label: 'FAKT 2' },
]

/** The product column stays put while the figures scroll under it on a phone. */
const PIN = 'tcol-sticky is-edge left-0'
const TITLE = 'Tovarlar · Bitrix24 ↔ MoySklad'

interface Totals {
  readonly bitrixQuantity: number
  readonly moyskladQuantity: number
  readonly bitrixAmount: number
  readonly moyskladAmount: number
}

function totalsOf(rows: readonly SverkaProductDto[]): Totals {
  return rows.reduce(
    (sum, r) => ({
      bitrixQuantity: sum.bitrixQuantity + r.bitrixQuantity,
      moyskladQuantity: sum.moyskladQuantity + r.moyskladQuantity,
      bitrixAmount: sum.bitrixAmount + r.bitrixAmount,
      moyskladAmount: sum.moyskladAmount + r.moyskladAmount,
    }),
    { bitrixQuantity: 0, moyskladQuantity: 0, bitrixAmount: 0, moyskladAmount: 0 },
  )
}

/**
 * «Tovarlar · Bitrix24 ↔ MoySklad» (the client, 2026-10-20: «Bitrix24da
 * shuncha tovar … Collagendan shuncha tovar MoySkladda ham, ikkisini
 * solishtirilgan holatda»): each brand's pieces per product on both systems,
 * FAKT 1 or FAKT 2, with the brand's total on its heading row.
 *
 * The deals «Нутрицолог» above it counts — each brand's cohort under the
 * brand switch's rule, «Brendsiz» on neither, a deal queued before MoySklad
 * held orders on neither side (`productRows`) — on the dashboard window and
 * company-wide. A brand's block is every product its orders carried, so a
 * Sedana sold in a Collagen order is a row under Collagen and in its total:
 * the heading says «buyurtmalari» for that reason. The endpoint is gated on «Sverka»'s section, so an account
 * without «Sverka» (or a narrowed one) is refused and gets no card.
 */
export function ProductCompareCard() {
  const { apiParams } = useDashboardFilters()
  const [basis, setBasis] = useState<Basis>('fakt1')

  const windowParams = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const query = useQuery({
    queryKey: ['kpi-products', windowParams],
    queryFn: ({ signal }) => apiGet<KpiProductsDto>('/kpi/products', windowParams, signal),
    placeholderData: (previous) => previous,
  })

  if (query.error instanceof ApiClientError && query.error.status === 403) return null

  const status = statusOf(query)
  const data = query.data?.data

  return (
    <ChartCard
      title={TITLE}
      hint="Collagen va Zextra buyurtmalaridagi tovarlar soni (dona) va summasi · FAKT 2 da MoySklad — Успешно / Касса · tanlangan davr, butun kompaniya"
      action={<SegmentedControl value={basis} options={BASIS_OPTIONS} onChange={setBasis} ariaLabel="FAKT turi" />}
    >
      {status === 'loading' ? (
        <LoadingSkeleton rows={6} />
      ) : status === 'error' || !data ? (
        <ErrorState
          message={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={TITLE} className="w-full min-w-[720px] text-xs tabular-nums">
            <thead>
              <tr style={{ color: 'var(--ink-muted)' }}>
                <th className={`${PIN} py-1 pr-3 text-left font-medium`}>Tovar</th>
                <th className="py-1 pr-3 text-right font-medium">Bitrix24 dona</th>
                <th className="py-1 pr-3 text-right font-medium">MoySklad dona</th>
                <th className="py-1 pr-3 text-right font-medium">Farq</th>
                <th className="py-1 pr-3 text-right font-medium">Bitrix24 soʻm</th>
                <th className="py-1 pr-3 text-right font-medium">MoySklad soʻm</th>
                <th className="py-1 text-right font-medium">Farq soʻm</th>
              </tr>
            </thead>
            {data.brands.map((brand) => (
              <BrandRows key={brand.brand} brand={brand.brand} rows={brand[basis]} />
            ))}
          </table>
        </div>
      )}
    </ChartCard>
  )
}

/** A product reconciles when BOTH its piece gap and its money gap round to zero. */
function rowMatched(row: SverkaProductDto): boolean {
  return gapIsZero(row.moyskladQuantity - row.bitrixQuantity) && gapIsZero(row.moyskladAmount - row.bitrixAmount)
}

function BrandRows({ brand, rows }: { readonly brand: BrandProductsDto['brand']; readonly rows: readonly SverkaProductDto[] }) {
  const total = totalsOf(rows)
  const mismatches = rows.reduce((n, r) => (rowMatched(r) ? n : n + 1), 0)
  return (
    <tbody>
      <tr className="border-t" style={{ borderColor: 'var(--grid)' }}>
        <th
          scope="rowgroup"
          className={`${PIN} pt-2.5 pb-1.5 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide`}
          style={{ color: 'var(--ink-secondary)' }}
        >
          <span className="inline-flex items-center gap-2">
            <span>{brand} buyurtmalari · jami</span>
            <ReconcileChip mismatches={mismatches} />
          </span>
        </th>
        <Cells {...total} strong />
      </tr>
      {rows.length === 0 ? (
        <tr className="border-t" style={{ borderColor: 'var(--grid)' }}>
          <td colSpan={7} className="py-1.5" style={{ color: 'var(--ink-muted)' }}>
            Bu davrda tovar yoʻq
          </td>
        </tr>
      ) : (
        rows.map((row) => {
          const matched = rowMatched(row)
          const tint = rowTint(matched)
          return (
            <tr key={row.key} className="border-t" style={{ borderColor: 'var(--grid)' }}>
              <th
                scope="row"
                className={`${PIN} py-1.5 pr-3 text-left font-medium`}
                style={{ color: 'var(--ink-primary)', background: tint }}
              >
                <RowMark matched={matched}>{row.name}</RowMark>
              </th>
              {/* The four figures by name: the DTO carries `key`, which React refuses in a spread. */}
              <Cells
                bitrixQuantity={row.bitrixQuantity}
                moyskladQuantity={row.moyskladQuantity}
                bitrixAmount={row.bitrixAmount}
                moyskladAmount={row.moyskladAmount}
                tint={tint}
              />
            </tr>
          )
        })
      )}
    </tbody>
  )
}

function Cells({
  bitrixQuantity,
  moyskladQuantity,
  bitrixAmount,
  moyskladAmount,
  strong = false,
  tint,
}: Totals & { readonly strong?: boolean; readonly tint?: string }) {
  const pieces = moyskladQuantity - bitrixQuantity
  const money = moyskladAmount - bitrixAmount
  const weight = strong ? 'font-semibold' : ''
  const figure = { color: 'var(--ink-primary)', background: tint }
  return (
    <>
      <td className={`py-1.5 pr-3 text-right ${weight}`} style={figure}>
        {formatNumber(bitrixQuantity)}
      </td>
      <td className={`py-1.5 pr-3 text-right ${weight}`} style={figure}>
        {formatNumber(moyskladQuantity)}
      </td>
      <td className="py-1.5 pr-3 text-right" style={{ background: tint }}>
        <DeltaBadge value={pieces} format={formatNumber} />
      </td>
      <td className={`py-1.5 pr-3 text-right ${weight}`} style={figure}>
        {formatFullUzs(bitrixAmount)}
      </td>
      <td className={`py-1.5 pr-3 text-right ${weight}`} style={figure}>
        {formatFullUzs(moyskladAmount)}
      </td>
      <td className="py-1.5 text-right" style={{ background: tint }}>
        <DeltaBadge value={money} format={formatFullUzs} />
      </td>
    </>
  )
}
