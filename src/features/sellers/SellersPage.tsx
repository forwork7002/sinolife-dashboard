'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card } from '@/components/ui/Card'
import { SearchInput } from '@/components/ui/Controls'
import { GaugeTile, Meter, SectionHeader, StatTile, StatusChip } from '@/components/ui/Stat'
import { InfoTip, Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { SellerDaysChart } from '@/features/sellers/SellerDaysChart'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  type SellerBoardDto,
  type SellerBoardRowDto,
  type SellerDayDto,
  type SellerPlanDto,
  type SellerTeamRowDto,
  apiGet,
} from '@/lib/api'
import {
  NO_VALUE,
  formatFullUzs,
  formatDate,
  formatNumber,
  formatPercent,
  formatUzs,
} from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Sotuvchilar reytingi — who brought the work in, and what it earned them.
 *
 * A PORT of the client's own published sellers dashboard — the board their
 * floor already reads every morning. Every function that page has is here:
 * the month bar, the ranked table in their column order and their words
 * (FAKT 2, FAKT 1, Tranz., Lid, Konv., Plan bajarish, Prognoz), the teams
 * view over the same columns, the per-seller card grid, the bonus ladder with
 * the band it is actually paid on, and the daily dynamics chart.
 *
 * FOUR DELIBERATE DEPARTURES, each one a place their page and this one had to
 * disagree, and each one recorded here rather than argued again later:
 *
 * 1. THE MONTH BAR WRITES THE SHARED WINDOW. Their months are private to that
 *    page. Here a month button writes `preset=custom` into the dashboard's own
 *    URL, so it lands in the address bar, survives a refresh and can be pasted
 *    into Telegram — a shortcut to the period control, not a second opinion
 *    about "now".
 *
 * 2. NO PER-PERSON TAB STRIP. Their nav carries one tab per operator; on this
 *    portal that is 128 tabs in a row that scrolls sideways forever. The job
 *    those tabs do is "find me", so the table takes a name filter instead and
 *    the row's own drill-down is the person page. Rank and share still come
 *    from the whole board, so a filtered view never promotes anyone.
 *
 * 3. NO ROP COLOUR CODING. Their page paints each ROP a hue from a
 *    thirteen-entry map. Two reasons it is not carried, and the second is the
 *    decisive one: this design system caps categorical identity at eight slots
 *    because past that the hues stop being distinguishable under
 *    colourblindness — AND their map is already stale against this portal.
 *    `department.get` returns fifteen (ROP) teams today; their map names ten
 *    of them and three of its entries (Husniddin, Shohjaxon, Vohidjon) no
 *    longer exist, so painting by it would leave Lola, Maftuna, Kompaniya,
 *    Asliddin and NEW grey. The team rides as a text badge: unlimited,
 *    readable, and never out of date.
 *
 * 4. THE DAILY CHART IS TWO PANELS, NOT ONE DUAL-AXIS PLOT — see
 *    `SellerDaysChart`, which carries the reasoning.
 *
 * THREE COLUMNS ARE ON SCREEN AND EMPTY, on purpose: Lid, Plan bajarish and
 * FOT. Their page fills the first two from a source outside Bitrix24 and the
 * third from payroll, and none of the three is in this database today. They
 * are rendered as em dashes that say why rather than left off, because a
 * column that states its own gap is a question somebody can answer — and a
 * zero would be an answer, the wrong one. What each would need is written on
 * the DTO field it belongs to.
 *
 * THIS PAGE IS THE RACE, and the design treats it as one. The floor opens it
 * to see who is first and what it takes to catch them, so the screen leads
 * with a podium — the page's one hero instrument, which this screen alone had
 * been missing — and every row below it names the seller's own next target:
 * the person directly ahead in soʻm, the next bonus rung in soʻm. Distances,
 * never ordinals: "+2,1 mln kerak" is something a seller can act on today,
 * "siz 47-siz" is something they can only feel bad about.
 *
 * TWO CLOCKS, QUEUE FIRST. The default reading is the floor's own FAKT 1 /
 * FAKT 2 — (Тасдиқланди + Тасдиқланмай чиқди) and Доставланди, every figure dated by the order's
 * arrival in the confirmation queue (C4:NEW), the same cohort the Tasdiqlash
 * board runs on. The client stated these definitions directly on 2026-09-03.
 * The original intake reading (dated by the day the ORDER WAS TAKEN) stays
 * behind the «Yaratilgan sana» toggle as the one figure measured against
 * their published dashboard to 0.1% (see `sellerBoardRepository`) — the
 * oracle a queue regression gets checked against, not the default anyone
 * reads. Either way this board's totals are nothing like Savdo dinamikasi's
 * delivered revenue (3.89 bn of July intake vs 0.98 bn delivered, same month,
 * same deals), so the caption under the totals states the basis in force —
 * a reader reconciling two true numbers must not conclude one is broken.
 *
 * NO ROP COLOUR CODING, and that is a deliberate departure. Their page paints
 * each ROP its own hue from a thirteen-colour map; this design system caps
 * categorical identity at eight slots because past that the hues stop being
 * distinguishable under colourblindness, and generating a ninth is the one
 * thing the palette rule forbids outright. The team rides as a text badge
 * instead: unlimited, readable, and legible to everyone.
 *
 * RANK WEARS METAL — AS CHROME, NEVER AS A CHANNEL. The first cut of this
 * screen kept rank hueless (weight, size, elevation, the emoji medals and
 * nothing else), and the client overruled it on 2026-09-03: this is the page
 * the sellers themselves open, and it must feel like a ceremony — three
 * unmistakable cards, gold on top. The compromise that keeps the palette
 * honest lives in the --medal-* tokens and the PODIUM section of globals.css:
 * the metals touch rims, washes, avatar rings and the pedestal numerals —
 * chrome — and never text that must be read, never a mark that encodes a
 * value (the closeness bars stay on the sequential ramp), never a series or
 * status role. They also stop at the three places the medal emoji already
 * paint, so a colourblind reader loses nothing: size, elevation, position
 * and the ordinal still carry the rank entirely on their own.
 */
