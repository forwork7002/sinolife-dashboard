/**
 * Sotuvchilar medallari — pagon, ball va daraja.
 *
 * SOF FUNKSIYA, ATAYLAB. Bazaga tegmaydi, React'ga tegmaydi va bitta ham
 * o'zbek so'zi chiqarmaydi — medalning SABABI bu yerda strukturaviy (qaysi
 * oy, qancha pul, necha foiz), matnga aylanishi esa `Pagon.tsx` da bo'ladi.
 * Sabab: bu qoidalar bazasiz test qilinadi va ular bilan bahslashadigan
 * yagona narsa — raqam, matn emas.
 *
 * KOEFFITSIYENTLAR 2026-09-15 da production'da 126 sotuvchi ustida
 * kalibrlangan va qotirilgan. Bir marta ishga tushgan darajani keyin
 * pasaytirish mumkin emas: floor uni jazo deb o'qiydi. Kalibrlash natijasi va
 * nima uchun aynan bu raqamlar tanlangani spec'da:
 * `docs/superpowers/specs/2026-09-15-sotuvchilar-medallari-design.md`.
 */

/**
 * N-darajaga kerak bo'ladigan ball: `50·N² − 50·N`.
 *
 * KVADRATIK, chunki chiziqli narvon ikki yomonlikdan birini beradi: boshida
 * juda sekin (yangi sotuvchi hech qachon qimirlamaydi) yoki oxirida juda tez
 * (chempion bir yilda 40-darajaga chiqib, narvonni tugatadi). O'lchov:
 * mediana sotuvchi oyiga ~800–1 100 ball yig'adi, ya'ni boshida deyarli har
 * ikki haftada daraja ko'tariladi va 10-darajadan keyin sekinlashadi.
 */
export function levelFloorOf(level: number): number {
  return 50 * level * level - 50 * level
}

/**
 * Ballga mos daraja.
 *
 * Yopiq shakl (`levelFloorOf` ni teskarisi) emas, sanoq — narvon 30-daraja
 * atrofida tugaydi, ya'ni sikl eng ko'pi bilan o'ttiz qadam yuradi va
 * kvadrat ildizning suzuvchi nuqtadagi yaxlitlanishi chegaraning AYNAN
 * ustida turgan ballni bir daraja pastga tushirib yuborish xavfini
 * butunlay olib tashlaydi.
 */
export function levelOf(points: number): number {
  let level = 1
  while (levelFloorOf(level + 1) <= points) level++
  return level
}

/**
 * Unvon bandlari, KAMAYIB — o'qilishi «siz o'tgan eng yuqori chegara», va
 * o'sib baholansa 21-darajali Legendaga «Yangi» berilardi.
 */
export const RANK_TITLES: readonly (readonly [number, string])[] = Object.freeze([
  [21, "Legenda"],
  [16, "Master"],
  [12, "Usta"],
  [8, "Katta sotuvchi"],
  [4, "Sotuvchi"],
  [1, "Yangi"],
] as const)

export function titleOf(level: number): string {
  return RANK_TITLES.find(([floor]) => level >= floor)?.[1] ?? "Yangi"
}

/**
 * Keyingi daraja unvonni almashtirsa — o'sha unvon; almashtirmasa — null.
 *
 * Progress chizig'i har doim KEYINGI DARAJANI ko'rsatadi, chunki u yaqin va
 * erishsa bo'ladigan maqsad. Lekin «13-darajaga 680 ball» dan ko'ra
 * «Master'ga 1 000 ball» ko'proq narsa aytadi, shuning uchun sarlavha o'tish
 * unvonni ko'targan paytdagina unvon nomini oladi.
 */
export function nextTitleOf(level: number): string | null {
  const next = titleOf(level + 1)
  return next === titleOf(level) ? null : next
}

export const MEDAL_CODES = [
  'month-gold',
  'month-silver',
  'month-bronze',
  'year-champion',
  'streak-fire',
  'streak-steady',
  'work-month',
  'conversion-master',
  'clean-month',
  'jump',
  'rookie',
  'day-record',
  'day-winner',
  'first-sale',
  'club',
] as const

export type MedalCode = (typeof MEDAL_CODES)[number]

