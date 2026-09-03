'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card } from '@/components/ui/Card'
import { GaugeTile, Meter, SectionHeader, StatTile, StatusChip } from '@/components/ui/Stat'
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
 * THIS PAGE IS THE RACE, and the design treats it as one. The floor opens it
 * to see who is first and what it takes to catch them, so the screen leads
 * with a podium — the page's one hero instrument, which this screen alone had
 * been missing — and every row below it names the seller's own next target:
 * the person directly ahead in soʻm, the next bonus rung in soʻm. Distances,
 * never ordinals: "+2,1 mln kerak" is something a seller can act on today,
 * "siz 47-siz" is something they can only feel bad about.
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
 *
 * RANK WEARS NO HUE ANYWHERE. Gold, silver and bronze fills are the first
 * thing a leaderboard reaches for and the design contract forbids them: rank
 * takes weight, size, elevation, the emoji medals and the ordinal ramp — and
 * nothing else. First place is made desirable by being the biggest thing on
 * the screen, not the shiniest.
 */
export function SellersPage() {
  const { apiParams: filterParams } = useDashboardFilters()
  const [tab, setTab] = useState<'sellers' | 'teams'>('sellers')
  const [openSeller, setOpenSeller] = useState<string | null>(null)
  /**
   * Which clock the board reads — see `?basis=` on `/analytics/sellers`.
   *
   * A page-local toggle, not a `useDashboardFilters` entry: the basis is a
   * question this screen alone asks, not a window every screen shares, and
   * `reset()` clearing it back to the floor's own definition is the right
   * behaviour rather than a bug to route around.
   */
  const [basis, setBasis] = useState<'queue' | 'intake'>('queue')
  const apiParams = useMemo(() => ({ ...filterParams, basis }), [filterParams, basis])

  const board = useQuery({
    queryKey: ['sellers', 'board', apiParams],
    queryFn: ({ signal }) => apiGet<SellerBoardDto>('/analytics/sellers', apiParams, signal),
    placeholderData: (previous) => previous,
  })

  const data = board.data?.data
  const status = board.isPending ? 'loading' : board.isError ? 'error' : 'ready'

  /**
   * A podium card is a door, not a poster: clicking a name lands on that
   * seller's row with the drill-down open. The double rAF waits out the
   * tab-switch render so the row exists before it is scrolled to; the scroll
   * itself glides only when `html`'s motion-guarded smooth-scroll rule says
   * it may.
   */
  const openFromPodium = (employeeId: string) => {
    setTab('sellers')
    setOpenSeller(employeeId)
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .getElementById(`seller-row-${employeeId}`)
          ?.scrollIntoView({ block: 'center' }),
      ),
    )
  }

  return (
    <PageShell
      title={t.nav.sellers}
      description={
        basis === 'queue'
          ? 'Kim qancha buyurtma olib keldi — FAKT 1 / FAKT 2, navbatga tushgan sana boʻyicha'
          : 'Kim qancha buyurtma olib keldi — buyurtma OLINGAN sana boʻyicha'
      }
      meta={board.data?.meta}
      stale={board.isPlaceholderData}
      accent="var(--series-5)"
      actions={
        /*
          TWO CLOCKS, ONE TOGGLE. «Navbat» is the floor's own FAKT 1 / FAKT 2 —
          Тасдиқланди / Доставланди, dated by the arrival in C4:NEW. «Yaratilgan
          sana» is the original reading this screen shipped with, kept as the
          one figure measured against the client's own published dashboard
          (see `sellerBoardRepository`) — the oracle a «Navbat» regression gets
          checked against, not a second board anyone is meant to keep reading.
        */
        <div className="flex gap-1" role="group" aria-label="Hisoblash asosi">
          {(
            [
              ['queue', 'Navbat (FAKT 1/2)'],
              ['intake', 'Yaratilgan sana'],
            ] as const
          ).map(([id, label]) => {
            const active = basis === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setBasis(id)}
                aria-pressed={active}
                className="focusable rounded-lg px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors"
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
      }
    >
      <PodiumHero
        data={data}
        status={status}
        errorMessage={(board.error as Error | null)?.message}
        onRetry={() => void board.refetch()}
        onOpenSeller={openFromPodium}
      />

      <TotalsBand data={data} status={status} />

      {/*
        The basis, stated once and prominently. It is the single fact that
        stops this page and Savdo dinamikasi — and the two readings of this
        very page — from looking like a bug.
      */}
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        {basis === 'queue' ? (
          <>
            Bu sahifadagi raqamlar <strong style={{ color: 'var(--ink-secondary)' }}>
            tasdiqlash navbatiga tushgan sana</strong> (C4:NEW) boʻyicha. «Buyurtma puli» —
            FAKT 1, <strong style={{ color: 'var(--ink-secondary)' }}>Тасдиқланди</strong> (mijozga
            yetib, Доставка ga oʻtgan buyurtmalar). «Yutilgan puli» — FAKT 2, shundan{' '}
            <strong style={{ color: 'var(--ink-secondary)' }}>Доставланди</strong> boʻlgani. Iyul
            oyida jonatilib avgustda yetkazilgan buyurtma FAKT 2 ga avgustda emas, iyulning oʻzida
            qoʻshiladi va oy yopilgandan keyin ham oʻsishda davom etishi mumkin — chunki sana
            buyurtma navbatga TUSHGAN kunni bildiradi, YETKAZILGAN kunni emas. Тасдиқланмаган va
            rad etilgan buyurtmalar «Buyurtma puli»ga kirmaydi.
          </>
        ) : (
          <>
            Bu sahifadagi barcha raqamlar <strong style={{ color: 'var(--ink-secondary)' }}>buyurtma
            olingan sana</strong> boʻyicha — mijozning oʻz dashboardi ham shunday sanaydi. «Savdo
            dinamikasi» esa tushumni <strong style={{ color: 'var(--ink-secondary)' }}>yopilgan
            sana</strong> boʻyicha koʻrsatadi, shuning uchun ikkala sahifaning jamlari bir xil
            boʻlmaydi — ikkalasi ham toʻgʻri, savoli boshqa. Bekor qilingan buyurtmalar
            «Buyurtma puli»ga kirmaydi.
          </>
        )}
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
                ? sellersCaption(data)
                : data.totals.teamlessSellers > 0
                  ? `${formatNumber(data.totals.teams)} ta komanda · ${formatNumber(data.totals.teamlessSellers)} ta sotuvchi komandasiz, ulushlar ularsiz`
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

/**
 * The tab caption, carrying one chase fact when it is true: how many sellers
 * are within striking distance of a bonus rung. The floor's manager reads it
 * as "who is about to cost me money", the floor reads it as "it can be done".
 */
function sellersCaption(data: SellerBoardDto): string {
  const near = data.rows.filter(
    (r) => r.bonus.toNextPercent !== null && r.bonus.toNextPercent >= 90,
  ).length
  const base = `${formatNumber(data.totals.sellers)} ta sotuvchi — davrda buyurtma olganlar`
  return near > 0
    ? `${base} · ${formatNumber(near)} tasi bonus darajasiga 90%+ yaqin`
    : base
}

// ---------------------------------------------------------------------------
// The podium — the page's one hero instrument
// ---------------------------------------------------------------------------

/**
 * The morning ceremony: the top three, on steps.
 *
 * One `.card-hero`, one `.figure-hero` — the leader's won money, which is THE
 * number this page exists to make people want. Rank is encoded exactly three
 * ways, all licensed: size (the leader's figure is the hero, the flankers get
 * 20px), elevation (the leader stands on the hero surface, the flankers on
 * sunken steps), and the emoji medals the table already hands out. DOM order
 * is 1-2-3 for reading and for the stagger — gold arrives first — while CSS
 * `order` seats second place on the left and third on the right, so the three
 * cells literally form a podium on wide screens.
 *
 * MEDALS ONLY FOR WON MONEY — the table's `ranked` rule, enforced here by
 * construction: the podium renders only rows with `won.amount > 0`, so a
 * short window where nobody has won yet shows the open-gate state instead of
 * handing out gold for a tie-break. That state still carries a real measured
 * number (the period's intake) rather than a zero pretending to be a fact.
 *
 * The footer is the pace of the race: the DTO's forecast, which this page
 * fetched and never showed. "At this pace the floor finishes at X" is the
 * one line that makes a mid-month podium mean something.
 */
function PodiumHero({
  data,
  status,
  errorMessage,
  onRetry,
  onOpenSeller,
}: {
  data: SellerBoardDto | undefined
  status: 'loading' | 'error' | 'ready'
  errorMessage?: string
  onRetry: () => void
  onOpenSeller: (employeeId: string) => void
}) {
  const winners = data ? data.rows.filter((r) => r.won.amount > 0).slice(0, 3) : []

  return (
    <section className="rise" aria-label="Davr peshqadamlari">
      {/* Brackets on the wrapper, hero treatment on the card: the two classes
          never share an element because both draw with ::after. */}
      <div className="brackets">
        <div className="card-hero px-5 py-4 sm:px-6 sm:py-5">
          <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2
              className="text-sm font-semibold tracking-tight"
              style={{ color: 'var(--ink-primary)' }}
            >
              Davr peshqadamlari
            </h2>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Yutilgan buyurtma puli boʻyicha — medal faqat yutilgan pul uchun
            </p>
          </header>

          {status === 'loading' ? (
            /* Sized to the ready layout, so ready never reflows loading. */
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.3fr_1fr] sm:items-end" role="status">
              <span className="sr-only">Yuklanmoqda</span>
              <div className="skeleton h-28" aria-hidden="true" />
              <div className="skeleton h-44" aria-hidden="true" />
              <div className="skeleton h-28" aria-hidden="true" />
            </div>
          ) : status === 'error' ? (
            <ErrorState message={errorMessage} onRetry={onRetry} />
          ) : !data || data.rows.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
                Bu davrda buyurtma yoʻq
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                Tanlangan davrda hech kim buyurtma olmagan — podium keyingi buyurtmani kutmoqda.
              </p>
            </div>
          ) : winners.length === 0 ? (
            /*
              Orders exist, wins do not — the first hours of a short window.
              The gate is open: no medals for a tie-break, but the hero still
              leads with a real number, the intake already on the books.
            */
            <div className="mt-3">
              <p className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
                Podium hali boʻsh — oʻrinlar hammaga ochiq
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                Birinchi yutilgan buyurtma podiumni yoqadi. Hozircha olingan buyurtma puli:
              </p>
              <div className="mt-2.5">
                <Tooltip content={<span className="tabular">{formatUzs(data.totals.ordered.amount)}</span>}>
                  <span
                    tabIndex={0}
                    className="focusable figure-hero inline-block rounded-[var(--radius-panel-sm)]"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    <AnimatedNumber value={data.totals.ordered.amount} format={formatCompactUzs} />
                    <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                      soʻm
                    </span>
                  </span>
                </Tooltip>
              </div>
              <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {formatNumber(data.totals.orders)} ta buyurtma olingan — gʻolib hali aniqlanmagan
              </p>
            </div>
          ) : (
            <>
              <div
                className={`stagger mt-4 grid gap-3 ${
                  winners.length === 3
                    ? 'sm:grid-cols-[1fr_1.3fr_1fr] sm:items-end'
                    : winners.length === 2
                      ? 'sm:grid-cols-[1.3fr_1fr] sm:items-end'
                      : 'sm:max-w-md'
                }`}
              >
                {winners.map((row, index) => (
                  <PodiumStep
                    key={row.employeeId}
                    row={row}
                    place={index + 1}
                    winnersCount={winners.length}
                    leader={winners[0]}
                    totalWon={data.totals.won.amount}
                    onOpen={() => onOpenSeller(row.employeeId)}
                  />
                ))}
              </div>

              <ForecastStrip data={data} />
            </>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * One step of the podium.
 *
 * The leader stands directly on the hero surface and carries the page's one
 * `.figure-hero`; second and third stand on sunken inset panels — a step DOWN
 * in elevation, which is the podium metaphor drawn with surface tokens
 * instead of paint. Each flanker's one motivating fact is the gap to the top:
 * a soʻm distance and a bar against the leader's total, in the sequential
 * hue, because "how close" is a magnitude and magnitude is what the ramp is
 * for.
 */
function PodiumStep({
  row,
  place,
  winnersCount,
  leader,
  totalWon,
  onOpen,
}: {
  row: SellerBoardRowDto
  place: number
  winnersCount: number
  leader: SellerBoardRowDto
  totalWon: number
  onOpen: () => void
}) {
  const isLeader = place === 1
  const medal = ['🥇', '🥈', '🥉'][place - 1]
  // Visual seating on wide screens: silver left of gold, bronze to the right.
  // DOM order stays 1-2-3, so reading order and the stagger keep the ranking.
  const seat =
    winnersCount === 3 ? (place === 2 ? 'sm:order-first' : place === 3 ? 'sm:order-last' : '') : ''

  const name = (
    <button
      type="button"
      onClick={onOpen}
      className={`focusable rounded text-left underline-offset-2 hover:underline ${
        isLeader ? 'text-[17px] font-semibold' : 'text-[13px] font-medium'
      }`}
      style={{ color: 'var(--ink-primary)' }}
    >
      {row.fullName}
    </button>
  )

  if (isLeader) {
    return (
      <div className={seat}>
        <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
          <span aria-hidden="true">{medal}</span>
          <span className="sr-only">1-oʻrin:</span>
          <span className="ml-1.5">1-oʻrin</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {name}
          {/* Inline beside a name, an absent team is silence, not a dash — the
              placeholder belongs to the table column, where alignment needs it. */}
          {row.rop && <TeamBadge rop={row.rop} />}
        </div>
        <div className="mt-2">
          <Tooltip content={<span className="tabular">{formatUzs(row.won.amount)}</span>}>
            <span
              tabIndex={0}
              className="focusable figure-hero inline-block rounded-[var(--radius-panel-sm)]"
              style={{ color: 'var(--ink-primary)' }}
            >
              <AnimatedNumber value={row.won.amount} format={formatCompactUzs} duration={900} />
              <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                soʻm
              </span>
            </span>
          </Tooltip>
        </div>
        {/* A hero number is never blank: the share it holds of the whole
            floor's winnings, and the fraction it was earned from. */}
        {row.sharePercent !== null && totalWon > 0 && (
          <div className="mt-2.5 max-w-[260px]">
            <Meter value={row.sharePercent} tone="neutral" label="Jami yutuqdagi ulushi" />
          </div>
        )}
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {formatNumber(row.wonOrders)} / {formatNumber(row.orders)} ta buyurtma
          {row.conversionPercent !== null && (
            <> · konversiya {formatPercent(row.conversionPercent)}</>
          )}
        </p>
        <div className="mt-2">
          {row.bonus.earned.amount > 0 ? (
            <StatusChip tone="good">{formatCompactUzs(row.bonus.earned.amount)} soʻm bonus</StatusChip>
          ) : row.bonus.toNext !== null ? (
            <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Bonusgacha +{formatCompactUzs(row.bonus.toNext.amount)} kerak
            </span>
          ) : null}
        </div>
      </div>
    )
  }

  const gap = leader.won.amount - row.won.amount
  const closeness = leader.won.amount > 0 ? (row.won.amount / leader.won.amount) * 100 : 0

  return (
    <div
      className={`rounded-[var(--radius-panel-sm)] px-4 py-3 ${seat}`}
      style={{ background: 'var(--surface-sunken)', border: '1px solid var(--border)' }}
    >
      <p className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        <span aria-hidden="true">{medal}</span>
        <span className="sr-only">{place}-oʻrin:</span>
        <span className="ml-1.5">{place}-oʻrin</span>
      </p>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        {name}
        {row.rop && <TeamBadge rop={row.rop} />}
      </div>
      <p className="mt-1.5">
        <Tooltip content={<span className="tabular">{formatUzs(row.won.amount)}</span>}>
          <span
            tabIndex={0}
            className="focusable figure inline-block rounded text-[20px] leading-none font-semibold"
            style={{ color: 'var(--ink-primary)' }}
          >
            {formatCompactUzs(row.won.amount)}
            <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
              soʻm
            </span>
          </span>
        </Tooltip>
      </p>
      {/* The chase, stated as a distance — the one number a runner-up can act
          on — and drawn as closeness to the leader on the shared track. */}
      <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
        Marragacha +{formatCompactUzs(gap)} soʻm
      </p>
      <div
        className="mt-1.5 h-1 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--track)' }}
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(1, closeness)}%`,
            background: 'var(--seq-550)',
            transition: 'width var(--duration-enter) var(--ease-out)',
          }}
        />
      </div>
    </div>
  )
}

/**
 * The pace of the race — the forecast the API always sent and the page never
 * showed. Elapsed time as a meter, the straight-line projection beside it.
 * The projection is a magnitude, not a judgement, so it stays in ink; the
 * service already nulls it once the period is over or before 2% has elapsed,
 * and each of those nulls gets its own honest sentence rather than a dash.
 */
function ForecastStrip({ data }: { data: SellerBoardDto }) {
  const { forecast, totals } = data

  return (
    <div
      className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t pt-3"
      style={{ borderColor: 'var(--grid)' }}
    >
      <div className="flex min-w-[200px] max-w-xs flex-1 items-center gap-2.5">
        <span
          className="text-[11px] whitespace-nowrap"
          style={{ color: 'var(--ink-secondary)' }}
        >
          Davr oʻtdi
        </span>
        <Meter value={forecast.elapsedPercent} tone="neutral" label="Davr oʻtishi" />
      </div>
      <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {forecast.projected !== null ? (
          <>
            Shu surʼatda davr oxirida ≈{' '}
            <Tooltip content={<span className="tabular">{formatUzs(forecast.projected.amount)}</span>}>
              <strong
                tabIndex={0}
                className="tabular focusable rounded font-medium"
                style={{ color: 'var(--ink-primary)' }}
              >
                {formatCompactUzs(forecast.projected.amount)}
              </strong>
            </Tooltip>{' '}
            soʻm yutiladi
          </>
        ) : forecast.elapsedPercent >= 100 ? (
          <>Davr yakunlangan — jadvaldagi natija qatʼiy</>
        ) : (
          <>Prognoz uchun hali erta — davr endi boshlandi</>
        )}
        <span className="mx-1.5">·</span>
        {formatNumber(totals.sellersInBonus)} ta sotuvchi bonus darajasida
      </p>
    </div>
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
  /*
    The denominator the rate was actually computed from. The totals DTO does
    not carry a lost count, so the resolved pool — won plus lost — is reduced
    from the rows; a rate that cannot state its fraction has no business on a
    tile.
  */
  const resolved = data
    ? data.rows.reduce((sum, r) => sum + r.wonOrders + r.lostOrders, 0)
    : null

  return (
    <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
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
      {/*
        Tiles wear rings, table rows wear bars — the one headline rate on this
        band takes the gauge, in the neutral hue: a sales conversion is a
        magnitude here, not a judgement against the house delivery thresholds.
      */}
      <GaugeTile
        label="Konversiya"
        value={totals?.conversionPercent ?? null}
        tone="neutral"
        status={status}
        hint="hal boʻlgan buyurtmalardan — ochiqlari hisobga olinmaydi"
        context={
          totals && resolved !== null && resolved > 0 ? (
            <p className="tabular text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
              {formatNumber(totals.wonOrders)} / {formatNumber(resolved)} ta
            </p>
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

/**
 * 🥇🥈🥉 for the podium, the plain figure below it — and nothing at all when
 * the podium would be decided by the tie-break.
 *
 * A medal claims to follow won money. On a short window where nobody has won
 * anything yet — the first hours of a day, "today" before noon — every row
 * held zero and the top three were whoever the internal id sorted first, so
 * the page handed out gold, silver and bronze for nothing. `ranked` is false
 * for those rows and the column prints a dash.
 */
function Rank({ rank, ranked = true }: { rank: number; ranked?: boolean }) {
  const medal = ranked && rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : null

  return (
    <span
      className="tabular inline-flex w-9 shrink-0 justify-end text-xs font-semibold"
      style={{ color: ranked && rank <= 3 ? 'var(--ink-primary)' : 'var(--ink-muted)' }}
    >
      {!ranked ? (
        <span aria-label="Hali yutilgan puli yoʻq">—</span>
      ) : medal ? (
        <span aria-label={`${rank}-oʻrin`}>{medal}</span>
      ) : (
        rank
      )}
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
  /**
   * The bar's ceiling is the biggest intake on the board, so every row's two
   * layers are read against one scale — and the two layers state exactly the
   * two money columns beside them, intake and won. One bar grammar for the
   * whole page: the drill-down's day bars speak the same pair, so the light
   * and dark steps of the ramp mean the same thing everywhere they appear.
   */
  const ceiling = Math.max(...rows.map((r) => r.ordered.amount), 1)

  return (
    <>
      {/*
        Sixty percent of the screen, then the rows scroll under a pinned header —
        the same bound every DataTable carries. A hundred and ten sellers is six
        thousand pixels, and the application never scrolls as a page.
      */}
      <div className="max-h-[60dvh] overflow-auto">
        <table className="w-full" style={{ minWidth: 940 }}>
          <thead>
            <tr>
              {[
                ['#', 'left'],
                ['Sotuvchi', 'left'],
                ['Komanda', 'left'],
                ['Quvish', 'right'],
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
            {rows.map((row, index) => {
              const open = openSeller === row.employeeId
              return (
                <SellerRows
                  key={row.employeeId}
                  row={row}
                  ahead={index > 0 ? rows[index - 1] : null}
                  chaser={row.rank === 1 ? (rows[1] ?? null) : null}
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
      <p className="mt-2.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        Och chiziq — olingan buyurtma puli, toʻq chiziq — shundan yutilgani.
        Quvish — oldingi oʻrindagiga yetish uchun kerak summa.
      </p>
    </>
  )
}

/**
 * The chase cell — the actionable half of a ranking.
 *
 * A seller's own rank tells them where they stand; the gap to the person
 * DIRECTLY ahead tells them what to do about it, in soʻm, today. When the
 * target is within ten percent it steps up in weight and ink — emphasis for
 * proximity is the goal-gradient the row exists to trigger, and weight is a
 * licensed rank channel where hue is not. The leader has no one ahead and
 * gets the word instead of a number.
 */
function ChaseCell({
  row,
  ahead,
}: {
  row: SellerBoardRowDto
  ahead: SellerBoardRowDto | null
}) {
  if (row.won.amount === 0) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </span>
    )
  }
  if (!ahead) {
    return (
      <span className="text-[11px] font-medium" style={{ color: 'var(--ink-primary)' }}>
        Lider
      </span>
    )
  }

  const gap = ahead.won.amount - row.won.amount
  if (gap === 0) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
        teng
      </span>
    )
  }

  const near = gap <= row.won.amount * 0.1

  return (
    <Tooltip
      content={
        <span className="tabular">
          {ahead.fullName}ga yetish uchun {formatUzs(gap)}
        </span>
      }
    >
      <span
        tabIndex={0}
        className={`tabular focusable rounded text-[11px] whitespace-nowrap ${near ? 'font-medium' : ''}`}
        style={{ color: near ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}
      >
        +{formatCompactUzs(gap)}
      </span>
    </Tooltip>
  )
}

function SellerRows({
  row,
  ahead,
  chaser,
  ceiling,
  open,
  onToggle,
  apiParams,
}: {
  row: SellerBoardRowDto
  ahead: SellerBoardRowDto | null
  chaser: SellerBoardRowDto | null
  ceiling: number
  open: boolean
  onToggle: () => void
  apiParams: Record<string, string | number>
}) {
  const podium = row.rank <= 3 && row.won.amount > 0

  return (
    <>
      <tr
        id={`seller-row-${row.employeeId}`}
        className="border-b"
        style={{
          borderColor: 'var(--grid)',
          /*
            Elevation for rank, never hue: the podium rows sit on a faint
            sunken wash so the top of the table reads as continuous with the
            podium above it. The open drill-down row takes the full token, so
            a click that arrived from the podium visibly lands somewhere.
          */
          background: open
            ? 'var(--surface-sunken)'
            : podium
              ? 'color-mix(in oklab, var(--surface-sunken) 55%, transparent)'
              : undefined,
        }}
      >
        <td className="px-2 py-2">
          <Rank rank={row.rank} ranked={row.won.amount > 0} />
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
            className={`focusable rounded text-left text-[12.5px] underline-offset-2 hover:underline ${
              podium ? 'font-semibold' : 'font-medium'
            }`}
            style={{ color: 'var(--ink-primary)' }}
          >
            {row.fullName}
          </button>
          {/*
            Two lengths on one track, the same grammar as the drill-down's day
            bars: the light layer is the intake this seller took, the dark
            layer the part of it already won — the row's own two money columns,
            drawn. The gap between the layers is the motivational half: it is
            the money still on the road or on the line, and the bottom of the
            table usually has plenty of it.
          */}
          <div
            className="relative mt-1 h-1 w-full max-w-[220px] overflow-hidden rounded-full"
            style={{ background: 'var(--track)' }}
            aria-hidden="true"
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${Math.max(1, (row.ordered.amount / ceiling) * 100)}%`,
                background: 'var(--seq-250)',
                transition: 'width var(--duration-enter) var(--ease-out)',
              }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${Math.max(row.won.amount > 0 ? 1 : 0, (row.won.amount / ceiling) * 100)}%`,
                background: 'var(--seq-550)',
                transition: 'width var(--duration-enter) var(--ease-out)',
              }}
            />
          </div>
        </td>
        <td className="px-2 py-2">
          <TeamBadge rop={row.rop} />
        </td>
        <td className="px-2 py-2 text-right">
          <ChaseCell row={row} ahead={ahead} />
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
          <td colSpan={9} className="px-2 pt-1 pb-4">
            <SellerDetail
              employeeId={row.employeeId}
              row={row}
              ahead={ahead}
              chaser={chaser}
              apiParams={apiParams}
            />
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * The bonus cell: what was earned, or how far the next tier is — WITH its
 * prize. "+3 mln kerak" is a debt; "+3 mln → 1 mln" is a trade, and the trade
 * is what the client's ladder actually offers. Within reach (85%+ of the way)
 * the line steps up in ink and weight — proximity emphasis, never a hue.
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
  const near = bonus.toNextPercent !== null && bonus.toNextPercent >= 85
  return (
    <span
      className={`text-[11px] whitespace-nowrap ${near ? 'font-medium' : ''}`}
      style={{ color: near ? 'var(--ink-secondary)' : 'var(--ink-muted)' }}
    >
      +{formatCompactUzs(bonus.toNext.amount)}
      {bonus.nextBonus !== null && <> → {formatCompactUzs(bonus.nextBonus.amount)}</>}
    </span>
  )
}

/** One seller's days, fetched only when the row is opened. */
function SellerDetail({
  employeeId,
  row,
  ahead,
  chaser,
  apiParams,
}: {
  employeeId: string
  row: SellerBoardRowDto
  /** The seller directly ahead in the ranking — the catchable target. */
  ahead: SellerBoardRowDto | null
  /** For the leader only: the second place, i.e. who is chasing THEM. */
  chaser: SellerBoardRowDto | null
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
  const ranked = row.won.amount > 0

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

      {/*
        Keyingi marralar — this seller's own two races, each as a distance.
        The rank chase names the person directly ahead (catchable, unlike the
        leader for someone mid-table); the bonus chase names the rung and its
        prize. The leader has no one to chase, so their line states who is
        chasing them — first place should feel pursued, not finished.
      */}
      {ranked && (
        <div className="mt-2.5 max-w-md space-y-2">
          {ahead ? (
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                  Oldingizda: {ahead.fullName} — yetish uchun{' '}
                  {ahead.won.amount - row.won.amount === 0 ? (
                    <>teng, bitta yutuq hal qiladi</>
                  ) : (
                    <strong className="tabular font-medium" style={{ color: 'var(--ink-primary)' }}>
                      +{formatCompactUzs(ahead.won.amount - row.won.amount)}
                    </strong>
                  )}
                </span>
              </div>
              {ahead.won.amount > 0 && (
                <div className="mt-1">
                  <Meter
                    value={(row.won.amount / ahead.won.amount) * 100}
                    tone="neutral"
                    label="Oldingi oʻringa yaqinlik"
                  />
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
              Siz liderisiz
              {chaser && chaser.won.amount > 0 && (
                <>
                  {' '}— 2-oʻrin{' '}
                  <strong className="tabular font-medium" style={{ color: 'var(--ink-primary)' }}>
                    {formatCompactUzs(row.won.amount - chaser.won.amount)}
                  </strong>{' '}
                  orqada
                </>
              )}
            </p>
          )}

          {row.bonus.nextFloor !== null && row.bonus.toNextPercent !== null && (
            <div>
              {/* The meter prints the percentage itself — a second copy of the
                  same figure at a different rounding would read as two facts. */}
              <span className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                Keyingi daraja {formatCompactUzs(row.bonus.nextFloor.amount)}: yana{' '}
                {row.bonus.toNext ? `+${formatCompactUzs(row.bonus.toNext.amount)}` : NO_VALUE} kerak
                {row.bonus.nextBonus && (
                  <> → {formatCompactUzs(row.bonus.nextBonus.amount)} bonus</>
                )}
              </span>
              <div className="mt-1">
                <Meter value={row.bonus.toNextPercent} tone="neutral" label="Keyingi darajaga" />
              </div>
            </div>
          )}
          {/* Past the top rung: the ladder is climbed, and that is a state. */}
          {row.bonus.nextFloor === null && row.bonus.earned.amount > 0 && (
            <StatusChip tone="good">
              Eng yuqori daraja — {formatCompactUzs(row.bonus.earned.amount)} soʻm bonus
            </StatusChip>
          )}
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
  // The same one-scale rule as the sellers' table: the ceiling is the biggest
  // intake, and the two layers are the row's own intake and won columns.
  const ceiling = Math.max(...rows.map((r) => r.ordered.amount), 1)

  return (
    <>
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
            {rows.map((row) => {
              const podium = row.rank <= 3 && row.won.amount > 0
              return (
                <tr
                  key={row.rop}
                  className="border-b"
                  style={{
                    borderColor: 'var(--grid)',
                    background: podium
                      ? 'color-mix(in oklab, var(--surface-sunken) 55%, transparent)'
                      : undefined,
                  }}
                >
                  <td className="px-2 py-2">
                    <Rank rank={row.rank} ranked={row.won.amount > 0} />
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={`text-[12.5px] ${podium ? 'font-semibold' : 'font-medium'}`}
                      style={{ color: 'var(--ink-primary)' }}
                    >
                      {row.rop}
                    </span>
                    <div
                      className="relative mt-1 h-1 w-full max-w-[240px] overflow-hidden rounded-full"
                      style={{ background: 'var(--track)' }}
                      aria-hidden="true"
                    >
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${Math.max(1, (row.ordered.amount / ceiling) * 100)}%`,
                          background: 'var(--seq-250)',
                          transition: 'width var(--duration-enter) var(--ease-out)',
                        }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${Math.max(row.won.amount > 0 ? 1 : 0, (row.won.amount / ceiling) * 100)}%`,
                          background: 'var(--seq-550)',
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
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        Och chiziq — olingan buyurtma puli, toʻq chiziq — shundan yutilgani.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------

/**
 * The ladder itself, printed once so the rule is on the page rather than in
 * somebody's memory — and attributed, because it is the client's policy and
 * not a figure this application measured.
 *
 * ASCENDING, left to right. Read downward a ladder is a ranking of tiers;
 * read upward it is a climb, and the next rung is always the one to the
 * right of where you stand. Each rung wears a rail from the sequential ramp
 * — the MAGNITUDE of its own floor, which is the licensed ordinal encoding —
 * and names the seller closest to reaching it, because "Aziza is 2 mln away
 * from the next rung" is a sentence a floor repeats to itself all afternoon.
 */
function BonusLadder({
  data,
  status,
}: {
  data: SellerBoardDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  const tiers = [
    { floor: 45_000_000, bonus: 1_000_000, rail: 'var(--seq-250)' },
    { floor: 60_000_000, bonus: 1_500_000, rail: 'var(--seq-450)' },
    { floor: 70_000_000, bonus: 2_000_000, rail: 'var(--seq-650)' },
  ]

  const ready = status === 'ready' && data

  const reached = (floor: number) =>
    ready ? data.rows.filter((r) => r.won.amount >= floor).length : null

  /** The highest-won seller still below this rung — the one about to arrive. */
  const nearest = (floor: number) => {
    if (!ready) return null
    let best: SellerBoardRowDto | null = null
    for (const r of data.rows) {
      if (r.won.amount > 0 && r.won.amount < floor && (!best || r.won.amount > best.won.amount)) {
        best = r
      }
    }
    return best
  }

  return (
    <section className="space-y-2.5">
      <SectionHeader
        title="Bonus darajalari"
        hint="Mijozning oʻz qoidasi — yutilgan buyurtma puli boʻyicha"
      />
      <div className="stagger grid gap-3 sm:grid-cols-3">
        {tiers.map((tier) => {
          const count = reached(tier.floor)
          const contender = nearest(tier.floor)
          return (
            <div key={tier.floor} className="card flex flex-col gap-1 overflow-hidden">
              {/* The rung's rail: tier height on the ordinal ramp — the floor's
                  magnitude, not anybody's rank. */}
              <div
                className="h-[3px] w-full"
                style={{ background: tier.rail }}
                aria-hidden="true"
              />
              <div className="flex flex-col gap-1 px-4 pt-2.5 pb-3.5">
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
                {/* The next arrival, by name: the rung's own little race. */}
                {contender && (
                  <p className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                    Eng yaqini: {contender.fullName} —{' '}
                    <span className="tabular font-medium" style={{ color: 'var(--ink-primary)' }}>
                      +{formatCompactUzs(tier.floor - contender.won.amount)}
                    </span>{' '}
                    kerak
                  </p>
                )}
              </div>
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
