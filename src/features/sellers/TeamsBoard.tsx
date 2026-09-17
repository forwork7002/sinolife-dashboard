'use client'

import { type CSSProperties, type ReactNode, useMemo } from 'react'

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
  today = false,
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
  /** «Bugun» oynasi — sanoq «bugun N komanda savdo qildi», plaket «Bugun jami». */
  today?: boolean
}) {
  const onDelivered = resolveOnDelivered(entries, fakt)
  const ordered = useMemo(() => rankedBy(entries, onDelivered), [entries, onDelivered])
  /*
    SIYRAK «BUGUN» (EFIR Premium §8, delta 17–17a): rank faqat pulli komandaga.
    Hech qaysi faktda puli yo'q komanda qatorda «— — —» bo'lib turmaydi —
    bitta sokin satrda nomi aytiladi, navbatdagi buyurtmalari bilan. Uzunroq
    davrda hamma komanda qatorida qoladi (o'zgarmagan).
  */
  const ranked = today ? ordered.filter((e) => e.won > 0 || e.ordered > 0) : ordered
  const idle = today ? ordered.filter((e) => e.won <= 0 && e.ordered <= 0) : []
  const quiet = idleTeamGroups(idle, sellers)
  const read = onDelivered ? 'fakt2' : 'fakt1'
  const ready = status === 'ready' && entries.length > 0
  const earning = ranked.filter((e) => figureOf(e, onDelivered) > 0).length
  const count = !ready
    ? null
    : today
      ? `bugun ${formatNumber(earning)} komanda ${onDelivered ? 'yetkazdi' : 'savdo qildi'}`
      : `${formatNumber(entries.length)} komanda`
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
        count={count}
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
          {ranked.length > 0 && (
            <div className="tv-tcols" data-read={read}>
              <span className="tv-tcols__r">#</span>
              {/* « · sotuvchi» — tor ustunda (telefon) tushadigan qism; to'liq yorliq matni o'zgarmaydi. */}
              <span className="tv-tcols__name">
                Komanda<span className="tv-tcols__cnt"> · sotuvchi</span>
              </span>
              <span className="tv-tcols__r on">{active}</span>
              <span className="tv-tcols__r">Ulush</span>
              <span className="tv-tcols__r">{other}</span>
              <span className="tv-tcols__r">Buyurt.</span>
              <span className="tv-tcols__r">Konv.</span>
            </div>
          )}
          <TeamRows
            ranked={ranked}
            onDelivered={onDelivered}
            read={read}
            after={quiet.length > 0 ? <IdleTeams groups={quiet} /> : null}
          />
          <TeamsFooter
            teams={entries}
            ranked={ranked}
            sellers={sellers}
            teamless={teamless}
            onDelivered={onDelivered}
            today={today}
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

/** «Hali savdosiz» satrining balandligi, px — CSS dagi `.quiet { height: 40px }` bilan bir raqam. */
const QUIET_H = 40

/** Komanda qatorining eng past va eng baland balandligi, px (spec §6). */
const TROW_MIN = 40
const TROW_MAX = 52

/**
 * Komanda qatorlari joyga qanday tushadi (spec §6, §10).
 *
 * Hammasi 40 px dan sig'sa — `clamp(40, floor(joy / n), 52)`, ro'yxat skroll
 * qilmaydi. SIG'MASA ro'yxat skroll qiladi va shunda DAM OLISH NUQTASIDA YARIM
 * QATOR BO'LMASLIGI kerak — sotuvchilar ro'yxati qoidasi: ko'rinadigan qatorlar
 * soni `k = floor(joy / 40)`, qator balandligi `floor(joy / k)` (52 dan
 * oshmaydi) va ro'yxat balandligi aynan `k × qator`. 1366 auditi (2026-09-17):
 * 386 px ga 14 komanda 40 px dan tushib, o'ninchisi yarmida kesilgan edi —
 * endi 9 × 42 = 378.
 *
 * `null` — hali o'lchanmagan (0) yoki qator yo'q: CSS o'z 50 px ida qoladi.
 * `list: null` — ro'yxat uyani to'ldiradi (hammasi sig'adi).
 *
 * QATOR HECH QACHON 40 DAN PAST EMAS, joy bir qatorga ham yetmasa ham
 * (juda past ustun): bitta 40 px qator, ro'yxat 40 px — uya uni kesadi, lekin
 * qator o'z o'lchamini buzmaydi. Avval `floor(joy / 1)` 30 px qator qaytarardi.
 */
export function teamRowLayout(room: number, rows: number): { row: number; list: number | null } | null {
  if (room <= 0 || rows <= 0) return null
  const even = Math.floor(room / rows)
  if (even >= TROW_MIN) return { row: Math.min(TROW_MAX, even), list: null }
  if (room < TROW_MIN) return { row: TROW_MIN, list: TROW_MIN }
  const visible = Math.floor(room / TROW_MIN)
  const row = Math.min(TROW_MAX, Math.floor(room / visible))
  return { row, list: visible * row }
}

function TeamRows({
  ranked,
  onDelivered,
  read,
  after = null,
}: {
  ranked: readonly BoardEntry[]
  onDelivered: boolean
  read: 'fakt1' | 'fakt2'
  /**
   * Ro'yxatdan KEYIN, o'sha uyada — «Hali savdosiz» satri. Berilganda ro'yxat
   * uyani to'ldirmaydi (`tv-trows--fit`), satr oxirgi qatorning tagida turadi,
   * va qator balandligi uning 40 px idan qolgan joydan hisoblanadi.
   */
  after?: ReactNode
}) {
  // Ro'yxat shu komponentda tug'iladi — shuning uchun ikkala hook ham shu yerda
  // (`useAvailableHeight` ref'ni mount'dan keyin bir marta o'qiydi).
  const listRef = useAutoScroll<HTMLOListElement>(ranked.length > 0)
  const available = useAvailableHeight(listRef)
  const total = ranked.reduce((sum, e) => sum + figureOf(e, onDelivered), 0)
  const leader = ranked.length > 0 ? figureOf(ranked[0]!, onDelivered) : 0
  const room = available - (after === null ? 0 : QUIET_H)
  const layout = teamRowLayout(room, ranked.length)
  const style =
    layout === null
      ? undefined
      : ({
          '--trow-h': `${layout.row}px`,
          ...(layout.list === null ? {} : { '--trows-h': `${layout.list}px` }),
        } as CSSProperties)
  const className = [
    'tv-trows',
    after === null ? '' : 'tv-trows--fit',
    layout?.list == null ? '' : 'tv-trows--whole',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="tv-tslot">
      <ol ref={listRef} className={className} data-read={read} aria-label="Komandalar reytingi" style={style}>
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
              {/* Nol ham xira chiziqcha — sotuvchi qatoridagi qoida (spec §2); jonli «Bugun» da «0 %» edi. */}
              {entry.conversionPercent === null || entry.conversionPercent === 0 ? (
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
      {after}
    </div>
  )
}

/**
 * «Hali savdosiz: A, B — navbatda 1 tadan buyurtma» (delta 17a). Navbat soni
 * komandaning sotuvchi qatorlaridan (`badge` = komanda nomi) yig'iladi; bir xil
 * sonli komandalar bitta bo'lakda, ko'pidan ozigacha. Puli ham, navbati ham
 * yo'q komanda (bugun faqat rad etilgan) — sotuvchilar ustunidagi «hech narsasi
 * yo'q» qator kabi — AYTILMAYDI; «0 ta» hech qachon yozilmaydi.
 */
export function idleTeamGroups(
  idle: readonly BoardEntry[],
  sellers: readonly BoardEntry[],
): readonly { readonly names: readonly string[]; readonly queued: number }[] {
  const queuedBy = new Map<string, number>()
  for (const s of sellers) {
    if (s.badge === null || s.queuedOrders === null) continue
    queuedBy.set(s.badge, (queuedBy.get(s.badge) ?? 0) + s.queuedOrders)
  }
  const groups = new Map<number, string[]>()
  for (const team of idle) {
    const k = queuedBy.get(team.name) ?? 0
    if (k > 0) groups.set(k, [...(groups.get(k) ?? []), team.name])
  }
  return [...groups.entries()].sort(([a], [b]) => b - a).map(([queued, names]) => ({ names, queued }))
}

function IdleTeams({ groups }: { groups: ReturnType<typeof idleTeamGroups> }) {
  return (
    <p className="quiet">
      Hali savdosiz:{' '}
      {groups.map((group, g) => (
        <span key={group.queued}>
          {g > 0 && ' · '}
          {group.names.map((name, i) => (
            <span key={name}>
              {i > 0 && ', '}
              <b>{name}</b>
            </span>
          ))}
          {` — navbatda ${formatNumber(group.queued)} ${group.names.length > 1 ? 'tadan' : 'ta'} buyurtma`}
        </span>
      ))}
    </p>
  )
}

function TeamsFooter({
  teams,
  ranked,
  sellers,
  teamless,
  onDelivered,
  today,
}: {
  /** Hamma komanda qatori — jami shulardan (pulsizlari nol qo'shadi, boshqa faktda emas). */
  teams: readonly BoardEntry[]
  /** Rank olgan komandalar — plaketdagi «n komanda» soni. */
  ranked: readonly BoardEntry[]
  sellers: readonly BoardEntry[]
  teamless: number
  onDelivered: boolean
  today: boolean
}) {
  const totals = teamTotals(teams, sellers, onDelivered)
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
          {today ? 'Bugun jami' : `${n} komanda jami`} · {active}
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
        {ranked.length > 0 && <dd className="jami__note">Ulush {n} komanda jamidan hisoblanadi</dd>}
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