/**
 * Bir sotuvchining bir oyi. `place` — o'sha oyning butun floor bo'yicha
 * o'rni, podiumning o'z qoidasi bilan (FAKT 2 birinchi, FAKT 1 hech kim
 * yetkazmagan oyni hal qiladi) — repozitoriy hisoblab beradi.
 */
export interface SellerMonthFact {
  /** Oyning birinchi kuni, `YYYY-MM-DD`, hisobot mintaqasida. */
  readonly month: string
  readonly employeeId: string
  readonly confirmedOrders: number
  readonly confirmedMinor: bigint
  readonly deliveredOrders: number
  readonly deliveredMinor: bigint
  readonly place: number
}

/** Bir sotuvchining bir kuni. Faqat kun medallari va davomat uchun. */
export interface SellerDayFact {
  readonly day: string
  readonly employeeId: string
  readonly confirmedOrders: number
  readonly deliveredMinor: bigint
  readonly place: number
}

/**
 * Bitta medal — va uning SABABI, strukturaviy.
 *
 * `reason` degan tayyor matn yo'q: motor qaysi oy/kun, qancha pul, necha
 * buyurtma va necha foiz ekanini beradi, jumlani `Pagon.tsx` yig'adi. Shu
 * sabab bu fayl o'zbek tilini bilmaydi va test faqat raqam bilan bahslashadi.
 */
export interface SellerMedal {
  readonly code: MedalCode
  /** Takrorlanadiganlar uchun nechta. Takrorlanmaydiganda 1. */
  readonly count: number
  /** Faqat `club` uchun 1..7; qolganlarida null. */
  readonly tier: number | null
  /** Shu medal(lar) bergan ballning yig'indisi. */
  readonly points: number
  /** Sababning kuni yoki oyi, `YYYY-MM-DD`. Yo'q bo'lsa null. */
  readonly at: string | null
  readonly amountMinor: bigint | null
  readonly orders: number | null
  readonly percent: number | null
}

export interface SellerMedalRow {
  readonly employeeId: string
  readonly points: number
  readonly level: number
  readonly rankTitle: string
  readonly levelFloor: number
  readonly nextLevelAt: number
  readonly nextTitle: string | null
  /** Ball bo'yicha kamayib — pagon qimmatlisini oldin chizadi. */
  readonly medals: readonly SellerMedal[]
}

export const POINTS_PER_CONFIRMED_ORDER = 10
export const POINTS_PER_DELIVERED_ORDER = 25
export const POINTS_PER_MLN = 5

/** Takrorlanadigan medalning BIR donasi beradigan ball. `club` — pastda. */
export const MEDAL_POINTS: Readonly<Record<Exclude<MedalCode, 'club'>, number>> = Object.freeze({
  'month-gold': 500,
  'month-silver': 300,
  'month-bronze': 200,
  'year-champion': 2000,
  'streak-fire': 750,
  'streak-steady': 400,
  'work-month': 250,
  'conversion-master': 400,
  'clean-month': 300,
  jump: 300,
  rookie: 300,
  'day-record': 1000,
  'day-winner': 50,
  'first-sale': 100,
})

/**
 * Klub bosqichlari — jami FAKT 2 bo'yicha, minor birlikda.
 *
 * RAQOBAT EMAS, CHEGARA: boshqa medallarning hammasi kimdir yutganda
 * boshqasi yutqazadigan turda, va faqat shundaylardan iborat taxta 126
 * sotuvchining 83 tasini medalsiz qoldirardi (o'lchangan, 2026-09-15).
 * Klub esa hammaga ochiq — faqat turli vaqtda keladi.
 *
 * O'sish sur'ati narvonni bir yilga yetkazadi: mediana sotuvchi oyiga ~25 mln
 * qiladi, ya'ni II bosqich birinchi oyda, IV bosqich to'rtinchi oy atrofida,
 * V esa o'n oydan keyin keladi.
 */
export const CLUB_RUNGS: readonly { readonly tier: number; readonly atMinor: bigint; readonly points: number }[] =
  Object.freeze([
    { tier: 1, atMinor: 10n * 100_000_000n, points: 100 },
    { tier: 2, atMinor: 25n * 100_000_000n, points: 150 },
    { tier: 3, atMinor: 50n * 100_000_000n, points: 250 },
    { tier: 4, atMinor: 100n * 100_000_000n, points: 400 },
    { tier: 5, atMinor: 250n * 100_000_000n, points: 800 },
    { tier: 6, atMinor: 500n * 100_000_000n, points: 1200 },
    { tier: 7, atMinor: 1000n * 100_000_000n, points: 2000 },
  ])

