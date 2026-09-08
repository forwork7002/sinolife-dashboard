'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import { EmptyState, ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { RecordWall } from '@/features/sellers/RecordWall'
import { useAutoScroll } from '@/features/sellers/useAutoScroll'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  type SellerBoardDto,
  type SellerBoardRowDto,
  type SellerBoardTotalsDto,
  type SellerTeamRowDto,
  apiGet,
} from '@/lib/api'
import { NO_VALUE, formatFullUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Sotuvchilar reytingi — the board on the television.
 *
 * THIS SCREEN HAS ONE AUDIENCE AND ONE PLACE: the sellers themselves, reading
 * it off a TV on the sales floor. The client said so on 2026-09-07 —
 * «sotuvchilar reytingi faqat sotuvchilar oʻz reytingini televizordan
 * koʻrishi uchun kerak» — and asked for exactly two things on it: the sellers
 * ranked on the left, the teams ranked on the right, and nothing that is not
 * a rank. Everything analytical the old page carried — the FAKT 1 / FAKT 2
 * totals band, the conversion gauge, the bonus fund, the bonus ladder, the
 * per-row Plan / Prognoz / Lid / FOT columns, the per-seller drill-down and
 * its day chart — moved to Savdo dinamikasi (`ConfirmationFaktSection`),
 * where the manager who reads those numbers actually is. Nothing about a
 * bonus is printed here at all, per the client's own note the same day.
 *
 * A TELEVISION HAS NO MOUSE, and that decides the rest of the layout:
 *
 * - Nothing here opens, filters or expands. A name is a name, not a door; the
 *   name filter that stood in for the client's 128-tab operator strip is gone
 *   with the drill-down it searched for.
 * - Both columns take the height the screen has (`PageShell fill`) and each
 *   list scrolls INSIDE its column, on its own — see `useAutoScroll`. Fifty
 *   sellers do not fit under a podium on a 1080p screen, and the thirty-eight
 *   below the fold are the ones this board exists for.
 * - Type is sized from the viewport (the `--tv-*` tokens in globals.css) so
 *   a 1920px television gets a board readable from a desk away and a laptop
 *   gets the house sizes; nothing is a literal pixel size that would be right
 *   on only one of them.
 *
 * TWO PODIUMS, ONE RULE. Each column opens on its own three seats — gold in
 * the middle and a step taller, silver left, bronze right, the shape a floor
 * recognises from across a room — and the same ceremony chrome the board has
 * worn since the client asked for gold on top (see the PODIUM block in
 * globals.css: metal on rims, rings, washes and ghost numerals, never on a
 * value). Places are decided by the client's own rule, FAKT 2 first and
 * FAKT 1 when nobody has delivered, and every seat prints which of the two
 * put it there — the reasoning is on `PodiumBasis`.
 *
 * THE LIST CONTINUES THE PODIUM, IT DOES NOT REPEAT IT: rows start at fourth
 * place, so the first three are on screen exactly once and the fold reaches
 * three rows further down. Every row states what the seat cards state —
 * both FAKT figures, the order count, conversion — and under each name the
 * one number a seller can act on today: the distance to the person directly
 * ahead, in soʻm. Distances, never ordinals: «+2,100,000» is something to do
 * this afternoon, «siz 47-siz» is only something to feel.
 *
 * NO ROP COLOUR CODING, still. The client's map is stale against this portal
 * (fifteen teams, ten named, three that no longer exist) and the design
 * system caps categorical hue at eight; the team rides as a text badge.
 */
export function SellersPage() {
  const { apiParams: filterParams } = useDashboardFilters()

  /*
    ONE CLOCK. The board reads the floor's own FAKT 1 / FAKT 2 — dated by the
    order's arrival in C4:NEW — and there is no control to change it. The
    'intake' reading still exists behind `?basis=intake` as the figure measured
    against the client's own published dashboard, the oracle a queue regression
    is checked against; it was never a second board for the floor to read.
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
  const errorMessage = (board.error as Error | null)?.message
  const retry = () => void board.refetch()

  /*
    ONE BOARD AT A TIME UNDER 1280px. Stacked, the two columns made a phone
    page of two podiums and two lists — a seller looking for their own row
    scrolled through three tall cards, then a list, then three more, and
    the list's own horizontal scroll (six nowrap columns in 390px) caught
    the thumb on the way: «scroll qilish qiyinlashgan», the client, on
    2026-09-07. So a phone gets a switch and sees one board; the television
    and the desk see both, and the switch is not drawn there at all. Local
    state, not the URL: which half a phone is looking at is not a question
    a pasted link needs to answer.
  */
  const [shown, setShown] = useState<'sellers' | 'teams'>('sellers')

  return (
    <PageShell
      title={t.nav.sellers}
      meta={board.data?.meta}
      /*
        THE RECORD WALL RIDES THE TITLE LINE, not the board below it. The
        client asked for it there, and it is also the only room left: the two
        columns already run to the bottom of the screen. It fetches on its own
        ten-minute clock rather than riding this board's minute — see
        `RecordWall`.
      */
      banner={<RecordWall />}
      stale={board.isPlaceholderData}
      accent="var(--series-5)"
      controlsAlign="end"
      fill
    >
      {/*
        `fill` hands the page one plain block; this column inside it is what
        lets the board take the rest of the height while the scope note above
        it keeps its own.
      */}
      <div className="tv-board-shell flex min-h-0 flex-col gap-3">

        <div className="tv-switch" role="tablist" aria-label="Qaysi reyting">
          {(
            [
              ['sellers', '🏆', 'Sotuvchilar'],
              ['teams', '🛡️', 'Komandalar'],
            ] as const
          ).map(([key, glyph, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={shown === key}
              aria-controls={`tv-${key}`}
              className={`tv-switch-tab tv-switch-tab--${key}`}
              onClick={() => setShown(key)}
            >
              <span aria-hidden="true">{glyph}</span> {label}
            </button>
          ))}
        </div>

        <div className="tv-board">
          <SellersColumn
            data={data}
            status={status}
            errorMessage={errorMessage}
            onRetry={retry}
            parked={shown !== 'sellers'}
          />
          <TeamsColumn
            data={data}
            status={status}
            errorMessage={errorMessage}
            onRetry={retry}
            parked={shown !== 'teams'}
          />
        </div>

        {/*
          The one line on this board that is not a rank: who made it. English,
          right-aligned and at the page's smallest size — see `.tv-credit` —
          so it stays out of the way of a seller looking for their own row.
        */}
        <p className="tv-credit">Developed by Yusuf</p>
      </div>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------

/**
 * One line of either board, in the words both boards share.
 *
 * A seller and a team are ranked by the same two figures under the same
 * rule, so the podium and the list are written once over this shape and the
 * two columns cannot drift apart in wording, sizing or arithmetic. What
 * differs is only what stands beside the name — a seller's team, a team's
 * headcount.
 *
 * NO BONUS ON THIS BOARD. The ladder and the fund live on Savdo dinamikasi;
 * the client's note of 2026-09-07 — «bonus kerak emas, bonus hali aytilmadi»
 * — took the per-seat bonus chips off the television, and the shape here
 * carries nothing the seats cannot print.
 */
export interface BoardEntry {
  readonly key: string
  readonly rank: number
  readonly name: string
  /** Beside the name: the seller's ROP, or «N sotuvchi» for a team. */
  readonly badge: string | null
  /** FAKT 2 — Доставланди, in soʻm. */
  readonly won: number
  /** FAKT 1 — Тасдиқланди + Тасдиқланмай чиқди, in soʻm. */
  readonly ordered: number
  readonly wonOrders: number
  readonly orders: number
  /** Null where the DTO does not carry it (teams). */
  readonly openOrders: number | null
  readonly conversionPercent: number | null
  readonly sharePercent: number | null
}

function fromSeller(row: SellerBoardRowDto): BoardEntry {
  return {
    key: row.employeeId,
    rank: row.rank,
    name: row.fullName,
    badge: row.rop,
    won: row.won.amount,
    ordered: row.ordered.amount,
    wonOrders: row.wonOrders,
    orders: row.orders,
    openOrders: row.openOrders,
    conversionPercent: row.conversionPercent,
    sharePercent: row.sharePercent,
  }
}

function fromTeam(row: SellerTeamRowDto): BoardEntry {
  return {
    key: row.rop,
    rank: row.rank,
    name: row.rop,
    badge: `${formatNumber(row.sellers)} sotuvchi`,
    won: row.won.amount,
    ordered: row.ordered.amount,
    wonOrders: row.wonOrders,
    orders: row.orders,
    openOrders: null,
    conversionPercent: row.conversionPercent,
    sharePercent: row.sharePercent,
  }
}

type Status = 'loading' | 'error' | 'ready'

interface ColumnProps {
  data: SellerBoardDto | undefined
  status: Status
  errorMessage?: string
  onRetry: () => void
  /** Hidden under 1280px while the switch shows the other board. */
  parked?: boolean
}

/** Exported for the tests, like `TotalsBand` before it. */
export function SellersColumn({ data, status, errorMessage, onRetry, parked = false }: ColumnProps) {
  const entries = useMemo(() => data?.rows.map(fromSeller) ?? [], [data])
  return (
    <BoardColumn
      id="tv-sellers"
      tone="sellers"
      parked={parked}
      glyph="🏆"
      title="Sotuvchilar"
      noun="Sotuvchi"
      count={(n) => `${formatNumber(n)} ta sotuvchi`}
      entries={entries}
      totals={data?.totals}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      empty="Tanlangan davrda hech kim buyurtma olmagan — podium keyingi buyurtmani kutmoqda."
    />
  )
}

export function TeamsColumn({ data, status, errorMessage, onRetry, parked = false }: ColumnProps) {
  const entries = useMemo(() => data?.teams.map(fromTeam) ?? [], [data])
  const teamless = data?.totals.teamlessSellers ?? 0
  return (
    <BoardColumn
      id="tv-teams"
      tone="teams"
      parked={parked}
      glyph="🛡️"
      title="Komandalar"
      noun="Komanda (ROP)"
      count={(n) =>
        teamless > 0
          ? `${formatNumber(n)} ta komanda · ${formatNumber(teamless)} ta sotuvchi komandasiz, ulushlar ularsiz`
          : `${formatNumber(n)} ta komanda`
      }
      entries={entries}
      totals={data?.totals}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      empty="Bu davrda hech bir ROP komandasi buyurtma olmagan."
    />
  )
}

/**
 * One half of the television: a heading, the three seats, the rows.
 *
 * Which FACT decided the places is computed ONCE here and handed to every
 * seat and every row, so the two cannot disagree about the unit — the
 * failure `PodiumBasis` records, where «Bugun» printed confirmed money in
 * the slot «Shu oy» printed delivered money in, and the month looked smaller
 * than the day inside it.
 */
function BoardColumn({
  id,
  tone,
  parked = false,
  glyph,
  title,
  noun,
  count,
  entries,
  totals,
  status,
  errorMessage,
  onRetry,
  empty,
}: {
  id: string
  /**
   * Which of the two boards this is, as a colour. People and teams are two
   * KINDS of thing, not two values of one, so a categorical hue each is
   * legitimate — the sellers wear the page's own accent, the teams a second
   * one — and it rides on the column's frame and heading, never on a figure.
   * Two of the palette's eight slots; the ROP badge stays a text chip.
   */
  tone: 'sellers' | 'teams'
  parked?: boolean
  glyph: string
  title: string
  /** The name column's header. */
  noun: string
  count: (n: number) => string
  entries: readonly BoardEntry[]
  totals: SellerBoardTotalsDto | undefined
  status: Status
  errorMessage?: string
  onRetry: () => void
  empty: string
}) {
  /*
    THE TOP THREE OF WHOEVER HAS MONEY, not only of whoever has delivered.
    Delivery takes days, so for most of a working day nobody has FAKT 2, and
    a podium gated on it stood empty over a floor that had confirmed 148 mln
    soʻm between 55 people. The board ranks FAKT 2 first and FAKT 1 second —
    the client's own rule — so the seats hold the same three the list would
    put on top, and each says which figure earned the place.
  */
  const winners = entries.filter((e) => e.won > 0 || e.ordered > 0).slice(0, 3)
  const onDelivered = winners.length > 0 && winners[0]!.won > 0
  const seated = new Set(winners.map((w) => w.key))
  const rows = entries.filter((e) => !seated.has(e.key))

  return (
    <section
      id={id}
      className={`tv-col tv-col--${tone}${parked ? ' tv-col--parked' : ''} card reveal`}
      aria-labelledby={`${id}-heading`}
    >
      <header className="tv-col-head">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2
            id={`${id}-heading`}
            className="display flex items-center gap-2.5 text-[18px] font-semibold"
            style={{ color: 'var(--ink-primary)' }}
          >
            <span aria-hidden="true" className="tv-col-glyph">
              {glyph}
            </span>
            {title}
          </h2>
          {status === 'ready' && entries.length > 0 && (
            <p className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
              {count(entries.length)}
            </p>
          )}
        </div>
      </header>

      {status === 'loading' ? (
        <ColumnSkeleton />
      ) : status === 'error' ? (
        <div className="px-4 py-6">
          <ErrorState message={errorMessage} onRetry={onRetry} />
        </div>
      ) : entries.length === 0 ? (
        <div className="px-4 py-6">
          <EmptyState title="Bu davrda buyurtma yoʻq" body={empty} />
        </div>
      ) : winners.length === 0 ? (
        /*
          Orders exist, money does not — the first minutes of a window. No
          seats for a tie-break, and the list below still shows who has
          taken what.
        */
        <>
          <p className="px-5 pt-3 text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
            <span aria-hidden="true" className="mr-1">
              🏁
            </span>
            Podium hali boʻsh — oʻrinlar hammaga ochiq
          </p>
          <BoardList
            entries={entries}
            allEntries={entries}
            noun={noun}
            onDelivered={onDelivered}
          />
        </>
      ) : (
        <>
          <Podium winners={winners} onDelivered={onDelivered} totalWon={totals?.won.amount ?? 0} />
          <BoardList entries={rows} allEntries={entries} noun={noun} onDelivered={onDelivered} />
        </>
      )}
    </section>
  )
}

/** Sized to the ready layout: three seats, then rows. */
function ColumnSkeleton() {
  return (
    <div className="px-4 pt-3 pb-4" role="status">
      <span className="sr-only">Yuklanmoqda</span>
      <div className="tv-podium tv-podium--3" aria-hidden="true">
        {/* Placed by the seat classes, not an inline grid-column: an inline
            style would beat the <640px rule that stacks the seats. */}
        {/* Each seat names its metal so the pedestal's colour-mix has a
            token to mix — without one the block paints nothing. */}
        <div className="podium-col--gold tv-seat tv-seat--1 tv-seat--at-2">
          <div className="skeleton h-64" />
          <div className="tv-pedestal" />
        </div>
        <div className="podium-col--silver tv-seat tv-seat--2 tv-seat--at-1">
          <div className="skeleton h-56" />
          <div className="tv-pedestal" />
        </div>
        <div className="podium-col--bronze tv-seat tv-seat--3 tv-seat--at-3">
          <div className="skeleton h-52" />
          <div className="tv-pedestal" />
        </div>
      </div>
      <div className="mt-3 space-y-2" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-11" />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Which of the two facts the figure above it is — said on every seat, in
 * both readings. It used to name only FAKT 1, and the silence is what made
 * the podium unreadable: «Bugun» has no FAKT 2 and printed 12 900 000 of
 * confirmed money where «Shu oy» printed 3 300 000 of delivered. Same slot,
 * same type, two quantities, and the month looked smaller than the day.
 */
function PodiumBasis({ onDelivered, className = '' }: { onDelivered: boolean; className?: string }) {
  return (
    <p className={`text-[11px] ${className}`} style={{ color: 'var(--ink-muted)' }}>
      {onDelivered ? 'FAKT 2 · yetkazilgan' : 'FAKT 1 · tasdiqlangan'}
    </p>
  )
}

const SEATS = [
  { col: 'podium-col--gold', medal: '🥇', ring: 60 },
  { col: 'podium-col--silver', medal: '🥈', ring: 46 },
  { col: 'podium-col--bronze', medal: '🥉', ring: 40 },
] as const

/**
 * The three seats, gold in the middle — and on the tallest block.
 *
 * DOM ORDER IS 1-2-3 AND THE GRID RE-SEATS THEM: a screen reader and the
 * stagger both meet the champion first, while the eye meets the shape it
 * knows — silver left, gold centre and a step taller, bronze right. Placed
 * by `grid-column`, not `order`, so the reading order is never lied about.
 * Two winners sit gold-then-silver; one sits alone in the centre. The
 * column is a class, not an inline style, so a phone can overrule it and
 * stack the seats — an inline `grid-column` would beat any media query.
 *
 * A PODIUM, NOT THREE CARDS. Each seat stands on a pedestal — 1 : 1.6 : 2.4
 * in height, the champion's card a step wider — so the three places are
 * told apart by SHAPE from across the room before a single word is read:
 * the client's ask of 2026-09-07, «1, 2 va 3 oʻrinlar yaqqol ajralib
 * tursin». The metal stays chrome on every part of it.
 */
function Podium({
  winners,
  onDelivered,
  totalWon,
}: {
  winners: readonly BoardEntry[]
  onDelivered: boolean
  totalWon: number
}) {
  const leader = winners[0]!
  const columnOf = (place: number) =>
    winners.length === 3 ? [2, 1, 3][place - 1]! : winners.length === 2 ? place : 1

  return (
    <div className={`tv-podium tv-podium--${winners.length} stagger`}>
      {winners.map((entry, index) => (
        <PodiumSeat
          key={entry.key}
          entry={entry}
          place={index + 1}
          column={columnOf(index + 1)}
          leader={leader}
          runnerUp={index === 0 ? (winners[1] ?? null) : null}
          onDelivered={onDelivered}
          totalWon={totalWon}
        />
      ))}
    </div>
  )
}

/**
 * The face of a seat: the place in its own metal ring, a crown on the
 * champion. The ring holds the PLACE and not the person's initials — the
 * client's note of 2026-09-04: the name is written in full right under it,
 * and on this portal the badge is a number, so «Sirojov 115 Davlatbek» came
 * out «S1». Decorative throughout; the plaque spells the place out.
 */
function PodiumAvatar({ place, size, crowned }: { place: number; size: number; crowned: boolean }) {
  return (
    <span className="relative inline-flex" aria-hidden="true">
      {crowned && (
        <span
          className="rise absolute z-[1] leading-none"
          style={{
            top: -16,
            left: '50%',
            transform: 'translateX(-50%) rotate(-12deg)',
            fontSize: 20,
            animationDelay: '650ms',
          }}
        >
          👑
        </span>
      )}
      <span className={`medal-ring ${crowned ? 'medal-ring--crowned' : ''}`}>
        <span
          className="tabular flex items-center justify-center rounded-full font-extrabold"
          style={{
            width: size,
            height: size,
            background: 'var(--surface-raised)',
            color: 'var(--ink-primary)',
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

function PodiumSeat({
  entry,
  place,
  column,
  leader,
  runnerUp,
  onDelivered,
  totalWon,
}: {
  entry: BoardEntry
  place: number
  column: number
  leader: BoardEntry
  /** The second seat, handed to the first so the champion has a distance too. */
  runnerUp: BoardEntry | null
  onDelivered: boolean
  totalWon: number
}) {
  const seat = SEATS[place - 1]!
  const champion = place === 1
  const figureOf = (e: BoardEntry) => (onDelivered ? e.won : e.ordered)
  const figure = figureOf(entry)
  const leaderFigure = figureOf(leader)
  const gap = leaderFigure - figure
  const closeness = leaderFigure > 0 ? (figure / leaderFigure) * 100 : 0
  const lead = runnerUp ? figure - figureOf(runnerUp) : null

  return (
    <div className={`${seat.col} tv-seat tv-seat--${place} tv-seat--at-${column}`}>
      <div className="podium-card tv-seat-card">
        {/*
          THE PLACE, ON THE CARD'S OWN EDGE. The plaque straddles the top
          border like a medal on a ribbon, so the ordinal is the first thing
          on the seat and is not mistaken for a line of the name.
        */}
        <p className="podium-plaque tv-seat-plaque">
          <span aria-hidden="true">{seat.medal}</span>
          <span className="sr-only">{entry.rank}-oʻrin:</span>
          {/*
            THE RANK, NOT THE SEAT. Ranking is competition-style and shared
            only when BOTH figures match — two sellers who each confirmed one
            order of the same product on «Bugun» are both first — and the rows
            below print the server's rank, so a seat printing its own position
            would put «2-oʻrin» over a joint leader and disagree with the row
            beneath it. The medal, the size and the pedestal follow the seat.
          */}
          <span aria-hidden="true">
            {entry.rank}-oʻrin
            {champion && <span className="hidden xl:inline"> · Chempion</span>}
          </span>
        </p>

        <div className="relative mt-1">
          {champion && <span className="podium-aura" aria-hidden="true" />}
          <PodiumAvatar place={place} size={seat.ring} crowned={champion} />
        </div>

        <p className="tv-seat-name relative mt-3" style={{ color: 'var(--ink-primary)' }}>
          {entry.name}
        </p>
        {entry.badge && (
          <div className="relative mt-1.5">
            <TeamBadge label={entry.badge} />
          </div>
        )}

        {/* THE WHOLE SUM — no tooltip, no tab stop; the digits ARE the reading
            this board reconciles against the floor's own. */}
        <p className="tv-seat-figure relative mt-3" style={{ color: 'var(--ink-primary)' }}>
          <AnimatedNumber value={figure} format={formatFullUzs} duration={900} />
          <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
            soʻm
          </span>
        </p>
        {champion && <div className="podium-gold-rule relative mt-2" aria-hidden="true" />}
        <PodiumBasis onDelivered={onDelivered} className="relative mt-1.5" />

        {/*
          What the number is made of. The other FACT is printed only when it
          is the secondary one — under the fallback nothing has been delivered
          and a row of «FAKT 2 0» on every seat says what the column's caption
          already said, three times.
        */}
        <div className="tabular relative mt-2.5 text-[11px] leading-snug" style={{ color: 'var(--ink-secondary)' }}>
          {onDelivered && (
            <p>
              FAKT 1{' '}
              <span style={{ color: 'var(--ink-primary)' }}>{formatFullUzs(entry.ordered)}</span>
            </p>
          )}
          <p>
            {formatNumber(entry.wonOrders)} / {formatNumber(entry.orders)} buyurtma
            {entry.conversionPercent !== null && (
              <>
                <span className="mx-1">·</span>
                {formatPercent(entry.conversionPercent)}
              </>
            )}
          </p>
        </div>

        {champion ? (
          <div className="relative mt-3 w-full">
            {/*
              THE CHAMPION'S DISTANCE IS THE ONE BEHIND THEM. A leader with
              nothing to read stops being motivated exactly at the top, and
              the runners already read their distance to this seat — so the
              seat states the same fact from its own side: the margin over
              second place, in soʻm, or a level pair when there is none.
              Alone on the podium it prints its share of the whole instead.
            */}
            {lead !== null ? (
              <span className="chase-chip chase-chip--lead inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold">
                <span aria-hidden="true">{lead === 0 ? '🔥' : '🚀'}</span>
                {lead === 0 ? (
                  '2-oʻrin bilan teng'
                ) : (
                  /* Two halves that may part between them and never inside
                     either: a team's margin runs to thirteen digits. */
                  <>
                    <span className="whitespace-nowrap">2-oʻrindan</span>
                    <span className="tabular whitespace-nowrap">+{formatUzs(lead)} oldinda</span>
                  </>
                )}
              </span>
            ) : entry.sharePercent !== null && totalWon > 0 ? (
              <span className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                Jami yutuqning{' '}
                <span className="tabular font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  {formatPercent(entry.sharePercent, 1)}
                </span>
              </span>
            ) : null}
          </div>
        ) : (
          <div className="relative mt-3 w-full">
            {/* The chase — the one number a runner-up can act on — in the
                pill the board already uses for it; `--seq-550`, no new hue. */}
            <span className="chase-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold">
              <span aria-hidden="true">{gap === 0 ? '🔥' : '🎯'}</span>
              {gap === 0 ? (
                'Lider bilan teng'
              ) : (
                <>
                  Liderga <span className="tabular whitespace-nowrap">+{formatUzs(gap)}</span>
                </>
              )}
            </span>
            {/* The bar states its own reading — «N% of the leader» — so the
                proportion never has to be estimated from a length. */}
            <div className="mt-2 flex items-center gap-2">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full"
                style={{ background: 'var(--track)' }}
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, Math.min(100, closeness))}%`,
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
        )}

        {/* Last child, so the streak passes over the whole seat. */}
        {champion && <div className="podium-shine" aria-hidden="true" />}
      </div>

      {/*
        THE PEDESTAL. Decorative — the plaque has already said the place in
        words — and the one part of the seat that is nothing but shape: a
        block whose HEIGHT is the rank, with the numeral cut into its face.
        Painted in the seat's metal, lettered in ink.
      */}
      <div className="tv-pedestal" aria-hidden="true">
        <span className="tv-pedestal-num">{place}</span>
      </div>
    </div>
  )
}

/**
 * The team (or the headcount) as a text badge — chrome tokens, never a
 * series colour. Thirteen ROPs exceed the eight-slot categorical palette.
 */
function TeamBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{
        background: 'var(--surface-sunken)',
        color: 'var(--ink-secondary)',
        border: '1px solid var(--border)',
      }}
    >
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------

/**
 * The rows under the seats, from fourth place down.
 *
 * One table, sticky header, scrolling inside its column — and drifting on
 * its own when nobody touches it (`useAutoScroll`), because a television
 * cannot scroll. `allEntries` is the whole column in rank order, so the
 * fourth row's chase names the bronze seat above it and not nobody.
 */
function BoardList({
  entries,
  allEntries,
  noun,
  onDelivered,
}: {
  entries: readonly BoardEntry[]
  allEntries: readonly BoardEntry[]
  noun: string
  onDelivered: boolean
}) {
  const listRef = useAutoScroll<HTMLDivElement>(entries.length > 0)
  if (entries.length === 0) return null

  // One scale for the whole column — the biggest intake — so a bar can be
  // read against the bar above it. Two layers from the same edge, each the
  // row's own figure on that one scale: light for FAKT 1, dark for FAKT 2.
  // NOT a part-of-whole: FAKT 2 is not a subset of FAKT 1 (an order refused
  // in the queue and delivered anyway is FAKT 2 money that never entered
  // FAKT 1), so the dark layer may run past the light one, and the legend
  // under the header names the two tones rather than leaving the overlap to
  // be read as «shundan».
  const ceiling = Math.max(...allEntries.map((e) => e.ordered), 1)
  const figureOf = (e: BoardEntry) => (onDelivered ? e.won : e.ordered)

  return (
    <div ref={listRef} className="tv-list">
      <table className="tv-table">
        <thead>
          <tr>
            <Th align="right">#</Th>
            <Th>{noun}</Th>
            <Th align="right">FAKT 2 · yetkaz.</Th>
            <Th align="right">FAKT 1 · tasdiq.</Th>
            {/* Dropped between 1280 and 1599 — `.tv-col-optional`. Under 1280
                every column is kept and the list scrolls sideways instead. */}
            <Th align="right" className="tv-col-optional">
              Buyurtma
            </Th>
            <Th align="right" className="tv-col-optional">
              Konv.
            </Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const index = allEntries.findIndex((e) => e.key === entry.key)
            const ahead = index > 0 ? allEntries[index - 1]! : null
            const ranked = entry.won > 0 || entry.ordered > 0
            return (
              <tr key={entry.key} className="tv-row">
                <td className="tabular text-right" style={{ color: 'var(--ink-muted)' }}>
                  {/* A place is only a place once there is money to rank on;
                      a row with none prints a dash, not a rank it was handed
                      by the tie-break. */}
                  {ranked ? (
                    <span className="tv-rank">{entry.rank}</span>
                  ) : (
                    <span aria-label="Hali puli yoʻq">—</span>
                  )}
                </td>
                <td>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="tv-name" style={{ color: 'var(--ink-primary)' }}>
                      {entry.name}
                    </span>
                    {entry.badge && <TeamBadge label={entry.badge} />}
                  </div>
                  <div
                    className="tv-bar relative mt-1 h-1 overflow-hidden rounded-full"
                    style={{ background: 'var(--track)' }}
                    aria-hidden="true"
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${Math.max(1, (entry.ordered / ceiling) * 100)}%`,
                        background: 'var(--seq-250)',
                        transition: 'width var(--duration-enter) var(--ease-out)',
                      }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${Math.max(entry.won > 0 ? 1 : 0, (entry.won / ceiling) * 100)}%`,
                        background: 'var(--seq-550)',
                        transition: 'width var(--duration-enter) var(--ease-out)',
                      }}
                    />
                  </div>
                  <Chase entry={entry} ahead={ahead} figureOf={figureOf} />
                </td>
                <td className="tabular text-right">
                  <span className="tv-money font-semibold" style={{ color: 'var(--ink-primary)' }}>
                    {formatFullUzs(entry.won)}
                  </span>
                  {entry.sharePercent !== null && entry.won > 0 && (
                    <span className="tv-small ml-1.5" style={{ color: 'var(--ink-muted)' }}>
                      {formatPercent(entry.sharePercent, 1)}
                    </span>
                  )}
                </td>
                <td className="tabular text-right">
                  <span className="tv-money" style={{ color: 'var(--ink-secondary)' }}>
                    {formatFullUzs(entry.ordered)}
                  </span>
                </td>
                <td className="tv-col-optional tabular text-right">
                  <span className="tv-money" style={{ color: 'var(--ink-primary)' }}>
                    {formatNumber(entry.orders)}
                  </span>
                  {entry.openOrders !== null && entry.openOrders > 0 && (
                    <span className="tv-small ml-1" style={{ color: 'var(--ink-muted)' }}>
                      ({formatNumber(entry.openOrders)} yoʻlda)
                    </span>
                  )}
                </td>
                <td className="tv-col-optional tabular text-right">
                  <span className="tv-money" style={{ color: 'var(--ink-secondary)' }}>
                    {entry.conversionPercent === null
                      ? NO_VALUE
                      : formatPercent(entry.conversionPercent)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Th({
  children,
  align = 'left',
  className = '',
}: {
  children: ReactNode
  align?: 'left' | 'right'
  /** A width class the column is hidden by, shared with its cells. */
  className?: string
}) {
  return (
    <th scope="col" className={`eyebrow whitespace-nowrap ${className}`} style={{ textAlign: align }}>
      {children}
    </th>
  )
}

/**
 * The chase, under the name: the distance to the row directly ahead.
 * «+2,100,000» is something to do this afternoon. Within reach (a gap under
 * a tenth of the seller's own figure) the line steps up in ink and weight —
 * proximity emphasis, never a hue.
 */
function Chase({
  entry,
  ahead,
  figureOf,
}: {
  entry: BoardEntry
  ahead: BoardEntry | null
  figureOf: (e: BoardEntry) => number
}) {
  const own = figureOf(entry)
  const gap = ahead ? figureOf(ahead) - own : null
  const near = gap !== null && gap > 0 && gap <= own * 0.1

  const chase =
    own === 0 ? null : gap === null ? (
      <span className="font-medium" style={{ color: 'var(--ink-secondary)' }}>
        Lider
      </span>
    ) : gap === 0 ? (
      <span style={{ color: 'var(--ink-secondary)' }}>
        <span aria-hidden="true">🔥</span> Oldingi bilan teng
      </span>
    ) : (
      <span
        className={`tabular ${near ? 'font-semibold' : ''}`}
        style={{ color: near ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}
      >
        <span aria-hidden="true">🎯</span> Oldingiga{' '}
        <span className="whitespace-nowrap">+{formatUzs(gap)}</span>
      </span>
    )

  if (!chase) return null

  return (
    <p className="tv-chase tv-small mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
      {chase}
    </p>
  )
}
