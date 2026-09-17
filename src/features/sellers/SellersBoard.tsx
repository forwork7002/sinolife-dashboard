'use client'

import { type CSSProperties, useMemo } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import { type BoardEntry, type FaktChoice, figureOf, rankedBy, resolveOnDelivered } from '@/features/sellers/board'
import { ColumnHead } from '@/features/sellers/ColumnHead'
import { Crest } from '@/features/sellers/Crest'
import { PromotionBanner } from '@/features/sellers/PromotionBanner'
import { RowMedals } from '@/features/sellers/RowMedals'
import { SeatCard } from '@/features/sellers/SeatCard'
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
 * THE TOP THREE OF WHOEVER HAS THE FACT BEING READ. An empty podium is an
 * answer — «hech kim yetkazmagan hali» — and the branch below has words for
 * it; the rows then start at first place.
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
}) {
  const onDelivered = resolveOnDelivered(entries, fakt)
  const ranked = useMemo(() => rankedBy(entries, onDelivered), [entries, onDelivered])
  const winners = ranked.filter((e) => figureOf(e, onDelivered) > 0).slice(0, 3)
  const seated = new Set(winners.map((w) => w.key))
  const rows = winners.length === 0 ? ranked : ranked.filter((e) => !seated.has(e.key))

  const onBoard = useMemo(() => new Set(entries.map((e) => e.key)), [entries])
  const promotion = usePromotions(medals, medalsToday, onBoard)
  const promotedName =
    promotion === null ? null : (entries.find((e) => e.key === promotion.employeeId)?.name ?? null)
  const newMedals = useNewMedals(medals)
  const ready = status === 'ready' && entries.length > 0

  return (
    <section
      id="tv-sellers"
      className={`tv-col tv-col--sellers${parked ? ' tv-col--parked' : ''}`}
      aria-labelledby="tv-sellers-heading"
    >
      <ColumnHead
        id="tv-sellers"
        title="Sotuvchilar"
        count={ready ? `${formatNumber(entries.length)} sotuvchi` : null}
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
          {winners.length === 0 ? (
            <p className="tv-empty-podium">
              <span aria-hidden="true">🏁</span> Podium hali boʻsh — oʻrinlar hammaga ochiq
            </p>
          ) : (
            <div className="tv-podium">
              {winners.map((entry, index) => (
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
          )}
          <SellerRows rows={rows} onDelivered={onDelivered} medals={medals} newMedals={newMedals} />
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
  onDelivered,
  medals,
  newMedals,
}: {
  rows: readonly BoardEntry[]
  onDelivered: boolean
  medals: ReadonlyMap<string, SellerMedalRowDto>
  newMedals: ReadonlyMap<string, ReadonlySet<MedalCode>>
}) {
  if (rows.length === 0) return null
  const read = onDelivered ? 'fakt2' : 'fakt1'
  const [hero, other] = onDelivered ? (['FAKT 2', 'FAKT 1'] as const) : (['FAKT 1', 'FAKT 2'] as const)

  return (
    <>
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
      <RowList rows={rows} onDelivered={onDelivered} medals={medals} newMedals={newMedals} read={read} />
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
  onDelivered,
  medals,
  newMedals,
  read,
}: {
  rows: readonly BoardEntry[]
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