const MINOR_PER_MLN = 100_000_000n

interface Draft {
  readonly employeeId: string
  points: number
  readonly medals: SellerMedal[]
}

export interface SellerMedalsInput {
  readonly months: readonly SellerMonthFact[]
  readonly days: readonly SellerDayFact[]
  /** `YYYY-MM` — hali yopilmagan oy. Seriya va oylik medallar undan qochadi. */
  readonly runningMonth: string
}

export function buildSellerMedals(input: SellerMedalsInput): readonly SellerMedalRow[] {
  const drafts = new Map<string, Draft>()
  const draftOf = (employeeId: string): Draft => {
    let d = drafts.get(employeeId)
    if (!d) {
      d = { employeeId, points: 0, medals: [] }
      drafts.set(employeeId, d)
    }
    return d
  }

  // --- kundalik ish -------------------------------------------------------
  for (const m of input.months) {
    const d = draftOf(m.employeeId)
    d.points += m.confirmedOrders * POINTS_PER_CONFIRMED_ORDER
    d.points += m.deliveredOrders * POINTS_PER_DELIVERED_ORDER
    d.points += Number(m.deliveredMinor / MINOR_PER_MLN) * POINTS_PER_MLN
  }

  // --- 🌱 birinchi savdo va 💎 klub — ikkalasi ham JAMI bo'yicha ----------
  const lifetimeMinor = new Map<string, bigint>()
  const lifetimeDelivered = new Map<string, number>()
  const firstDeliveredMonth = new Map<string, string>()
  for (const m of input.months) {
    lifetimeMinor.set(m.employeeId, (lifetimeMinor.get(m.employeeId) ?? 0n) + m.deliveredMinor)
    lifetimeDelivered.set(
      m.employeeId,
      (lifetimeDelivered.get(m.employeeId) ?? 0) + m.deliveredOrders,
    )
    if (m.deliveredOrders > 0) {
      const seen = firstDeliveredMonth.get(m.employeeId)
      if (seen === undefined || m.month < seen) firstDeliveredMonth.set(m.employeeId, m.month)
    }
  }

  for (const [employeeId, total] of lifetimeMinor) {
    const d = draftOf(employeeId)

    if ((lifetimeDelivered.get(employeeId) ?? 0) > 0) {
      d.points += MEDAL_POINTS['first-sale']
      d.medals.push({
        code: 'first-sale',
        count: 1,
        tier: null,
        points: MEDAL_POINTS['first-sale'],
        at: firstDeliveredMonth.get(employeeId) ?? null,
        amountMinor: null,
        orders: null,
        percent: null,
      })
    }

    // O'TILGAN HAR BOSQICH BALL BERADI, lekin CHIZILADIGANI BITTA — eng
    // yuqorisi. To'rtta klub belgisi bir pagon qatorida turmaydi, va yuqori
    // bosqich pastdagisini bekor qilishi ham noto'g'ri bo'lardi: 100 mln
    // qilgan odam 10 mln qilgandan to'rt barobar ko'p mehnat qo'ygan.
    const passed = CLUB_RUNGS.filter((r) => total >= r.atMinor)
    if (passed.length > 0) {
      const top = passed[passed.length - 1]!
      const points = passed.reduce((sum, r) => sum + r.points, 0)
      d.points += points
      d.medals.push({
        code: 'club',
        count: 1,
        tier: top.tier,
        points,
        at: null,
        amountMinor: total,
        orders: null,
        percent: null,
      })
    }
  }

  return [...drafts.values()]
    .map((d) => {
      const level = levelOf(d.points)
      return {
        employeeId: d.employeeId,
        points: d.points,
        level,
        rankTitle: titleOf(level),
        levelFloor: levelFloorOf(level),
        nextLevelAt: levelFloorOf(level + 1),
        nextTitle: nextTitleOf(level),
        medals: [...d.medals].sort((a, b) => b.points - a.points),
      }
    })
    .sort((a, b) => b.points - a.points)
}
