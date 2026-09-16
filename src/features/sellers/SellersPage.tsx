'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import { EmptyState, ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Lavha } from '@/features/sellers/Lavha'
import { LevelBlock, isNearNextLevel, nextLevelSentence } from '@/features/sellers/LevelBlock'
import { MedalDefs } from '@/features/sellers/MedalDefs'
import { MedalRail } from '@/features/sellers/MedalRail'
import { Narvon } from '@/features/sellers/Narvon'
import { PromotionBanner } from '@/features/sellers/PromotionBanner'
import { RecordWall } from '@/features/sellers/RecordWall'
import { RowMedals } from '@/features/sellers/RowMedals'
import { SpeakingMedal } from '@/features/sellers/SpeakingMedal'
import { useAutoScroll } from '@/features/sellers/useAutoScroll'
import { useMedalRotation } from '@/features/sellers/useMedalRotation'
import { useNewMedals, usePromotions } from '@/features/sellers/usePromotions'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  type MedalCode,
  type SellerBoardDto,
  type SellerBoardRowDto,
  type SellerMedalDto,
  type SellerMedalRowDto,
  type SellerMedalsDto,
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

/** Medal shaxsiy — ROP komandasiga berilmaydi, shuning uchun komandalar
 *  ustuni har doim bo'sh Map bilan chizadi. */
const EMPTY_MEDALS: ReadonlyMap<string, SellerMedalRowDto> = new Map()

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

  /*
    PAGON O'Z SO'ROVIDA VA O'Z SOATIDA — devorning naqshi.

    Uch sabab. Oynasi boshqa: medal `RECORDS_FROM` dan bugungacha, taxta esa
    tanlangan davr — bir payloadga solish medalni filtr tugmasi bilan
    o'chiradigan qilib qo'yardi. Sur'ati boshqa: taxta oltmish soniyada,
    medal o'n daqiqada o'zgaradi. Va eng muhimi — BUZILMASLIK: bu so'rov
    xato bersa yoki kechiksa, televizordagi reyting hech nima sezmaydi,
    faqat pagon ko'rinmaydi.

    `staleTime` va `refetchInterval` — ikkalasi ham, chunki `refetchInterval`
    staleness'ni hech qachon so'ramaydi va bittasini qo'yish hech narsa
    bermaydi (`?include=records` ning o'sha juftligi).
  */
  const medals = useQuery({
    queryKey: ['sellers', 'medals'],
    queryFn: ({ signal }) => apiGet<SellerMedalsDto>('/analytics/sellers', { include: 'medals' }, signal),
    staleTime: 600_000,
    refetchInterval: 600_000,
    placeholderData: (previous) => previous,
  })

  const medalsById = useMemo(() => {
    const map = new Map<string, SellerMedalRowDto>()
    for (const row of medals.data?.data.sellers ?? []) map.set(row.employeeId, row)
    return map
  }, [medals.data])

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

  /*
    WHICH FACT THE BOARD IS READ ON — ONE CHOICE FOR BOTH COLUMNS.

    The client asked for it on 2026-09-10: «ikkita boʻlimni sotuvchilar va
    komandalar boʻyichasini fakt 1 va fakt 2 boʻyicha koʻrish mumkin boʻlsin.
    reytingni». So both headings carry the switch — that is where they pointed
    — and both press the SAME state, which is the part that is not cosmetic:
    a team's money is its sellers' money summed, so a board reading FAKT 1 on
    the left and FAKT 2 on the right invites exactly the reconciliation
    `PodiumBasis` exists to prevent, one column deep instead of one slot deep.

    'auto' is what the board did before the switch and is still what it opens
    on — FAKT 2 the moment anybody has delivered, FAKT 1 while nobody has —
    so a television nobody touches behaves as it always did. Local state, not
    the URL, for the reason the phone's switch is: which fact somebody is
    reading is not a question a pasted link needs to answer, and on this
    dashboard a URL write is a server round trip (`SHALLOW_ROUTES`).
  */
  const [fakt, setFakt] = useState<FaktChoice>('auto')

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
        {/*
          SAHIFANING YAGONA <defs>. Lavha ham, medal ham `<use href="#…">`
          bilan chiziladi, ya'ni belgilar bir marta, taxtaning boshida
          e'lon qilinishi shart — har qatorga nusxa qo'yilsa id'lar
          takrorlanadi va `<use>` birinchisiga bog'lanib qoladi.
        */}
        <MedalDefs />

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
            fakt={fakt}
            onFakt={setFakt}
            medals={medalsById}
            medalsToday={medals.data?.data.today ?? null}
          />
          <TeamsColumn
            data={data}
            status={status}
            errorMessage={errorMessage}
            onRetry={retry}
            parked={shown !== 'teams'}
            fakt={fakt}
            onFakt={setFakt}
            medals={EMPTY_MEDALS}
            medalsToday={medals.data?.data.today ?? null}
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
/**
 * Which of the two facts the board is ranked and read on.
 *
 * 'auto' is not a third reading — it is the absence of a decision, and it
 * resolves to one of the other two on every render: FAKT 2 once anybody has
 * delivered, FAKT 1 until then. It has to stay reachable as the OPENING
 * state, or a board left on «Bugun» overnight opens pinned to a fact nobody
 * has any money in yet.
 */
