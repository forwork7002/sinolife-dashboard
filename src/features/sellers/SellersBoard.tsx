'use client'

import { type CSSProperties, useMemo } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import {
  type BoardEntry,
  type FaktChoice,
  figureOf,
  rankedBy,
  resolveOnDelivered,
  splitBoard,
} from '@/features/sellers/board'
import { ColumnHead } from '@/features/sellers/ColumnHead'
import { Crest } from '@/features/sellers/Crest'
import { PromotionBanner } from '@/features/sellers/PromotionBanner'
import { RowMedals } from '@/features/sellers/RowMedals'
import { SeatCard } from '@/features/sellers/SeatCard'
import { GhostStage, StageCard } from '@/features/sellers/StageCard'
import { TierLegend } from '@/features/sellers/TierLegend'
import { parseSellerName } from '@/features/sellers/sellerName'
import { useAutoScroll } from '@/features/sellers/useAutoScroll'
import { useAvailableHeight } from '@/features/sellers/useAvailableHeight'
import { useNewMedals, usePromotions } from '@/features/sellers/usePromotions'
import type { MedalCode, SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { NO_VALUE, formatNumber, formatPercentUz, formatSomFull } from '@/lib/format'

export type Status = 'loading' | 'error' | 'ready'

const NO_MEDALS: readonly SellerMedalDto[] = []

/**
 * Sotuvchilar ustuni — EFIR (spec §4, §5): sarlavha · uch o'rindiq (2-1-3) ·
 * STATIK yorliq qatori · siljiydigan qatorlar (`useAutoScroll` faqat shu
 * qutida) · legenda. Qaysi FAKT o'rin berganini bir marta shu yerda hisoblab
 * har o'rindiq va qatorga uzatadi, ikkalasi birlik haqida kelisha olmasligi
 * uchun.
 *
 * THE TOP THREE OF WHOEVER HAS THE FACT BEING READ — when there are three.
 * One or two earners take ONE full-width stage (`StageCard`) and the second
 * is the first ranked row; nobody at all is a quiet stage (`GhostStage`) that
 * says so in words. Sellers with no money but orders in the confirmation
 * queue follow the ranked rows under «Tasdiq kutilmoqda» (EFIR Premium §8).
 *
 * MAROSIM SHU YERDA: e'lon ustun sarlavhasi USTIDA (`ColumnHead` children),
 * ko'tarilgan odam o'rindiqda bo'lsa gerbi to'ladi. `onBoard` — shu ustunda
 * chizilgan kalitlar; `useMemo` SHART, to'plam effektning bog'liqliklarida.
 */
export function SellersBoard({
  entries,
  status,
  errorMessage,
  onRetry,
  parked = false,
  fakt,
  onFakt,
  medals,
  medalsToday,
  today = false,
}: {
  entries: readonly BoardEntry[]
  status: Status
  errorMessage?: string
  onRetry: () => void
  /** Hidden under 1280px while the switch shows the other board. */
  parked?: boolean
  fakt: FaktChoice
  onFakt: (choice: FaktChoice) => void
  /** Sotuvchi id si bo'yicha daraja va medallar; so'rov kelmagan bo'lsa bo'sh Map. */
  medals: ReadonlyMap<string, SellerMedalRowDto>
  /** `SellerMedalsDto.today` — e'lonning birinchi tetigi (`usePromotions`). */
  medalsToday: string | null
  /** Javob «Bugun» oynasidan — sarlavha sanog'i va sahna so'zlari kunni aytadi. */
  today?: boolean
}) {
  const onDelivered = resolveOnDelivered(entries, fakt)
  const ordered = useMemo(() => rankedBy(entries, onDelivered), [entries, onDelivered])
  const { earners, ranked, queued, idle } = splitBoard(ordered, onDelivered)
  /*
    SIYRAK HOLAT (EFIR Premium §8): uch va undan ko'p earner — odatdagi uchlik;
    bir-ikki — bitta sahna, ikkinchisi birinchi rank qatori; hech kim — sokin
    sahna. Qolgan qatorlar: pulli (qaysi faktda bo'lmasin) — rank bilan; puli
    yo'q-u tasdiq navbatida buyurtmasi bor — «Tasdiq kutilmoqda» guruhida;
    hech narsasi yo'q — «Bugun» da taxtada umuman yo'q, uzunroq davrda rank-siz
    qatori qoladi (`BoardSplit.idle`).
  */
  const mode = earners.length >= 3 ? 'podium' : earners.length > 0 ? 'stage' : 'ghost'
  const seated = earners.slice(0, mode === 'podium' ? 3 : 1)
  const seatedKeys = new Set(seated.map((w) => w.key))
  const rows = [...ranked.filter((e) => !seatedKeys.has(e.key)), ...(today ? [] : idle)]

  const onBoard = useMemo(() => new Set(entries.map((e) => e.key)), [entries])
  const promotion = usePromotions(medals, medalsToday, onBoard)
  const promotedName =
    promotion === null ? null : (entries.find((e) => e.key === promotion.employeeId)?.name ?? null)
  const newMedals = useNewMedals(medals)
  const ready = status === 'ready' && entries.length > 0
  const waiting = queued.length > 0 ? ` · ${formatNumber(queued.length)} tasi tasdiq kutmoqda` : ''
  /*
    FE'L O'QILAYOTGAN FAKTNI AYTADI. `earners` — faol faktda puli borlar; FAKT 2 da
    ular yetkazganlar. «bugun 0 sotuvchi savdo qildi» FAKT 2 kaliti ostida 15 kishi
    FAKT 1 da savdo qilgan kunni yolg'on aytardi (real-data audit, 2026-09-17).
  */
  const count = !ready
    ? null
    : today
      ? `bugun ${formatNumber(earners.length)} sotuvchi ${onDelivered ? 'yetkazdi' : 'savdo qildi'}${waiting}`
      : `${formatNumber(entries.length)} sotuvchi`
  // So'z o'qilayotgan faktni aytadi: boshqa faktda pul bo'lsa «savdo yoʻq» yolg'on bo'lardi.
  const what = ranked.length === 0 ? 'savdo' : onDelivered ? 'yetkazilgan pul' : 'tasdiqlangan pul'
  const ghostTitle = `${today ? 'Bugun' : 'Bu davrda'} hali ${what} yoʻq`

  return (
    <section
      id="tv-sellers"
      className={`tv-col tv-col--sellers${parked ? ' tv-col--parked' : ''}`}
      aria-labelledby="tv-sellers-heading"
    >
      <ColumnHead
        id="tv-sellers"
        title="Sotuvchilar"
        count={count}
        fakt={onDelivered ? 'fakt2' : 'fakt1'}
        onFakt={onFakt}
      >
        {promotion !== null && promotedName !== null && (
          <PromotionBanner promotion={promotion} name={promotedName} />
        )}
      </ColumnHead>

      {status === 'loading' ? (
        <SellersSkeleton />
      ) : status === 'error' ? (
        <div className="tv-empty">
          <ErrorState message={errorMessage} onRetry={onRetry} />
        </div>
      ) : entries.length === 0 ? (
        <div className="tv-empty">
          <EmptyState
            title="Bu davrda buyurtma yoʻq"
            body="Tanlangan davrda hech kim buyurtma olmagan — podium keyingi buyurtmani kutmoqda."
          />
        </div>
      ) : (
        <>
          {mode === 'podium' ? (
            <div className="tv-podium">
              {seated.map((entry, index) => (
                <SeatCard
                  key={entry.key}
                  rank={entry.rank}
                  place={(index + 1) as 1 | 2 | 3}
                  name={entry.name}
                  team={entry.badge}
                  won={entry.won}
                  ordered={entry.ordered}
                  onDelivered={onDelivered}
                  medal={medals.get(entry.key) ?? null}
                  rise={promotion?.employeeId === entry.key}
                  newKeys={newMedals.get(entry.key)}
                />
              ))}
            </div>
          ) : (
            <div className="tv-stage">
              {seated[0] !== undefined ? (
                <StageCard
                  entry={seated[0]}
                  onDelivered={onDelivered}
                  medal={medals.get(seated[0].key) ?? null}
                  rise={promotion?.employeeId === seated[0].key}
                  newKeys={newMedals.get(seated[0].key)}
                />
              ) : (
                <GhostStage title={ghostTitle} />
              )}
            </div>
          )}
          <SellerRows rows={rows} queued={queued} onDelivered={onDelivered} medals={medals} newMedals={newMedals} />
          {/* LEGENDA USTUN PASTIDA, BIR MARTA — medal so'rovi kelganda. Podium
              bilan ro'yxat orasida hech qachon emas (spec §2). */}
          {medals.size > 0 && <TierLegend />}
        </>
      )}
    </section>
  )
}

/**
 * Qator balandligi, px — CSS dagi `.row { height: 43px; }` bilan BIR raqam
 * (`efirCss.test.ts` ikkalasini pinlaydi). Ro'yxat balandligi shuning butun
 * karrasi (spec §5, delta 13): drift ikki chetda to'xtaganda yarim qator
 * ko'rinmaydi.
 */
export const ROW_H = 43

/**
 * Ro'yxat oladigan balandlik: bo'sh joyga sig'adigan BUTUN qatorlar. 0 —
 * «hali o'lchanmagan» (`useAvailableHeight`), shunda null va CSS o'z
 * tabiiy o'lchamida qoladi. 1920 / rail ochiq: 500 → 473 = 11 × 43.
 */
export function wholeRowsHeight(available: number): number | null {
  if (available <= 0) return null
  return Math.floor(available / ROW_H) * ROW_H
}

/**
 * Qatorlar — timing tower (spec §5). Yorliq qatori `.tv-cols` STATIK va
 * skroll qutisi `.tv-rows` ning TASHQARISIDA, ya'ni 4-rank hech qachon
 * yashirinmaydi. O'QISH TARTIBI: tasma · rank · gerb · ism(+kod) · komanda ·
 * medallar · QAHRAMON (faol fakt) · boshqa fakt · buyurt. · konv.
 *
 * FAOL FAKT HAR DOIM QAHRAMON USTUNIDA. FAKT 1 o'qilganda ikki fakt uyasi
 * almashadi — ustun tartibi emas, MAZMUN: 148 px uyada doim o'rin bergan
 * raqam turadi, shuning uchun jonli kadrdagi «FAKT 1 raqami Buyurtma ustiga
 * chiqadi» xatosi yo'qoladi. `data-read` faqat belgi — CSS undan og'irlik
 * o'qimaydi (delta 11d).
 */
function SellerRows({
  rows,
  queued,
  onDelivered,
  medals,
  newMedals,
}: {
  rows: readonly BoardEntry[]
  /** «Tasdiq kutilmoqda» — rank qatorlaridan keyin, o'sha skroll qutisida. */
  queued: readonly BoardEntry[]
  onDelivered: boolean
  medals: ReadonlyMap<string, SellerMedalRowDto>
  newMedals: ReadonlyMap<string, ReadonlySet<MedalCode>>
}) {
  if (rows.length === 0 && queued.length === 0) return null
  const read = onDelivered ? 'fakt2' : 'fakt1'
  const [hero, other] = onDelivered ? (['FAKT 2', 'FAKT 1'] as const) : (['FAKT 1', 'FAKT 2'] as const)

  return (
    <>
      {/* Yorliq qatori faqat rank qatorlari uchun — navbat qatorlarida ustun yo'q. */}
      {rows.length > 0 && (
        <div className="tv-cols" data-read={read}>
          <span />
          <span className="tv-cols__r">#</span>
          <span>Daraja</span>
          <span>Sotuvchi</span>
          <span>Komanda</span>
          <span className="tv-cols__r">Medallar</span>
          <span className="tv-cols__r on">{hero}</span>
          <span className="tv-cols__r">{other}</span>
          <span className="tv-cols__r">Buyurt.</span>
          <span className="tv-cols__r">Konv.</span>
        </div>
      )}
      <RowList
        rows={rows}
        queued={queued}
        onDelivered={onDelivered}
        medals={medals}
        newMedals={newMedals}
        read={read}
      />
    </>
  )
}

/**
 * Skroll qutisi o'z uyasida. `useAvailableHeight` UYANI o'lchaydi (ro'yxatning
 * ota elementi), ro'yxat o'sha raqamdan butun qatorlar balandligini oladi —
 * hook ro'yxat elementini chizadigan komponentda turishi shart (ref bir marta,
 * mount'dan keyin o'qiladi), shuning uchun bu alohida komponent.
 */
function RowList({
  rows,
  queued,
  onDelivered,
  medals,
  newMedals,
  read,
}: {
  rows: readonly BoardEntry[]
  queued: readonly BoardEntry[]
  onDelivered: boolean
  medals: ReadonlyMap<string, SellerMedalRowDto>
  newMedals: ReadonlyMap<string, ReadonlySet<MedalCode>>
  read: 'fakt1' | 'fakt2'
}) {
  const listRef = useAutoScroll<HTMLOListElement>(true)
  const height = wholeRowsHeight(useAvailableHeight(listRef))
  const style = height === null ? undefined : ({ '--rows-h': `${height}px` } as CSSProperties)

  return (
    <div className="tv-rows-slot">
      <ol ref={listRef} className="tv-rows" data-read={read} aria-label="Reyting qatorlari" style={style}>
        {rows.map((entry) => (
          <SellerRow
            key={entry.key}
            entry={entry}
            onDelivered={onDelivered}
            medal={medals.get(entry.key) ?? null}
            newKeys={newMedals.get(entry.key)}
          />
        ))}
        {/* Guruh sarlavhasi ro'yxat ICHIDA va bir qator balandligida — ro'yxat
            balandligi `ROW_H` karrasi bo'lib qoladi, drift yarim qatorda to'xtamaydi. */}
        {queued.length > 0 && (
          <li className="group">
            <h4>Tasdiq kutilmoqda</h4>
            <span>buyurtma bor, pul hali tasdiqlanmagan — tasdiqlangach reytingga kiradi</span>
          </li>
        )}
        {queued.map((entry) => (
          <QueueRow
            key={entry.key}
            entry={entry}
            medal={medals.get(entry.key) ?? null}
            newKeys={newMedals.get(entry.key)}
          />
        ))}
      </ol>
    </div>
  )
}

/** Faint dash for a zero or missing figure — never a bold «0» (spec §2). */
function None() {
  return <span className="row__none">{NO_VALUE}</span>
}

function SellerRow({
  entry,
  onDelivered,
  medal,
  newKeys,
}: {
  entry: BoardEntry
  onDelivered: boolean
  medal: SellerMedalRowDto | null
  newKeys: ReadonlySet<MedalCode> | undefined
}) {
  // A place is only a place once there is money to rank on. A row with none
  // prints NO rank at all — not a dash, not the place the tie-break handed it.
  const ranked = entry.won > 0 || entry.ordered > 0
  const heroFigure = figureOf(entry, onDelivered)
  const otherFigure = figureOf(entry, !onDelivered)
  const { name, code } = parseSellerName(entry.name)

  return (
    <li className="row" data-tier={medal?.level ?? 0} data-row-name={entry.name}>
      <span className="row__band" aria-hidden="true" />
      <span className="row__rank">{ranked ? entry.rank : null}</span>
      {medal !== null ? <Crest level={medal.level} legendaTier={medal.legendaTier} height={20} /> : <span />}
      <span className="row__name">
        <span className="nm">{name}</span>
        {code !== null && <span className="code">{code}</span>}
      </span>
      <span className="row__team">{entry.badge ?? ''}</span>
      <RowMedals medals={medal?.medals ?? NO_MEDALS} newKeys={newKeys} />
      <span className="row__hero">{heroFigure > 0 ? formatSomFull(heroFigure) : <None />}</span>
      <span className="row__sec">{otherFigure > 0 ? formatSomFull(otherFigure) : <None />}</span>
      <span className="row__sec">{entry.orders > 0 ? formatNumber(entry.orders) : <None />}</span>
      <span className="row__sec">
        {entry.conversionPercent === null || entry.conversionPercent === 0 ? (
          <None />
        ) : (
          formatPercentUz(entry.conversionPercent)
        )}
      </span>
    </li>
  )
}

/**
 * Navbatdagi sotuvchi (delta 16d): tasma, gerb, ism, komanda va medallar
 * odatdagidek — faqat qiymat uyalari BITTA keng jumlaga aylanadi. Rank uyasi
 * bo'sh (chiziqcha ham emas), nol hech qayerda. Son tasdiqlab bo'lmasa
 * (`queuedOrders` null) jumla sonsiz.
 */
function QueueRow({
  entry,
  medal,
  newKeys,
}: {
  entry: BoardEntry
  medal: SellerMedalRowDto | null
  newKeys: ReadonlySet<MedalCode> | undefined
}) {
  const { name, code } = parseSellerName(entry.name)
  const n = entry.queuedOrders
  return (
    <li className="row row--queue" data-tier={medal?.level ?? 0} data-row-name={entry.name}>
      <span className="row__band" aria-hidden="true" />
      <span className="row__rank" />
      {medal !== null ? <Crest level={medal.level} legendaTier={medal.legendaTier} height={20} /> : <span />}
      <span className="row__name">
        <span className="nm">{name}</span>
        {code !== null && <span className="code">{code}</span>}
      </span>
      <span className="row__team">{entry.badge ?? ''}</span>
      <RowMedals medals={medal?.medals ?? NO_MEDALS} newKeys={newKeys} />
      <span className="row__wait">
        {n !== null && n > 0 ? (
          <>
            <b>{formatNumber(n)}</b> buyurtma tasdiq navbatida
          </>
        ) : (
          'buyurtmasi tasdiq navbatida'
        )}
      </span>
    </li>
  )
}

/** Sized to the ready layout: three seats, then rows. */
function SellersSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Yuklanmoqda</span>
      <div className="tv-podium" aria-hidden="true">
        <div className="seat seat--2 skeleton tv-skeleton-seat" />
        <div className="seat seat--1 skeleton tv-skeleton-seat" />
        <div className="seat seat--3 skeleton tv-skeleton-seat" />
      </div>
      <div className="tv-skeleton-rows" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton tv-skeleton-row" />
        ))}
      </div>
    </div>
  )
}
