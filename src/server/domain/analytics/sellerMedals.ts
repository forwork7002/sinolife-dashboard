/**
 * Sotuvchilar medallari — pagon, ball va daraja.
 *
 * SOF FUNKSIYA, ATAYLAB. Bazaga tegmaydi, React'ga tegmaydi va bitta ham
 * o'zbek so'zi chiqarmaydi — medalning SABABI bu yerda strukturaviy (qaysi
 * oy, qancha pul, necha foiz), matnga aylanishi esa `Pagon.tsx` da bo'ladi.
 * Sabab: bu qoidalar bazasiz test qilinadi va ular bilan bahslashadigan
 * yagona narsa — raqam, matn emas.
 *
 * NARVON 2026-09-16 da production'da 126 sotuvchi ustida o'lchangan
 * taqsimotdan tanlangan va qotirilgan (jami yetkazilgan pul: p50 30,8 mln,
 * p90 102 mln, max 173 mln). Ishga tushgan ostonani keyin ko'tarish mumkin
 * emas: floor uni jazo deb o'qiydi. Spec:
 * `docs/superpowers/specs/2026-09-16-daraja-va-medallar-design.md`.
 */

/** 1 so'm = 100 minor; 1 mln so'm. */
export const MINOR_PER_MLN = 100_000_000n

/**
 * Daraja — 2026-avgustdan beri yetkazilgan JAMI FAKT 2 dan, faqat ko'tariladi.
 *
 * AYTIB YURILADIGAN RAQAMLAR: «yuz million — Usta», «bir milliard — Legenda».
 * 1-daraja birinchi so'mdan — nol yetkazgan sotuvchi 0-darajada, unvonsiz,
 * va bu ogohlantirish emas: bitta savdo uni Yangi qiladi.
 */
export const LEVEL_THRESHOLDS_MINOR: readonly bigint[] = Object.freeze([
  1n, // 1 · Yangi — birinchi so'm
  10n * MINOR_PER_MLN, // 2 · Sotuvchi
  30n * MINOR_PER_MLN, // 3 · Katta sotuvchi
  100n * MINOR_PER_MLN, // 4 · Usta
  300n * MINOR_PER_MLN, // 5 · Ustoz
  1000n * MINOR_PER_MLN, // 6 · Legenda
])

export const LEVEL_TITLES: readonly string[] = Object.freeze([
  'Yangi',
  'Sotuvchi',
  'Katta sotuvchi',
  'Usta',
  'Ustoz',
  'Legenda',
])

/** Legenda har keyingi milliardda II, III … — narvon hech qachon tugamaydi. */
export const LEGENDA_STEP_MINOR = 1000n * MINOR_PER_MLN

export interface Level {
  /** 0 — hali savdosiz; 1..6. */
  readonly level: number
  /** 6-darajada 1 = Legenda, 2 = Legenda II …; pastda 0. */
  readonly legendaTier: number
}

export function levelOf(deliveredMinor: bigint): Level {
  let level = 0
  for (const threshold of LEVEL_THRESHOLDS_MINOR) {
    if (deliveredMinor >= threshold) level++
    else break
  }
  const legendaTier =
    level === 6 ? Number((deliveredMinor - LEVEL_THRESHOLDS_MINOR[5]!) / LEGENDA_STEP_MINOR) + 1 : 0
  return { level, legendaTier }
}

/** Shu darajaning ostonasi; 0-darajada 0. */
export function levelFloorMinorOf(l: Level): bigint {
  if (l.level === 0) return 0n
  if (l.level < 6) return LEVEL_THRESHOLDS_MINOR[l.level - 1]!
  return LEVEL_THRESHOLDS_MINOR[5]! + BigInt(l.legendaTier - 1) * LEGENDA_STEP_MINOR
}

/** Keyingi ostona — HAR DOIM bor: 0-darajada birinchi so'm, Legendada keyingi milliard. */
export function nextLevelAtMinorOf(l: Level): bigint {
  if (l.level < 6) return LEVEL_THRESHOLDS_MINOR[l.level]!
  return LEVEL_THRESHOLDS_MINOR[5]! + BigInt(l.legendaTier) * LEGENDA_STEP_MINOR
}

