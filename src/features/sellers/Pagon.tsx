'use client'

import { monthLabel } from '@/features/sellers/RecordWall'
import type { MedalCode, SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

/**
 * Pagon — medal chizig'i, ball va daraja.
 *
 * TELEVIZORDA SICHQONCHA YO'Q, va shu bitta fakt bu faylning yarmini
 * belgilaydi. Medalning ma'nosi hover ostida yashira olmaydi: floordagi odam
 * 🎯 belgisini ko'radi-yu, nima uchun berilganini hech qachon bilmaydi. Shu
 * sababdan har medal UCH narsa olib yuradi — belgi, o'zbek nomi va SABABI
 * fakt bilan — va ustunning bitta soati navbat bilan bittasini ochib,
 * ekranning o'zi medal alifbosini o'rgatadi.
 *
 * SABAB BU YERDA YIG'ILADI, domen qatlamida emas. `SellerMedalDto` bo'laklar
 * beradi (qaysi oy, qancha pul, necha foiz), chunki seat kartasi uzun jumla,
 * jadval qatori esa qisqasini tuzadi — bir xil bo'laklardan ikki uzunlik.
 *
 * DARAJA — O'RIN EMAS, va bu jumla ekranda bo'lishi kerak. O'rin — bu
 * davrdagi pul; daraja — 2026-avgustdan buyon to'plangan mehnat. 8-o'rindagi
 * odam 12-darajada bo'lishi mumkin va bu xato emas.
 */

/** Medalning belgisi va o'zbekcha nomi. Nom HAR DOIM chiziladi — `sr-only`
 *  bo'lsa ham — chunki emoji o'zi hech narsa demaydi. */
export const MEDALS: Readonly<Record<MedalCode, { readonly glyph: string; readonly name: string }>> =
  Object.freeze({
    'month-gold': { glyph: '🥇', name: 'Oy chempioni' },
    'month-silver': { glyph: '🥈', name: 'Kumush oy' },
    'month-bronze': { glyph: '🥉', name: 'Bronza oy' },
    'year-champion': { glyph: '🏆', name: 'Yil chempioni' },
    'streak-fire': { glyph: '🔥', name: 'Olov seriyasi' },
    'streak-steady': { glyph: '⭐', name: 'Barqaror' },
    'work-month': { glyph: '📅', name: 'Ishchan oy' },
    'conversion-master': { glyph: '🎯', name: 'Konversiya ustasi' },
    'clean-month': { glyph: '💯', name: 'Toza oy' },
    jump: { glyph: '📈', name: 'Sakrash' },
    rookie: { glyph: '🚀', name: 'Yangi yulduz' },
    'day-record': { glyph: '⚡', name: 'Kun rekordi' },
    'day-winner': { glyph: '🌅', name: 'Kun gʻolibi' },
    'first-sale': { glyph: '🌱', name: 'Birinchi savdo' },
    club: { glyph: '💎', name: 'Klub' },
  })

/** Klub bosqichi — rim raqami. O'lchov emas, unvon: «IV bosqich». */
export const CLUB_TIER_NAMES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const

const tierOf = (medal: SellerMedalDto): string =>
  medal.tier === null ? '' : (CLUB_TIER_NAMES[medal.tier - 1] ?? '')

/**
 * Medalning sababi, bir jumlada.
 *
 * Har medal o'zining eng aytishga arziydigan faktini oladi: pul medali —
 * summani, sifat medali — foizni, seriya — oyni. Bo'sh satr qaytmaydi:
 * izohsiz medal televizorda javobsiz savol bo'lib qoladi.
 */
export function medalReason(medal: SellerMedalDto): string {
  const when = medal.at === null ? null : monthLabel(medal.at)
  const parts: string[] = []

  if (medal.code === 'club') {
    parts.push(`${tierOf(medal)} bosqich`)
    if (medal.amount !== null) parts.push(`jami ${formatFullUzs(medal.amount.amount)} soʻm`)
    return parts.join(' · ')
  }

  /*
    📅 «ISHCHAN OY»NING `orders` MAYDONI BUYURTMA EMAS, KUN, VA `percent`
    KONVERSIYA EMAS, DAVOMAT. Domen qatlami floor ishlagan kunlar ichida bu
    sotuvchi necha kun tasdiq berganini `orders`da, ulushni `percent`da
    uzatadi (boshqa maydon qo'shmaslik uchun) — umumiy yo'ldan o'tsa, kun
    soni «N buyurtma» deb, foiz esa yorliqsiz chizilardi, va bu aynan mijoz
    2026-09-15 da o'chirtirgan ziddiyatli holatni qayta yaratardi.
  */
  if (medal.code === 'work-month') {
    if (when !== null) parts.push(when)
    if (medal.orders !== null) parts.push(`${formatNumber(medal.orders)} kun`)
    if (medal.percent !== null) parts.push(`davomat ${formatPercent(medal.percent)}`)
    if (medal.count > 1) parts.push(`${formatNumber(medal.count)} marta`)
    return parts.length > 0 ? parts.join(' · ') : MEDALS[medal.code].name
  }

  if (when !== null) parts.push(when)
  if (medal.percent !== null) parts.push(formatPercent(medal.percent))
  if (medal.amount !== null) parts.push(`${formatFullUzs(medal.amount.amount)} soʻm`)
  /*
    🚀 NING `orders` MAYDONI BUYURTMA EMAS, O'RIN. Domen qatlami yangi
    yulduzning birinchi oyidagi o'rnini shu maydonda uzatadi (boshqa
    maydon qo'shmaslik uchun), shuning uchun uni «7 buyurtma» deb chizish
    yolg'on bo'lardi — medal aytayotgan narsa «7-oʻrin».
  */
  if (medal.code === 'rookie' && medal.orders !== null) {
    parts.push(`${formatNumber(medal.orders)}-oʻrin`)
  } else if (medal.orders !== null) {
    parts.push(`${formatNumber(medal.orders)} buyurtma`)
  }
  if (medal.count > 1) parts.push(`${formatNumber(medal.count)} marta`)

  return parts.length > 0 ? parts.join(' · ') : MEDALS[medal.code].name
}

/** Unvon bandining tartibi — chevron nechta chiziq chizishini hal qiladi. */
const BAND_BARS: Readonly<Record<string, number>> = Object.freeze({
  Yangi: 1,
  Sotuvchi: 2,
  'Katta sotuvchi': 3,
  Usta: 4,
  Master: 5,
  Legenda: 6,
})

const SEAT_MEDALS = 5
const ROW_MEDALS = 3

export function Pagon({
  row,
  variant,
  speaking,
}: {
  row: SellerMedalRowDto
  variant: 'seat' | 'row'
  /** Ustunning soati shu seatga navbat berganida — ochiladigan medal. */
  speaking?: SellerMedalDto | null
}) {
  const cap = variant === 'seat' ? SEAT_MEDALS : ROW_MEDALS
  const shown = row.medals.slice(0, cap)
  const rest = row.medals.length - shown.length

  const span = Math.max(1, row.nextLevelAt - row.levelFloor)
  const done = Math.max(0, Math.min(100, ((row.points - row.levelFloor) / span) * 100))
  const remaining = Math.max(0, row.nextLevelAt - row.points)
  const goal =
    row.nextTitle !== null
      ? `${row.nextTitle}ga ${formatNumber(remaining)} ball`
      : `${formatNumber(row.level + 1)}-darajaga ${formatNumber(remaining)} ball`

  return (
    <div className={`pagon${variant === 'row' ? ' pagon--row' : ''}`}>
      <p className="pagon-level">
        <span className="pagon-chevron" aria-hidden="true">
          {Array.from({ length: BAND_BARS[row.rankTitle] ?? 1 }, (_, i) => (
            <span key={i} />
          ))}
        </span>
        <span className="tabular">{formatNumber(row.level)}-daraja</span>
        <span className="pagon-title">{row.rankTitle}</span>
        {variant === 'seat' && (
          <span className="tabular pagon-goal">{formatNumber(row.points)} ball</span>
        )}
      </p>

      {variant === 'seat' && (
        <>
          <div className="pagon-track" aria-hidden="true">
            <div className="pagon-fill" style={{ width: `${Math.max(2, done)}%` }} />
          </div>
          <p className="pagon-goal">{goal}</p>
        </>
      )}

      {shown.length > 0 && (
        <div className="pagon-medals">
          {shown.map((medal) => (
            <span
              key={`${medal.code}-${medal.at ?? ''}`}
              className={`pagon-medal${medal.code === 'club' ? ' pagon-medal--club' : ''}`}
              title={`${MEDALS[medal.code].name} — ${medalReason(medal)}`}
            >
              <span aria-hidden="true">{MEDALS[medal.code].glyph}</span>
              <span className="sr-only">{MEDALS[medal.code].name}</span>
              {medal.code === 'club' && <span aria-hidden="true">{tierOf(medal)}</span>}
              {medal.count > 1 && <span className="tabular">×{formatNumber(medal.count)}</span>}
            </span>
          ))}
          {rest > 0 && <span className="pagon-more tabular">+{formatNumber(rest)}</span>}
        </div>
      )}

      {variant === 'seat' && speaking != null && (
        <div className="pagon-speech">
          <span aria-hidden="true">{MEDALS[speaking.code].glyph}</span>
          <span>
            <span className="pagon-speech-name">{MEDALS[speaking.code].name}</span>
            <br />
            <span className="pagon-speech-why">{medalReason(speaking)}</span>
          </span>
        </div>
      )}
    </div>
  )
}