export type FaktChoice = 'auto' | 'fakt1' | 'fakt2'

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
  /** Which fact BOTH columns are read on — the page owns it, not the column. */
  fakt: FaktChoice
  onFakt: (choice: FaktChoice) => void
  /** Sotuvchi id si bo'yicha pagon. Komandalar ustuni uchun bo'sh Map. */
  medals: ReadonlyMap<string, SellerMedalRowDto>
  /**
   * `SellerMedalsDto.today` — e'lon lentasi `promotedOn` ni shu sana kaliti
   * bilan solishtiradi, ya'ni «bugun» hisobot mintaqasida, brauzer soatida
   * emas. So'rov kelmagan bo'lsa null va hech kim e'lon qilinmaydi.
   */
  medalsToday: string | null
}

/** Exported for the tests, like `TotalsBand` before it. */
export function SellersColumn({
  data,
  status,
  errorMessage,
  onRetry,
  parked = false,
  fakt,
  onFakt,
  medals,
  medalsToday,
}: ColumnProps) {
  const entries = useMemo(() => data?.rows.map(fromSeller) ?? [], [data])
  return (
    <BoardColumn
      id="tv-sellers"
      tone="sellers"
      parked={parked}
      fakt={fakt}
      onFakt={onFakt}
      glyph="🏆"
      title="Sotuvchilar"
      noun="Sotuvchi"
      count={(n) => `${formatNumber(n)} ta sotuvchi`}
      entries={entries}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      empty="Tanlangan davrda hech kim buyurtma olmagan — podium keyingi buyurtmani kutmoqda."
      medals={medals}
      medalsToday={medalsToday}
    />
  )
}

export function TeamsColumn({
  data,
  status,
  errorMessage,
  onRetry,
  parked = false,
  fakt,
  onFakt,
  medals,
  medalsToday,
}: ColumnProps) {
  const entries = useMemo(() => data?.teams.map(fromTeam) ?? [], [data])
  const teamless = data?.totals.teamlessSellers ?? 0
  return (
    <BoardColumn
      id="tv-teams"
      tone="teams"
      parked={parked}
      fakt={fakt}
      onFakt={onFakt}
      glyph="🛡️"
      title="Komandalar"
      noun="Komanda (ROP)"
      count={(n) =>
        teamless > 0
          ? `${formatNumber(n)} ta komanda · ${formatNumber(teamless)} ta sotuvchi komandasiz, ulushlar ularsiz`
          : `${formatNumber(n)} ta komanda`
      }
      entries={entries}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      empty="Bu davrda hech bir ROP komandasi buyurtma olmagan."
      medals={medals}
      medalsToday={medalsToday}
    />
  )
}

