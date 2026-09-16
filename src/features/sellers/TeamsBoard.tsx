'use client'

import { type CSSProperties, useMemo } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import { type BoardEntry, type FaktChoice, figureOf, rankedBy, resolveOnDelivered } from '@/features/sellers/board'
import { ColumnHead } from '@/features/sellers/ColumnHead'
import { metalOfRank } from '@/features/sellers/Halo'
import type { Status } from '@/features/sellers/SellersBoard'
import { useAutoScroll } from '@/features/sellers/useAutoScroll'
import { NO_VALUE, formatNumber, formatPercentUz, formatSomFull } from '@/lib/format'

/**
 * Komandalar ustuni — EFIR (spec §6): podium YO'Q, 40 px sarlavha, 24 px
 * statik yorliq qatori, bir qatorli 62 px qatorlar — rank (1–3 metall raqam)
 * · nom · sotuvchi soni · FAKT 2 · ulush · FAKT 1 · buyurtma · konv.; har
 * qator pastida ulush chizig'i (ulush ÷ yetakchi ulushi). Sotuvchilar
 * ro'yxati bilan bir xil lug'at; plastina, chip, qizil delta yo'q.
 *
 * ULUSH BRAUZERDA, O'QILAYOTGAN FAKT USTIDA: komanda puli ÷ komandalar
 * jami puli. Servisning `sharePercent` i FAKT 2 ulushi — FAKT 1 rejimida u
 * yolg'on bo'lardi. Komandasiz sotuvchilar jamiga kirmaydi (pastdagi jumla
 * shuni aytadi). Daraja shaxsiy — komandalar ustunida gerb, e'lon, legenda
 * yo'q.
 */
export function TeamsBoard({
  entries,
  teamless,
  status,
  errorMessage,
  onRetry,
  parked = false,
  fakt,
  onFakt,
}: {
  entries: readonly BoardEntry[]
  /** `totals.teamlessSellers` — pastdagi jumla uchun. */
  teamless: number
  status: Status
  errorMessage?: string
  onRetry: () => void
  parked?: boolean
  fakt: FaktChoice
  onFakt: (choice: FaktChoice) => void
}) {
  const onDelivered = resolveOnDelivered(entries, fakt)
  const ranked = useMemo(() => rankedBy(entries, onDelivered), [entries, onDelivered])
  const listRef = useAutoScroll<HTMLOListElement>(ranked.length > 0)
  const total = ranked.reduce((sum, e) => sum + figureOf(e, onDelivered), 0)
  const leader = ranked.length > 0 ? figureOf(ranked[0]!, onDelivered) : 0
  const read = onDelivered ? 'fakt2' : 'fakt1'
  const ready = status === 'ready' && entries.length > 0

  return (
    <section
      id="tv-teams"
      className={`tv-col tv-col--teams${parked ? ' tv-col--parked' : ''}`}
      aria-labelledby="tv-teams-heading"
    >
      <ColumnHead
        id="tv-teams"
        title="Komandalar"
        count={ready ? `${formatNumber(entries.length)} komanda` : null}
        fakt={read}
        onFakt={onFakt}
      />

      {status === 'loading' ? (
        <TeamsSkeleton />
      ) : status === 'error' ? (
        <div className="tv-empty">
          <ErrorState message={errorMessage} onRetry={onRetry} />
        </div>
      ) : entries.length === 0 ? (
        <div className="tv-empty">
          <EmptyState title="Bu davrda buyurtma yoʻq" body="Bu davrda hech bir ROP komandasi buyurtma olmagan." />
        </div>
      ) : (
        <>
          <div className="tv-tcols" data-read={read}>
            <span className="tv-tcols__c">#</span>
            <span className="tv-tcols__name">Komanda (ROP)</span>
            <span className="tv-tcols__r">Sotuvchi</span>
            <span className="tv-tcols__r tv-tcols__f2">FAKT 2, yetkazilgan</span>
            <span className="tv-tcols__r">Ulush</span>
            <span className="tv-tcols__r tv-tcols__f1">FAKT 1</span>
            <span className="tv-tcols__r">Buyurtma</span>
            <span className="tv-tcols__r">Konv.</span>
          </div>
          <ol ref={listRef} className="tv-trows" data-read={read} aria-label="Komandalar reytingi">
            {ranked.map((entry) => {
              const figure = figureOf(entry, onDelivered)
              const isRanked = entry.won > 0 || entry.ordered > 0
              const share = total > 0 ? (figure / total) * 100 : null
              const rel = leader > 0 ? (figure / leader).toFixed(3) : '0.000'
              return (
                <li
                  key={entry.key}
                  className="trow"
                  data-share={rel}
                  style={{ '--share': rel } as CSSProperties}
                >
                  <span className="trow__rank" data-metal={isRanked ? metalOfRank(entry.rank) : 'none'}>
                    {isRanked ? entry.rank : '—'}
                  </span>
                  <span className="trow__name">{entry.name}</span>
                  <span className="trow__cnt">{entry.sellers === null ? NO_VALUE : formatNumber(entry.sellers)}</span>
                  <span className="trow__f2">{formatSomFull(entry.won)}</span>
                  <span className="trow__share">{share === null ? NO_VALUE : formatPercentUz(share)}</span>
                  <span className="trow__f1">{formatSomFull(entry.ordered)}</span>
                  <span className="trow__orders">{formatNumber(entry.orders)}</span>
                  <span className="trow__conv">
                    {entry.conversionPercent === null ? NO_VALUE : formatPercentUz(entry.conversionPercent)}
                  </span>
                </li>
              )
            })}
          </ol>
          {teamless > 0 && (
            <p className="tv-tfoot">{formatNumber(teamless)} sotuvchi komandasiz, ulushlar ularsiz</p>
          )}
        </>
      )}
    </section>
  )
}

function TeamsSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Yuklanmoqda</span>
      <div className="tv-skeleton-rows" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="skeleton tv-skeleton-row tv-skeleton-row--team" />
        ))}
      </div>
    </div>
  )
}
