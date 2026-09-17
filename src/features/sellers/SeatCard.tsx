import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Crest } from '@/features/sellers/Crest'
import { UZ_MONTHS as MONTHS } from '@/features/sellers/dateLine'
import { Halo, metalOfRank } from '@/features/sellers/Halo'
import { MedalMark } from '@/features/sellers/MedalMark'
import { MEDALS, dativeOf, nextLevelSentence, progressOf, seatMedals } from '@/features/sellers/medalCatalog'
import { parseSellerName } from '@/features/sellers/sellerName'
import type { MedalCode, SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { NO_VALUE, formatSomFull } from '@/lib/format'

/** Kun bilan sanalanadigan medallar — qolganlarining `at` i oy boshi (`YYYY-MM-01`). */
const DAY_MEDALS: ReadonlySet<MedalCode> = new Set<MedalCode>(['day-winner', 'day-record'])

/**
 * Tokcha izohidagi sana (delta 8i): kun medali «9-sentabr», yil chempioni
 * «2025», qolgani — sababning oyi, «avgust». Motor bu medallarning `at`
 * iga oy boshini yozadi (`sellerMedals.ts`), ya'ni «1-avgust» deb yozish
 * bo'lmagan kunni aytardi. «hozircha» YO'Q (mijoz qarori 3).
 */
export function medalWhen(medal: SellerMedalDto): string | null {
  if (medal.at === null) return null
  const [year, month, day] = medal.at.split('-')
  const name = MONTHS[Number(month) - 1]
  if (name === undefined || year === undefined) return null
  if (medal.code === 'year-champion') return year
  if (DAY_MEDALS.has(medal.code)) return `${Number(day)}-${name}`
  return name
}

/**
 * Pul satrining kengligi xonalar soniga bog'liq (Inter, tnum, U+202F):
 * 8 xona 5,51em, 9 xona 6,15em, 10 xona 6,97em. CSS har bandga o'z `cqi`
 * chegarasini beradi — mock kengligida 40 / 52 px saqlanadi, hech bir raqam
 * o'rindiqdan chiqmaydi. 8 xonagacha — atributsiz.
 */
function digitsBand(figure: number): '9' | '10' | undefined {
  const whole = Math.abs(Math.round(figure))
  if (whole >= 1_000_000_000) return '10'
  if (whole >= 100_000_000) return '9'
  return undefined
}

/**
 * O'rindiq — EFIR Premium (spec §4, delta 8–8j). Yuqoridan pastga:
 * tanga · ikki qatorli ism (kod 2-qatorda sokin) · meta (plastinali gerb,
 * daraja so'zi, komanda) · pul · FAKT qatori · progress («… qoldi», 4 px
 * metr, «Avgustdan beri {delivered} / {nextLevelAt}») · medal tokchasi va
 * izohi. Ramka yo'q — material CSS da (`.seat` fon qatlamlari).
 *
 * KOMANDA BUTUNLAY TUSHADI. `.seat__meta` 20 px balandlikda o'raladigan
 * flex: sig'magan komanda ikkinchi (ko'rinmas) qatorga o'tadi, hech qachon
 * «A…» bo'lib qolmaydi. Tokcha izohi ham xuddi shunday.
 *
 * PUL BITTA MATN TUGUNI (`AnimatedNumber`), shuning uchun o'rindiqning
 * `textContent` i raqamni bir marta tashiydi.
 *
 * `data-seat-name` — xom portal ismi; testlar va taxta shu bilan topadi,
 * ism bo'linishi va kod tokenidan mustaqil.
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
  /** Musobaqa ranki — tangadagi raqam (teng bo'lsa 1, 1, 3). */
  rank: number
  /** O'rindiq — 1 markazda va baland; DOM tartibi 1-2-3, joyi CSS gridda. */
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
  const parsed = parseSellerName(name)
  const [first = '', ...restTokens] = parsed.name.split(' ')
  const second = restTokens.join(' ')
  const figure = onDelivered ? won : ordered
  const other = onDelivered ? ordered : won
  const level = medal?.level ?? 0
  const metal = metalOfRank(rank)
  const rack = medal === null ? [] : seatMedals(medal.medals, place === 1 ? 4 : 3)
  const top = rack[0]
  const topWhen = top === undefined ? null : medalWhen(top)

  return (
    <article
      className={`seat seat--${place}`}
      data-tier={level}
      data-metal={metal === 'none' ? undefined : metal}
      data-seat-name={name}
      aria-label={`${rank}-oʻrin`}
    >
      <span className="seat__band" aria-hidden="true" />
      <div className="seat__id">
        <Halo rank={rank} size={place === 1 ? 66 : 56} wreath={place === 1} />
        <div className="seat__who">
          <h3 className="seat__name">
            <span>{first}</span>
            {/* Ikkinchi qator — o'raladigan qator: sig'masa KOD butunlay tushadi
                (yashirin ikkinchi qatorga), ism esa o'z kengligida ellipsis
                bo'ladi. Hech qachon «Davlatbek 11…» (1366 auditi). */}
            {(second !== '' || parsed.code !== null) && (
              <span className="seat__name2">
                {second !== '' && <span className="nm">{second}</span>}
                {parsed.code !== null && (
                  <>
                    {second !== '' && ' '}
                    <span className="code">{parsed.code}</span>
                  </>
                )}
              </span>
            )}
          </h3>
          {(medal !== null || team !== null) && (
            <p className="seat__meta">
              {medal !== null && (
                <Crest
                  level={medal.level}
                  legendaTier={medal.legendaTier}
                  height={place === 1 ? 20 : 18}
                  plated
                  animate={rise}
                />
              )}
              {medal?.rankTitle != null && <b className="lvl">{medal.rankTitle}</b>}
              {team !== null && <span className="team">{team}</span>}
            </p>
          )}
        </div>
      </div>

      {/* THE WHOLE SUM, one text node — the digits ARE the reading this
          board reconciles against the floor's own; no unit, no tooltip. */}
      <p className="seat__money" data-digits={digitsBand(figure)}>
        <AnimatedNumber value={figure} format={formatSomFull} duration={900} />
      </p>
      <p className="seat__fakt">
        <span>
          <b>{onDelivered ? 'FAKT 2' : 'FAKT 1'}</b>
        </span>
        {other > 0 && (
          <span className="seat__other">
            <b>{onDelivered ? 'FAKT 1' : 'FAKT 2'}</b> <em>{formatSomFull(other)}</em>
          </span>
        )}
      </p>

      {medal !== null && (
        <>
          <div className="seat__prog">
            <NextLevel medal={medal} />
            <div className="meter" aria-hidden="true">
              <i style={{ width: `${(progressOf(medal) * 100).toFixed(1)}%` }} />
            </div>
            {medal.level > 0 && (
              <p className="seat__life">
                <span>Avgustdan beri</span>
                <span>
                  <em>{formatSomFull(medal.delivered.amount)}</em> / <span>{formatSomFull(medal.nextLevelAt.amount)}</span>
                </span>
              </p>
            )}
          </div>
          {top !== undefined && (
            <div className="seat__rack">
              {rack.map((m) => (
                <MedalMark
                  key={m.code}
                  code={m.code}
                  size={place === 1 ? 48 : 40}
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
        </>
      )}
    </article>
  )
}

/**
 * «Ustozga 127 010 000 qoldi» — pul `<em>` da, bitta matn tuguni. Ostonadan
 * oshib ketgan lahza (motor keyingi darajani hali yozmagan) qalin «0» emas,
 * xira chiziqcha. 0-darajada gap boshqacha — `nextLevelSentence`.
 */
export function NextLevel({ medal }: { medal: SellerMedalRowDto }) {
  if (medal.level === 0) return <p className="seat__left">{nextLevelSentence(medal)}</p>
  const left = Math.max(0, medal.nextLevelAt.amount - medal.delivered.amount)
  return (
    <p className="seat__left">
      <span>{dativeOf(medal.nextTitle)}</span>{' '}
      {left > 0 ? <em>{formatSomFull(left)}</em> : <em className="seat__none">{NO_VALUE}</em>}{' '}
      <span>qoldi</span>
    </p>
  )
}
