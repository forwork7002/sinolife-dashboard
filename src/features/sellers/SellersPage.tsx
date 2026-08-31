'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { Meter, SectionHeader, StatTile, StatusChip } from '@/components/ui/Stat'
import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  type SellerBoardDto,
  type SellerBoardRowDto,
  type SellerDayDto,
  type SellerTeamRowDto,
  apiGet,
} from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatDateShort, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Sotuvchilar reytingi — who brought the work in, and what it earned them.
 *
 * Modelled on the client's own published sellers dashboard, which is the
 * board their floor already reads every morning: a ranked table with medals,
 * the ROP's team beside each name, a teams view, a per-seller drill-down, and
 * the bonus ladder. What it does NOT copy is that page's month tabs — the
 * period comes from this application's own control at the top of every
 * screen, so one date choice moves every section instead of each page holding
 * its own opinion about "now".
 *
 * THE CLOCK IS ORDER INTAKE, and the whole page depends on saying so. Every
 * figure is bucketed by the day the ORDER WAS TAKEN, not the day it was
 * delivered — which is how the client scores their floor and pays bonuses,
 * and which is why this board's totals are nothing like the Savdo dinamikasi
 * page's. Measured on July 2026: 3.89 bn so'm of intake here against 0.98 bn
 * of delivered revenue there, the same month, the same deals, two clocks. The
 * caption states the basis, because a reader who reaches both screens will
 * otherwise reconcile two true numbers and conclude one is broken.
 *
 * THE DEFINITIONS WERE MEASURED, NOT GUESSED. Their page's three money
 * columns carry no published formula; each was reproduced against this
 * database until it matched July 2026 to within half a percent — see
 * `sellerBoardRepository`. That is what licenses this screen to use their
 * column names.
 *
 * NO ROP COLOUR CODING, and that is a deliberate departure. Their page paints
 * each ROP its own hue from a thirteen-colour map; this design system caps
 * categorical identity at eight slots because past that the hues stop being
 * distinguishable under colourblindness, and generating a ninth is the one
 * thing the palette rule forbids outright. The team rides as a text badge
 * instead: unlimited, readable, and legible to everyone.
 */
