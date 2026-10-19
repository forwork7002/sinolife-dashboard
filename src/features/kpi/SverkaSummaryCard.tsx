'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { ErrorState, LoadingSkeleton, statusOf } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { ChartCard } from '@/components/ui/Card'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  ISSUE_TEXT,
  SVERKA_ISSUES,
  type SverkaOverviewDto,
  type SverkaPairDto,
} from '@/features/sverka/sverkaApi'
import { ApiClientError, apiGet } from '@/lib/api'
import { formatDateTime, formatFullUzs, formatNumber } from '@/lib/format'

/** Mirrors `SverkaSummaryDto` in `src/server/services/sverkaService.ts`. */
type SverkaSummaryDto = Omit<SverkaOverviewDto, 'lines' | 'products'>

const signed = (value: number, format: (v: number) => string) => (value > 0 ? `+${format(value)}` : format(value))
const gapColor = (value: number) => (value === 0 ? 'var(--ink-muted)' : 'var(--status-critical)')

/**
 * «Bitrix24 ↔ MoySklad» (the client, 2026-10-19: «kpi natijalariga chiqar
 * barcha maʼlumotlarni solishtirib»): «Sverka»'s whole comparison for the
 * window on «KPI rejalari» — FAKT 1 / FAKT 2 / on the way / returned on both
 * systems, the cash desk, every kind of difference, and the teams. The deal
 * rows stay on «Sverka», which the card links to.
 *
 * Company-wide and on the dashboard window, like «Нутрицолог · Collagen»
 * above it. The endpoint is gated on «Sverka»'s section, so an account without
 * «Sverka» (or a narrowed one) is refused and gets no card.
 */