/**
 * The board's own order, over whichever fact is being read.
 *
 * THIS MIRRORS `SellerBoardService` — `buildBoard` for the sellers and
 * `teamRows` for the teams — AND HAS TO KEEP MIRRORING IT: the fact being
 * read, then the other one, then the key, with competition ranking over BOTH
 * figures so equal money is an equal rank and the next rank skips. Read on
 * FAKT 2 it reproduces the ranks the service already sent, which is what
 * `sellersTvBoard.test.tsx` asserts row by row; read on FAKT 1 it is the same
 * rule with the two keys swapped, and that swap is the whole of what the
 * switch does. Ranking on the leading fact alone is the failure both those
 * comments record: on «Bugun» nobody has FAKT 2, the comparison ties for all
 * fifteen teams, and the tie-break — a name, an employee id — becomes the
 * ranking, under a seat claiming a fact.
 *
 * WHY IT IS DONE HERE AND NOT ASKED OF THE API. Every row is already on the
 * payload carrying both facts; this is ONE answer read two ways, not a second
 * question. So the switch costs no request, cannot straddle a sync, cannot
 * flash a stale board while a second one lands, and cannot disagree with the
 * totals beside it. The key stays the last resort — an employee id, a ROP's
 * name — so two rows level on both figures do not swap places between two
 * refreshes of one screen.
 */
function rankedBy(
  entries: readonly BoardEntry[],
  onDelivered: boolean,
): readonly BoardEntry[] {
  const read = (e: BoardEntry) => (onDelivered ? e.won : e.ordered)
  const other = (e: BoardEntry) => (onDelivered ? e.ordered : e.won)

  const ordered = [...entries].sort(
    (a, b) => read(b) - read(a) || other(b) - other(a) || a.key.localeCompare(b.key),
  )

  let rank = 0
  return ordered.map((entry, index) => {
    const previous = index > 0 ? ordered[index - 1]! : null
    // Equal on BOTH figures, because both decide the order. Otherwise two
    // sellers level on the fact being read but far apart on the other would
    // share a rank the sort has already separated them by, and the board
    // would print 1, 1, 3 over rows that visibly differ.
    if (!previous || previous.won !== entry.won || previous.ordered !== entry.ordered) {
      rank = index + 1
    }
    return { ...entry, rank }
  })
}

/**
 * FAKT 1 / FAKT 2 — the switch in each heading, and the only thing on this
 * board that answers a press.
 *
 * IT SHOWS THE RESOLVED FACT, NOT THE STORED CHOICE. The board opens on
 * 'auto', and an 'auto' that lit neither button would leave a reader unable
 * to tell which fact they are looking at from the control that names both —
 * with the seats' own caption two lines below saying it outright. So the
 * button that is lit is the one the board is actually ranked on, and pressing
 * it changes nothing but the fact that it is now pinned.
 *
 * TWO BUTTONS AND NO WAY BACK TO 'auto'. A third state on a television is a
 * third thing to read from across a room, and the state it would return to is
 * only ever the opening one; a floor that pins FAKT 2 at nine in the morning
 * sees «Podium hali boʻsh» and the other button, lit, one press away.
 */
