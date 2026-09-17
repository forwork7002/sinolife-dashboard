'use client'

import { type CSSProperties, useMemo } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import { type BoardEntry, type FaktChoice, figureOf, rankedBy, resolveOnDelivered } from '@/features/sellers/board'
import { ColumnHead } from '@/features/sellers/ColumnHead'
import { Halo, metalOfRank } from '@/features/sellers/Halo'
import type { Status } from '@/features/sellers/SellersBoard'
import { useAutoScroll } from '@/features/sellers/useAutoScroll'
import { useAvailableHeight } from '@/features/sellers/useAvailableHeight'
import { NO_VALUE, formatNumber, formatPercentUz, formatSomFull } from '@/lib/format'

/**
 * Komandalar ustuni — EFIR Premium (spec §6): podium YO'Q, 28 px statik
 * yorliq qatori, bir qatorli qatorlar — rank (1–3 zarb qilingan 30 px tanga,
 * qolgani sokin raqam) · nom + sotuvchi soni BITTA uyada · QAHRAMON (faol
 * fakt) · ulush · boshqa fakt · buyurt. · konv.; har qator pastida 4 px ulush
 * chizig'i (ulush ÷ yetakchi ulushi, 1–3 da metall). Pastda `footer.jami`
 * plaketi: komandalar jami, komandasizlar puli va barcha sotuvchilar jami.
 *
 * ULUSH BRAUZERDA, O'QILAYOTGAN FAKT USTIDA: komanda puli ÷ komandalar
 * jami puli. Servisning `sharePercent` i FAKT 2 ulushi — FAKT 1 rejimida u
 * yolg'on bo'lardi. Komandasiz sotuvchilar jamiga kirmaydi (plaket izohi
 * shuni aytadi). Daraja shaxsiy — komandalar ustunida gerb, e'lon, legenda
 * yo'q.
 *
 * QATOR BALANDLIGI USTUNDAN: `clamp(40, floor(joy / n), 52)` — 14 komanda
 * 1920 da 50 px da ustunni scrollsiz to'ldiradi. O'lchanmaguncha (0) CSS
 * dagi 50 px qoladi.
 */
export function TeamsBoard({
  entries,
  sellers,
  teamless,
  status,
  errorMessage,
  onRetry,
  parked = false,
  fakt,
  onFakt,
}: {
  entries: readonly BoardEntry[]
  /** Sotuvchi qatorlari — komandasizlar puli va barcha sotuvchilar jami shulardan. */
  sellers: readonly BoardEntry[]
  /** `totals.teamlessSellers` — plaketdagi «Komandasiz · k sotuvchi». */
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
  const read = onDelivered ? 'fakt2' : 'fakt1'
  const ready = status === 'ready' && entries.length > 0
  const active = onDelivered ? 'FAKT 2' : 'FAKT 1'
  const other = onDelivered ? 'FAKT 1' : 'FAKT 2'

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
            <span className="tv-tcols__r">#</span>
            <span className="tv-tcols__name">Komanda · sotuvchi</span>
            <span className="tv-tcols__r on">{active}</span>
            <span className="tv-tcols__r">Ulush</span>
            <span className="tv-tcols__r">{other}</span>
            <span className="tv-tcols__r">Buyurt.</span>
            <span className="tv-tcols__r">Konv.</span>
          </div>
          <TeamRows ranked={ranked} onDelivered={onDelivered} read={read} />
          <TeamsFooter
            ranked={ranked}
            sellers={sellers}
            teamless={teamless}
            onDelivered={onDelivered}
          />
        </>
      )}
    </section>
  )
}

/**
 * Plaket raqamlari, bir joyda — test ayniyatni shu yerda ushlaydi:
 * `teams + teamless === all` (ikkala fakt), bitta komanda puli uning
 * sotuvchilari yig'indisi bo'lgani uchun.
 */
export interface TeamTotals {
  /** Komandalar jami, faol faktda. */
  readonly teams: number
  /** Komandalar jami, boshqa faktda. */
  readonly teamsOther: number
  /** `rop === null` sotuvchi qatorlari yig'indisi, faol faktda. */
  readonly teamless: number
  /** Barcha sotuvchi qatorlari, faol faktda. */
  readonly all: number
}

export function teamTotals(
  teams: readonly BoardEntry[],
  sellers: readonly BoardEntry[],
  onDelivered: boolean,
): TeamTotals {
  const sum = (list: readonly BoardEntry[], delivered: boolean) =>
    list.reduce((total, e) => total + figureOf(e, delivered), 0)
  return {
    teams: sum(teams, onDelivered),
    teamsOther: sum(teams, !onDelivered),
    teamless: sum(
      sellers.filter((s) => s.badge === null),
      onDelivered,
    ),
    all: sum(sellers, onDelivered),
  }
}

/** Nol yoki null ikkinchi darajali qiymat — xira chiziqcha, hech qachon qalin «0». */
function None({ className }: { className: string }) {
  return <span className={`${className} trow__none`}>{NO_VALUE}</span>
}