export function romanOf(n: number): string {
  const table: readonly (readonly [number, string])[] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let rest = Math.max(0, Math.floor(n))
  let out = ''
  for (const [value, glyph] of table) {
    while (rest >= value) {
      out += glyph
      rest -= value
    }
  }
  return out
}

/** «Ustoz», «Legenda II»; 0-darajada null — unvonsiz. */
export function titleOf(l: Level): string | null {
  if (l.level === 0) return null
  const title = LEVEL_TITLES[l.level - 1]!
  return l.level === 6 && l.legendaTier > 1 ? `${title} ${romanOf(l.legendaTier)}` : title
}

/** Keyingi darajaning unvoni — «… ga N mln qoldi» jumlasi uchun; har doim bor. */
export function nextTitleOf(l: Level): string {
  const next: Level =
    l.level < 6
      ? { level: l.level + 1, legendaTier: l.level + 1 === 6 ? 1 : 0 }
      : { level: 6, legendaTier: l.legendaTier + 1 }
  return titleOf(next)!
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

/**
 * Sifat medallarining eng kam buyurtmasi.
 *
 * 19 ta buyurtmadagi 100% konversiya statistik shovqin, mahorat emas — va
 * medal uni mahorat deb e'lon qilsa, taxtaning ishonchi shunga ketadi.
 */
export const MEDAL_MIN_ORDERS = 20

/** 💯 «Toza oy» chegarasi. O'lchangan: p75 = 78.6%, p90 = 85.7%. */
export const CLEAN_MONTH_PERCENT = 80

/**
 * 📅 «Ishchan oy» — floor ishlagan kunlarning ulushi.
 *
 * 100% EMAS, VA BO'LISHI HAM MUMKIN EMAS. Avgustda floor 31 kun ishladi;
 * dam olish kuni bor sotuvchi 100% ga hech qachon chiqmaydi. O'lchangan:
 * eng yuqori davomat 96.8%, p90 = 77.4%, p50 = 35.5% — 100% qoidasi NOL
 * kishiga medal berardi. 60% 29 kishini qamraydi va «bu oy muntazam ishladi»
 * degan haqiqiy faktligicha qoladi.
 */
export const WORK_MONTH_SHARE = 0.6

/** 📈 «Sakrash» — o'tgan oyning necha barobari. */
export const JUMP_GROWTH = 1.5

/** Seriya uchun kerakli ketma-ket YOPILGAN oy soni. */
export const STREAK_MONTHS = 3
/** 🔥 «Olov seriyasi» — shu o'rin va undan yuqori. */
export const STREAK_FIRE_PLACE = 3
/** ⭐ «Barqaror» — shu o'rin va undan yuqori. */
export const STREAK_STEADY_PLACE = 10

/** 🚀 «Yangi yulduz» — birinchi to'liq oyda shu o'rin va undan yuqori. */
export const ROOKIE_PLACE = 10

/**
 * 🚀 shu oydan OLDIN boshlaganlarga berilmaydi.
 *
 * `RECORDS_FROM = '2026-08'` chegarasi tufayli o'sha oyda HAMMA sotuvchi
 * «birinchi oyida» ko'rinadi — bu portalning atributsiya nuqsoni
 * (`UF_CRM_1778416910` yozila boshlaguncha bitim joriy mas'ulga yozilgan),
 * sotuvchining fakti emas. Devor ochilgan oyda medal tarqatish uni faktdek
 * ko'rsatardi.
 */
export const ROOKIE_FROM_MONTH = '2026-09'

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
  /**
   * `YYYY-MM-DD`, hisobot mintaqasida — hali tugamagan kun.
   *
   * Xuddi `runningMonth` oylik medallarni chetlab o'tgani kabi, ⚡ va 🌅 shu
   * kunni chetlab o'tadi. Kun tugamaguncha uning `place`i har soatda
   * o'zgaradi: bugungi yetakchi kechqurun boshqasidan oshirilib, 🌅 ni
   * yo'qotardi — va 50 ball yo'qotish darajani pasaytirishi mumkin, spec esa
   * darajaning hech qachon pasaymasligini talab qiladi.
   */
  readonly runningDay: string
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

  // --- oylarni guruhlash; joriy oy hech qanday oylik medal bermaydi -------
  /*
    YOPILMAGAN OY MEDAL BERMAYDI. Uning o'rni har kuni o'zgaradi, ya'ni
    oltin medal ertalab berilib kechqurun olinardi — bu taxtani buzuq
    qiladi. Xuddi shu sabab `📅` va `📈` ham yopilgan oyda hisoblanadi.
  */
  const byMonth = new Map<string, SellerMonthFact[]>()
  for (const m of input.months) {
    if (m.month.slice(0, 7) === input.runningMonth) continue
    const bucket = byMonth.get(m.month)
    if (bucket) bucket.push(m)
    else byMonth.set(m.month, [m])
  }
  const closedMonths = [...byMonth.keys()].sort()

  const daysByMonth = new Map<string, SellerDayFact[]>()
  for (const d of input.days) {
    const key = `${d.day.slice(0, 7)}-01`
    const bucket = daysByMonth.get(key)
    if (bucket) bucket.push(d)
    else daysByMonth.set(key, [d])
  }

  /** Bir medalni qo'shadi; takrorlanadigani bo'lsa sanoqni oshiradi. */
  const award = (
    employeeId: string,
    code: Exclude<MedalCode, 'club'>,
    at: string | null,
    detail: { amountMinor?: bigint; orders?: number; percent?: number } = {},
  ): void => {
    const d = draftOf(employeeId)
    const points = MEDAL_POINTS[code]
    d.points += points
    const seen = d.medals.find((m) => m.code === code)
    if (seen) {
      const index = d.medals.indexOf(seen)
      d.medals[index] = {
        ...seen,
        count: seen.count + 1,
        points: seen.points + points,
        // ENG OXIRGI SABAB QOLADI: pagon «qachon oldi» deganda yangisini
        // ko'rsatadi — eskisi hikoya, yangisi yangilik.
        at: at !== null && (seen.at === null || at > seen.at) ? at : seen.at,
        amountMinor: detail.amountMinor ?? seen.amountMinor,
        orders: detail.orders ?? seen.orders,
        percent: detail.percent ?? seen.percent,
      }
      return
    }
    d.medals.push({
      code,
      count: 1,
      tier: null,
      points,
      at,
      amountMinor: detail.amountMinor ?? null,
      orders: detail.orders ?? null,
      percent: detail.percent ?? null,
    })
  }

  const conversionOf = (m: SellerMonthFact): number =>
    m.confirmedOrders > 0 ? (m.deliveredOrders / m.confirmedOrders) * 100 : 0

  for (const monthKey of closedMonths) {
    const rows = byMonth.get(monthKey)!

    // --- 🥇🥈🥉 podium ---------------------------------------------------
    for (const m of rows) {
      if (m.place === 1) award(m.employeeId, 'month-gold', monthKey, { amountMinor: m.deliveredMinor, orders: m.deliveredOrders })
      else if (m.place === 2) award(m.employeeId, 'month-silver', monthKey, { amountMinor: m.deliveredMinor, orders: m.deliveredOrders })
      else if (m.place === 3) award(m.employeeId, 'month-bronze', monthKey, { amountMinor: m.deliveredMinor, orders: m.deliveredOrders })
    }

    // --- 🎯 va 💯, ikkalasi ham eng kam buyurtma gatesi ostida ------------
    const eligible = rows.filter((m) => m.confirmedOrders >= MEDAL_MIN_ORDERS)
    let best: SellerMonthFact | null = null
    for (const m of eligible) if (best === null || conversionOf(m) > conversionOf(best)) best = m
    if (best !== null) {
      award(best.employeeId, 'conversion-master', monthKey, {
        percent: conversionOf(best),
        orders: best.confirmedOrders,
      })
    }
    for (const m of eligible) {
      if (conversionOf(m) >= CLEAN_MONTH_PERCENT) {
        award(m.employeeId, 'clean-month', monthKey, {
          percent: conversionOf(m),
          orders: m.confirmedOrders,
        })
      }
    }

    // --- 📅 ishchan oy ----------------------------------------------------
    /*
      ISH KUNI — KALENDAR EMAS, FLOORNING O'ZI. «Butun floor kamida bitta
      buyurtma tasdiqlagan kun» — bayram va yakshanbani sotuvchining aybiga
      yozib bo'lmaydi, va portalning o'z ma'lumoti bu savolga allaqachon
      javob beradi.
    */
    const dayRows = daysByMonth.get(monthKey) ?? []
    const floorDays = new Set(dayRows.filter((d) => d.confirmedOrders > 0).map((d) => d.day))
    if (floorDays.size > 0) {
      const worked = new Map<string, Set<string>>()
      for (const d of dayRows) {
        if (d.confirmedOrders === 0) continue
        const set = worked.get(d.employeeId) ?? new Set<string>()
        set.add(d.day)
        worked.set(d.employeeId, set)
      }
      for (const m of rows) {
        const mine = worked.get(m.employeeId)?.size ?? 0
        if (mine / floorDays.size >= WORK_MONTH_SHARE) {
          award(m.employeeId, 'work-month', monthKey, {
            orders: mine,
            percent: (mine / floorDays.size) * 100,
          })
        }
      }
    }
  }

  // --- 📈 sakrash: qo'shni YOPILGAN oylar orasida -------------------------
  for (let i = 1; i < closedMonths.length; i++) {
    const before = new Map(
      byMonth.get(closedMonths[i - 1]!)!.map((m) => [m.employeeId, m.deliveredMinor] as const),
    )
    for (const m of byMonth.get(closedMonths[i]!)!) {
      const past = before.get(m.employeeId) ?? 0n
      // NOLDAN BOSHLAGANGA BERILMAYDI: nolning ellik foizi ham nol, ya'ni
      // birinchi oyi bor har kim avtomatik «sakragan» bo'lib chiqardi.
      if (past <= 0n) continue
      if (m.deliveredMinor * 2n >= past * 3n) {
        award(m.employeeId, 'jump', closedMonths[i]!, {
          amountMinor: m.deliveredMinor,
          percent: (Number(m.deliveredMinor) / Number(past) - 1) * 100,
        })
      }
    }
  }

  // --- 🔥 ⭐ seriya -------------------------------------------------------
  /*
    QATNASHMAGAN OY KETMA-KETLIKNI UZADI. Bir oy umuman ko'rinmagan sotuvchi
    «top-3 dan chiqmagan» emas — u ishlamagan, va seriya aynan davomiylik
    haqidagi medal. Shuning uchun sanoq oylar ro'yxati bo'ylab yuradi, har
    oyda qatnashuvni ham, o'rinni ham tekshiradi.

    SERIYA TUGAGACH QAYTA BOSHLANADI, ya'ni olti oy ketma-ket ikkita medal
    beradi — bir marta berilib qoladigan medal barqarorlikni rag'batlantirmay
    qo'yadi.
  */
  const placesOf = new Map<string, Map<string, number>>()
  for (const monthKey of closedMonths) {
    for (const m of byMonth.get(monthKey)!) {
      const seen = placesOf.get(m.employeeId) ?? new Map<string, number>()
      seen.set(monthKey, m.place)
      placesOf.set(m.employeeId, seen)
    }
  }
  for (const [employeeId, places] of placesOf) {
    for (const [cap, code] of [
      [STREAK_FIRE_PLACE, 'streak-fire'],
      [STREAK_STEADY_PLACE, 'streak-steady'],
    ] as const) {
      let run = 0
      for (const monthKey of closedMonths) {
        const place = places.get(monthKey)
        run = place !== undefined && place <= cap ? run + 1 : 0
        if (run >= STREAK_MONTHS) {
          award(employeeId, code, monthKey)
          run = 0
        }
      }
    }
  }

  // --- 🏆 yil chempioni, faqat YOPILGAN yil ------------------------------
  const runningYear = input.runningMonth.slice(0, 4)
  const byYear = new Map<string, Map<string, bigint>>()
  for (const monthKey of closedMonths) {
    const year = monthKey.slice(0, 4)
    if (year === runningYear) continue
    const totals = byYear.get(year) ?? new Map<string, bigint>()
    for (const m of byMonth.get(monthKey)!) {
      totals.set(m.employeeId, (totals.get(m.employeeId) ?? 0n) + m.deliveredMinor)
    }
    byYear.set(year, totals)
  }
  for (const [year, totals] of byYear) {
    let championId: string | null = null
    let championMinor = 0n
    for (const [employeeId, minor] of totals) {
      // Teng bo'lganda `employee.id` — ism 'uz' va 'ru' da boshqacha
      // saralanadi (`branches.ts`), va ikki so'rov orasida o'rin almashadigan
      // taxta buzuq ko'rinadi.
      if (minor > championMinor || (minor === championMinor && championId !== null && employeeId < championId)) {
        championId = employeeId
        championMinor = minor
      }
    }
    if (championId !== null && championMinor > 0n) {
      award(championId, 'year-champion', `${year}-12-01`, { amountMinor: championMinor })
    }
  }

  // --- ⚡ 🌅 kun medallari ------------------------------------------------
  let recordDay: SellerDayFact | null = null
  for (const d of input.days) {
    // JORIY KUN MEDAL BERMAYDI — xuddi joriy oy kabi. Kun tugamaguncha
    // `place`i har soatda o'zgaradi, ya'ni bugungi g'olib kechqurun almashib
    // ketardi, va ⚡ ni ham xuddi shunday yo'qotib-topib turardi.
    if (d.day === input.runningDay) continue
    // PULSIZ KUN G'OLIBLIK EMAS. `place` hamma qatnashgan kun uchun
    // beriladi, shu jumladan hech kim yetkazmagan kun uchun ham — u yerdagi
    // «1-o'rin» tie-break natijasi, yutuq emas.
    if (d.place === 1 && d.deliveredMinor > 0n) {
      award(d.employeeId, 'day-winner', d.day, { amountMinor: d.deliveredMinor })
    }
    if (d.deliveredMinor > 0n && (recordDay === null || d.deliveredMinor > recordDay.deliveredMinor)) {
      recordDay = d
    }
  }
  if (recordDay !== null) {
    award(recordDay.employeeId, 'day-record', recordDay.day, { amountMinor: recordDay.deliveredMinor })
  }

  // --- 🚀 yangi yulduz ----------------------------------------------------
  const firstMonthOf = new Map<string, string>()
  for (const monthKey of closedMonths) {
    for (const m of byMonth.get(monthKey)!) {
      const seen = firstMonthOf.get(m.employeeId)
      if (seen === undefined || monthKey < seen) firstMonthOf.set(m.employeeId, monthKey)
    }
  }
  for (const [employeeId, firstMonth] of firstMonthOf) {
    if (firstMonth.slice(0, 7) < ROOKIE_FROM_MONTH) continue
    const place = placesOf.get(employeeId)?.get(firstMonth)
    if (place !== undefined && place <= ROOKIE_PLACE) {
      // `orders` bu yerda buyurtma soni emas — bu medalda u o‘RINNI tashiydi,
      // aks holda keyingi render «7 buyurtma» deb «7-o‘rin»ni yozib qo‘yadi.
      award(employeeId, 'rookie', firstMonth, { orders: place })
    }
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
      const lvl = levelOf(lifetimeMinor.get(d.employeeId) ?? 0n)
      return {
        employeeId: d.employeeId,
        points: d.points,
        level: lvl.level,
        rankTitle: titleOf(lvl) ?? 'Yangi',
        levelFloor: 0,
        nextLevelAt: 0,
        nextTitle: null,
        medals: [...d.medals].sort((a, b) => b.points - a.points),
      }
    })
    .sort((a, b) => b.points - a.points)
}
