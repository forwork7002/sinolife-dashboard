'use client'

import { useQuery } from '@tanstack/react-query'
import { Fragment, useMemo, useState } from 'react'

import { ErrorState, LoadingSkeleton, statusOf } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { ChevronGlyph } from '@/components/ui/Icons'
import { DeltaBadge, gapIsZero, ReconcileChip, RowMark, rowTint } from '@/features/kpi/reconcile'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { bitrixDealUrl } from '@/features/target/targetApi'
import { PRODUCT_TONE } from '@/features/target/targetTheme'
import { ApiClientError, apiGet } from '@/lib/api'
import { formatDate, formatFullUzs, formatNumber } from '@/lib/format'

/* Mirrors `KpiDaysDto` and its parts in `src/server/services/sverkaService.ts` — nothing checks the mirror. */
type Basis = 'FAKT1' | 'FAKT2'
type Brand = 'all' | 'Collagen' | 'Zextra'
type Verdict = 'same' | 'products' | 'noMoysklad' | 'noBitrix' | 'beforeFloor'

interface DaySide {
  readonly orders: number
  readonly pieces: number
  readonly amount: number
}

interface DayDto {
  readonly day: string | null
  readonly bitrix: DaySide
  readonly moysklad: DaySide
  readonly mismatched: number
}

interface OrderItemDto {
  readonly key: string
  readonly name: string
  readonly bitrixQuantity: number
  readonly moyskladQuantity: number
  readonly bitrixAmount: number
  readonly moyskladAmount: number
}

interface OrderDto {
  readonly dealId: string | null
  readonly brand: 'Collagen' | 'Zextra'
  readonly queuedAt: string | null
  readonly inBitrix: boolean
  readonly inMoysklad: boolean
  readonly verdict: Verdict
  readonly bitrix: { readonly stage: string; readonly amount: number; readonly seller: string | null; readonly rop: string | null } | null
  readonly moysklad: { readonly orderName: string; readonly state: string | null; readonly amount: number; readonly moment: string } | null
  readonly items: readonly OrderItemDto[]
}

interface KpiDaysDto {
  readonly days: readonly DayDto[]
  readonly total: DayDto
  readonly orders: readonly OrderDto[] | null
}

const BASIS_OPTIONS: readonly { readonly value: Basis; readonly label: string }[] = [
  { value: 'FAKT1', label: 'FAKT 1' },
  { value: 'FAKT2', label: 'FAKT 2' },
]

const BRAND_OPTIONS: readonly { readonly value: Brand; readonly label: string; readonly swatch?: string }[] = [
  { value: 'all', label: 'Hammasi' },
  { value: 'Collagen', label: 'Collagen', swatch: PRODUCT_TONE.Collagen },
  { value: 'Zextra', label: 'Zextra', swatch: PRODUCT_TONE.Zextra },
]

const TITLE = 'Kunlar boʻyicha · Bitrix24 ↔ MoySklad'
/** The date column stays put while the figures scroll under it on a phone. */
const PIN = 'tcol-sticky is-edge left-0'
const COLUMNS = 11

/** A day reads the Tashkent date its deals were queued on; noon keeps any zone on the same day. */
const dayLabel = (day: string) => formatDate(`${day}T07:00:00Z`)

/** What a verdict says, in the words of the FAKT figure it was read under. */
function verdictText(verdict: Verdict, basis: Basis): string {
  switch (verdict) {
    case 'same':
      return 'Mos'
    case 'products':
      return 'Tovar farqi'
    case 'noMoysklad':
      return basis === 'FAKT1' ? 'MoySkladʼda buyurtma yoʻq' : 'MoySkladʼda yetkazilmagan'
    case 'noBitrix':
      return 'Bitrix24ʼda yetkazilmagan'
    case 'beforeFloor':
      return 'MoySkladʼdan oldin · solishtirilmaydi'
  }
}

function dayMatched(d: DayDto): boolean {
  return (
    d.mismatched === 0 &&
    gapIsZero(d.moysklad.orders - d.bitrix.orders) &&
    gapIsZero(d.moysklad.pieces - d.bitrix.pieces) &&
    gapIsZero(d.moysklad.amount - d.bitrix.amount)
  )
}

