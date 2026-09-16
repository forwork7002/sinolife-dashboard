import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Crest } from '@/features/sellers/Crest'
import { Halo } from '@/features/sellers/Halo'
import { MedalMark } from '@/features/sellers/MedalMark'
import { nextLevelSentence, progressOf, sortMedals } from '@/features/sellers/medalCatalog'
import type { MedalCode, SellerMedalRowDto } from '@/lib/api'
import { formatSomFull } from '@/lib/format'

/**
 * Ism ikki qatorga (spec §4): `tokens[0]` / qolgani; birinchi token raqam
 * bo'lsa `tokens[0..1]` / qolgani — «268 Ozoda Yuldosheva» → «268 Ozoda» /
 * «Yuldosheva», «Shahtiyarovna 197 Marjona» → «Shahtiyarovna» / «197 Marjona».
 * Bu portalning ikki ism shakliga mo'ljallangan; boshqalari birinchi so'z /
 * qolgani. Bitta so'z — ikkinchi qator bo'sh (chizilmaydi).
 */
export function splitSeatName(name: string): readonly [string, string] {
  const tokens = name.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return ['', '']
  const head = /^\d+$/.test(tokens[0]!) && tokens.length > 1 ? 2 : 1
  return [tokens.slice(0, head).join(' '), tokens.slice(head).join(' ')]
}

/**
 * O'rindiq — podium kartasi (spec §4). Yuqoridan pastga: halqa qatori (rank
 * metall halqada, ikki qatorli ism, komanda · gerb · daraja so'zi), raqam
 * (o'qilayotgan fakt 44 px, ostida boshqa fakt), progress (10 px yo'l va
 * «… qoldi» jumlasi), medal qatori ×N bilan. Pedestal, bevel, xrom, sharpa,
 * shtamp, hikoya kartasi YO'Q. Chap chetida 10 px `--tier` tasma (CSS).
 *
 * SO'Z BIR MARTA: daraja so'zi («Usta») faqat shu yerda, gerb yonida;
 * qatorlarda so'z yo'q. Medal qatori kelmagan sotuvchi (yuklanish holati)
 * halqa, ism, komanda va raqamni chizadi — gerb, so'z, progress va medallar
 * so'rov kelganda paydo bo'ladi, taxta hech nima sezmaydi.
 *
 * `data-seat-name` — testlar va ism bo'linishidan mustaqil bitta o'qish
 * (ikki <span> ning textContent'i orasida bo'sh joy yo'q).
 */
export function SeatCard({
  rank,
  place,
  name,
  team,
  won,
  ordered,
  onDelivered,
  medal,
  rise = false,
  newKeys,
}: {
  /** Musobaqa ranki — halqadagi raqam (teng bo'lsa 1, 1, 3). */
  rank: number
  /** O'rindiq — 1 katta, 2 va 3 kichik; tartib CSS `order` bilan 2-1-3. */
  place: 1 | 2 | 3
  name: string
  team: string | null
  won: number
  ordered: number
  onDelivered: boolean
  /** Shu odamning daraja qatori; medal so'rovi kelmagan bo'lsa null. */
  medal: SellerMedalRowDto | null
  /** Ko'tarilish marosimi — gerbning eng yangi katakchasi bir marta to'ladi. */
  rise?: boolean
  /** Shu yangilanishda ochilgan medallar — bir marta 0,6 → 1. */
  newKeys?: ReadonlySet<MedalCode>
}) {
  const [line1, line2] = splitSeatName(name)
  const figure = onDelivered ? won : ordered
  const other = onDelivered ? ordered : won
  const level = medal?.level ?? 0

  return (
    <article
      className={`seat seat--${place}`}
      data-tier={level}
      data-seat-name={name}
      aria-label={`${rank}-oʻrin`}
    >
      <div className="seat__top">
        <Halo rank={rank} size={place === 1 ? 'lg' : 'md'} />
        <div className="seat__who">
          <h3 className="seat__name">
            <span>{line1}</span>
            {line2 !== '' && <span>{line2}</span>}
          </h3>
          <p className="seat__sub">
            <span className="seat__team">{team ?? 'komandasiz'}</span>
            {medal !== null && (
              <>
                <Crest level={medal.level} legendaTier={medal.legendaTier} size="seat" animate={rise} />
                {medal.rankTitle !== null && <span className="seat__level">{medal.rankTitle}</span>}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="seat__fig">
        {/* THE WHOLE SUM — the digits ARE the reading this board reconciles
            against the floor's own; no unit, no tooltip. */}
        <span className="seat__figure">
          <AnimatedNumber value={figure} format={formatSomFull} duration={900} />
        </span>
        <p className="seat__facts">
          <span className="seat__cap">{onDelivered ? 'FAKT 2' : 'FAKT 1'}</span>
          {other > 0 && (
            <span className="seat__other">
              {onDelivered ? 'FAKT 1' : 'FAKT 2'} <b>{formatSomFull(other)}</b>
            </span>
          )}
        </p>
      </div>

      {medal !== null && (
        <>
          <div className="seat__prog">
            <div className="seat__bar" aria-hidden="true">
              <i style={{ width: `${(progressOf(medal) * 100).toFixed(1)}%` }} />
            </div>
            <p className="seat__next">{nextLevelSentence(medal)}</p>
          </div>
          {medal.medals.length > 0 && (
            <div className="seat__medals">
              {sortMedals(medal.medals).map((m) => (
                <MedalMark key={m.code} code={m.code} count={m.count} isNew={newKeys?.has(m.code) ?? false} />
              ))}
            </div>
          )}
        </>
      )}
    </article>
  )
}
