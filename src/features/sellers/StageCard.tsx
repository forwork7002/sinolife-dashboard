import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Crest } from '@/features/sellers/Crest'
import { Halo, metalOfRank } from '@/features/sellers/Halo'
import { MedalMark } from '@/features/sellers/MedalMark'
import { MEDALS, progressOf, seatMedals } from '@/features/sellers/medalCatalog'
import { NextLevel, medalWhen } from '@/features/sellers/SeatCard'
import { parseSellerName } from '@/features/sellers/sellerName'
import type { BoardEntry } from '@/features/sellers/board'
import type { MedalCode, SellerMedalRowDto } from '@/lib/api'
import { formatNumber, formatSomFull } from '@/lib/format'

/**
 * SAHNA — siyrak «Bugun» (EFIR Premium §8, delta 16a–16c). Bir yoki ikki
 * kishi pul qilgan ertalab uch o'rindiqli podium ikki bo'sh quti bo'lib
 * turardi; o'rniga BITTA to'liq kenglikdagi plaket: chapda tanga (84, dafna),
 * o'rtada ism (26 px), meta va progress («Avgustdan beri yetkazilgan»), o'ngda
 * pul (56 px), ikki fakt qatori, medal tokchasi va izohi. Ikkinchi earner —
 * birinchi rank qatori (`SellersBoard`).
 *
 * IKKINCHI FAKT QATORI HECH QACHON NOL EMAS: FAKT 1 o'qilganda va yetkazilgan
 * pul hali yo'q bo'lsa — «FAKT 2 hali yoʻq — yetkazish kutilmoqda»; FAKT 2
 * o'qilganda boshqa fakt nol bo'lsa satr umuman chizilmaydi.
 */
export function StageCard({
  entry,
  onDelivered,
  medal,
  rise = false,
  newKeys,
}: {
  entry: BoardEntry
  onDelivered: boolean
  medal: SellerMedalRowDto | null
  rise?: boolean
  newKeys?: ReadonlySet<MedalCode>
}) {
  const { name, code } = parseSellerName(entry.name)
  const figure = onDelivered ? entry.won : entry.ordered
  const other = onDelivered ? entry.ordered : entry.won
  const count = onDelivered ? entry.wonOrders : entry.orders
  const metal = metalOfRank(entry.rank)
  const rack = medal === null ? [] : seatMedals(medal.medals, 3)
  const top = rack[0]
  const topWhen = top === undefined ? null : medalWhen(top)

  return (
    <article
      className="stage"
      data-tier={medal?.level ?? 0}
      data-metal={metal === 'none' ? undefined : metal}
      data-seat-name={entry.name}
      aria-label={`${entry.rank}-oʻrin`}
    >
      <span className="seat__band" aria-hidden="true" />
      <Halo rank={entry.rank} size={84} wreath />
      <div className="stage__who">
        <h3 className="stage__name">
          {name}
          {code !== null && <span className="code">{code}</span>}
        </h3>
        {(medal !== null || entry.badge !== null) && (
          <p className="seat__meta">
            {medal !== null && (
              <Crest level={medal.level} legendaTier={medal.legendaTier} height={20} plated animate={rise} />
            )}
            {medal?.rankTitle != null && <b className="lvl">{medal.rankTitle}</b>}
            {entry.badge !== null && <span className="team">{entry.badge}</span>}
          </p>
        )}
        {medal !== null && (
          <div className="seat__prog stage__prog">
            <NextLevel medal={medal} />
            <div className="meter" aria-hidden="true">
              <i style={{ width: `${(progressOf(medal) * 100).toFixed(1)}%` }} />
            </div>
            {medal.level > 0 && (
              <p className="seat__life">
                <span>Avgustdan beri yetkazilgan</span>
                <span>
                  <em>{formatSomFull(medal.delivered.amount)}</em> / <span>{formatSomFull(medal.nextLevelAt.amount)}</span>
                </span>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="stage__money">
        <p className="seat__money">
          <AnimatedNumber value={figure} format={formatSomFull} duration={900} />
        </p>
        <p className="stage__fakt">
          <span>
            <b>{onDelivered ? 'FAKT 2' : 'FAKT 1'}</b>
            {onDelivered ? 'yetkazilgan' : 'tasdiqlangan'}
            {count > 0 && ` · ${formatNumber(count)} buyurtma`}
          </span>
          {other > 0 ? (
            <span>
              <b>{onDelivered ? 'FAKT 1' : 'FAKT 2'}</b>
              <em>{formatSomFull(other)}</em>
            </span>
          ) : (
            !onDelivered && (
              <span>
                <b>FAKT 2</b>hali yoʻq — yetkazish kutilmoqda
              </span>
            )
          )}
        </p>
        {top !== undefined && (
          <div className="stage__rack">
            {rack.map((m) => (
              <MedalMark
                key={m.code}
                code={m.code}
                size={40}
                count={m.count}
                seat
                isNew={newKeys?.has(m.code) ?? false}
              />
            ))}
            <span className="seat__cap">
              <b>
                {MEDALS[top.code].name}
                {top.count > 1 && ` ×${top.count}`}
              </b>
              {topWhen !== null && <i>{topWhen}</i>}
            </span>
          </div>
        )}
      </div>
    </article>
  )
}

/**
 * Hech kim pul qilmagan — bo'sh podium emas, sokin sahna: `#halo-ghost` tanga
 * va bitta jumla (delta 16c). So'z davrni va o'qilayotgan faktni aytadi:
 * boshqa faktda pul bo'lsa «savdo yo'q» yolg'on bo'lardi.
 */
export function GhostStage({ title }: { title: string }) {
  return (
    <article className="stage stage--ghost" aria-label={title}>
      <span className="halo-box" style={{ width: 84, height: 84 }}>
        <svg className="halo" viewBox="0 0 64 64" width={84} height={84} aria-hidden="true">
          <use href="#halo-ghost" />
        </svg>
      </span>
      <p className="stage__ghost">{title}</p>
    </article>
  )
}