export function SellersPage() {
  const { apiParams } = useDashboardFilters()
  const [tab, setTab] = useState<'sellers' | 'teams'>('sellers')
  const [openSeller, setOpenSeller] = useState<string | null>(null)

  const board = useQuery({
    queryKey: ['sellers', 'board', apiParams],
    queryFn: ({ signal }) => apiGet<SellerBoardDto>('/analytics/sellers', apiParams, signal),
    placeholderData: (previous) => previous,
  })

  const data = board.data?.data
  const status = board.isPending ? 'loading' : board.isError ? 'error' : 'ready'

  return (
    <PageShell
      title={t.nav.sellers}
      description="Kim qancha buyurtma olib keldi — buyurtma OLINGAN sana boʻyicha"
      meta={board.data?.meta}
      accent="var(--series-5)"
    >
      <TotalsBand data={data} status={status} />

      {/*
        The basis, stated once and prominently. It is the single fact that
        stops this page and Savdo dinamikasi from looking like a bug.
      */}
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        Bu sahifadagi barcha raqamlar <strong style={{ color: 'var(--ink-secondary)' }}>buyurtma
        olingan sana</strong> boʻyicha — mijozning oʻz dashboardi ham shunday sanaydi. «Savdo
        dinamikasi» esa tushumni <strong style={{ color: 'var(--ink-secondary)' }}>yopilgan
        sana</strong> boʻyicha koʻrsatadi, shuning uchun ikkala sahifaning jamlari bir xil
        boʻlmaydi — ikkalasi ham toʻgʻri, savoli boshqa. Bekor qilingan buyurtmalar
        «Buyurtma puli»ga kirmaydi.
      </p>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {(
              [
                ['sellers', 'Sotuvchilar'],
                ['teams', 'Komandalar'],
              ] as const
            ).map(([id, label]) => {
              const active = tab === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-pressed={active}
                  className="focusable rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors"
                  style={{
                    background: active ? 'var(--surface-raised)' : 'transparent',
                    color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                    boxShadow: active ? 'var(--shadow-card)' : 'none',
                    border: `1px solid ${active ? 'var(--border-strong)' : 'transparent'}`,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {data && status === 'ready' && (
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {tab === 'sellers'
                ? `${formatNumber(data.totals.sellers)} ta sotuvchi — davrda buyurtma olganlar`
                : `${formatNumber(data.totals.teams)} ta komanda`}
            </p>
          )}
        </div>

        <Card className="reveal px-4 py-4">
          {status === 'loading' ? (
            <ChartSkeleton height={360} />
          ) : status === 'error' ? (
            <ErrorState
              message={(board.error as Error | null)?.message}
              onRetry={() => void board.refetch()}
            />
          ) : !data || data.rows.length === 0 ? (
            <EmptyState
              title="Bu davrda buyurtma yoʻq"
              body="Tanlangan davrda hech kim buyurtma olmagan."
            />
          ) : tab === 'sellers' ? (
            <SellerTable
              rows={data.rows}
              openSeller={openSeller}
              onToggle={(id) => setOpenSeller((current) => (current === id ? null : id))}
              apiParams={apiParams}
            />
          ) : (
            <TeamTable rows={data.teams} />
          )}
        </Card>
      </section>

      <BonusLadder data={data} status={status} />
    </PageShell>
  )
}

// ---------------------------------------------------------------------------

function TotalsBand({
  data,
  status,
}: {
  data: SellerBoardDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  const totals = data?.totals

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatTile
        label="Olingan buyurtma puli"
        value={totals ? totals.ordered.amount : null}
        unit="money"
        status={status}
        hint={totals ? `${formatNumber(totals.orders)} ta buyurtma` : undefined}
      />
      <StatTile
        label="Shundan yutilgani"
        value={totals ? totals.won.amount : null}
        unit="money"
        status={status}
        hint={
          totals ? `${formatNumber(totals.wonOrders)} ta yakunlangan buyurtma` : undefined
        }
        context={totals ? <TrendIndicator delta={totals.wonDelta} /> : undefined}
      />
      <StatTile
        label="Konversiya"
        value={totals?.conversionPercent ?? null}
        unit="percent"
        status={status}
        hint="hal boʻlgan buyurtmalardan — ochiqlari hisobga olinmaydi"
        context={
          totals && totals.conversionPercent !== null ? (
            <Meter value={totals.conversionPercent} tone="neutral" label="Konversiya" />
          ) : undefined
        }
      />
      {/*
        The bonus total is the one figure on this band that is a POLICY rather
        than a measurement, so it names its own source in the hint.
      */}
      <StatTile
        label="Bonus jamgʻarmasi"
        value={totals ? totals.bonusPayable.amount : null}
        unit="money"
        status={status}
        hint={
          totals
            ? `${formatNumber(totals.sellersInBonus)} ta sotuvchi darajani oldi`
            : undefined
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

/** 🥇🥈🥉 for the podium, the plain figure below it. */
function Rank({ rank }: { rank: number }) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
  return (
    <span
      className="tabular inline-flex w-9 shrink-0 justify-end text-xs font-semibold"
      style={{ color: rank <= 3 ? 'var(--ink-primary)' : 'var(--ink-muted)' }}
    >
      {medal ? <span aria-label={`${rank}-oʻrin`}>{medal}</span> : rank}
    </span>
  )
}

/**
 * The team, as a text badge.
 *
 * Chrome tokens, never a series colour: thirteen ROPs exceed the eight-slot
 * categorical palette, and the design contract forbids generating more hues.
 * The name is the identity here, which also survives a colourblind reader and
 * a black-and-white print.
 */
function TeamBadge({ rop }: { rop: string | null }) {
  if (!rop) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{
        background: 'var(--surface-sunken)',
        color: 'var(--ink-secondary)',
        border: '1px solid var(--border)',
      }}
    >
      {rop}
    </span>
  )
}

function SellerTable({
  rows,
  openSeller,
  onToggle,
  apiParams,
}: {
  rows: readonly SellerBoardRowDto[]
  openSeller: string | null
  onToggle: (employeeId: string) => void
  apiParams: Record<string, string | number>
}) {
  // The bar's ceiling is the leader, so the first row fills the track and
  // every other row is read against the person who actually leads.
  const ceiling = Math.max(...rows.map((r) => r.won.amount), 1)

  return (
    /*
      Sixty percent of the screen, then the rows scroll under a pinned header —
      the same bound every DataTable carries. A hundred and ten sellers is six
      thousand pixels, and the application never scrolls as a page.
    */
    <div className="max-h-[60dvh] overflow-auto">
      <table className="w-full" style={{ minWidth: 860 }}>
        <thead>
          <tr>
            {[
              ['#', 'left'],
              ['Sotuvchi', 'left'],
              ['Komanda', 'left'],
              ['Buyurtma', 'right'],
              ['Buyurtma puli', 'right'],
              ['Yutilgan puli', 'right'],
              ['Konversiya', 'right'],
              ['Bonus', 'right'],
            ].map(([label, align]) => (
              <th
                key={label}
                className="eyebrow sticky top-0 z-[1] px-2 pt-1 pb-2 whitespace-nowrap"
                style={{ textAlign: align as 'left' | 'right', background: 'var(--surface)' }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = openSeller === row.employeeId
            return (
              <SellerRows
                key={row.employeeId}
                row={row}
                ceiling={ceiling}
                open={open}
                onToggle={() => onToggle(row.employeeId)}
                apiParams={apiParams}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SellerRows({
  row,
  ceiling,
  open,
  onToggle,
  apiParams,
}: {
  row: SellerBoardRowDto
  ceiling: number
  open: boolean
  onToggle: () => void
  apiParams: Record<string, string | number>
}) {
  return (
    <>
      <tr
        className="border-b"
        style={{ borderColor: 'var(--grid)' }}
      >
        <td className="px-2 py-2">
          <Rank rank={row.rank} />
        </td>
        <td className="px-2 py-2">
          {/*
            The name is the disclosure trigger — one target, not a name plus a
            separate chevron, so the row has a single obvious action.
          */}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="focusable rounded text-left text-[12.5px] font-medium underline-offset-2 hover:underline"
            style={{ color: 'var(--ink-primary)' }}
          >
            {row.fullName}
          </button>
          <div className="mt-1 h-1 w-full max-w-[220px] overflow-hidden rounded-full"
               style={{ background: 'var(--track)' }}
               aria-hidden="true">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(1, (row.won.amount / ceiling) * 100)}%`,
                background: 'var(--seq-450)',
                transition: 'width var(--duration-enter) var(--ease-out)',
              }}
            />
          </div>
        </td>
        <td className="px-2 py-2">
          <TeamBadge rop={row.rop} />
        </td>
        <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-primary)' }}>
          {formatNumber(row.orders)}
          {row.openOrders > 0 && (
            <span className="ml-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              ({formatNumber(row.openOrders)} yoʻlda)
            </span>
          )}
        </td>
        <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-secondary)' }}>
          <Tooltip content={<span className="tabular">{formatUzs(row.ordered.amount)}</span>}>
            <span tabIndex={0} className="focusable rounded">
              {formatCompactUzs(row.ordered.amount)}
            </span>
          </Tooltip>
        </td>
        <td className="tabular px-2 py-2 text-right text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
          <Tooltip content={<span className="tabular">{formatUzs(row.won.amount)}</span>}>
            <span tabIndex={0} className="focusable rounded">
              {formatCompactUzs(row.won.amount)}
            </span>
          </Tooltip>
          {row.sharePercent !== null && (
            <span className="ml-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {formatPercent(row.sharePercent, 1)}
            </span>
          )}
        </td>
        <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {row.conversionPercent === null ? NO_VALUE : formatPercent(row.conversionPercent)}
        </td>
        <td className="px-2 py-2 text-right">
          <BonusCell bonus={row.bonus} />
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={8} className="px-2 pt-1 pb-4">
            <SellerDetail employeeId={row.employeeId} row={row} apiParams={apiParams} />
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * The bonus cell: what was earned, or how far the next tier is.
 *
 * A seller below every floor gets the DISTANCE rather than a zero — the zero
 * is true and useless, the distance is the only thing they can act on.
 */
function BonusCell({ bonus }: { bonus: SellerBoardRowDto['bonus'] }) {
  if (bonus.earned.amount > 0) {
    return (
      <StatusChip tone="good">{formatCompactUzs(bonus.earned.amount)}</StatusChip>
    )
  }
  if (bonus.toNext === null) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </span>
    )
  }
  return (
    <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
      +{formatCompactUzs(bonus.toNext.amount)} kerak
    </span>
  )
}

/** One seller's days, fetched only when the row is opened. */
function SellerDetail({
  employeeId,
  row,
  apiParams,
}: {
  employeeId: string
  row: SellerBoardRowDto
  apiParams: Record<string, string | number>
}) {
  const days = useQuery({
    queryKey: ['sellers', 'days', employeeId, apiParams],
    queryFn: ({ signal }) =>
      apiGet<readonly SellerDayDto[]>(
        '/analytics/sellers',
        { ...apiParams, employeeId },
        signal,
      ),
  })

  const rows = days.data?.data ?? []
  const peak = Math.max(...rows.map((d) => d.ordered.amount), 1)

  return (
    <div
      className="rounded-[var(--radius-panel-sm)] px-4 py-3.5"
      style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.fullName}
          <span className="ml-2 font-normal" style={{ color: 'var(--ink-muted)' }}>
            kunlar kesimida
          </span>
        </p>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Yutilgan {formatCompactUzs(row.won.amount)} · yoʻlda{' '}
          {formatCompactUzs(row.open.amount)} ({formatNumber(row.openOrders)} ta) · bekor{' '}
          {formatNumber(row.lostOrders)} ta
        </p>
      </div>

      {/* The bonus ladder for THIS seller, where the distance means something. */}
      {row.bonus.nextFloor !== null && row.bonus.toNextPercent !== null && (
        <div className="mt-2.5 max-w-md">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
              Keyingi daraja: {formatCompactUzs(row.bonus.nextFloor.amount)} →{' '}
              {row.bonus.nextBonus ? formatCompactUzs(row.bonus.nextBonus.amount) : NO_VALUE} bonus
            </span>
            <span className="tabular text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {formatPercent(row.bonus.toNextPercent, 0)}
            </span>
          </div>
          <div className="mt-1"><Meter value={row.bonus.toNextPercent} tone="neutral" /></div>
        </div>
      )}

      <div className="mt-3">
        {days.isPending ? (
          <div className="skeleton h-24 w-full rounded" role="status">
            <span className="sr-only">Yuklanmoqda</span>
          </div>
        ) : days.isError ? (
          <ErrorState
            message={(days.error as Error | null)?.message}
            onRetry={() => void days.refetch()}
          />
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
            Kunlik yozuv topilmadi
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((day) => (
              <li key={day.date} className="flex items-center gap-3">
                <span
                  className="tabular w-16 shrink-0 text-[11px]"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {formatDateShort(day.date)}
                </span>
                <span
                  className="tabular w-10 shrink-0 text-right text-[11px]"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {formatNumber(day.orders)} ta
                </span>
                {/*
                  Two lengths on one track: the day's intake, and the part of
                  it already won. Same hue at two steps of the sequential ramp
                  — one measure at two stages, never two categories.
                */}
                <div
                  className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full"
                  style={{ background: 'var(--track)' }}
                  role="img"
                  aria-label={`${formatDateShort(day.date)}: ${formatCompactUzs(
                    day.ordered.amount,
                  )} olindi, ${formatCompactUzs(day.won.amount)} yutildi`}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${(day.ordered.amount / peak) * 100}%`,
                      background: 'var(--seq-250)',
                    }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${(day.won.amount / peak) * 100}%`,
                      background: 'var(--seq-550)',
                    }}
                  />
                </div>
                <span
                  className="tabular w-24 shrink-0 text-right text-[11px]"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {formatCompactUzs(day.won.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-2.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        Ochiq ustun — olingan buyurtma puli, toʻq ustun — shundan yutilgani.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------

function TeamTable({ rows }: { rows: readonly SellerTeamRowDto[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Komanda topilmadi"
        body="Bu davrda hech bir ROP komandasi buyurtma olmagan."
      />
    )
  }
  const ceiling = Math.max(...rows.map((r) => r.won.amount), 1)

  return (
    <div className="max-h-[60dvh] overflow-auto">
      <table className="w-full" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            {[
              ['#', 'left'],
              ['Komanda (ROP)', 'left'],
              ['Sotuvchi', 'right'],
              ['Buyurtma', 'right'],
              ['Buyurtma puli', 'right'],
              ['Yutilgan puli', 'right'],
              ['Konversiya', 'right'],
            ].map(([label, align]) => (
              <th
                key={label}
                className="eyebrow sticky top-0 z-[1] px-2 pt-1 pb-2 whitespace-nowrap"
                style={{ textAlign: align as 'left' | 'right', background: 'var(--surface)' }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rop} className="border-b" style={{ borderColor: 'var(--grid)' }}>
              <td className="px-2 py-2">
                <Rank rank={row.rank} />
              </td>
              <td className="px-2 py-2">
                <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink-primary)' }}>
                  {row.rop}
                </span>
                <div className="mt-1 h-1 w-full max-w-[240px] overflow-hidden rounded-full"
                     style={{ background: 'var(--track)' }} aria-hidden="true">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(1, (row.won.amount / ceiling) * 100)}%`,
                      background: 'var(--seq-450)',
                      transition: 'width var(--duration-enter) var(--ease-out)',
                    }}
                  />
                </div>
              </td>
              <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {formatNumber(row.sellers)}
              </td>
              <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-primary)' }}>
                {formatNumber(row.orders)}
              </td>
              <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {formatCompactUzs(row.ordered.amount)}
              </td>
              <td className="tabular px-2 py-2 text-right text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
                {formatCompactUzs(row.won.amount)}
                {row.sharePercent !== null && (
                  <span className="ml-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {formatPercent(row.sharePercent, 1)}
                  </span>
                )}
              </td>
              <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-secondary)' }}>
                {row.conversionPercent === null ? NO_VALUE : formatPercent(row.conversionPercent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * The ladder itself, printed once so the rule is on the page rather than in
 * somebody's memory — and attributed, because it is the client's policy and
 * not a figure this application measured.
 */
function BonusLadder({
  data,
  status,
}: {
  data: SellerBoardDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  const tiers = [
    { floor: 70_000_000, bonus: 2_000_000 },
    { floor: 60_000_000, bonus: 1_500_000 },
    { floor: 45_000_000, bonus: 1_000_000 },
  ]

  const reached = (floor: number) =>
    status === 'ready' && data ? data.rows.filter((r) => r.won.amount >= floor).length : null

  return (
    <section className="space-y-2.5">
      <SectionHeader
        title="Bonus darajalari"
        hint="Mijozning oʻz qoidasi — yutilgan buyurtma puli boʻyicha"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {tiers.map((tier) => {
          const count = reached(tier.floor)
          return (
            <div key={tier.floor} className="card flex flex-col gap-1 px-4 py-3.5">
              <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                {formatCompactUzs(tier.floor)} soʻmdan
              </p>
              {/*
                Plain text, NOT AnimatedNumber, and the reason is both
                correctness and meaning. A tier is a POLICY CONSTANT — it does
                not arrive from a query, so there is nothing to count up to,
                and animating it would imply a figure that moves. It also
                broke hydration: this is the one number on the page the server
                renders, and `formatCompactUzs` resolves uz-UZ differently in
                Node than in the browser ("1,5 mln" against "1.5 mln"), so the
                SSR text and the client text disagreed on first paint.
              */}
              <p className="figure text-[22px] leading-none font-semibold" style={{ color: 'var(--ink-primary)' }}>
                {formatCompactUzs(tier.bonus)}
                <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                  soʻm bonus
                </span>
              </p>
              <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {count === null
                  ? '…'
                  : count === 0
                    ? 'Bu davrda hech kim yetmadi'
                    : `${formatNumber(count)} ta sotuvchi yetdi`}
              </p>
            </div>
          )
        })}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        Daraja bir marta toʻlanadi — eng yuqori bosib oʻtilgan chegara boʻyicha, qoʻshilmaydi.
      </p>
    </section>
  )
}