function FaktSwitch({
  fakt,
  onFakt,
}: {
  fakt: 'fakt1' | 'fakt2'
  onFakt: (choice: FaktChoice) => void
}) {
  return (
    /*
      `data-fakt` IS WHAT MOVES THE LIT PILL. The thumb is one element on the
      track (`.tv-fakt::before`) rather than a background each button paints
      for itself, so the press reads as a slide from one fact to the other.
      The attribute carries the RESOLVED fact, the same one `aria-pressed`
      below is answering — they cannot disagree.
    */
    <div
      className="tv-fakt"
      data-fakt={fakt}
      role="group"
      aria-label="Reyting qaysi fakt boʻyicha"
    >
      {(
        [
          ['fakt1', 'FAKT 1'],
          ['fakt2', 'FAKT 2'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          className="tv-fakt-tab focusable"
          aria-pressed={fakt === key}
          onClick={() => onFakt(key)}
        >
          {/*
            The mark that carries across a room — a filled disc in the column's
            hue on the lit fact, a hollow one on the other. Decoration only:
            `aria-pressed` is the state a reader is told.
          */}
          <span aria-hidden="true" className="tv-fakt-dot" />
          {label}
        </button>
      ))}
    </div>
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
  fakt,
  onFakt,
  glyph,
  title,
  noun,
  count,
  entries,
  status,
  errorMessage,
  onRetry,
  empty,
  medals,
  medalsToday,
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
  fakt: FaktChoice
  onFakt: (choice: FaktChoice) => void
  glyph: string
  title: string
  /** The name column's header. */
  noun: string
  count: (n: number) => string
  entries: readonly BoardEntry[]
  status: Status
  errorMessage?: string
  onRetry: () => void
  empty: string
  /** Sotuvchi id si bo'yicha pagon. Komandalar ustuni uchun bo'sh Map. */
  medals: ReadonlyMap<string, SellerMedalRowDto>
  /**
   * `SellerMedalsDto.today` — e'lon lentasi shu kunni `promotedOn` bilan
   * solishtiradi. Sana serverdan keladi, brauzerning soatidan emas: taxta
   * hisobot mintaqasida yashaydi, televizor esa qayerda bo'lsa o'sha yerda.
   */
  medalsToday: string | null
}) {
  /*
    THE FACT FIRST, THEN THE ORDER — the heading's switch decides both, and
    it decides them in that sequence because the second follows the first.

    'auto' resolves the way the board always did: FAKT 2 the moment anybody
    has delivered, FAKT 1 while nobody has. Delivery takes days, so for most
    of a working day nobody has FAKT 2, and a podium gated on it stood empty
    over a floor that had confirmed 148 mln soʻm between 55 people.

    THE TOP THREE OF WHOEVER HAS THE FACT BEING READ. It used to be the top
    three of whoever had ANY money, which on a window where two people had
    delivered seated a third card printing «0 soʻm» under «FAKT 2 ·
    yetkazilgan». With the fact now chosen rather than inferred, an empty
    podium is an answer — «hech kim yetkazmagan hali» — and the branch below
    already has words for it.
  */
  const onDelivered = fakt === 'auto' ? entries.some((e) => e.won > 0) : fakt === 'fakt2'
  const ranked = useMemo(() => rankedBy(entries, onDelivered), [entries, onDelivered])
  const winners = ranked.filter((e) => (onDelivered ? e.won : e.ordered) > 0).slice(0, 3)
  const seated = new Set(winners.map((w) => w.key))
  const rows = ranked.filter((e) => !seated.has(e.key))

  /*
    USTUNGA BITTA SOAT. Uch seat bir vaqtda o'z medalini almashtirsa,
    televizorga qarab turgan odam uchta joyda bir vaqtda o'zgarishni ko'radi
    va hech birini o'qishga ulgurmaydi — navbat esa ritm beradi. Qaysi seat
    gapirayotganini `useMedalRotation` aytadi; qolgan ikkitasi jim turadi.
  */
  const speaking = useMedalRotation(
    useMemo(
      () =>
        winners.map((entry) => ({
          employeeId: entry.key,
          medals: medals.get(entry.key)?.medals ?? [],
        })),
      [winners, medals],
    ),
  )

  /*
    MAROSIM — USTUNNING O'ZIDA, chunki e'lon ustun sarlavhasida turadi va
    ko'tarilgan odam shu ustunning qatorlari orasida. Komandalar ustuni
    e'lon qilmaydi: daraja shaxsiy, ROP komandasiga berilmaydi — shuning
    uchun unga bo'sh xarita beriladi (hook shartsiz chaqiriladi).

    `onBoard` — shu ustunda chizilgan kalitlar: taxtada yo'q odamning
    ko'tarilishi sarflanmaydi, chunki medal oynasi taxta oynasi emas.
    `useMemo` SHART — to'plam effektning bog'liqliklarida turibdi.
  */
  const onBoard = useMemo(() => new Set(entries.map((e) => e.key)), [entries])
  const promotion = usePromotions(tone === 'sellers' ? medals : EMPTY_MEDALS, medalsToday, onBoard)
  const promotedName =
    promotion === null ? null : (entries.find((e) => e.key === promotion.employeeId)?.name ?? null)
  const newMedals = useNewMedals(medals)

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
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
              <p className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                {count(entries.length)}
              </p>
              {/*
                THE ONE CONTROL ON THIS BOARD, and it is drawn in both headings
                on purpose — a phone shows one column at a time, so a switch
                living over only one of them would be unreachable from the
                other. Both press the page's single choice; see the block in
                `SellersPage`.
              */}
              <FaktSwitch fakt={onDelivered ? 'fakt2' : 'fakt1'} onFakt={onFakt} />
            </div>
          )}
        </div>
        {/*
          E'LON — sarlavha ostida, 8 soniya. Podiumdagi yulduz tushishi
          faqat uchta o'rindiqda ko'rinadi; 40-o'rindagi odamning
          ko'tarilishini butun ustunga aytadigan yagona joy shu.
        */}
        {promotion !== null && promotedName !== null && (
          <PromotionBanner promotion={promotion} name={promotedName} />
        )}
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
          {/*
            NARVON SHU YERDA HAM. Seat yo'q, lekin qatorlarda lavha bor — va
            izohsiz plastina o'zini tushuntirmaydi. Birinchi daqiqalarda taxta
            aynan shu holatda turadi, ya'ni ko'pchilik narvonni birinchi marta
            shu yerda ko'radi. Sharti tayyor branchdagining aynan o'zi.
          */}
          {tone === 'sellers' && medals.size > 0 && <Narvon />}
          <BoardList
            entries={ranked}
            allEntries={ranked}
            noun={noun}
            onDelivered={onDelivered}
            medals={medals}
            newMedals={newMedals}
          />
        </>
      ) : (
        <>
          <Podium
            winners={winners}
            onDelivered={onDelivered}
            medals={medals}
            speaking={speaking}
            risingId={promotion?.employeeId ?? null}
            newMedals={newMedals}
          />
          {/*
            NARVON PODIUM OSTIDA, BIR MARTA — «daraja o'rin emas» jumlasining
            o'rnini bosgan chizma. Faqat sotuvchilar ustunida: daraja shaxsiy,
            ROP komandasiga berilmaydi. Medal so'rovi kelmagan bo'lsa taxta
            hech nima sezmasligi kerak, shuning uchun `medals.size` shart.
          */}
          {tone === 'sellers' && medals.size > 0 && <Narvon />}
          <BoardList
            entries={rows}
            allEntries={ranked}
            noun={noun}
            onDelivered={onDelivered}
            medals={medals}
            newMedals={newMedals}
          />
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
  medals,
  speaking,
  risingId,
  newMedals,
}: {
  winners: readonly BoardEntry[]
  onDelivered: boolean
  medals: ReadonlyMap<string, SellerMedalRowDto>
  /** Ustunning yagona soati — qaysi seat, qaysi medal. */
  speaking: ReturnType<typeof useMedalRotation>
  /** Hozirgina ko'tarilgan seat; marosim faqat bittasida. */
  risingId: string | null
  /** Oxirgi yangilanishda paydo bo'lgan medallar, sotuvchi id si bo'yicha. */
  newMedals: ReadonlyMap<string, ReadonlySet<MedalCode>>
}) {
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
          onDelivered={onDelivered}
          medal={medals.get(entry.key) ?? null}
          speaking={speaking?.employeeId === entry.key ? speaking.medal : null}
          rise={risingId === entry.key}
          newKeys={newMedals.get(entry.key)}
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
  onDelivered,
  medal,
  speaking,
  rise,
  newKeys,
}: {
  entry: BoardEntry
  place: number
  column: number
  onDelivered: boolean
  /** Shu odamning daraja qatori; medal so'rovi kelmagan bo'lsa null. */
  medal: SellerMedalRowDto | null
  /** Ustun soati shu seatga navbat bergan medal, yoki null. */
  speaking: SellerMedalDto | null
  /** Ko'tarilish marosimi — yulduzlar tushadi, lavha bir marta yaltiraydi. */
  rise: boolean
  /** Shu yangilanishda ochilgan medallar — bir marta kattalashib tushadi. */
  newKeys: ReadonlySet<MedalCode> | undefined
}) {
  const seat = SEATS[place - 1]!
  const champion = place === 1
  const figureOf = (e: BoardEntry) => (onDelivered ? e.won : e.ordered)
  const figure = figureOf(entry)

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
          What the number is made of. THE OTHER FACT, WHEN THERE IS ONE TO
          PRINT. It used to be drawn only under a FAKT 2 reading, because the
          other reading meant nobody had delivered and a row of «FAKT 2 0» on
          every seat said what the caption above it already said, three times.
          Since 2026-09-10 FAKT 1 is a reading somebody CHOOSES, and on a
          window where deliveries exist the fact left off the seat is real
          money — so the test is whether it exists, not which way round the
          two are. Nobody delivered, nothing printed, exactly as before.

          «N / M buyurtma · %» SATRI 2026-09-16 DA OLIB TASHLANDI. Mijoz
          seat'ning shu pastki burchagini «noaniq keraksiz xolat» deb atadi va
          o'rniga darajani so'radi: buyurtma soni ham, konversiya ham
          pastdagi jadvalning o'z ustunlarida turibdi, seat esa faqat pulni
          va odamning darajasini aytadi. Faqat FAKT-boshqa-fakt qatori qoldi —
          va u endi o'ralmaydi: yagona bolasi chizilmaydigan o'ram `mt-2.5` ni
          baribir olib kelardi, ya'ni yo'q satr ostida bo'sh joy qolardi.
        */}
        {(onDelivered ? entry.ordered : entry.won) > 0 && (
          <p
            className="tabular relative mt-2.5 text-[11px] leading-snug"
            style={{ color: 'var(--ink-secondary)' }}
          >
            {onDelivered ? 'FAKT 1' : 'FAKT 2'}{' '}
            <span style={{ color: 'var(--ink-primary)' }}>
              {formatFullUzs(onDelivered ? entry.ordered : entry.won)}
            </span>
          </p>
        )}

        {/*
          DARAJA, TOKCHA, GAPIRUVCHI KARTA — medal so'rovi kelgan seatda.
          Sharpa faqat chempionda: uchta seatda uchta «keyingi lavha» bir-biri
          bilan poyga qilib ko'rinardi, va kengroq karta faqat o'rtadagisida
          joy bor. So'rov kelmasa (`medal === null`) seat avvalgidek chiziladi.
        */}
        {medal !== null && (
          <>
            <LevelBlock row={medal} ghost={champion} rise={rise} />
            <MedalRail medals={medal.medals} newKeys={newKeys} />
            {speaking !== null && <SpeakingMedal medal={speaking} />}
          </>
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
  medals,
  newMedals,
}: {
  entries: readonly BoardEntry[]
  allEntries: readonly BoardEntry[]
  noun: string
  onDelivered: boolean
  /** Sotuvchi id si bo'yicha pagon. Komandalar ustuni uchun bo'sh Map. */
  medals: ReadonlyMap<string, SellerMedalRowDto>
  /** Oxirgi yangilanishda paydo bo'lgan medallar, sotuvchi id si bo'yicha. */
  newMedals: ReadonlyMap<string, ReadonlySet<MedalCode>>
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
            {/* BOTH FACTS STAY ON EVERY ROW, whichever one is being read —
                the switch moves the emphasis and the order, it never hides a
                figure. The ranked column is the one marked `aria-sort`, so a
                reader who cannot see the weight is told which it is. */}
            <Th align="right" sorted={onDelivered}>
              FAKT 2 · yetkaz.
            </Th>
            <Th align="right" sorted={!onDelivered}>
              FAKT 1 · tasdiq.
            </Th>
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
            // BIR MARTA QIDIRILADI. Katakcha uni sakkiz joyda o'qiydi, va
            // `medals.get(...)!` ning sakkizta nusxasi bir kun bittasi
            // yangilanmay qolib, `undefined` ustida yorilishi uchun turadi.
            const medal = medals.get(entry.key) ?? null
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
                  {/*
                    USTUN QO'SHILMAYDI — lavha ham, medallar ham ISM
                    KATAKCHASINING ichida. Jadval 390px da allaqachon yon
                    skroll qiladi (oltita nowrap ustun), ettinchisi esa
                    telefonda ismni ekrandan chiqarib yuborardi: chapda
                    plastina, o'rtada ism va unvon so'zi, o'ngda medallar.
                  */}
                  <div className="tv-namecell">
                    {medal !== null && (
                      <Lavha level={medal.level} legendaTier={medal.legendaTier} size="row" />
                    )}
                    <div className="tv-namecell-main">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="tv-name" style={{ color: 'var(--ink-primary)' }}>
                          {entry.name}
                        </span>
                        {entry.badge && <TeamBadge label={entry.badge} />}
                        {medal !== null && (
                          <span className={`lavha-word${isNearNextLevel(medal) ? ' lavha-word--near' : ''}`}>
                            {medal.rankTitle ?? 'hali savdosiz'}
                          </span>
                        )}
                      </div>
                      {/* bar — AVVALGIDEK, o'zgarmaydi */}
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
                      <Chase
                        entry={entry}
                        ahead={ahead}
                        figureOf={figureOf}
                        next={medal === null ? null : nextLevelSentence(medal)}
                      />
                    </div>
                    {medal !== null && (
                      <RowMedals medals={medal.medals} newKeys={newMedals.get(entry.key)} />
                    )}
                  </div>
                </td>
                <td className="tabular text-right">
                  <span
                    className={`tv-money ${onDelivered ? 'font-semibold' : ''}`}
                    style={{ color: onDelivered ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}
                  >
                    {formatFullUzs(entry.won)}
                  </span>
                  {entry.sharePercent !== null && entry.won > 0 && (
                    <span className="tv-small ml-1.5" style={{ color: 'var(--ink-muted)' }}>
                      {formatPercent(entry.sharePercent, 1)}
                    </span>
                  )}
                </td>
                <td className="tabular text-right">
                  <span
                    className={`tv-money ${onDelivered ? '' : 'font-semibold'}`}
                    style={{ color: onDelivered ? 'var(--ink-secondary)' : 'var(--ink-primary)' }}
                  >
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
  sorted = false,
}: {
  children: ReactNode
  align?: 'left' | 'right'
  /** A width class the column is hidden by, shared with its cells. */
  className?: string
  /** The fact the rows are ordered by. Descending, always. */
  sorted?: boolean
}) {
  return (
    <th
      scope="col"
      className={`eyebrow whitespace-nowrap ${className}`}
      style={{ textAlign: align }}
      aria-sort={sorted ? 'descending' : undefined}
    >
      {children}
    </th>
  )
}

/**
 * The chase, under the name: the distance to the row directly ahead.
 * «+2,100,000» is something to do this afternoon. Within reach (a gap under
 * a tenth of the seller's own figure) the line steps up in ink and weight —
 * proximity emphasis, never a hue.
 *
 * IKKI BO'LAK, IKKI POYGA. Birinchisi — oldindagi odam, ikkinchisi —
 * keyingi daraja. Ular bir-birini almashtirmaydi: lider oldida hech kim
 * yo'q, lekin keyingi lavha baribir bor, va shu yagona narsa uni bugun ham
 * ishlashga undaydi.
 */
function Chase({
  entry,
  ahead,
  figureOf,
  next,
}: {
  entry: BoardEntry
  ahead: BoardEntry | null
  figureOf: (e: BoardEntry) => number
  /** Keyingi darajagacha qolgan pul, so'z bilan. Medal so'rovi kelmasa null. */
  next?: string | null
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

  if (!chase && !next) return null

  return (
    <p className="tv-chase tv-small mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
      {chase}
      {next && (
        <span className="tabular font-medium" style={{ color: 'var(--ink-secondary)' }}>
          {next}
        </span>
      )}
    </p>
  )
}
