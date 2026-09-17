'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { type FaktChoice, fromSeller, fromTeam } from '@/features/sellers/board'
import { todayDateLine } from '@/features/sellers/dateLine'
import { MedalDefs } from '@/features/sellers/MedalDefs'
import { RecordWall } from '@/features/sellers/RecordWall'
import { SellersBoard, type Status } from '@/features/sellers/SellersBoard'
import { TeamsBoard } from '@/features/sellers/TeamsBoard'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type SellerBoardDto, type SellerMedalRowDto, type SellerMedalsDto, apiGet } from '@/lib/api'
import { t } from '@/lib/messages'

/**
 * Sotuvchilar reytingi — the board on the television. EFIR (2026-09-16).
 *
 * THIS SCREEN HAS ONE AUDIENCE AND ONE PLACE: the sellers themselves, reading
 * it off a TV on the sales floor — «sotuvchilar reytingi faqat sotuvchilar
 * oʻz reytingini televizordan koʻrishi uchun kerak» (2026-09-07). Two
 * columns, nothing that is not a rank: sellers left (three seats over a
 * timing-tower list), teams right (one-line rows). Everything analytical
 * lives on Savdo dinamikasi. No bonus is printed here at all.
 *
 * A TELEVISION HAS NO MOUSE: nothing opens or filters; both columns take
 * the screen's height (`PageShell fill`) and each LIST drifts inside its
 * column (`useAutoScroll`) with its label strip standing still above it.
 * Type is the `--tv-*` scale (44/24/16/13, a step smaller under 1600).
 *
 * ONE ACCENT, ONE METAL. Level is the only hue on the board — the `--tier`
 * band and crest on every row and seat — and gold the only metal (rank
 * halos, medals, the record wall's labels). The two columns are told apart
 * by their content and their headings, not by a frame colour.
 *
 * NO ROP COLOUR CODING, still: fifteen teams exceed the palette, and the
 * team rides as muted text beside the name.
 */