export function SellersPage() {
  const { apiParams: filterParams } = useDashboardFilters()
  const [tab, setTab] = useState<'sellers' | 'teams'>('sellers')
  const [openSeller, setOpenSeller] = useState<string | null>(null)
  /**
   * The name filter — this port's answer to their per-person tab strip.
   *
   * Their page puts one tab in the nav for every operator, which on this
   * portal would be 128 of them in a row that scrolls sideways forever. The
   * job those tabs actually do is "find me", and a search box does it in one
   * keystroke instead of a horizontal hunt. The row's own drill-down is still
   * the person page, so nothing is lost but the scrolling.
   *
   * IT FILTERS, IT DOES NOT RE-RANK. Rank, share and the podium all come from
   * the whole board, so a filtered view shows a seller their real position
   * rather than making everyone who searches their own name number one.
   */
  const [query, setQuery] = useState('')
  /**
   * Which clock the board reads — see `?basis=` on `/analytics/sellers`.
   *
   * A page-local toggle, not a `useDashboardFilters` entry: the basis is a
   * question this screen alone asks, not a window every screen shares, and
   * `reset()` clearing it back to the floor's own definition is the right
   * behaviour rather than a bug to route around.
   */
  /*
    ONE CLOCK ON SCREEN. The board reads the floor's own FAKT 1 / FAKT 2 —
    Тасдиқланди + Тасдиқланмай чиқди and Доставланди, dated by the arrival in
    C4:NEW — and there is
    no longer a control to change it. The 'intake' reading still exists behind
    `?basis=intake` because it is the figure measured against the client's own
    published dashboard and so the oracle a regression gets checked against;
    it is not a second board the floor was ever meant to read, and a toggle
    offering it invited exactly that.
  */
  const basis = 'queue' as const
  const apiParams = useMemo(() => ({ ...filterParams, basis }), [filterParams, basis])

  const board = useQuery({
    queryKey: ['sellers', 'board', apiParams],
    queryFn: ({ signal }) => apiGet<SellerBoardDto>('/analytics/sellers', apiParams, signal),
    placeholderData: (previous) => previous,
  })

  const data = board.data?.data
  const status = board.isPending ? 'loading' : board.isError ? 'error' : 'ready'

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!data) return []
    if (!needle) return data.rows
    return data.rows.filter(
      (row) =>
        row.fullName.toLowerCase().includes(needle) ||
        (row.rop ?? '').toLowerCase().includes(needle),
    )
  }, [data, query])

  /*
    The per-row Prognoz divisor — the client's own `forecast()` carried over
    from their published page, where it is a COLUMN, not just a footer line.
    One divisor for the whole board (elapsed fraction of the period), gated by
    the same nulls the service applies to the global projection: no forecast
    once the period is over, none below the 2% floor where one early order
    multiplies into a fantasy. Division happens on the lossy display amount
    because a projection is an estimate by construction — see MoneyDto.
  */
  const projectionDivisor =
    data && data.forecast.projected !== null && data.forecast.elapsedPercent > 0
      ? data.forecast.elapsedPercent / 100
      : null

  /*
    The span the targets were set for, printed beside every plan figure.

    A target is a contract for a stated period, not a rate to be sliced to
    whatever window the reader picked — `/kpi` learned that the expensive way.
    So when the board scores a monthly plan under «Bugun», the tile says which
    month it is scoring against instead of letting the reader assume the plan
    is today's. Absent when no target covers the window, which is every window
    until somebody sets one.
  */
  const planWindowHint = data?.planWindow
    ? // Half-open, like every window in this product: the last INSTANT belongs
      // to the previous day, so an August plan must read «1-avg — 31-avg» and
      // not «1-avg — 1-sen». Same subtraction PageShell makes on the period line.
      `Reja davri: ${formatDate(data.planWindow.start)} — ${formatDate(
        new Date(new Date(data.planWindow.end).getTime() - 1).toISOString(),
      )}`
    : undefined

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
      description="Kim qancha sotdi — FAKT 1 / FAKT 2, navbatga tushgan sana boʻyicha"
      meta={board.data?.meta}
      stale={board.isPlaceholderData}
      accent="var(--series-5)"
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
            tasdiqlash navbatiga tushgan sana</strong> (C4:NEW) boʻyicha.{' '}
            <strong style={{ color: 'var(--ink-secondary)' }}>FAKT 1</strong> —{' '}
            <strong style={{ color: 'var(--ink-secondary)' }}>Тасдиқланди</strong> va{' '}
            <strong style={{ color: 'var(--ink-secondary)' }}>Тасдиқланмай чиқди</strong>:
            navbatdan chiqib Доставка ga oʻtgan buyurtmalar puli — mijozga yetib tasdiqlanganlari
            ham, mijozga yetib boʻlmay, lekin baribir joʻnatilganlari ham.{' '}
            <strong style={{ color: 'var(--ink-secondary)' }}>FAKT 2</strong> —{' '}
            <strong style={{ color: 'var(--ink-secondary)' }}>Доставланди</strong>: yetkazib
            berilganlari.{' '}
            {/*
              THE TWO ARE SIBLINGS, NOT A WHOLE AND ITS PART, and this sentence
              is the one that has to say so. The page previously read «FAKT 2,
              shundan Доставланди» — "of which" — and then printed 57.6 mln
              beside 58.8 mln, which reads as a broken page rather than as the
              fact it is.

              The example the sentence used to give — an order shipped
              Тасдиқланмай чиқди — is now INSIDE FAKT 1 (see `FAKT1_OUTCOMES`),
              so it names the case that is still outside: an order refused in
              the queue and revived afterwards.
            */}
            FAKT 2 — FAKT 1 ning bir qismi emas: navbatda rad etilgan buyurtma keyin tiklanib
            yetkazilsa FAKT 2 ga tushadi-yu, FAKT 1 ga kirmaydi, shuning uchun FAKT 2 baʼzan
            FAKT 1 dan katta boʻlishi mumkin. Iyul oyida jonatilib avgustda yetkazilgan buyurtma FAKT 2 ga
            avgustda emas, iyulning oʻzida qoʻshiladi va oy yopilgandan keyin ham oʻsishda davom
            etishi mumkin — chunki sana buyurtma navbatga TUSHGAN kunni bildiradi, YETKAZILGAN
            kunni emas. Rad etilgan (Тасдиқланмади), hali navbatda turgan va koʻtarmagan
            buyurtmalar FAKT 1 ga kirmaydi.
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
          <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
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

            {/*
              Their per-person tab strip, as one box. See `query`.

              Full width on its own line below sm, 192px beside the two tabs
              from there up. Fixed at 192px it was the widest thing on the
              page at 360px: the row ran 61px past main, which clips rather
              than scrolls, so on a phone the seller search was not narrow —
              it was off the screen entirely.
            */}
            {tab === 'sellers' && (
              <div className="w-full sm:ml-1 sm:w-48">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Sotuvchi yoki ROP…"
                />
              </div>
            )}
          </div>

          {data && status === 'ready' && (
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {tab === 'sellers'
                ? query.trim()
                  ? `${formatNumber(visibleRows.length)} / ${formatNumber(data.rows.length)} ta sotuvchi — oʻrin va ulush butun jadval boʻyicha`
                  : sellersCaption(data)
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
            visibleRows.length === 0 ? (
              <EmptyState
                title="Bu nom topilmadi"
                body="Qidiruvni oʻzgartiring — bu davrdagi sotuvchilar orasida bunday nom yoʻq."
              />
            ) : (
            <SellerTable
              rows={visibleRows}
              openSeller={openSeller}
              onToggle={(id) => setOpenSeller((current) => (current === id ? null : id))}
              apiParams={apiParams}
              projectionDivisor={projectionDivisor}
              planWindowHint={planWindowHint}
            />
            )
          ) : (
            <TeamTable rows={data.teams} projectionDivisor={projectionDivisor} />
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
  const base = `${formatNumber(data.totals.sellers)} ta sotuvchi`

  /*
    THE YOUNG-WINDOW STATE, SAID OUT LOUD.

    Delivery takes days, so on «Bugun» — and on any window opened before the
    first courier arrives — every row holds zero FAKT 2, the ranking has
    nothing to sort on and the whole rank column is em dashes. That is correct
    and it looks broken. Naming it turns a dead-looking board into a board
    that is waiting, which is what it actually is.
  */
  if (data.totals.won.amount === 0) {
    return data.totals.ordered.amount > 0
      ? `${base} — ${formatFullUzs(data.totals.ordered.amount)} soʻm tasdiqlangan, hali hech biri yetkazilmagan. Reyting FAKT 2 toʻlgani sayin shakllanadi.`
      : `${base} — bu davrda hali harakat yoʻq.`
  }

  const near = data.rows.filter(
    (r) => r.bonus.toNextPercent !== null && r.bonus.toNextPercent >= 90,
  ).length
  const withMoney = data.rows.filter((r) => r.won.amount > 0).length

  const body = `${base} · ${formatNumber(withMoney)} tasida FAKT 2 bor`
  return near > 0
    ? `${body} · ${formatNumber(near)} tasi bonus darajasiga 90%+ yaqin`
    : body
}

// ---------------------------------------------------------------------------
// The podium — the page's one hero instrument
// ---------------------------------------------------------------------------

/**
 * The morning ceremony: the champion across the hall, the chasers beneath.
 *
 * One `.card-hero` (the hall), one `.figure-hero` — the leader's won money,
 * which is THE number this page exists to make people want. First place is a
 * full-width BANNER, a shape nothing else on the page has, so it is found by
 * form before a single word is read; second and third stand under it as two
 * smaller horizontal cards. Rank travels on scale (avatar, name, figure all
 * step down), position (above vs below, left vs right), the ordinal in the
 * ring, the ghost numeral, and the base rail thinning 4→3→2px; the medal
 * metals varnish it (see the header contract — chrome, never a channel). DOM
 * order is 1-2-3 with no CSS re-seating, so reading order, the stagger and
 * the visual order agree.
 *
 * MEDALS ONLY FOR WON MONEY — the table's `ranked` rule, enforced here by
 * construction: a row with neither FAKT 2 nor FAKT 1 has done nothing to
 * rank, and the open-gate state appears instead of gold handed out on a
 * tie-break. Where FAKT 2 is still zero across the floor — most of a working
 * day, since delivery takes days — the places are decided by FAKT 1 and each
 * card says so, rather than leading with a zero about a real person.
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
  /*
    THE TOP THREE OF WHOEVER HAS MONEY, not only of whoever has delivered.

    Delivery takes days, so for most of a working day nobody has FAKT 2 and
    the podium stood empty over a floor that had confirmed 148 mln soʻm
    between 55 people. The board ranks FAKT 2 first and FAKT 1 second — the
    client's own rule — so the podium shows the same three people the table
    puts on top, and the card states which figure earned the place.
  */
  const winners = data
    ? data.rows.filter((r) => r.won.amount > 0 || r.ordered.amount > 0).slice(0, 3)
    : []

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
              <span aria-hidden="true" className="mr-1.5">🏆</span>
              Davr peshqadamlari
            </h2>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Avval FAKT 2 (yetkazilgan), teng boʻlsa FAKT 1 (tasdiqlangan) boʻyicha
            </p>
          </header>

          {status === 'loading' ? (
            /* Sized to the ready layout, so ready never reflows loading:
               one banner-height block, then the two runner cards. */
            <div className="mt-4 grid gap-3 sm:gap-4" role="status">
              <span className="sr-only">Yuklanmoqda</span>
              <div className="skeleton h-48 sm:h-40" aria-hidden="true" />
              <div className="grid gap-3 sm:gap-4 sm:grid-cols-2" aria-hidden="true">
                <div className="skeleton h-44" />
                <div className="skeleton h-44" />
              </div>
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
                <span aria-hidden="true" className="mr-1">🏁</span>
                Podium hali boʻsh — oʻrinlar hammaga ochiq
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                Birinchi yutilgan buyurtma podiumni yoqadi. Hozircha olingan buyurtma puli:
              </p>
              <div className="mt-2.5">
                {/* No tooltip and no tab stop: the figure IS the exact soʻm —
                    see `formatFullUzs`. */}
                <span
                  className="figure-hero figure-sum-hero inline-block"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  <AnimatedNumber value={data.totals.ordered.amount} format={formatFullUzs} />
                  <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                    soʻm
                  </span>
                </span>
              </div>
              <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {formatNumber(data.totals.orders)} ta buyurtma olingan — gʻolib hali aniqlanmagan
              </p>
            </div>
          ) : (
            <>
              {/*
                THE CHAMPION IS A BANNER, THE CHASERS ARE CARDS.

                Three near-identical columns asked the reader to compare
                heights to find first place; now the three places have three
                different FORMS. Gold spans the whole hall in its own
                horizontal banner — nothing else on the page has that shape —
                and silver and bronze stand under it as two cards whose size,
                metal and giant ghost numeral each restate their rank. DOM
                order is 1-2-3 with no CSS re-seating: the reading order, the
                stagger and the visual order finally agree.
              */}
              <div className="stagger mt-4 grid gap-3 sm:gap-4">
                <ChampionBanner
                  row={winners[0]}
                  totalWon={data.totals.won.amount}
                  onDelivered={winners[0].won.amount > 0}
                  onOpen={() => onOpenSeller(winners[0].employeeId)}
                />
                {winners.length > 1 && (
                  <div
                    className={`grid gap-3 sm:gap-4 ${
                      winners.length === 3 ? 'sm:grid-cols-2' : 'sm:mx-auto sm:w-full sm:max-w-md'
                    }`}
                  >
                    {winners.slice(1).map((row, index) => (
                      <RunnerCard
                        key={row.employeeId}
                        row={row}
                        place={index + 2}
                        leader={winners[0]}
                        onDelivered={winners[0].won.amount > 0}
                        onOpen={() => onOpenSeller(row.employeeId)}
                      />
                    ))}
                  </div>
                )}
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
 * The chasing seats' chrome, by place. Gold has no row here on purpose: the
 * champion is a different FORM — the full-width banner — not the big end of
 * this scale, so reading rank never requires comparing near-equals. Between
 * silver and bronze the scale still steps: avatar, name and figure all
 * shrink one notch, and the base rail under the card loses a pixel.
 */
const RUNNER_SEATS = [
  {
    col: 'podium-col--silver',
    medal: '🥈',
    avatar: 50,
    nameClass: 'text-[14.5px]',
    figureClass: '',
  },
  {
    col: 'podium-col--bronze',
    medal: '🥉',
    avatar: 42,
    nameClass: 'text-[13px]',
    figureClass: 'figure-sum-runner--bronze',
  },
] as const

/**
 * The metal chrome tokens by place, for the table rows that echo the podium.
 * Chrome only — see the header contract: a wash and a stripe, never a mark.
 */
const MEDAL_TOKENS = [
  'var(--medal-gold)',
  'var(--medal-silver)',
  'var(--medal-bronze)',
] as const

/**
 * The face of a ceremony card: the seat's number in its own metal ring, and
 * a crown on the champion — the floor should see WHICH PLACE it is looking at
 * before it reads a name, and the name is written in full immediately below.
 * All of it decorative; see the note inside for what carries the rank.
 */
function PodiumAvatar({
  place,
  size,
  crowned = false,
}: {
  place: number
  size: number
  crowned?: boolean
}) {
  /*
    THE RING HOLDS THE PLACE, NOT THE PERSON.

    It used to hold two initials, and the client's note on 2026-09-04 is the
    right reading of it: the name is written in full immediately below, so the
    letters said nothing the card had not already said, and on this portal
    they were often wrong anyway — the floor badge is a number, so
    «Sirojov 115 Davlatbek» came out «S1». The one fact the seat has that the
    name does not is WHICH SEAT IT IS, and that is now what it shows, set in
    the seat's own metal.

    Still decorative: the plaque beside it spells «N-oʻrin» for a screen
    reader and the ghost numeral repeats it, so nothing here is the only
    carrier of the rank.
  */
  return (
    <span className="relative inline-flex" aria-hidden="true">
      {crowned && (
        <span
          /* Drops in once, after the shine has crossed the card — the
             ceremony's last beat, not its first. Reuses `.rise` rather than a
             bespoke keyframe so it inherits the house's one motion rule for
             free: nothing here plays under reduced motion. */
          className="rise absolute z-[1] leading-none"
          style={{
            top: -15,
            left: '50%',
            transform: 'translateX(-50%) rotate(-12deg)',
            fontSize: 18,
            animationDelay: '650ms',
          }}
        >
          👑
        </span>
      )}
      {/* The champion's ring carries a wider halo than the chrome shared with
          silver and bronze — see `.medal-ring--crowned`: still the seat's own
          metal, just lit brighter, the way the actual centre step is. */}
      <span className={`medal-ring ${crowned ? 'medal-ring--crowned' : ''}`}>
        <span
          className="tabular flex items-center justify-center rounded-full font-extrabold"
          style={{
            width: size,
            height: size,
            background: 'var(--surface-raised)',
            color: 'var(--metal)',
            fontSize: Math.round(size * 0.52),
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}
        >
          {place}
        </span>
      </span>
    </span>
  )
}

/**
 * A seller's name as the card's one action.
 *
 * `podium-name` is a hit-slop hook, not a style: `.podium-name::before` pads
 * the tap target a good ten pixels past the text on every side with an
 * absolutely-positioned layer, so a thumb aiming just off the letters still
 * opens the drill-down. `position: relative` is load-bearing for that
 * overlay. It also doubles as the hook the CARD lifts on — see
 * `.podium-card:has(.podium-name:hover)`.
 */
function PodiumName({
  fullName,
  onOpen,
  className,
}: {
  fullName: string
  onOpen: () => void
  className: string
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`podium-name focusable relative rounded font-semibold underline-offset-2 hover:underline ${className}`}
      style={{ color: 'var(--ink-primary)' }}
    >
      {fullName}
    </button>
  )
}

/**
 * First place, as a banner across the whole hall.
 *
 * Nothing else on the page has this shape, which is the point: the champion
 * is found by FORM before any label is read. Ring and crown on the left, the
 * name and the full-digit sum in the middle at the page's largest reading,
 * and the story of the win — share, orders, bonus — in its own column on the
 * right. A giant ghost «1» in the card's own metal fills the quiet corner,
 * the one-time shine still crosses on arrival, and the thickest base rail of
 * the three closes the bottom edge like the top step of a real podium.
 */
function ChampionBanner({
  row,
  totalWon,
  onDelivered,
  onOpen,
}: {
  row: SellerBoardRowDto
  totalWon: number
  /*
    THE CARD SHOWS THE FIGURE THAT EARNED THE PLACE. Ranking reads FAKT 2
    first and FAKT 1 second, so for most of a working day — before the first
    courier arrives — the places are decided by FAKT 1, and a banner leading
    with «0 soʻm» would be reporting the wrong number about the right person.
    Computed once in PodiumHero so the three cards can never disagree on it.
  */
  onDelivered: boolean
  onOpen: () => void
}) {
  const figure = onDelivered ? row.won.amount : row.ordered.amount

  return (
    <div className="podium-col--gold">
      <div className="podium-card podium-banner flex flex-col items-center gap-4 px-5 py-5 text-center sm:flex-row sm:gap-6 sm:px-7 sm:text-left">
        {/* The ghost numeral, clipped by its own layer so the card never
            needs overflow:hidden — same construction as .podium-shine. */}
        <div className="podium-ghost" aria-hidden="true">
          <span className="podium-ghost-num">1</span>
        </div>

        <div className="relative shrink-0">
          {/* The ring's own light pooling behind it — static, like the halo
              on the ring itself; see .podium-aura for why it never pulses. */}
          <span className="podium-aura" aria-hidden="true" />
          <PodiumAvatar place={1} size={76} crowned />
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start">
            <p className="podium-plaque">
              <span aria-hidden="true">🥇</span>
              <span className="sr-only">1-oʻrin:</span>
              <span aria-hidden="true">1-oʻrin · Chempion</span>
            </p>
            {/* Inline beside a name, an absent team is silence, not a dash —
                the placeholder belongs to the table column. */}
            {row.rop && <TeamBadge rop={row.rop} />}
          </div>
          <div className="mt-1.5">
            <PodiumName fullName={row.fullName} onOpen={onOpen} className="text-[19px] sm:text-[22px]" />
          </div>
          <div className="mt-1">
            {/* THE WHOLE SUM — no tooltip, no tab stop; the digits ARE the
                reading this board reconciles against the floor's own. */}
            <span
              className="figure-hero figure-sum-hero inline-block"
              style={{ color: 'var(--ink-primary)' }}
            >
              <AnimatedNumber value={figure} format={formatFullUzs} duration={900} />
              <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                soʻm
              </span>
            </span>
            {/* The stand under the number: a short gold rule, the banner's
                one flourish that is pure metal — licensed because the figure
                above it already states the value in ink. */}
            <div className="podium-gold-rule mx-auto mt-2 sm:mx-0" aria-hidden="true" />
            {/* Which of the two put them here. Silent on the delivered
                reading — the one every other label on the page assumes. */}
            {!onDelivered && (
              <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                FAKT 1 · tasdiqlangan
              </p>
            )}
          </div>
        </div>

        {/* The story column: what the number is made of, and what is still
            ahead of them — a champion with nothing left to chase is a page
            that stops motivating exactly at the top. A metal hairline seats
            it as its own panel: left of the column from sm, above it when
            the banner stacks on a phone. */}
        <div className="podium-story relative w-full shrink-0 sm:w-[230px]">
          {row.sharePercent !== null && totalWon > 0 && (
            <div>
              <p className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                Jami yutuqdagi ulushi
              </p>
              <div className="mt-1">
                <Meter value={row.sharePercent} tone="neutral" label="Jami yutuqdagi ulushi" />
              </div>
            </div>
          )}
          <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {formatNumber(row.wonOrders)} / {formatNumber(row.orders)} ta buyurtma
            {row.conversionPercent !== null && (
              <> · konversiya {formatPercent(row.conversionPercent)}</>
            )}
          </p>
          <div className="mt-2">
            {row.bonus.earned.amount > 0 ? (
              <StatusChip tone="good">
                {formatFullUzs(row.bonus.earned.amount)} soʻm bonus
              </StatusChip>
            ) : row.bonus.toNext !== null ? (
              /*
                THE SAME "how close" GRAMMAR AS THE RUNNERS' CHASE BAR, one
                rung up: they read distance to the leader, the leader reads
                distance to the next reward. `toNextPercent` is the service's
                own figure (`sellerBonus.ts`), so the fill can never disagree
                with the soʻm caption beside it.
              */
              <div>
                <p className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                  <span aria-hidden="true">🎁</span> Bonusgacha{' '}
                  <span className="tabular" style={{ color: 'var(--ink-primary)' }}>
                    +{formatFullUzs(row.bonus.toNext.amount)}
                  </span>
                </p>
                {row.bonus.toNextPercent !== null && (
                  <div
                    className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
                    style={{ background: 'var(--track)' }}
                    aria-hidden="true"
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, row.bonus.toNextPercent)}%`,
                        background: 'var(--metal)',
                        transition: 'width var(--duration-enter) var(--ease-out)',
                      }}
                    />
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Last child, so the streak passes over the whole banner. */}
        <div className="podium-shine" aria-hidden="true" />
      </div>
    </div>
  )
}

/**
 * Second and third place: one horizontal card each, under the banner.
 *
 * The same anatomy at a smaller scale — ring, plaque, name, the full-digit
 * sum — then the card's one motivating fact: the gap to the top as a tinted
 * chip and a closeness bar on the sequential ramp, because "how close" is a
 * magnitude and the metal is not licensed to say it. Silver and bronze are
 * separated the same way gold is separated from both: scale (avatar, name,
 * figure all one notch down), the metal chrome, the ghost numeral, and a
 * base rail one pixel thinner.
 */
function RunnerCard({
  row,
  place,
  leader,
  onDelivered,
  onOpen,
}: {
  row: SellerBoardRowDto
  place: number
  leader: SellerBoardRowDto
  onDelivered: boolean
  onOpen: () => void
}) {
  const spec = place === 2 ? RUNNER_SEATS[0] : RUNNER_SEATS[1]
  const figure = onDelivered ? row.won.amount : row.ordered.amount
  const leaderFigure = onDelivered ? leader.won.amount : leader.ordered.amount

  const gap = leaderFigure - figure
  const closeness = leaderFigure > 0 ? (figure / leaderFigure) * 100 : 0

  return (
    <div className={spec.col}>
      <div className="podium-card flex items-center gap-4 px-4 py-4">
        <div className="podium-ghost" aria-hidden="true">
          <span className="podium-ghost-num podium-ghost-num--runner">{place}</span>
        </div>

        <div className="relative shrink-0">
          <PodiumAvatar place={place} size={spec.avatar} />
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="podium-plaque">
              <span aria-hidden="true">{spec.medal}</span>
              <span className="sr-only">{place}-oʻrin:</span>
              <span aria-hidden="true">{place}-oʻrin</span>
            </p>
            {row.rop && <TeamBadge rop={row.rop} />}
          </div>

          <div className="mt-1.5">
            <PodiumName fullName={row.fullName} onOpen={onOpen} className={spec.nameClass} />
          </div>

          <div className="mt-1">
            <span
              className={`figure figure-sum-runner ${spec.figureClass} inline-block leading-none font-semibold`}
              style={{ color: 'var(--ink-primary)' }}
            >
              {formatFullUzs(figure)}
              <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                soʻm
              </span>
            </span>
            {!onDelivered && (
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                FAKT 1 · tasdiqlangan
              </p>
            )}
          </div>

          {/*
            The chase — the one number a runner-up can act on — in a tinted
            pill so the card's call to action does not read like a caption.
            The pill borrows `--seq-550`, the hue the closeness bar under it
            already carries: no colour outside the licensed ramp.
          */}
          <div className="chase-chip mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold">
            <span aria-hidden="true">{gap === 0 ? '🔥' : '🎯'}</span>
            {gap === 0 ? (
              'Lider bilan teng — bitta yutuq hal qiladi'
            ) : (
              <>
                Liderga <span className="tabular">+{formatFullUzs(gap)}</span> soʻm
              </>
            )}
          </div>
          {/* The bar states its own reading — "you are at N% of the leader"
              — so the proportion never has to be estimated from a length.
              Same composition as Meter: track flex-1, figure beside it. */}
          <div className="mt-2 flex items-center gap-2">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full"
              style={{ background: 'var(--track)' }}
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, closeness)}%`,
                  // A lighter-to-full sweep, mixed toward the card's own
                  // surface rather than a literal white, so it reads correctly
                  // whichever theme's --seq-550 it is given.
                  background:
                    'linear-gradient(90deg, color-mix(in oklab, var(--seq-550) 45%, var(--surface-raised)), var(--seq-550))',
                  transition: 'width var(--duration-enter) var(--ease-out)',
                }}
              />
            </div>
            <span
              className="tabular shrink-0 text-[10.5px] font-medium"
              style={{ color: 'var(--ink-muted)' }}
              aria-label="Liderga nisbatan"
            >
              {formatPercent(closeness, 0)}
            </span>
          </div>
        </div>
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
            <strong className="tabular font-medium" style={{ color: 'var(--ink-primary)' }}>
              {formatFullUzs(forecast.projected.amount)}
            </strong>{' '}
            soʻm yutiladi
          </>
        ) : forecast.elapsedPercent >= 100 ? (
          <>Davr yakunlangan — jadvaldagi natija qatʼiy</>
        ) : (
          <>Prognoz uchun hali erta — davr endi boshlandi</>
        )}
        <span className="mx-1.5">·</span>
        {formatNumber(totals.sellersInBonus)} ta sotuvchi bonus darajasida
        {/*
          The board's own plan line — their `plandone` at the top level. It
          appears only when targets exist, because a strip that always says
          "reja belgilanmagan" trains the reader to stop looking at it.
        */}
        {totals.plan.percent !== null && (
          <>
            <span className="mx-1.5">·</span>
            reja {formatPercent(totals.plan.percent)} bajarildi
          </>
        )}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Exported for `tests/features/sellersDeliveryLag.test.tsx`, like `OutcomeCell`. */
export function TotalsBand({
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
        label="FAKT 1 · tasdiqlangan"
        value={totals ? totals.ordered.amount : null}
        unit="money"
        /*
          THE SUM, TO THE LAST DIGIT, everywhere on this board.

          The floor does not scan these two tiles, it reconciles them: against
          the Тасдиқлаш kanban, against the bot's own Telegram totals, against
          the client's published page. «106 mln» cannot be compared with
          «106 432 000» without opening a tooltip, and this is the screen where
          that comparison is the whole point. `money="full"` carries the
          format, the size and the dropped tooltip together — see StatTile.
        */
        money="full"
        status={status}
        /*
          BOTH COUNTS, because the two screens print both and neither used to
          say so. `orders` is the part that left the queue as an order —
          Тасдиқланди plus Тасдиқланмай чиқди, exactly what FAKT 1's money is
          made of — while `cohortOrders` is every order that reached the queue
          in this window, which is the number Tasdiqlash navbati shows.
          August: 2 874 against 3 228. A reader comparing the two pages was
          left with two true figures 354 apart and nothing to reconcile them.

          «navbatdan chiqdi», not «tasdiqlangan»: the count covers two of the
          board's states now, and naming it after one of them would send a
          reader looking for the difference on the wrong tile.
        */
        hint={
          totals
            ? totals.cohortOrders > totals.orders
              ? `${formatNumber(totals.orders)} ta navbatdan chiqdi · navbatda jami ${formatNumber(totals.cohortOrders)} ta`
              : `${formatNumber(totals.orders)} ta buyurtma`
            : undefined
        }
      />
      {/*
        «FAKT 2», NOT «shundan yutilgani» — the word was a lie about the
        arithmetic.

        On the queue basis FAKT 2 is not a subset of FAKT 1: an order that
        went out Тасдиқланмай чиқди was never confirmed, so it is outside
        FAKT 1 and still delivers real money into FAKT 2. The tiles therefore
        cross over — 57.6 mln confirmed beside 58.8 mln delivered is a state
        this board reaches — and a tile reading "of which" above a number
        larger than the one above it reads as a broken page. The two are
        siblings, and the labels now say so; `sellerBoardService` and the
        HAVING gate in `confirmationSellerRating` carry the reason.
      */}
      {/*
        A ZERO HERE IS A DATE, NOT A FAULT — so the tile has to say which.

        FAKT 2 asks where the cohort stands NOW, and the cohort is dated by its
        arrival in C4:NEW, so on a young window the answer is legitimately
        nothing: delivery takes days. Measured on production 2026-09-04, by
        arrival day — 04-sen 79 confirmed / 0 delivered, 03-sen 94 / 0, 02-sen
        80 / 20, 31-avg 99 / 73, 29-avg 101 / 87. The portal agrees: of the 111
        orders that reached C4:NEW that morning not one was in C6:WON, while 34
        of 50 sampled from 10-avgust were. Nothing lands for about two days,
        and the board opens on «Bugun».

        What the tile printed for that state was «0 ta yakunlangan buyurtma»
        over «oʻzgarishsiz» — two true statements that together read as a dead
        screen, and it was read as one. The money is not missing, it is on the
        road, so the hint names the road; `sellersCaption` says the same thing
        above the table and the two must not disagree.

        THE TREND GOES WITH IT. `wonDelta` compares this window's delivered
        money with the previous one's, and when this one is zero the comparison
        is zero against zero — «oʻzgarishsiz» is arithmetically right and tells
        the reader nothing, next to the very figure they are questioning.
        Keyed on `wonOrders`, not on the money: an order delivered for nothing
        is still a delivery, and the tile must not call that an empty window.
      */}
      <StatTile
        label="FAKT 2 · yetkazilgan"
        value={totals ? totals.won.amount : null}
        unit="money"
        money="full"
        status={status}
        hint={
          totals
            ? totals.wonOrders > 0
              ? `${formatNumber(totals.wonOrders)} ta yakunlangan buyurtma`
              : totals.open.amount > 0
                ? `hali yetkazilmagan — ${formatFullUzs(totals.open.amount)} soʻm yoʻlda`
                : 'bu davrda yetkazilgan buyurtma yoʻq'
            : undefined
        }
        context={
          totals && totals.wonOrders > 0 ? <TrendIndicator delta={totals.wonDelta} /> : undefined
        }
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
        money="full"
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

  /*
    THE PLACE, AT THE SIZE A PLACE DESERVES.

    On the podium rows the ordinal is set in the row's own metal at 19px — the
    same varnish the rail and the avatar ring wear, and decorative by the same
    contract: the medal glyph sits beside it and the aria-label spells the
    place out, so the rank survives with the colour gone. Everyone else keeps
    the quiet tabular figure, which is what makes the top three read as
    somewhere to get to.
  */
  if (!ranked) {
    return (
      <span
        className="tabular inline-flex w-10 shrink-0 justify-end text-xs"
        style={{ color: 'var(--ink-muted)' }}
        aria-label="Hali yetkazilgan puli yoʻq"
      >
        —
      </span>
    )
  }

  if (medal) {
    return (
      <span className="inline-flex w-10 shrink-0 items-center justify-end gap-1">
        <span aria-hidden="true" className="text-[13px] leading-none">
          {medal}
        </span>
        <span className="rank-num" aria-label={`${rank}-oʻrin`}>
          {rank}
        </span>
      </span>
    )
  }

  return (
    <span
      className="tabular inline-flex w-10 shrink-0 justify-end text-xs font-medium"
      style={{ color: 'var(--ink-secondary)' }}
    >
      {rank}
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
  projectionDivisor,
  planWindowHint,
}: {
  rows: readonly SellerBoardRowDto[]
  openSeller: string | null
  onToggle: (employeeId: string) => void
  apiParams: Record<string, string | number>
  /** Elapsed fraction of the period, or null when no projection is honest. */
  projectionDivisor: number | null
  /** The plan's own span, when the board found targets. See SellersPage. */
  planWindowHint?: string
}) {
  /*
    HOW WIDE THE DRILL-DOWN MAY BE.

    The panel lives in a `<td colSpan>`, so it inherits the table's 1 220px
    minimum — but the reader only ever sees the container's width. On a 1 280
    screen that hid the fourth tile column and the right quarter of the daily
    chart until they scrolled sideways, which is not something anyone does to
    read their own numbers. Measured once on mount and on resize; the panel
    then pins itself to the left edge of the scroll box and takes exactly the
    visible width.
  */
  const scrollBox = useRef<HTMLDivElement | null>(null)
  const [visibleWidth, setVisibleWidth] = useState<number | null>(null)
  useEffect(() => {
    const box = scrollBox.current
    if (!box) return
    const observer = new ResizeObserver(([entry]) => {
      setVisibleWidth(entry ? Math.round(entry.contentRect.width) : null)
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

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
      {/*
        THE CLIENT'S COLUMN ORDER, in the client's words.

        Their board reads left to right: who, whose team, the money won, the
        money ordered, the count, the leads, the conversion, the plan, the
        forecast. This table now says the same things in the same order, with
        their FAKT 1 / FAKT 2 vocabulary spelled out once in the header so
        nobody has to remember which is which. Two columns are ours and sit
        after theirs: Bonus (their ladder, which their table keeps on the
        person page instead) and Quvish, the distance to the person ahead.
      */}
      {/*
        The box grows when a row is open.

        Sixty percent of the screen is the right bound for a hundred and ten
        closed rows, and the wrong one the moment a drill-down unfolds inside
        it: the person panel is eight tiles and a two-panel chart, and at
        60dvh its lower half sat below the fold of a box that is itself inside
        a page that does not scroll. Eighty gives the panel room without
        letting the closed table run away with the viewport.
      */}
      <div
        ref={scrollBox}
        className={`${openSeller ? 'max-h-[80dvh]' : 'max-h-[60dvh]'} overflow-auto`}
      >
        <table className="w-full" style={{ minWidth: 1220 }}>
          <thead>
            <tr>
              {[
                ['#', 'left'],
                ['Sotuvchi', 'left'],
                ['ROP', 'left'],
                ['FAKT 2 · yetkazilgan', 'right'],
                ['FAKT 1 · tasdiqlangan', 'right'],
                ['Tranz.', 'right'],
                ['Lid', 'right'],
                ['Konv.', 'right'],
                ['Plan bajarish', 'right'],
                ['Prognoz', 'right'],
                ['Bonus', 'right'],
              ].map(([label, align]) => (
                <th
                  key={label}
                  scope="col"
                  className="eyebrow sticky top-0 z-[1] px-2 pt-1 pb-2 whitespace-nowrap"
                  /* --surface-sunken, the token every other sticky header in
                     the app uses: --surface is the card's own colour, so in
                     light theme the header vanished into the card behind it. */
                  style={{ textAlign: align as 'left' | 'right', background: 'var(--surface-sunken)' }}
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
                  projectionDivisor={projectionDivisor}
                  planWindowHint={planWindowHint}
                  visibleWidth={visibleWidth}
                />
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        Och chiziq — FAKT 1 (tasdiqlangan), toʻq chiziq — FAKT 2 (yetkazilgan);
        ikkisi ikki oʻlchov, biri ikkinchisining ichida emas. Prognoz — shu
        surʼatda davr oxirida yetkaziladigan pul. Oldingi oʻringacha qancha
        qolgani — sotuvchi nomini bosing.
        <br />
        <strong style={{ color: 'var(--ink-secondary)' }}>Konv.</strong> — yetkazilgan / hal
        boʻlgan buyurtma. Mijozning taxtasi bu ustunni buyurtma / lid deb sanaydi; lid manbasi
        ulanganda ikkinchi oʻlchov ham qoʻshiladi. <strong style={{ color: 'var(--ink-secondary)' }}>Bonus</strong>{' '}
        faqat 107–147 raqamli sotuvchilarga toʻlanadi — boshqalarda katak boʻsh turadi.{' '}
        <span className="inline-flex items-center gap-1">
          Lid ustuni hozircha boʻsh
          <InfoTip content={<span>{NO_LEAD_SOURCE}</span>} label="Lid nega boʻsh" />
        </span>
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
      <span className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
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
        +{formatFullUzs(gap)}
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
  projectionDivisor,
  planWindowHint,
  visibleWidth,
}: {
  row: SellerBoardRowDto
  ahead: SellerBoardRowDto | null
  chaser: SellerBoardRowDto | null
  ceiling: number
  open: boolean
  onToggle: () => void
  apiParams: Record<string, string | number>
  projectionDivisor: number | null
  planWindowHint?: string
  visibleWidth?: number | null
}) {
  /*
    A PLACE IS ONLY A PLACE ONCE SOMETHING HAS BEEN DELIVERED.

    On a young window — «Bugun» before the first courier arrives — every row
    holds zero FAKT 2 and the order is decided by a tie-break, so nobody wears
    metal. The table says «—» in the rank column instead of handing out gold
    for nothing, and the caption above explains why.
  */
  const ranked = row.won.amount > 0 || row.ordered.amount > 0
  const podium = row.rank <= 3 && ranked

  return (
    <>
      {/*
        THE TABLE IS THE PODIUM'S CONTINUATION, not a list under it.

        This is the screen the sellers open, and the top places have to feel
        like places all the way down the page — the ceremony used to stop at
        the fold, with the first three rows differing from the rest by an
        eight-percent wash. `.rank-row` carries a metal rail and a wash that
        fades across the row from the rank; see the RANKED ROWS block in
        globals.css for why the metal is licensed here and what still carries
        the rank without it.
      */}
      <tr
        id={`seller-row-${row.employeeId}`}
        className={`border-b transition-colors hover:bg-[var(--surface-sunken)] ${
          podium ? `rank-row rank-${row.rank}` : ''
        }`}
        style={{
          borderColor: 'var(--grid)',
          // The open drill-down takes the sunken token, so a click that
          // arrived from the podium visibly lands somewhere.
          background: open ? 'var(--surface-sunken)' : undefined,
        }}
      >
        <td className={podium ? 'px-2 py-3' : 'px-2 py-2'}>
          <Rank rank={row.rank} ranked={ranked} />
        </td>
        <td className={podium ? 'px-2 py-3' : 'px-2 py-2'}>
          {/*
            The name is the disclosure trigger — one target, not a name plus a
            separate chevron, so the row has a single obvious action.
          */}
          {/* No ring here. The # column beside it already carries the medal
              and the ordinal in the row's metal; a second mark on the same
              row repeats the place instead of adding anything, and initials
              would repeat the name it sits next to. */}
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              className={`focusable rounded text-left underline-offset-2 hover:underline ${
                podium ? 'text-[13.5px] font-semibold' : 'text-[12.5px] font-medium'
              }`}
              style={{ color: 'var(--ink-primary)' }}
            >
              {row.fullName}
            </button>
          </span>
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
          {/*
            The chase, under the name rather than in a column of its own.

            It belongs next to the person it is about, and the client's board
            has ten columns before ours begin — a thirteenth pushed Bonus and
            Prognoz off the right edge of an office monitor, which is a poor
            trade for a figure that reads better here anyway.
          */}
          <div className="mt-0.5">
            <ChaseCell row={row} ahead={ahead} />
          </div>
        </td>
        <td className={podium ? 'px-2 py-3' : 'px-2 py-2'}>
          <TeamBadge rop={row.rop} />
        </td>
        {/* FAKT 2 — Доставланди. Their leading money column, and ours. */}
        <td
          className={`tabular px-2 text-right font-semibold ${
            podium ? 'py-3 text-[13.5px]' : 'py-2 text-[12.5px]'
          }`}
          style={{ color: 'var(--ink-primary)' }}
        >
          {formatFullUzs(row.won.amount)}
          {row.sharePercent !== null && (
            <span className="ml-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {formatPercent(row.sharePercent, 1)}
            </span>
          )}
        </td>
        {/* FAKT 1 — Тасдиқланди + Тасдиқланмай чиқди. See `FAKT1_OUTCOMES`. */}
        <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {formatFullUzs(row.ordered.amount)}
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
          <LeadCell leads={row.leads} />
        </td>
        <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {row.conversionPercent === null ? NO_VALUE : formatPercent(row.conversionPercent)}
        </td>
        <td className="px-2 py-2 text-right">
          <PlanCell plan={row.plan} />
        </td>
        <td className="px-2 py-2 text-right">
          <ForecastCell wonAmount={row.won.amount} projectionDivisor={projectionDivisor} />
        </td>
        <td className="px-2 py-2 text-right">
          <BonusCell bonus={row.bonus} />
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={11} className="p-0">
            {/* Pinned to the left edge of the scroll box and sized to what the
                reader can actually see, so the panel never hides behind a
                horizontal scroll the table needs and it does not. */}
            <div
              className="sticky left-0 px-2 pt-1 pb-4"
              style={visibleWidth ? { width: visibleWidth } : undefined}
            >
            <SellerDetail
              employeeId={row.employeeId}
              row={row}
              ahead={ahead}
              chaser={chaser}
              apiParams={apiParams}
              planWindowHint={planWindowHint}
            />
            </div>
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
/**
 * The row's own end-of-period projection — the client's `forecast()` column.
 *
 * Straight-line: won so far over the elapsed fraction, the same arithmetic
 * as the global ForecastStrip, so the column and the strip can never state
 * two different paces. A dash for a row with nothing won (zero projected to
 * zero is not a forecast) and for every window where the strip itself would
 * refuse — the period is over, or too little of it has elapsed to divide by.
 */
function ForecastCell({
  wonAmount,
  projectionDivisor,
}: {
  wonAmount: number
  projectionDivisor: number | null
}) {
  if (projectionDivisor === null || wonAmount <= 0) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </span>
    )
  }
  const projected = wonAmount / projectionDivisor
  return (
    <Tooltip
      content={
        <span className="tabular">
          Shu surʼatda davr oxirida ≈ {formatUzs(Math.round(projected))}
        </span>
      }
    >
      <span
        tabIndex={0}
        className="tabular focusable rounded text-xs whitespace-nowrap"
        style={{ color: 'var(--ink-secondary)' }}
      >
        ≈{formatFullUzs(projected)}
      </span>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// The three cells the client's board has and this one did not
// ---------------------------------------------------------------------------

/**
 * The sentence a column with no source prints, once, in one place.
 *
 * Repeating it per cell would put a hundred identical tooltips on the page;
 * the column is empty for the same reason on every row, so the explanation
 * belongs to the column and the cells stay quiet dashes.
 */
const NO_LEAD_SOURCE =
  'Lid soni bu bazada saqlanmaydi — Bitrix24 sinxronizatsiyasi lidlarni olib kelmaydi. ' +
  'Qaysi manbadan olinishini kelishib olishimiz kerak.'

/** Their `Lid`. Empty everywhere today, and saying so rather than showing 0. */
function LeadCell({ leads }: { leads: number | null }) {
  if (leads === null) {
    return (
      <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
    )
  }
  return <>{formatNumber(leads)}</>
}

/**
 * Their `Plan bajarish` — the bar, and the percentage beside it.
 *
 * THE BAR CLAMPS AT 100 AND THE NUMBER DOES NOT. That is their behaviour and
 * it is the right one: a track that can overflow stops being a track, while a
 * seller who reached 112% has earned the 112. The tone follows their three
 * bands (≥100, ≥70, below) on the status tokens.
 *
 * A row with no target prints a dash and NO track. An empty bar beside «0%»
 * is a claim that the seller missed something; there is nothing to miss.
 */
function PlanCell({ plan }: { plan: SellerPlanDto }) {
  /*
    Null only when there is nothing to divide by — no target AND no confirmed
    money. With FAKT 1 on the row the column always has something true to say:
    the share of it that arrived, which is what the client's own board prints
    wherever no target exists.
  */
  if (plan.percent === null) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {NO_VALUE}
      </span>
    )
  }

  const rail =
    plan.percent >= 100
      ? 'var(--status-good)'
      : plan.percent >= 70
        ? 'var(--status-warning)'
        : 'var(--status-critical)'

  return (
    <Tooltip
      content={
        <span className="tabular">
          {plan.amount
            ? `Reja ${formatUzs(plan.amount.amount)} — bajarilgani ${formatPercent(plan.percent)}`
            : `FAKT 1 ning ${formatPercent(plan.percent)} i yetkazilgan`}
        </span>
      }
    >
      <span tabIndex={0} className="focusable inline-flex w-full items-center justify-end gap-1.5 rounded">
        <span
          className="relative h-1.5 w-14 shrink-0 overflow-hidden rounded-full"
          style={{ background: 'var(--track)' }}
          aria-hidden="true"
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${Math.min(plan.percent, 100)}%`,
              background: rail,
              transition: 'width var(--duration-enter) var(--ease-out)',
            }}
          />
        </span>
        {/*
          CAPPED IN TEXT AT 999%, not in value. Their own board prints 1343%
          and 44 029.3% where a plan is a fraction of the month's takings, and
          one such row sets the width of the whole column. The bar already
          clamps; this stops the label from doing the same damage sideways.
        */}
        <span className="tabular text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
          {plan.percent > 999 ? '999%+' : formatPercent(plan.percent)}
        </span>
      </span>
    </Tooltip>
  )
}

function BonusCell({ bonus }: { bonus: SellerBoardRowDto['bonus'] }) {
  /*
    OUTSIDE THE BAND, NOTHING — not a dash that reads as "not yet".

    The client's ladder pays only the 107–147 floor numbers, and this board
    used to apply it to everyone: July's top three all clear the top rung and
    none of them is paid for it. A promise of 2 mln soʻm to somebody who will
    not receive it is worse than an empty column, so the row says which it is.
  */
  if (!bonus.eligible) {
    /*
      NOTHING, not a dash and not a word.

      A dash reads as "not yet" and would promise a rung that will never
      arrive; the word «bonussiz» printed on every ineligible row — 87 of 128
      on this portal — turns the column into a wall of one string. The rule
      belongs to the COLUMN, so it is stated once under the table and once on
      the ladder, and the cell simply stays quiet.
    */
    return <span aria-label="Bonus qoidasi bu sotuvchiga tegishli emas" />
  }
  if (bonus.earned.amount > 0) {
    return (
      <StatusChip tone="good">{formatFullUzs(bonus.earned.amount)}</StatusChip>
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
      +{formatFullUzs(bonus.toNext.amount)}
      {bonus.nextBonus !== null && <> → {formatFullUzs(bonus.nextBonus.amount)}</>}
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
  planWindowHint,
}: {
  employeeId: string
  row: SellerBoardRowDto
  /** The seller directly ahead in the ranking — the catchable target. */
  ahead: SellerBoardRowDto | null
  /** For the leader only: the second place, i.e. who is chasing THEM. */
  chaser: SellerBoardRowDto | null
  apiParams: Record<string, string | number>
  /** The plan's own span, printed on the Plan tile. See SellersPage. */
  planWindowHint?: string
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
  const ranked = row.won.amount > 0 || row.ordered.amount > 0

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
          {/*
            THREE STATES, NOT TWO. «Yoʻlda» is only what is still moving —
            confirmed, undelivered and OPEN. An order the seller confirmed and
            then lost used to sit in that same figure (102 orders and
            176 mln soʻm across July), which read as live work they were still
            carrying. It has its own clause now, and the queue refusals keep
            theirs.
          */}
          FAKT 2 {formatFullUzs(row.won.amount)} · yoʻlda{' '}
          {formatFullUzs(row.open.amount)} ({formatNumber(row.openOrders)} ta)
          {row.lostAfterConfirmOrders > 0 && (
            <> · chiqqach bekor {formatNumber(row.lostAfterConfirmOrders)} ta</>
          )}
          {' '}· navbatda rad {formatNumber(row.lostOrders - row.lostAfterConfirmOrders)} ta
          {row.cohortOrders > row.orders && (
            <> · davrda jami {formatNumber(row.cohortOrders)} ta</>
          )}
        </p>
      </div>

      {/*
        THE CLIENT'S EIGHT CARDS, in their order — Lid, Tranzaksiya, FAKT 2,
        FAKT 1, Plan, Konversiya, Plan bajarish, FOT.

        Their per-seller tab opens on this grid, and it is the half of their
        page this screen genuinely lacked: every one of these figures existed
        here only as a cell on a row 1 400 pixels wide, which is not where a
        seller reads their own numbers. Three of the eight are empty and each
        says so on its own tile rather than in a footnote — the reader can see
        exactly which questions this application cannot answer yet.
      */}
      <div className="stagger mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile
          label="Lid"
          value={row.leads}
          unit="count"
          status="ready"
          hint={row.leads === null ? 'Manba ulanmagan' : undefined}
        />
        <StatTile label="Tranzaksiya" value={row.orders} unit="count" status="ready" />
        <StatTile
          label="FAKT 2 · yetkazilgan"
          value={row.won.amount}
          unit="money"
          money="full"
          status="ready"
          hint={`${formatNumber(row.wonOrders)} ta buyurtma`}
        />
        <StatTile
          label="FAKT 1 · tasdiqlangan"
          value={row.ordered.amount}
          unit="money"
          money="full"
          status="ready"
        />
        <StatTile
          label="Plan"
          value={row.plan.amount?.amount ?? null}
          unit="money"
          money="full"
          status="ready"
          hint={row.plan.amount === null ? 'Reja belgilanmagan' : planWindowHint}
        />
        <GaugeTile
          label="Konversiya"
          value={row.conversionPercent}
          tone="neutral"
          status="ready"
          hint="yutilgan / hal boʻlgan buyurtma"
          context={
            <p className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
              Lid boʻyicha:{' '}
              {row.leadConversionPercent === null
                ? NO_VALUE
                : formatPercent(row.leadConversionPercent)}
            </p>
          }
        />
        <GaugeTile
          label="Plan bajarish"
          value={row.plan.percent}
          tone="neutral"
          status="ready"
          hint={
            row.plan.percent === null
              ? 'Hisoblash uchun maʼlumot yoʻq'
              : row.plan.basis === 'target'
                ? 'yetkazilgan / reja'
                : 'FAKT 2 / FAKT 1 — tasdiqlanganning qanchasi yetkazilgani'
          }
        />
        <StatTile
          label="FOT (ish haqi)"
          value={row.fot?.amount ?? null}
          unit="money"
          money="full"
          status="ready"
          hint={row.fot === null ? 'Bazada maosh maʼlumoti yoʻq' : undefined}
        />
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
                      +{formatFullUzs(ahead.won.amount - row.won.amount)}
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
                    {formatFullUzs(row.won.amount - chaser.won.amount)}
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
                Keyingi daraja {formatFullUzs(row.bonus.nextFloor.amount)}: yana{' '}
                {row.bonus.toNext ? `+${formatFullUzs(row.bonus.toNext.amount)}` : NO_VALUE} kerak
                {row.bonus.nextBonus && (
                  <> → {formatFullUzs(row.bonus.nextBonus.amount)} bonus</>
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
              Eng yuqori daraja — {formatFullUzs(row.bonus.earned.amount)} soʻm bonus
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
          /*
            «Kunlik dinamika» — their chart, as two stacked panels. The list of
            horizontal bars this replaced could be read a day at a time but not
            as a SHAPE, and the shape is the whole point of a daily series: a
            week that trailed off looks nothing like a week that held. Exact
            per-day figures did not go away, they moved into the tooltip.
          */
          <>
            <p className="eyebrow mb-1.5">Kunlik dinamika</p>
            <SellerDaysChart days={rows} />
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function TeamTable({
  rows,
  projectionDivisor,
}: {
  rows: readonly SellerTeamRowDto[]
  projectionDivisor: number | null
}) {
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
        {/* The same columns as the sellers' table, in the same order and the
            same words — their ROP tab and their seller tab are one function
            called twice, and a reader who learns one has learned both. */}
        <table className="w-full" style={{ minWidth: 1080 }}>
          <thead>
            <tr>
              {[
                ['#', 'left'],
                ['Komanda (ROP)', 'left'],
                ['Sotuvchi', 'right'],
                ['FAKT 2 · yetkazilgan', 'right'],
                ['FAKT 1 · tasdiqlangan', 'right'],
                ['Tranz.', 'right'],
                ['Lid', 'right'],
                ['Konv.', 'right'],
                ['Plan bajarish', 'right'],
                ['Prognoz', 'right'],
              ].map(([label, align]) => (
                <th
                  key={label}
                  scope="col"
                  className="eyebrow sticky top-0 z-[1] px-2 pt-1 pb-2 whitespace-nowrap"
                  /* --surface-sunken, the token every other sticky header in
                     the app uses: --surface is the card's own colour, so in
                     light theme the header vanished into the card behind it. */
                  style={{ textAlign: align as 'left' | 'right', background: 'var(--surface-sunken)' }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const podium = row.rank <= 3 && (row.won.amount > 0 || row.ordered.amount > 0)
              // The same metal echo as the sellers' table — chrome only.
              const metal = !podium
                ? null
                : row.rank === 1
                  ? MEDAL_TOKENS[0]
                  : row.rank === 2
                    ? MEDAL_TOKENS[1]
                    : MEDAL_TOKENS[2]
              return (
                <tr
                  key={row.rop}
                  className="border-b"
                  style={{
                    borderColor: 'var(--grid)',
                    background: metal
                      ? `color-mix(in oklab, ${metal} 8%, transparent)`
                      : undefined,
                  }}
                >
                  <td
                    className="px-2 py-2"
                    style={metal ? { boxShadow: `inset 3px 0 0 ${metal}` } : undefined}
                  >
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
                  <td className="tabular px-2 py-2 text-right text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
                    {formatFullUzs(row.won.amount)}
                    {row.sharePercent !== null && (
                      <span className="ml-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        {formatPercent(row.sharePercent, 1)}
                      </span>
                    )}
                  </td>
                  <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-secondary)' }}>
                    {formatFullUzs(row.ordered.amount)}
                  </td>
                  <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-primary)' }}>
                    {formatNumber(row.orders)}
                  </td>
                  <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-secondary)' }}>
                    <LeadCell leads={row.leads} />
                  </td>
                  <td className="tabular px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-secondary)' }}>
                    {row.conversionPercent === null ? NO_VALUE : formatPercent(row.conversionPercent)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <PlanCell plan={row.plan} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <ForecastCell wonAmount={row.won.amount} projectionDivisor={projectionDivisor} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        Och chiziq — FAKT 1 (tasdiqlangan), toʻq chiziq — FAKT 2 (yetkazilgan).
        Prognoz — shu surʼatda davr oxirida yetkaziladigan pul.
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
  /*
    The glyphs are the climb's own story — aim, take off, arrive — and stay
    decorative (aria-hidden): the rail already states each rung's magnitude,
    and the emoji vocabulary is the one the medals established.
  */
  const tiers = [
    { floor: 45_000_000, bonus: 1_000_000, rail: 'var(--seq-250)', glyph: '🎯' },
    { floor: 60_000_000, bonus: 1_500_000, rail: 'var(--seq-450)', glyph: '🚀' },
    { floor: 70_000_000, bonus: 2_000_000, rail: 'var(--seq-650)', glyph: '💎' },
  ]

  const ready = status === 'ready' && data

  /*
    ONLY THE PEOPLE THE LADDER PAYS.

    Every count and every «eng yaqini» on these three cards is drawn from the
    107–147 band, because the ladder is. Counting the whole board here would
    say "nine sellers reached 70 mln" on a page whose rows show a bonus for
    four of them — the rungs and the column have to be describing one set of
    people or the section is quietly lying about who gets paid.
  */
  const payable = ready ? data.rows.filter((r) => r.bonus.eligible) : []

  const reached = (floor: number) =>
    ready ? payable.filter((r) => r.won.amount >= floor).length : null

  /** The highest-won seller still below this rung — the one about to arrive. */
  const nearest = (floor: number) => {
    if (!ready) return null
    let best: SellerBoardRowDto | null = null
    for (const r of payable) {
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
        hint="Mijozning oʻz qoidasi — 107–147 raqamli sotuvchilar, yetkazilgan pul boʻyicha"
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
                  <span aria-hidden="true" className="mr-1.5">{tier.glyph}</span>
                  {formatFullUzs(tier.floor)} soʻmdan
                </p>
                {/*
                  Plain text, NOT AnimatedNumber, and the reason is both
                  correctness and meaning. A tier is a POLICY CONSTANT — it does
                  not arrive from a query, so there is nothing to count up to,
                  and animating it would imply a figure that moves. It also
                  broke hydration: this is the one number on the page the server
                  renders, and a formatter that resolved uz-UZ per engine gave
                  Node and the browser different separators ("1,5 mln" against
                  "1.5 mln"), so the SSR text and the client text disagreed on
                  first paint. `format.ts` states the separators now, and the
                  full reading goes through the same two constants.
                */}
                <p className="figure text-[22px] leading-none font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  {formatFullUzs(tier.bonus)}
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
                      +{formatFullUzs(tier.floor - contender.won.amount)}
                    </span>{' '}
                    kerak
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        Daraja bir marta toʻlanadi — eng yuqori bosib oʻtilgan chegara boʻyicha, qoʻshilmaydi.
        {ready && (
          <>
            {' '}Zinapoya faqat <strong style={{ color: 'var(--ink-secondary)' }}>107–147</strong>{' '}
            raqamli sotuvchilarga tegishli — bu davrda{' '}
            {formatNumber(data.totals.sellersEligibleForBonus)} tasi shu doirada,{' '}
            {formatNumber(data.totals.sellers - data.totals.sellersEligibleForBonus)} tasi esa emas
            (ularda bonus katagi boʻsh turadi).
          </>
        )}
      </p>
    </section>
  )
}
