'use client'

import { useMemo } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import { type BoardEntry, type FaktChoice, figureOf, rankedBy, resolveOnDelivered } from '@/features/sellers/board'
import { ColumnHead } from '@/features/sellers/ColumnHead'
import { Crest } from '@/features/sellers/Crest'
import { PromotionBanner } from '@/features/sellers/PromotionBanner'
import { RowMedals } from '@/features/sellers/RowMedals'
import { SeatCard } from '@/features/sellers/SeatCard'
import { TierLegend } from '@/features/sellers/TierLegend'
import { useAutoScroll } from '@/features/sellers/useAutoScroll'
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
 * Qatorlar — timing tower (spec §5). Yorliq qatori `.tv-cols` STATIK va
 * skroll qutisi `.tv-rows` ning TASHQARISIDA, ya'ni 4-rank hech qachon
 * yashirinmaydi. Bitta baseline: tasma · rank · gerb · ism + komanda ·
 * medallar · FAKT 2 · FAKT 1 · buyurtma · konv. «Oldingiga +…» satri YO'Q.
 *
 * `data-read` — o'qilayotgan fakt; CSS o'sha ustunni qalin qiladi, tartib
 * o'zgarmaydi (FAKT 2 har doim chapda).
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
  const listRef = useAutoScroll<HTMLOListElement>(rows.length > 0)
  if (rows.length === 0) return null
  const read = onDelivered ? 'fakt2' : 'fakt1'

  return (
    <>
      <div className="tv-cols" data-read={read}>
        <span />
        <span className="tv-cols__c">#</span>
        <span>Daraja</span>
        <span className="tv-cols__name">Sotuvchi</span>
        <span>Medallar</span>
        <span className="tv-cols__r tv-cols__f2">FAKT 2, yetkazilgan</span>
        <span className="tv-cols__r tv-cols__f1">FAKT 1, tasdiqlangan</span>
        <span className="tv-cols__r">Buyurtma</span>
        <span className="tv-cols__r">Konv.</span>
      </div>
      <ol ref={listRef} className="tv-rows" data-read={read} aria-label="Reyting qatorlari">
        {rows.map((entry) => {
          // A place is only a place once there is money to rank on; a row
          // with none prints a dash, not a rank it was handed by the tie-break.
          const ranked = entry.won > 0 || entry.ordered > 0
          // BIR MARTA QIDIRILADI — katakcha uni bir necha joyda o'qiydi.
          const medal = medals.get(entry.key) ?? null
          return (
            <li key={entry.key} className="row" data-tier={medal?.level ?? 0}>
              <span className="row__band" aria-hidden="true" />
              <span className="row__rank">
                {ranked ? entry.rank : <span aria-label="Hali puli yoʻq">—</span>}
              </span>
              {medal !== null ? (
                <Crest level={medal.level} legendaTier={medal.legendaTier} size="row" />
              ) : (
                <span />
              )}
              <span className="row__name">
                {entry.name}
                {entry.badge && <span className="row__team">{entry.badge}</span>}
              </span>
              <RowMedals medals={medal?.medals ?? NO_MEDALS} newKeys={newMedals.get(entry.key)} />
              <span className="row__f2">{formatSomFull(entry.won)}</span>
              <span className="row__f1">{formatSomFull(entry.ordered)}</span>
              <span className="row__orders">{formatNumber(entry.orders)}</span>
              <span className="row__conv">
                {entry.conversionPercent === null ? NO_VALUE : formatPercentUz(entry.conversionPercent)}
              </span>
            </li>
          )
        })}
      </ol>
    </>
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