export function SellersPage() {
  const { apiParams: filterParams } = useDashboardFilters()

  /*
    ONE CLOCK. The board reads the floor's own FAKT 1 / FAKT 2 — dated by the
    order's arrival in C4:NEW — and there is no control to change it. The
    'intake' reading still exists behind `?basis=intake` as the oracle a
    queue regression is checked against; it was never a second board.
  */
  const basis = 'queue' as const
  const apiParams = useMemo(() => ({ ...filterParams, basis }), [filterParams, basis])

  const board = useQuery({
    queryKey: ['sellers', 'board', apiParams],
    queryFn: ({ signal }) => apiGet<SellerBoardDto>('/analytics/sellers', apiParams, signal),
    placeholderData: (previous) => previous,
  })

  /*
    DARAJA VA MEDALLAR O'Z SO'ROVIDA VA O'Z SOATIDA — devorning naqshi.

    Oynasi boshqa: medal `RECORDS_FROM` dan bugungacha, taxta esa tanlangan
    davr — bir payloadga solish medalni filtr tugmasi bilan o'chiradigan qilib
    qo'yardi. Sur'ati boshqa: taxta oltmish soniyada, medal o'n daqiqada. Va
    BUZILMASLIK: bu so'rov xato bersa yoki kechiksa, televizordagi reyting
    hech nima sezmaydi — faqat gerb, progress, legenda va medallar ko'rinmaydi.

    `staleTime` va `refetchInterval` — ikkalasi ham: `refetchInterval`
    staleness'ni hech qachon so'ramaydi, bittasini qo'yish hech narsa bermaydi.
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
  const status: Status = board.isPending ? 'loading' : board.isError ? 'error' : 'ready'
  const errorMessage = (board.error as Error | null)?.message
  const retry = () => void board.refetch()

  /*
    ONE BOARD AT A TIME UNDER 1280px — a phone gets a switch and sees one
    column («scroll qilish qiyinlashgan», 2026-09-07); the television sees
    both and no switch. Local state, not the URL.
  */
  const [shown, setShown] = useState<'sellers' | 'teams'>('sellers')

  /*
    WHICH FACT THE BOARD IS READ ON — ONE CHOICE FOR BOTH COLUMNS
    (2026-09-10: «ikkita boʻlimni … fakt 1 va fakt 2 boʻyicha koʻrish mumkin
    boʻlsin»). Both headings carry the switch and both press the SAME state:
    a team's money is its sellers' money summed, so two halves reading
    different facts would be the reconciliation the seat caption exists to
    prevent. 'auto' is the opening state — FAKT 2 once anybody has delivered.
    Local state: a URL write on this dashboard is a server round trip.
  */
  const [fakt, setFakt] = useState<FaktChoice>('auto')

  /*
    «BUGUN» NAMES ITS DAY (EFIR Premium spec §7): «17-sentabr 2026, payshanba ·
    bugun» instead of the shell's «17-sen 2026 – 17-sen 2026». PageShell is
    shared chrome and reaches /confirmation, so it is not edited: on the today
    window the page hands the line over as `description` and passes `meta`
    WITHOUT its period, which is what stops the shell printing the range after
    it. Everything else meta carries — the data source, the truncation badge —
    still travels. The window is read from the RESPONSE (`meta.period`), not
    from the control, so the words never name a day the numbers are not from.
  */
  const meta = board.data?.meta
  const today = meta?.period?.preset === 'today' ? meta.period : undefined
  const shellMeta = useMemo(() => (today && meta ? { ...meta, period: undefined } : meta), [meta, today])

  return (
    <PageShell
      title={t.nav.sellers}
      description={today ? todayDateLine(today.start) : undefined}
      meta={shellMeta}
      /* THE RECORD WALL RIDES THE TITLE LINE — two static bands between the
         title and the period control (spec §7), on its own ten-minute clock. */
      banner={<RecordWall />}
      stale={board.isPlaceholderData}
      accent="var(--series-5)"
      controlsAlign="end"
      fill
    >
      <div className="tv-board-shell flex min-h-0 flex-col gap-3">
        {/*
          SAHIFANING YAGONA <defs>. Gerb ham, medal ham `<use href="#…">`
          bilan chiziladi — belgilar bir marta, taxtaning boshida.
        */}
        <MedalDefs />

        <div className="tv-switch" role="tablist" aria-label="Qaysi reyting">
          {(
            [
              ['sellers', 'Sotuvchilar'],
              ['teams', 'Komandalar'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={shown === key}
              aria-controls={`tv-${key}`}
              className="tv-switch-tab"
              onClick={() => setShown(key)}
            >
              {label}
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
            medals={medalsById}
            medalsToday={medals.data?.data.today ?? null}
          />
        </div>

        {/*
          THE PAGE FOOT (EFIR Premium spec §7): the three definitions the
          numbers on this board rest on, and who made it. Nothing here is a
          rank and nothing here moves. No «hozircha» definition — the client
          declined that word everywhere on this screen (2026-09-17).
        */}
        <footer className="tv-foot">
          <p className="tv-foot__defs">
            <span>
              <b>Konv.</b> = yetkazilgan ÷ (yetkazilgan + barcha bekor)
            </span>
            <span>
              <b>Buyurt.</b> = FAKT 1 buyurtmalari
            </span>
            <span>
              <b>Daraja</b> — avgustdan beri yetkazilgan pul boʻyicha
            </span>
          </p>
          <p className="tv-credit">Developed by Yusuf</p>
        </footer>
      </div>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------

/** Ikkala ustun bir xil shaklni oladi — testlar ikkalasiga bir `PROPS` beradi. */
export interface ColumnProps {
  data: SellerBoardDto | undefined
  status: Status
  errorMessage?: string
  onRetry: () => void
  /** Hidden under 1280px while the switch shows the other board. */
  parked?: boolean
  /** Which fact BOTH columns are read on — the page owns it, not the column. */
  fakt: FaktChoice
  onFakt: (choice: FaktChoice) => void
  /** Sotuvchi id si bo'yicha daraja va medallar. Komandalar ustuni o'qimaydi — daraja shaxsiy. */
  medals: ReadonlyMap<string, SellerMedalRowDto>
  /** `SellerMedalsDto.today` — e'lonning birinchi tetigi; komandalar ustuni o'qimaydi. */
  medalsToday: string | null
}

/** Exported for the tests. */
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
    <SellersBoard
      entries={entries}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      parked={parked}
      fakt={fakt}
      onFakt={onFakt}
      medals={medals}
      medalsToday={medalsToday}
    />
  )
}

export function TeamsColumn({ data, status, errorMessage, onRetry, parked = false, fakt, onFakt }: ColumnProps) {
  const entries = useMemo(() => data?.teams.map(fromTeam) ?? [], [data])
  // Komandasizlar puli = `rop === null` sotuvchi qatorlari (spec §6) — DTO o'zgarmaydi.
  const sellers = useMemo(() => data?.rows.map(fromSeller) ?? [], [data])
  return (
    <TeamsBoard
      entries={entries}
      sellers={sellers}
      teamless={data?.totals.teamlessSellers ?? 0}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      parked={parked}
      fakt={fakt}
      onFakt={onFakt}
    />
  )
}