export function SverkaSummaryCard() {
  const { apiParams } = useDashboardFilters()

  const windowParams = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const query = useQuery({
    queryKey: ['kpi-sverka', windowParams],
    queryFn: ({ signal }) => apiGet<SverkaSummaryDto>('/kpi/sverka', windowParams, signal),
    placeholderData: (previous) => previous,
  })

  if (query.error instanceof ApiClientError && query.error.status === 403) return null

  const status = statusOf(query)
  const data = query.data?.data

  return (
    <ChartCard
      title="Bitrix24 ↔ MoySklad · solishtirish"
      hint="«Sverka» hisobi: tanlangan davrda Tasdiqlashga tushgan bitimlar MoySklad buyurtmalari bilan, butun kompaniya"
    >
      <div className="space-y-5 px-5 pb-5">
        {status === 'loading' ? (
          <LoadingSkeleton rows={6} />
        ) : status === 'error' || !data ? (
          <ErrorState
            message={query.error instanceof ApiClientError ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <SummaryBody data={data} />
        )}
      </div>
    </ChartCard>
  )
}

function SummaryBody({ data }: { readonly data: SverkaSummaryDto }) {
  const { totals, moysklad } = data
  const pairs: readonly (readonly [string, SverkaPairDto])[] = [
    ['FAKT 1', totals.fakt1],
    ['FAKT 2', totals.fakt2],
    ['Yoʻlda', totals.transit],
    ['Qaytdi / rad', totals.returned],
  ]
  const flagged = SVERKA_ISSUES.reduce((sum, issue) => sum + data.issueCounts[issue], 0)

  return (
    <>
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        Davrda {formatNumber(totals.cohortOrders)} ta bitim · FAKT 1 dan {formatNumber(totals.clean)} tasi toʻliq mos
        {totals.pending.orders > 0 ? ` · ${formatNumber(totals.pending.orders)} tasi MoySkladʼda hali tayyorlanmoqda` : ''}
        {moysklad.lastSuccessAt ? ` · MoySklad oxirgi tekshiruv ${formatDateTime(moysklad.lastSuccessAt)}` : ''}
      </p>
      {moysklad.lastError && (
        <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
          MoySklad bilan oxirgi aloqa xatosi ({formatDateTime(moysklad.lastError.at)}): {moysklad.lastError.message}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs tabular-nums">
          <thead>
            <tr style={{ color: 'var(--ink-muted)' }}>
              <th className="py-1 pr-3 text-left font-medium" />
              <th className="py-1 pr-3 text-right font-medium">Bitrix24 soni</th>
              <th className="py-1 pr-3 text-right font-medium">MoySklad soni</th>
              <th className="py-1 pr-3 text-right font-medium">Farq</th>
              <th className="py-1 pr-3 text-right font-medium">Bitrix24 summa</th>
              <th className="py-1 pr-3 text-right font-medium">MoySklad summa</th>
              <th className="py-1 text-right font-medium">Farq, soʻm</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map(([label, pair]) => {
              const countGap = pair.moysklad.orders - pair.bitrix.orders
              const amountGap = pair.moysklad.amount - pair.bitrix.amount
              return (
                <tr key={label} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium" style={{ color: 'var(--ink-primary)' }}>
                    {label}
                  </th>
                  <td className="py-1.5 pr-3 text-right" style={{ color: 'var(--ink-primary)' }}>
                    {formatNumber(pair.bitrix.orders)}
                  </td>
                  <td className="py-1.5 pr-3 text-right" style={{ color: 'var(--ink-primary)' }}>
                    {formatNumber(pair.moysklad.orders)}
                  </td>
                  <td className="py-1.5 pr-3 text-right" style={{ color: gapColor(countGap) }}>
                    {signed(countGap, formatNumber)}
                  </td>
                  <td className="py-1.5 pr-3 text-right" style={{ color: 'var(--ink-primary)' }}>
                    {formatFullUzs(pair.bitrix.amount)}
                  </td>
                  <td className="py-1.5 pr-3 text-right" style={{ color: 'var(--ink-primary)' }}>
                    {formatFullUzs(pair.moysklad.amount)}
                  </td>
                  <td className="py-1.5 text-right" style={{ color: gapColor(amountGap) }}>
                    {signed(amountGap, formatFullUzs)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {totals.beforeFloor.orders > 0 && (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {formatNumber(totals.beforeFloor.orders)} ta bitim MoySklad ishga tushishidan oldin tushgan — Bitrix24 sonida bor,
          solishtirilmaydi.
        </p>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold" style={{ color: 'var(--ink-primary)' }}>
          Kassa · FAKT 2 puli
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Tile label="Tushishi kerak" orders={totals.kassa.due.orders} amount={totals.kassa.due.amount} />
          <Tile label="MoySkladʼda toʻlangan" orders={totals.kassa.received.orders} amount={totals.kassa.received.amount} />
          <Tile
            label="Qolgan"
            orders={totals.kassa.left.orders}
            amount={totals.kassa.left.amount}
            critical={totals.kassa.left.orders > 0}
            note={[
              totals.kassa.partial > 0 ? `${formatNumber(totals.kassa.partial)} tasi qisman` : null,
              totals.kassa.noOrder > 0 ? `${formatNumber(totals.kassa.noOrder)} tasi buyurtmasiz` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold" style={{ color: 'var(--ink-primary)' }}>
          Farqlar {flagged === 0 ? '· yoʻq' : ''}
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {SVERKA_ISSUES.map((issue) => {
            const text = ISSUE_TEXT[issue]
            const count = data.issueCounts[issue]
            const tone = count === 0 ? 'var(--ink-muted)' : text.tone === 'critical' ? 'var(--status-critical)' : 'var(--status-warning)'
            return (
              <div key={issue} title={text.hint} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--grid)' }}>
                <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {text.label}
                </div>
                <div className="text-sm font-semibold tabular-nums" style={{ color: tone }}>
                  {formatNumber(count)} ta
                </div>
                {count > 0 && (
                  <div className="text-[11px] tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                    {formatFullUzs(data.issueAmounts[issue])} soʻm
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {data.otherWindowOrders > 0 && (
          <p className="mt-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            Shu davrda MoySkladʼda yana {formatNumber(data.otherWindowOrders)} ta buyurtma ochilgan, bitimi boshqa davrda.
          </p>
        )}
      </section>

      {data.teams.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold" style={{ color: 'var(--ink-primary)' }}>
            Jamoalar boʻyicha · FAKT 1
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs tabular-nums">
              <thead>
                <tr style={{ color: 'var(--ink-muted)' }}>
                  <th className="py-1 pr-3 text-left font-medium">Jamoa</th>
                  <th className="py-1 pr-3 text-right font-medium">Bitrix24 soni</th>
                  <th className="py-1 pr-3 text-right font-medium">MoySklad soni</th>
                  <th className="py-1 pr-3 text-right font-medium">Bitrix24 summa</th>
                  <th className="py-1 pr-3 text-right font-medium">MoySklad summa</th>
                  <th className="py-1 text-right font-medium">Farqli bitim</th>
                </tr>
              </thead>
              <tbody>
                {data.teams.map((team) => (
                  <tr key={team.team} className="border-t" style={{ borderColor: 'var(--grid)' }}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-medium" style={{ color: 'var(--ink-primary)' }}>
                      {team.team}
                    </th>
                    <td className="py-1.5 pr-3 text-right">{formatNumber(team.bitrix.orders)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatNumber(team.moysklad.orders)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatFullUzs(team.bitrix.amount)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatFullUzs(team.moysklad.amount)}</td>
                    <td className="py-1.5 text-right" style={{ color: gapColor(team.issues) }}>
                      {formatNumber(team.issues)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Button href="/sverka" size="sm">
        Har bir bitim boʻyicha — «Sverka»
      </Button>
    </>
  )
}

function Tile({
  label,
  orders,
  amount,
  critical = false,
  note,
}: {
  readonly label: string
  readonly orders: number
  readonly amount: number
  readonly critical?: boolean
  readonly note?: string
}) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--grid)' }}>
      <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {label} · {formatNumber(orders)} ta
      </div>
      <div
        className="text-sm font-semibold tabular-nums"
        style={{ color: critical ? 'var(--status-critical)' : 'var(--ink-primary)' }}
      >
        {formatFullUzs(amount)} soʻm
      </div>
      {note && (
        <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {note}
        </div>
      )}
    </div>
  )
}