/**
 * «Kunlar boʻyicha · Bitrix24 ↔ MoySklad» (the client, 2026-10-22: «har bir
 * buyurtmadagi tovarlar farqi moy sklad va bitrix24da», then «sanalar boʻyicha
 * chiqishi kerak har biri»): «Нутрицолог»'s orders and «Tovarlar»'s pieces
 * and soʻm above it, cut by the day each deal was queued, every day opening
 * onto its orders — each with its products on both systems, its sums, seller,
 * team and status — the differences first.
 *
 * The server cuts the very lines those two cards read (`sverkaDays`), so the
 * «Jami» row is their figures over the same brand and FAKT figure. Gated on
 * «Sverka»'s section as they are: an account without it gets no card.
 */
export function SverkaDaysCard() {
  const { apiParams } = useDashboardFilters()
  const [basis, setBasis] = useState<Basis>('FAKT1')
  const [brand, setBrand] = useState<Brand>('all')
  const [open, setOpen] = useState<string | null>(null)

  const params = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset, basis, brand }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to, basis, brand])

  const query = useQuery({
    queryKey: ['kpi-days', params],
    queryFn: ({ signal }) => apiGet<KpiDaysDto>('/kpi/days', params, signal),
    placeholderData: (previous) => previous,
  })

  if (query.error instanceof ApiClientError && query.error.status === 403) return null

  const status = statusOf(query)
  const data = query.data?.data

  return (
    <ChartCard
      title={TITLE}
      hint="Har kun — oʻsha kuni Tasdiqlashga tushgan bitimlar: buyurtmalar «Нутрицолог», dona va soʻm «Tovarlar» qoidasida · kunni bosing — har bir buyurtma va uning tovarlari · tanlangan davr, butun kompaniya"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={brand}
            options={BRAND_OPTIONS}
            onChange={(next) => {
              setBrand(next)
              setOpen(null)
            }}
            ariaLabel="Brend"
          />
          <SegmentedControl
            value={basis}
            options={BASIS_OPTIONS}
            onChange={(next) => {
              setBasis(next)
              setOpen(null)
            }}
            ariaLabel="FAKT turi"
          />
        </div>
      }
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
          <table aria-label={TITLE} className="w-full min-w-[960px] text-xs tabular-nums">
            <thead>
              <tr style={{ color: 'var(--ink-muted)' }}>
                <th className={`${PIN} py-1 pr-3 text-left font-medium`}>Sana</th>
                <th className="py-1 pr-3 text-right font-medium">Bitrix24 buyurtma</th>
                <th className="py-1 pr-3 text-right font-medium">MoySklad buyurtma</th>
                <th className="py-1 pr-3 text-right font-medium">Farq</th>
                <th className="py-1 pr-3 text-right font-medium">Bitrix24 dona</th>
                <th className="py-1 pr-3 text-right font-medium">MoySklad dona</th>
                <th className="py-1 pr-3 text-right font-medium">Farq</th>
                <th className="py-1 pr-3 text-right font-medium">Bitrix24 soʻm</th>
                <th className="py-1 pr-3 text-right font-medium">MoySklad soʻm</th>
                <th className="py-1 pr-3 text-right font-medium">Farq soʻm</th>
                <th className="py-1 text-right font-medium">Holat</th>
              </tr>
            </thead>
            <tbody>
              {data.days.length === 0 ? (
                <tr className="border-t" style={{ borderColor: 'var(--grid)' }}>
                  <td colSpan={COLUMNS} className="py-1.5" style={{ color: 'var(--ink-muted)' }}>
                    Bu davrda buyurtma yoʻq
                  </td>
                </tr>
              ) : (
                data.days.map((d) => {
                  const key = d.day ?? 'none'
                  const expanded = open === key && d.day !== null
                  const matched = dayMatched(d)
                  const tint = rowTint(matched)
                  return (
                    <Fragment key={key}>
                      <tr className="border-t" style={{ borderColor: 'var(--grid)' }}>
                        <th scope="row" className={`${PIN} py-1.5 pr-3 text-left font-medium`} style={{ color: 'var(--ink-primary)', background: tint }}>
                          {d.day === null ? (
                            <RowMark matched={matched}>Sanasiz</RowMark>
                          ) : (
                            <button
                              type="button"
                              className="focusable inline-flex items-center gap-1.5 rounded-[var(--radius-panel-sm)] whitespace-nowrap"
                              aria-expanded={expanded}
                              aria-controls={`kpi-day-${key}`}
                              onClick={() => setOpen(expanded ? null : key)}
                            >
                              <ChevronGlyph direction={expanded ? 'down' : 'right'} size={12} className="shrink-0" />
                              <RowMark matched={matched}>{dayLabel(d.day)}</RowMark>
                            </button>
                          )}
                        </th>
                        <DayCells day={d} tint={tint} />
                      </tr>
                      {expanded && d.day !== null && (
                        <tr id={`kpi-day-${key}`}>
                          <td colSpan={COLUMNS} className="pb-3">
                            <DayOrders params={params} day={d.day} basis={basis} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2" style={{ borderColor: 'var(--grid)' }}>
                <th scope="row" className={`${PIN} pt-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide`} style={{ color: 'var(--ink-secondary)' }}>
                  Jami
                </th>
                <DayCells day={data.total} strong />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ChartCard>
  )
}

function DayCells({ day, strong = false, tint }: { readonly day: DayDto; readonly strong?: boolean; readonly tint?: string }) {
  const weight = strong ? 'font-semibold' : ''
  const figure = { color: 'var(--ink-primary)', background: tint }
  const plain = { background: tint }
  const cell = `py-1.5 pr-3 text-right ${weight}`
  return (
    <>
      <td className={cell} style={figure}>{formatNumber(day.bitrix.orders)}</td>
      <td className={cell} style={figure}>{formatNumber(day.moysklad.orders)}</td>
      <td className="py-1.5 pr-3 text-right" style={plain}>
        <DeltaBadge value={day.moysklad.orders - day.bitrix.orders} format={formatNumber} />
      </td>
      <td className={cell} style={figure}>{formatNumber(day.bitrix.pieces)}</td>
      <td className={cell} style={figure}>{formatNumber(day.moysklad.pieces)}</td>
      <td className="py-1.5 pr-3 text-right" style={plain}>
        <DeltaBadge value={day.moysklad.pieces - day.bitrix.pieces} format={formatNumber} />
      </td>
      <td className={cell} style={figure}>{formatFullUzs(day.bitrix.amount)}</td>
      <td className={cell} style={figure}>{formatFullUzs(day.moysklad.amount)}</td>
      <td className="py-1.5 pr-3 text-right" style={plain}>
        <DeltaBadge value={day.moysklad.amount - day.bitrix.amount} format={formatFullUzs} />
      </td>
      <td className="py-1.5 text-right" style={plain}>
        <ReconcileChip mismatches={day.mismatched} />
      </td>
    </>
  )
}

/** One day's orders, read when the day is opened — the same window, brand and FAKT figure, plus the day. */
function DayOrders({ params, day, basis }: { readonly params: Record<string, string | number>; readonly day: string; readonly basis: Basis }) {
  const dayParams = useMemo(() => ({ ...params, day }), [params, day])
  const query = useQuery({
    queryKey: ['kpi-day-orders', dayParams],
    queryFn: ({ signal }) => apiGet<KpiDaysDto>('/kpi/days', dayParams, signal),
  })
  const status = statusOf(query)
  const orders = query.data?.data.orders

  if (status === 'loading') return <LoadingSkeleton rows={3} />
  if (status === 'error' || !orders) {
    return (
      <ErrorState
        message={query.error instanceof ApiClientError ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    )
  }
  if (orders.length === 0) {
    return (
      <p className="py-2 pl-5" style={{ color: 'var(--ink-muted)' }}>
        Bu kunda buyurtma yoʻq
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-2 pt-1 pl-5" aria-label={`${dayLabel(day)} buyurtmalari`}>
      {orders.map((o, index) => (
        <OrderBlock key={o.dealId ?? `${o.moysklad?.orderName ?? 'order'}-${index}`} order={o} basis={basis} />
      ))}
    </ul>
  )
}

function OrderBlock({ order, basis }: { readonly order: OrderDto; readonly basis: Basis }) {
  const matched = order.verdict === 'same' || order.verdict === 'beforeFloor'
  const tone = matched ? 'var(--status-good)' : 'var(--status-critical)'
  const muted = { color: 'var(--ink-muted)' }
  const bx = order.bitrix
  const ms = order.moysklad
  return (
    <li
      className="rounded-[var(--radius-panel-sm)] border p-2.5"
      style={{ borderColor: 'var(--grid)', background: matched ? undefined : rowTint(false) }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
          style={{ background: `color-mix(in oklab, ${tone} 14%, transparent)`, color: tone }}
        >
          {verdictText(order.verdict, basis)}
        </span>
        {order.dealId !== null ? (
          <a
            href={bitrixDealUrl(order.dealId)}
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
            style={{ color: 'var(--ink-primary)' }}
          >
            Bitim #{order.dealId}
          </a>
        ) : (
          <span className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
            Bitimsiz
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: PRODUCT_TONE[order.brand] }} />
          {order.brand}
        </span>
        <span style={muted}>MoySklad: {ms ? ms.orderName : 'buyurtma yoʻq'}</span>
        {bx?.seller && <span style={muted}>Sotuvchi: {bx.seller}</span>}
        {bx?.rop && <span style={muted}>ROP: {bx.rop}</span>}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5" style={muted}>
        <span>Bitrix24: {bx ? `${bx.stage} · ${formatFullUzs(bx.amount)} soʻm` : '—'}</span>
        <span>MoySklad: {ms ? `${ms.state ?? 'holatsiz'} · ${formatFullUzs(ms.amount)} soʻm` : '—'}</span>
      </div>
      {order.items.length > 0 && (
        <table className="mt-2 w-full text-xs tabular-nums" aria-label={`Bitim ${order.dealId ?? ''} tovarlari`}>
          <thead>
            <tr style={muted}>
              <th className="py-0.5 pr-3 text-left font-medium">Tovar</th>
              <th className="py-0.5 pr-3 text-right font-medium">Bitrix24 dona</th>
              <th className="py-0.5 pr-3 text-right font-medium">MoySklad dona</th>
              <th className="py-0.5 pr-3 text-right font-medium">Farq</th>
              <th className="py-0.5 pr-3 text-right font-medium">Bitrix24 soʻm</th>
              <th className="py-0.5 pr-3 text-right font-medium">MoySklad soʻm</th>
              <th className="py-0.5 text-right font-medium">Farq soʻm</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((i) => {
              const same = gapIsZero(i.moyskladQuantity - i.bitrixQuantity) && gapIsZero(i.moyskladAmount - i.bitrixAmount)
              return (
                <tr key={i.key} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                  <th scope="row" className="py-1 pr-3 text-left font-medium" style={{ color: 'var(--ink-primary)' }}>
                    <RowMark matched={same || order.verdict === 'beforeFloor'}>{i.name}</RowMark>
                  </th>
                  <td className="py-1 pr-3 text-right">{order.inBitrix ? formatNumber(i.bitrixQuantity) : '—'}</td>
                  <td className="py-1 pr-3 text-right">{order.inMoysklad ? formatNumber(i.moyskladQuantity) : '—'}</td>
                  <td className="py-1 pr-3 text-right">
                    <DeltaBadge value={i.moyskladQuantity - i.bitrixQuantity} format={formatNumber} />
                  </td>
                  <td className="py-1 pr-3 text-right">{order.inBitrix ? formatFullUzs(i.bitrixAmount) : '—'}</td>
                  <td className="py-1 pr-3 text-right">{order.inMoysklad ? formatFullUzs(i.moyskladAmount) : '—'}</td>
                  <td className="py-1 text-right">
                    <DeltaBadge value={i.moyskladAmount - i.bitrixAmount} format={formatFullUzs} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </li>
  )
}