function TeamRows({
  ranked,
  onDelivered,
  read,
}: {
  ranked: readonly BoardEntry[]
  onDelivered: boolean
  read: 'fakt1' | 'fakt2'
}) {
  // Ro'yxat shu komponentda tug'iladi — shuning uchun ikkala hook ham shu yerda
  // (`useAvailableHeight` ref'ni mount'dan keyin bir marta o'qiydi).
  const listRef = useAutoScroll<HTMLOListElement>(ranked.length > 0)
  const available = useAvailableHeight(listRef)
  const total = ranked.reduce((sum, e) => sum + figureOf(e, onDelivered), 0)
  const leader = ranked.length > 0 ? figureOf(ranked[0]!, onDelivered) : 0
  const rowHeight =
    available > 0 && ranked.length > 0 ? Math.min(52, Math.max(40, Math.floor(available / ranked.length))) : null

  return (
    <div className="tv-tslot">
      <ol
        ref={listRef}
        className="tv-trows"
        data-read={read}
        aria-label="Komandalar reytingi"
        style={rowHeight === null ? undefined : ({ '--trow-h': `${rowHeight}px` } as CSSProperties)}
      >
        {ranked.map((entry) => {
          const figure = figureOf(entry, onDelivered)
          const second = figureOf(entry, !onDelivered)
          const share = total > 0 && figure > 0 ? (figure / total) * 100 : null
          const rel = leader > 0 ? figure / leader : 0
          const metal = figure > 0 ? metalOfRank(entry.rank) : 'none'
          return (
            <li
              key={entry.key}
              className="trow"
              data-metal={metal === 'none' ? undefined : metal}
              data-share={rel.toFixed(3)}
            >
              <span className="trow__rank">
                {metal === 'none' ? (
                  entry.rank
                ) : (
                  <>
                    <Halo rank={entry.rank} size={30} small />
                    <span className="sr-only">{entry.rank}</span>
                  </>
                )}
              </span>
              <span className="trow__name">
                <span className="nm">{entry.name}</span>
                {entry.sellers !== null && <span className="cnt">{formatNumber(entry.sellers)}</span>}
              </span>
              {figure > 0 ? (
                <span className="trow__hero">{formatSomFull(figure)}</span>
              ) : (
                <None className="trow__hero" />
              )}
              {share === null ? (
                <None className="trow__sec" />
              ) : (
                <span className="trow__sec">{formatPercentUz(share)}</span>
              )}
              {second > 0 ? (
                <span className="trow__sec">{formatSomFull(second)}</span>
              ) : (
                <None className="trow__sec" />
              )}
              {entry.orders > 0 ? (
                <span className="trow__sec">{formatNumber(entry.orders)}</span>
              ) : (
                <None className="trow__sec" />
              )}
              {entry.conversionPercent === null ? (
                <None className="trow__sec" />
              ) : (
                <span className="trow__sec">{formatPercentUz(entry.conversionPercent)}</span>
              )}
              <span className="trow__bar" aria-hidden="true">
                <i style={{ width: `${(rel * 100).toFixed(1)}%` }} />
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function TeamsFooter({
  ranked,
  sellers,
  teamless,
  onDelivered,
}: {
  ranked: readonly BoardEntry[]
  sellers: readonly BoardEntry[]
  teamless: number
  onDelivered: boolean
}) {
  const totals = teamTotals(ranked, sellers, onDelivered)
  const n = formatNumber(ranked.length)
  const active = onDelivered ? 'FAKT 2' : 'FAKT 1'
  const other = onDelivered ? 'FAKT 1' : 'FAKT 2'
  const money = (value: number, className = '') =>
    value > 0 ? (
      <dd className={className || undefined}>{formatSomFull(value)}</dd>
    ) : (
      <dd className={`${className} trow__none`.trim()}>{NO_VALUE}</dd>
    )

  return (
    <footer className="jami">
      <div className="jami__l">
        <p className="jami__k">
          {n} komanda jami · {active}
        </p>
        <p className={`jami__v${totals.teams > 0 ? '' : ' trow__none'}`}>
          {totals.teams > 0 ? formatSomFull(totals.teams) : NO_VALUE}
        </p>
        <p className="jami__o">
          <b>{other}</b>
          <span className={totals.teamsOther > 0 ? undefined : 'trow__none'}>
            {totals.teamsOther > 0 ? formatSomFull(totals.teamsOther) : NO_VALUE}
          </span>
        </p>
      </div>
      <dl className="jami__r">
        {teamless > 0 && (
          <>
            <dt>Komandasiz · {formatNumber(teamless)} sotuvchi</dt>
            {money(totals.teamless)}
          </>
        )}
        <dt className="sum">Barcha sotuvchilar</dt>
        {money(totals.all)}
        <dd className="jami__note">Ulush {n} komanda jamidan hisoblanadi</dd>
      </dl>
    </footer>
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
