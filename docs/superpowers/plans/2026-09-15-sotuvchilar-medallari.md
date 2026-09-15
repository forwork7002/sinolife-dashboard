# Sotuvchilar medallari — implementatsiya rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/sellers` ekranidagi seat kartasining uch karrali «liderga nisbatan» bloki o'rniga medal pagoni, to'planadigan ball va daraja qo'yish — 126 sotuvchining har biri o'z yig'gan narsasini televizordan ko'rishi uchun.

**Architecture:** Hech qanday yangi jadval yoki migratsiya yo'q. Medal ham, ball ham `2026-08` dan buyongi faktlardan sof funksiya bilan hisoblanadi (`domain/analytics/sellerMedals.ts`), repozitoriy bitta `queueSql` kogortasidan ikki kesim (oy va kun) oladi, servis 10 daqiqa keshlaydi, va ekran uni `?include=medals` bilan alohida so'rovda o'qiydi — RecordWall'ning naqshi. Board payload'i o'zgarmaydi.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7 + PostgreSQL 16 (xom SQL `$queryRawUnsafe`), TanStack Query, Tailwind 4 + `globals.css` tokenlari, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-15-sotuvchilar-medallari-design.md`

## Global Constraints

- **`/sellers` — himoyalangan ekran.** Mijozning 2026-09-11 dagi «teginilmasin» chegarasi mijozning 2026-09-15 dagi o'z so'rovi bilan kesilmoqda. Diff faqat quyidagilarga tegadi: seat kartasining pastki bloki, jadval qatoridagi **ism katakchasi**, va yangi fayllar. **Tegilmaydi:** `RecordWall.tsx`, `useAutoScroll.ts`, FAKT 1 / FAKT 2 tugmalari, komandalar ustuni, jadval **ustunlari**, `confirmationSellerRecords` va `recordsSql`, `/confirmation` ning hech qayeri.
- **Metall rang ma'lumot tashimaydi** (`globals.css:128` shartnomasi). `--medal-gold/silver/bronze` va `--metal` faqat ramka, halqa, yuvindi. Ball chizig'i — `--seq-550`. Daraja raqami va unvon — `--ink-primary`. Medal foni — `--surface-sunken` + `--border`.
- **Palitradan tashqari rang yo'q.** Literal `#fff`, `#000` yoki hex rang yozilmaydi; `color-mix(in oklab, …)` va mavjud tokenlar ishlatiladi.
- **UI tili — o'zbek**, valyuta UZS, har oyna `Asia/Tashkent`.
- **Frontend hech qachon Bitrix24 bilan gaplashmaydi.** Bitrix24 → CrmProvider → SyncEngine → PostgreSQL → Repositories → Domain → Services → `/api/v1` → React. `eslint.config.mjs` buni majburlaydi.
- **Gate — uchalasi:** `npm run verify` (typecheck + lint + test), `npm run build`, `npm run db:check`. CI yo'q, git hook yo'q.
- **Vitest faqat repo ildizidan ishga tushiriladi** (`vitest.config.mts` `process.cwd()` ishlatadi).
- **`main` ga push qilinmaydi.** `.do/app.yaml` da `deploy_on_push: true` — push production'ga chiqadi. Lokal commit qilinadi; push faqat mijoz «deploy qil» deganda.
- **Shared working tree:** `git add -A` **hech qachon** ishlatilmaydi — boshqa sessiya shu repoda ishlayapti. Har commit aniq yo'l ro'yxati bilan.
- **Ball koeffitsiyentlari 2026-09-15 da production'da kalibrlangan va QOTIRILGAN.** Spec'dagi jadvaldan bir raqam ham o'zgartirilmaydi.

---

## Fayl tuzilishi

| Fayl | Mas'uliyati |
|---|---|
| `src/server/domain/analytics/sellerMedals.ts` | **yangi** — sof motor. Daraja narvoni, unvonlar, klub bosqichlari, 15 medal qoidasi, ball. Bazaga tegmaydi, React'ga tegmaydi, o'zbek matn yozmaydi (faqat strukturaviy sabab) |
| `src/server/repositories/insightsRepository.ts` | **+1 metod, +1 private static SQL** — `sellerMedalFacts()` va `medalFactsSql(grain, filterClause)`. Mavjud `recordsSql` ga tegilmaydi |
| `src/server/services/sellerBoardService.ts` | **+DTO, +metod** — `medals(ctx)`, `SellerMedalsDto`, `medalsCache` |
| `src/app/api/v1/analytics/sellers/route.ts` | **+1 `include` qiymati** — `'medals'` |
| `src/lib/api.ts` | **+DTO nusxasi** — `SellerMedalDto`, `SellerMedalRowDto`, `SellerMedalsDto` |
| `src/features/sellers/Pagon.tsx` | **yangi** — pagon (seat va qator variantlari), medal lug'ati (belgi + o'zbek nom), sabab matnini yig'ish |
| `src/features/sellers/useMedalRotation.ts` | **yangi** — ustunning bitta soati; qaysi medal «gapirayotganini» qaytaradi |
| `src/features/sellers/SellersPage.tsx` | **modifikatsiya** — eski blok olib tashlanadi, pagon o'rnatiladi, medal so'rovi qo'shiladi |
| `src/app/globals.css` | **+PAGON bo'limi** — PODIUM bo'limidan keyin, `MOTION` dan oldin |

**Testlar:** `tests/domain/sellerMedals.level.test.ts` (yangi), `tests/domain/sellerMedals.test.ts` (yangi), `tests/http/sellerMedalFactsSql.test.ts` (yangi), `tests/http/sellersRoute.test.ts` (yangi), `tests/services/sellerMedals.test.ts` (yangi), `tests/features/sellersPagon.test.tsx` (yangi), `tests/features/useMedalRotation.test.ts` (yangi), `tests/features/sellersTvBoard.test.tsx` (**mavjud** — unga qo'shiladi, mavjud testlari o'zgartirilmaydi).

---

### Task 1: Daraja narvoni va unvonlar

**Files:**
- Create: `src/server/domain/analytics/sellerMedals.ts`
- Test: `tests/domain/sellerMedals.level.test.ts`

**Interfaces:**
- Consumes: hech narsa.
- Produces: `levelFloorOf(level: number): number`, `levelOf(points: number): number`, `titleOf(level: number): string`, `nextTitleOf(level: number): string | null`, `RANK_TITLES: readonly (readonly [number, string])[]`.

- [ ] **Step 1: Write the failing test**

`tests/domain/sellerMedals.level.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { levelFloorOf, levelOf, nextTitleOf, titleOf } from '@/server/domain/analytics/sellerMedals'

/**
 * The level ladder, pinned to the numbers calibrated on production 2026-09-15.
 *
 * A level that moves after the board has shipped reads as a punishment to the
 * floor — «kecha 9-daraja edim» — so the curve is a fact this file defends,
 * not a tuning knob.
 */
describe('daraja narvoni', () => {
  it('N-darajaning chegarasi 50·N² − 50·N', () => {
    expect(levelFloorOf(1)).toBe(0)
    expect(levelFloorOf(2)).toBe(100)
    expect(levelFloorOf(3)).toBe(300)
    expect(levelFloorOf(5)).toBe(1_000)
    expect(levelFloorOf(10)).toBe(4_500)
    expect(levelFloorOf(12)).toBe(6_600)
    expect(levelFloorOf(15)).toBe(10_500)
    expect(levelFloorOf(20)).toBe(19_000)
  })

  it('nol ball — 1-daraja, chunki 1-daraja «hali savdosi yo‘q» degani', () => {
    expect(levelOf(0)).toBe(1)
    expect(levelOf(99)).toBe(1)
  })

  it('chegaraning aynan ustida keyingi darajaga o‘tadi', () => {
    expect(levelOf(100)).toBe(2)
    expect(levelOf(299)).toBe(2)
    expect(levelOf(300)).toBe(3)
  })

  it('kalibrlangan haqiqiy ballar o‘lchangan darajani beradi', () => {
    // probe-medals3.mts, production, 2026-09-15
    expect(levelOf(7_700)).toBe(12) // Shahtiyarovna 197 Marjona
    expect(levelOf(1_130)).toBe(5) // mediana
  })

  it('unvon bandlari: 1–3 Yangi, 4–7 Sotuvchi, 8–11 Katta sotuvchi, 12–15 Usta, 16–20 Master, 21+ Legenda', () => {
    expect(titleOf(1)).toBe('Yangi')
    expect(titleOf(3)).toBe('Yangi')
    expect(titleOf(4)).toBe('Sotuvchi')
    expect(titleOf(7)).toBe('Sotuvchi')
    expect(titleOf(8)).toBe('Katta sotuvchi')
    expect(titleOf(11)).toBe('Katta sotuvchi')
    expect(titleOf(12)).toBe('Usta')
    expect(titleOf(15)).toBe('Usta')
    expect(titleOf(16)).toBe('Master')
    expect(titleOf(20)).toBe('Master')
    expect(titleOf(21)).toBe('Legenda')
    expect(titleOf(99)).toBe('Legenda')
  })

  it('keyingi unvon faqat keyingi daraja uni almashtirganda aytiladi', () => {
    // 12-darajadan 13-ga o‘tish hamon Usta — aytadigan yangilik yo‘q.
    expect(nextTitleOf(12)).toBeNull()
    // 15-dan 16-ga o‘tish Master qiladi — aytiladi.
    expect(nextTitleOf(15)).toBe('Master')
    expect(nextTitleOf(3)).toBe('Sotuvchi')
    expect(nextTitleOf(20)).toBe('Legenda')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/sellerMedals.level.test.ts`
Expected: FAIL — `Failed to resolve import "@/server/domain/analytics/sellerMedals"`.

- [ ] **Step 3: Write minimal implementation**

`src/server/domain/analytics/sellerMedals.ts`:

```ts
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
  [21, 'Legenda'],
  [16, 'Master'],
  [12, 'Usta'],
  [8, 'Katta sotuvchi'],
  [4, 'Sotuvchi'],
  [1, 'Yangi'],
] as const)

export function titleOf(level: number): string {
  return RANK_TITLES.find(([floor]) => level >= floor)?.[1] ?? 'Yangi'
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/sellerMedals.level.test.ts`
Expected: PASS — 6 test.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/analytics/sellerMedals.ts tests/domain/sellerMedals.level.test.ts
git commit -m "feat(sellers): daraja narvoni va unvon bandlari

50·N² − 50·N, 2026-09-15 da 126 sotuvchi ustida kalibrlangan."
```

---

### Task 2: Fakt tiplari, kundalik ball va klub bosqichlari

**Files:**
- Modify: `src/server/domain/analytics/sellerMedals.ts`
- Test: `tests/domain/sellerMedals.test.ts`

**Interfaces:**
- Consumes: `levelFloorOf`, `levelOf`, `titleOf`, `nextTitleOf` (Task 1).
- Produces: tiplar `MedalCode`, `SellerMonthFact`, `SellerDayFact`, `SellerMedal`, `SellerMedalRow`; konstantalar `MEDAL_CODES`, `MEDAL_POINTS`, `CLUB_RUNGS`, `POINTS_PER_CONFIRMED_ORDER`, `POINTS_PER_DELIVERED_ORDER`, `POINTS_PER_MLN`; funksiya `buildSellerMedals(input): readonly SellerMedalRow[]`.

- [ ] **Step 1: Write the failing test**

`tests/domain/sellerMedals.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  type SellerDayFact,
  type SellerMonthFact,
  buildSellerMedals,
} from '@/server/domain/analytics/sellerMedals'

/** 1 so'm = 100 minor; 1 mln so'm = 100_000_000n. */
const MLN = 100_000_000n

function month(over: Partial<SellerMonthFact> & { employeeId: string }): SellerMonthFact {
  return {
    month: '2026-08-01',
    confirmedOrders: 0,
    confirmedMinor: 0n,
    deliveredOrders: 0,
    deliveredMinor: 0n,
    place: 99,
    ...over,
  }
}

function day(over: Partial<SellerDayFact> & { employeeId: string }): SellerDayFact {
  return {
    day: '2026-08-03',
    confirmedOrders: 0,
    deliveredMinor: 0n,
    place: 99,
    ...over,
  }
}

const build = (months: SellerMonthFact[], days: SellerDayFact[] = []) =>
  buildSellerMedals({ months, days, runningMonth: '2026-09' })

const rowOf = (rows: readonly { employeeId: string }[], id: string) =>
  rows.find((r) => r.employeeId === id)!

const codes = (row: { medals: readonly { code: string }[] }) => row.medals.map((m) => m.code)

describe('kundalik ish balli', () => {
  it('tasdiq 10, yetkazish 25, har to‘liq 1 mln FAKT 2 uchun 5', () => {
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 3, deliveredOrders: 2, deliveredMinor: 7n * MLN }),
    ])
    // 3·10 + 2·25 + 7·5 = 115, ustiga 🌱 birinchi savdo 100 = 215
    expect(rowOf(rows, 'a').points).toBe(215)
  })

  it('to‘liq bo‘lmagan million ball bermaydi — pastga yaxlitlanadi', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 1n * MLN + 99_999_999n }),
    ])
    // 1·25 + 1·5 + 100 = 130 — ikkinchi million to‘lmagan
    expect(rowOf(rows, 'a').points).toBe(130)
  })

  it('yetkazilgan buyurtmasi yo‘q sotuvchi 🌱 olmaydi va 1-darajada qoladi', () => {
    const rows = build([month({ employeeId: 'a', confirmedOrders: 5 })])
    expect(codes(rowOf(rows, 'a'))).not.toContain('first-sale')
    expect(rowOf(rows, 'a').level).toBe(1)
    expect(rowOf(rows, 'a').points).toBe(50)
  })
})

describe('klub — bitta medal, yetti bosqich', () => {
  it('faqat eng yuqori bosqich CHIZILADI', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 60n * MLN }),
    ])
    const club = rowOf(rows, 'a').medals.filter((m) => m.code === 'club')
    expect(club).toHaveLength(1)
    expect(club[0]!.tier).toBe(3) // 50 mln bosqichi
  })

  it('ball esa o‘tilgan bosqichlar YIG‘INDISI', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 60n * MLN }),
    ])
    const club = rowOf(rows, 'a').medals.find((m) => m.code === 'club')!
    expect(club.points).toBe(100 + 150 + 250) // I + II + III
  })

  it('10 mln dan pastda klub yo‘q', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 9n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('club')
  })

  it('klub JAMI bo‘yicha — oylar qo‘shiladi', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-08-01', deliveredOrders: 1, deliveredMinor: 6n * MLN }),
      month({ employeeId: 'a', month: '2026-09-01', deliveredOrders: 1, deliveredMinor: 6n * MLN }),
    ])
    expect(rowOf(rows, 'a').medals.find((m) => m.code === 'club')!.tier).toBe(1)
  })

  it('eng yuqori bosqich 1 mlrd', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 1200n * MLN }),
    ])
    expect(rowOf(rows, 'a').medals.find((m) => m.code === 'club')!.tier).toBe(7)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/sellerMedals.test.ts`
Expected: FAIL — `buildSellerMedals is not exported`.

- [ ] **Step 3: Write minimal implementation**

`src/server/domain/analytics/sellerMedals.ts` ga qo'shiladi (Task 1 kodidan keyin):

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/sellerMedals.test.ts tests/domain/sellerMedals.level.test.ts`
Expected: PASS — 13 test.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/analytics/sellerMedals.ts tests/domain/sellerMedals.test.ts
git commit -m "feat(sellers): kundalik ball, birinchi savdo va yetti bosqichli klub

Klub bitta medal: eng yuqori bosqich chiziladi, ball bosqichlar yig'indisi.
Chegaralar production'da o'lchangan — 83/126 medalsizni 5 ga tushiradi."
```

---

### Task 3: Oylik medallar — podium, konversiya, toza oy, ishchan oy, sakrash

**Files:**
- Modify: `src/server/domain/analytics/sellerMedals.ts`
- Test: `tests/domain/sellerMedals.test.ts`

**Interfaces:**
- Consumes: Task 2 ning barcha tiplari va `buildSellerMedals` skeleti.
- Produces: `buildSellerMedals` endi `month-gold`, `month-silver`, `month-bronze`, `conversion-master`, `clean-month`, `work-month`, `jump` medallarini ham beradi. Yangi eksport: `CLEAN_MONTH_PERCENT = 80`, `MEDAL_MIN_ORDERS = 20`, `WORK_MONTH_SHARE = 0.6`, `JUMP_GROWTH = 1.5`.

- [ ] **Step 1: Write the failing test**

`tests/domain/sellerMedals.test.ts` oxiriga qo'shiladi:

```ts
describe('oylik medallar faqat YOPILGAN oyda beriladi', () => {
  it('joriy oy podium medali bermaydi — o‘rni har kuni o‘zgaradi', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-09-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('month-gold')
  })

  it('yopilgan oyning 1-2-3 o‘rni oltin, kumush, bronza beradi', () => {
    const rows = build([
      month({ employeeId: 'a', place: 1, deliveredOrders: 1, deliveredMinor: 3n * MLN }),
      month({ employeeId: 'b', place: 2, deliveredOrders: 1, deliveredMinor: 2n * MLN }),
      month({ employeeId: 'c', place: 3, deliveredOrders: 1, deliveredMinor: MLN }),
      month({ employeeId: 'd', place: 4, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).toContain('month-gold')
    expect(codes(rowOf(rows, 'b'))).toContain('month-silver')
    expect(codes(rowOf(rows, 'c'))).toContain('month-bronze')
    expect(codes(rowOf(rows, 'd')).some((c) => c.startsWith('month-'))).toBe(false)
  })

  it('oltin takrorlanadi va sanaladi', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-08-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
      month({ employeeId: 'a', month: '2026-07-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    const gold = rowOf(rows, 'a').medals.find((m) => m.code === 'month-gold')!
    expect(gold.count).toBe(2)
    expect(gold.points).toBe(1000)
    // Sabab — ENG OXIRGI oy, chunki pagon «qachon oldi» deganda oxirgisini
    // ko'rsatadi; eskisi hikoya, yangisi yangilik.
    expect(gold.at).toBe('2026-08-01')
  })
})

describe('sifat medallari', () => {
  it('🎯 oyda eng yuqori konversiyaga, faqat bittasiga', () => {
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 40, deliveredOrders: 30, deliveredMinor: MLN }),
      month({ employeeId: 'b', confirmedOrders: 40, deliveredOrders: 20, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).toContain('conversion-master')
    expect(codes(rowOf(rows, 'b'))).not.toContain('conversion-master')
    expect(rowOf(rows, 'a').medals.find((m) => m.code === 'conversion-master')!.percent).toBe(75)
  })

  it('20 buyurtmadan kam bo‘lsa 🎯 ham, 💯 ham bermaydi', () => {
    // 19 ta buyurtmada 100% konversiya — statistik shovqin, medal emas.
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 19, deliveredOrders: 19, deliveredMinor: MLN }),
      month({ employeeId: 'b', confirmedOrders: 40, deliveredOrders: 10, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('conversion-master')
    expect(codes(rowOf(rows, 'a'))).not.toContain('clean-month')
    expect(codes(rowOf(rows, 'b'))).toContain('conversion-master')
  })

  it('💯 konversiya 80% va undan yuqori bo‘lganlarning HAMMASIGA', () => {
    const rows = build([
      month({ employeeId: 'a', confirmedOrders: 40, deliveredOrders: 32, deliveredMinor: MLN }),
      month({ employeeId: 'b', confirmedOrders: 40, deliveredOrders: 36, deliveredMinor: MLN }),
      month({ employeeId: 'c', confirmedOrders: 40, deliveredOrders: 31, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).toContain('clean-month') // aynan 80%
    expect(codes(rowOf(rows, 'b'))).toContain('clean-month')
    expect(codes(rowOf(rows, 'c'))).not.toContain('clean-month') // 77.5%
  })

  it('📅 floor ishlagan kunlarning 60% ida ishlaganga — 100% talab qilinmaydi', () => {
    // Floor 5 kun ishladi (har kuni kimdir tasdiqladi).
    const days = [
      day({ employeeId: 'a', day: '2026-08-01', confirmedOrders: 1 }),
      day({ employeeId: 'a', day: '2026-08-02', confirmedOrders: 1 }),
      day({ employeeId: 'a', day: '2026-08-03', confirmedOrders: 1 }),
      day({ employeeId: 'b', day: '2026-08-04', confirmedOrders: 1 }),
      day({ employeeId: 'b', day: '2026-08-05', confirmedOrders: 1 }),
    ]
    const rows = build(
      [
        month({ employeeId: 'a', confirmedOrders: 3, deliveredOrders: 1, deliveredMinor: MLN }),
        month({ employeeId: 'b', confirmedOrders: 2, deliveredOrders: 1, deliveredMinor: MLN }),
      ],
      days,
    )
    expect(codes(rowOf(rows, 'a'))).toContain('work-month') // 3/5 = 60%
    expect(codes(rowOf(rows, 'b'))).not.toContain('work-month') // 2/5 = 40%
  })

  it('📈 o‘tgan oydan FAKT 2 kamida 50% oshganda', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-07-01', deliveredOrders: 1, deliveredMinor: 10n * MLN }),
      month({ employeeId: 'a', month: '2026-08-01', deliveredOrders: 1, deliveredMinor: 15n * MLN }),
      month({ employeeId: 'b', month: '2026-07-01', deliveredOrders: 1, deliveredMinor: 10n * MLN }),
      month({ employeeId: 'b', month: '2026-08-01', deliveredOrders: 1, deliveredMinor: 14n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).toContain('jump') // aynan +50%
    expect(codes(rowOf(rows, 'b'))).not.toContain('jump') // +40%
  })

  it('📈 noldan boshlaganga berilmaydi — nolning 50% i ham nol', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-07-01', confirmedOrders: 2 }),
      month({ employeeId: 'a', month: '2026-08-01', deliveredOrders: 1, deliveredMinor: 90n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('jump')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/sellerMedals.test.ts`
Expected: FAIL — `expected [ 'first-sale', 'club' ] to contain 'month-gold'`.

- [ ] **Step 3: Write minimal implementation**

`src/server/domain/analytics/sellerMedals.ts`: `MINOR_PER_MLN` dan keyin konstantalar qo'shiladi —

```ts
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
```

`buildSellerMedals` ichida, klub blokidan **oldin** — yordamchi va oylik qoidalar:

```ts
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
```

**Eslatma:** `JUMP_GROWTH = 1.5` suzuvchi nuqta bilan emas, `× 2n ≥ × 3n` butun son taqqoslashi bilan qo'llaniladi — `bigint` da 1.5 ga ko'paytirish yo'q va suzuvchiga o'tkazish 13 xonali summada aniqlikni yo'qotadi. Konstanta hujjat sifatida qoladi va testda nomlanadi.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/sellerMedals.test.ts`
Expected: PASS — 21 test.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/analytics/sellerMedals.ts tests/domain/sellerMedals.test.ts
git commit -m "feat(sellers): oylik medallar — podium, konversiya, toza oy, ishchan oy, sakrash

Yopilmagan oy medal bermaydi: o'rni har kuni o'zgaradi. Ishchan oy 100%
davomat emas (hech kim chiqolmaydi) — floor kunlarining 60%."
```

---

### Task 4: Seriya, yil chempioni, kun medallari va yangi yulduz

**Files:**
- Modify: `src/server/domain/analytics/sellerMedals.ts`
- Test: `tests/domain/sellerMedals.test.ts`

**Interfaces:**
- Consumes: Task 3 ning `award`, `byMonth`, `closedMonths` yordamchilari.
- Produces: `buildSellerMedals` to'liq — `streak-fire`, `streak-steady`, `year-champion`, `day-record`, `day-winner`, `rookie` qo'shiladi. Yangi eksport: `STREAK_MONTHS = 3`, `STREAK_FIRE_PLACE = 3`, `STREAK_STEADY_PLACE = 10`, `ROOKIE_PLACE = 10`, `ROOKIE_FROM_MONTH = '2026-09'`.

- [ ] **Step 1: Write the failing test**

`tests/domain/sellerMedals.test.ts` oxiriga qo'shiladi:

```ts
const threeMonths = (id: string, places: [number, number, number]) => [
  month({ employeeId: id, month: '2026-06-01', place: places[0], deliveredOrders: 1, deliveredMinor: MLN }),
  month({ employeeId: id, month: '2026-07-01', place: places[1], deliveredOrders: 1, deliveredMinor: MLN }),
  month({ employeeId: id, month: '2026-08-01', place: places[2], deliveredOrders: 1, deliveredMinor: MLN }),
]

describe('seriya medallari', () => {
  it('🔥 3 oy ketma-ket top-3 da', () => {
    const rows = build(threeMonths('a', [1, 3, 2]))
    expect(codes(rowOf(rows, 'a'))).toContain('streak-fire')
  })

  it('2 oy yetarli emas — tarix qisqa bo‘lsa medal yo‘q', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-07-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
      month({ employeeId: 'a', month: '2026-08-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('streak-fire')
  })

  it('uzilgan seriya noldan sanaladi', () => {
    const rows = build([
      ...threeMonths('a', [1, 9, 2]),
      month({ employeeId: 'a', month: '2026-05-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('streak-fire')
    expect(codes(rowOf(rows, 'a'))).toContain('streak-steady') // 4 oy top-10
  })

  it('oy TUSHIB QOLSA ham seriya uziladi — qatnashmagan oy ketma-ketlik emas', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-06-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
      // 2026-07 yo‘q
      month({ employeeId: 'a', month: '2026-08-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
      month({ employeeId: 'b', month: '2026-07-01', place: 1, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('streak-fire')
  })

  it('6 oy ketma-ket ikkita 🔥 beradi — seriya tugagach qaytadan boshlanadi', () => {
    const months = Array.from({ length: 6 }, (_, i) =>
      month({
        employeeId: 'a',
        month: `2026-0${i + 3}-01`,
        place: 1,
        deliveredOrders: 1,
        deliveredMinor: MLN,
      }),
    )
    const rows = build(months)
    expect(rowOf(rows, 'a').medals.find((m) => m.code === 'streak-fire')!.count).toBe(2)
  })
})

describe('kun medallari', () => {
  it('🌅 kunning 1-o‘rni, takrorlanadi', () => {
    const rows = build(
      [month({ employeeId: 'a', deliveredOrders: 2, deliveredMinor: 2n * MLN })],
      [
        day({ employeeId: 'a', day: '2026-08-01', place: 1, deliveredMinor: MLN }),
        day({ employeeId: 'a', day: '2026-08-02', place: 1, deliveredMinor: MLN }),
        day({ employeeId: 'a', day: '2026-08-03', place: 2, deliveredMinor: MLN }),
      ],
    )
    expect(rowOf(rows, 'a').medals.find((m) => m.code === 'day-winner')!.count).toBe(2)
  })

  it('puli yo‘q kun 1-o‘rin bo‘lsa ham medal bermaydi', () => {
    const rows = build(
      [month({ employeeId: 'a', confirmedOrders: 1 })],
      [day({ employeeId: 'a', place: 1, deliveredMinor: 0n })],
    )
    expect(codes(rowOf(rows, 'a'))).not.toContain('day-winner')
  })

  it('⚡ butun tarixdagi eng katta kunga, faqat BITTA kishiga', () => {
    const rows = build(
      [
        month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 9n * MLN }),
        month({ employeeId: 'b', deliveredOrders: 1, deliveredMinor: 5n * MLN }),
      ],
      [
        day({ employeeId: 'a', day: '2026-08-01', place: 1, deliveredMinor: 9n * MLN }),
        day({ employeeId: 'b', day: '2026-08-02', place: 1, deliveredMinor: 5n * MLN }),
      ],
    )
    expect(codes(rowOf(rows, 'a'))).toContain('day-record')
    expect(codes(rowOf(rows, 'b'))).not.toContain('day-record')
  })
})

describe('yil chempioni va yangi yulduz', () => {
  it('🏆 faqat YOPILGAN kalendar yil uchun', () => {
    // 2026 hali tugamagan — joriy oy 2026-09.
    const rows = build([
      month({ employeeId: 'a', place: 1, deliveredOrders: 1, deliveredMinor: 100n * MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('year-champion')
  })

  it('🚀 devor ochilgan oyda berilmaydi — u yerda hamma «yangi» ko‘rinadi', () => {
    // 2026-08 — RECORDS_FROM. Atributsiya nuqsoni butun floorni yangi qiladi.
    const rows = build([
      month({ employeeId: 'a', month: '2026-08-01', place: 2, deliveredOrders: 1, deliveredMinor: MLN }),
    ])
    expect(codes(rowOf(rows, 'a'))).not.toContain('rookie')
  })

  it('🚀 2026-09 dan keyin boshlagan va birinchi to‘liq oyida top-10 ga kirganga', () => {
    const rows = buildSellerMedals({
      months: [
        month({ employeeId: 'a', month: '2026-10-01', place: 7, deliveredOrders: 1, deliveredMinor: MLN }),
      ],
      days: [],
      runningMonth: '2026-11',
    })
    expect(codes(rowOf(rows, 'a'))).toContain('rookie')
  })

  it('🚀 birinchi oyi 11-o‘rin bo‘lsa berilmaydi va keyin ham qaytmaydi', () => {
    const rows = buildSellerMedals({
      months: [
        month({ employeeId: 'a', month: '2026-10-01', place: 11, deliveredOrders: 1, deliveredMinor: MLN }),
        month({ employeeId: 'a', month: '2026-11-01', place: 2, deliveredOrders: 1, deliveredMinor: MLN }),
      ],
      days: [],
      runningMonth: '2026-12',
    })
    expect(codes(rowOf(rows, 'a'))).not.toContain('rookie')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/sellerMedals.test.ts`
Expected: FAIL — `expected [ … ] to contain 'streak-fire'`.

- [ ] **Step 3: Write minimal implementation**

Konstantalar `JUMP_GROWTH` dan keyin:

```ts
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
```

`buildSellerMedals` ichida, 📈 blokidan **keyin** va qaytarishdan **oldin**:

```ts
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
      award(employeeId, 'rookie', firstMonth, { orders: place })
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/sellerMedals.test.ts tests/domain/sellerMedals.level.test.ts`
Expected: PASS — 33 test.

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/analytics/sellerMedals.ts tests/domain/sellerMedals.test.ts
git commit -m "feat(sellers): seriya, yil chempioni, kun medallari va yangi yulduz

Motor to'liq — 15 medal. Qatnashmagan oy seriyani uzadi; 🚀 devor ochilgan
oyda berilmaydi, chunki u yerda atributsiya butun floorni yangi ko'rsatadi."
```

---

### Task 5: Repozitoriy — bitta kogorta, ikki kesim

**Files:**
- Modify: `src/server/repositories/insightsRepository.ts` (`confirmationSellerRecords` dan **keyin**, `recordsSql` ga TEGILMAYDI)
- Test: `tests/http/sellerMedalFactsSql.test.ts`

**Interfaces:**
- Consumes: mavjud `InsightsRepository.queueSql`, `FAKT1_OUTCOMES`, `faktDeliveredSql`, `ratingFilterSql`, `scopeValue`, `ConfirmationSellerRatingFilters`, `ScopedWindow`.
- Produces:
  - `export interface SellerMedalMonthRow { month: string; employeeId: string; fullName: string; confirmedOrders: number; confirmedMinor: bigint; deliveredOrders: number; deliveredMinor: bigint; place: number }`
  - `export interface SellerMedalDayRow { day: string; employeeId: string; confirmedOrders: number; deliveredMinor: bigint; place: number }`
  - `async sellerMedalFacts(period: ScopedWindow, filters?: ConfirmationSellerRatingFilters): Promise<{ months: SellerMedalMonthRow[]; days: SellerMedalDayRow[] }>`
  - `private static medalFactsSql(grain: 'month' | 'day', filterClause: string): string`

- [ ] **Step 1: Write the failing test**

`tests/http/sellerMedalFactsSql.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

/*
  Same reason `confirmationRecordsSql.test.ts` supplies these first: `env` is
  read at module scope for APP_TIMEZONE and refuses to load without a complete
  configuration. A unit test about SQL shape has no database.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * The medal cut, held to the board's own definitions.
 *
 * THE PAGON AND THE PODIUM ARE ONE SCREEN. A seat prints a gold medal above
 * the same seller's FAKT 2 figure, so the two must agree about who a seller
 * is, what FAKT 1 counts, what FAKT 2 counts, and how a place is decided — or
 * the board crowns one person and the pagon under it crowns another.
 *
 * This cut deliberately does NOT reuse `recordsSql` (which keeps only
 * `place = 1`) and does NOT modify it (`confirmationRecordsSql.test.ts` pins
 * that string, and the record wall is a working object on a television). The
 * agreement is bought instead by sharing the predicates literally, and this
 * file is what proves they are still shared.
 */
const medalFactsSql = (
  InsightsRepository as unknown as {
    medalFactsSql: (grain: 'month' | 'day', filterClause: string) => string
  }
).medalFactsSql

const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
const MONTH = bare(medalFactsSql('month', ''))
const DAY = bare(medalFactsSql('day', ''))

describe('medal kesimi taxtaning tilida gapiradi', () => {
  it('FAKT 1 — navbatdan buyurtma bo‘lib chiqqan ikki natija', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toContain("c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')")
      expect(sql).not.toContain('UC_YUKVF1')
    }
  })

  it('FAKT 2 — bitimning JORIY bosqichidagi yetkazish roli', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toContain(`ds."logisticsRole" = 'DELIVERED'`)
    }
  })

  it('sotuvchi — operator, bo‘lmasa mas’ul', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toContain('COALESCE(d."operatorEmployeeId", d."employeeId")')
    }
  })

  it('o‘rin podiumning qoidasi: FAKT 2 birinchi, FAKT 1 hech kim yetkazmaganda', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toMatch(/row_number\(\) OVER \(/)

      /*
        POZITSIYA BO‘YICHA, MATN BO‘YICHA EMAS. «ORDER BY … DELIVERED …»
        degan regex ikkisi o‘rin almashganda ham o‘tardi, chunki FAKT 1
        ifodasida DELIVERED so‘zi umuman yo‘q — ya‘ni podiumning butun
        qoidasi teskarisiga aylansa ham test yashil qolardi.
        `confirmationRecordsSql.test.ts` buni indeks taqqoslash bilan
        qiladi; bu yerda ham shunday.
      */
      const order = sql.slice(sql.indexOf('ORDER BY'), sql.indexOf(') AS place'))
      const fakt2 = order.indexOf(`FILTER (WHERE ds."logisticsRole" = 'DELIVERED') DESC`)
      const fakt1 = order.indexOf(`FILTER (WHERE c.outcome IN ('CONFIRMED', 'UNCONFIRMED_SHIPPED')) DESC`)

      expect(fakt2).toBeGreaterThan(-1)
      expect(fakt1).toBeGreaterThan(-1)
      // Almashsa, buyurtmalari hali yo‘lda turgan kesim haqiqatan
      // yetkazgan kesimdan yuqori chiqadi.
      expect(fakt2).toBeLessThan(fakt1)
    }
  })

  it('tenglikni employee id hal qiladi, ism emas', () => {
    // Ism 'uz' va 'ru' da boshqacha saralanadi — branches.ts.
    for (const sql of [MONTH, DAY]) {
      expect(sql).toMatch(/DESC NULLS LAST,\s*e\."id"\s*\)\s*AS place/)
    }
  })

  it('oy kesimi oy bo‘yicha, kun kesimi kun bo‘yicha guruhlanadi', () => {
    expect(MONTH).toContain("date_trunc('month'")
    expect(MONTH).not.toContain("date_trunc('day'")
    expect(DAY).toContain("date_trunc('day'")
    expect(DAY).not.toContain("date_trunc('month'")
  })

  it('vaqt mintaqasi hisobotning o‘zi, UTC emas', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toContain("AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent'")
    }
  })

  it('sof rad javoblardan iborat kesim qator bermaydi', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).toContain('HAVING')
    }
  })

  it('`place = 1` filtri YO‘Q — pagon butun floorni oladi', () => {
    for (const sql of [MONTH, DAY]) {
      expect(sql).not.toContain('place = 1')
    }
  })

  it('filtr bandi ikkala kesimga ham o‘tadi', () => {
    expect(bare(medalFactsSql('month', 'AND d."id" = $4'))).toContain('AND d."id" = $4')
    expect(bare(medalFactsSql('day', 'AND d."id" = $4'))).toContain('AND d."id" = $4')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http/sellerMedalFactsSql.test.ts`
Expected: FAIL — `medalFactsSql is not a function`.

- [ ] **Step 3: Write minimal implementation**

`src/server/repositories/insightsRepository.ts`, `ConfirmationMonthlyRecordRow` (748-satr atrofi) yonida tiplar:

```ts
/** Bir sotuvchining bir oyi, pagon uchun. Rekord devoridan farqi: HAR o'rin. */
export interface SellerMedalMonthRow {
  /** Oyning birinchi kuni, `APP_TIMEZONE` da, `YYYY-MM-DD`. */
  readonly month: string
  readonly employeeId: string
  readonly fullName: string
  readonly confirmedOrders: number
  readonly confirmedMinor: bigint
  readonly deliveredOrders: number
  readonly deliveredMinor: bigint
  /** O'sha oydagi o'rin, podiumning qoidasi bilan. */
  readonly place: number
}

/** Bir sotuvchining bir kuni — ⚡, 🌅 va 📅 davomati uchun. */
export interface SellerMedalDayRow {
  readonly day: string
  readonly employeeId: string
  readonly confirmedOrders: number
  readonly deliveredMinor: bigint
  readonly place: number
}
```

`confirmationSellerRecords` metodidan keyin:

```ts
  /**
   * Pagonning fakti — bir kogorta, ikki kesim.
   *
   * `confirmationSellerRecords` BILAN QO'SHILMAGAN, ATAYLAB. Rekord devori
   * `place = 1` ni qoldiradi va uning SQL satri `confirmationRecordsSql.test.ts`
   * tomonidan mixlangan; u televizorda ishlab turgan obyekt. Ikkinchi kogorta
   * qurilishi 10 daqiqalik kesh ostida sutkasiga ~140 marta ishlaydi
   * (o'lchangan 2026-09-15: oy kesimi 848 ms, kun kesimi 1 224 ms), va bu
   * ishlayotgan taxtani sindirish xavfidan arzon.
   *
   * IKKI SO'ROV, BIR TRANZAKSIYA EMAS. Ikkalasi ham bir xil oynani o'qiydi va
   * javob 10 daqiqa keshlanadi; oralarida yozilgan bitta buyurtma medalni
   * emas, faqat ballni bir necha ballga o'zgartiradi va keyingi keshda
   * tuzaladi. Bitta statement'ga yig'ish esa ikki `row_number()` oynasini bir
   * natija to'plamiga tiqishni talab qiladi — o'qilishi qiyinroq, tezligi
   * o'lchovda bir xil.
   *
   * KUN KESIMI NIMA UCHUN KERAK: ⚡ kun rekordi va 🌅 kun g'olibi o'z-o'zidan,
   * va 📅 «ishchan oy» davomati — «floor ishlagan kunlarning ulushi» degan
   * savolga kalendar emas, portalning o'z ma'lumoti javob beradi.
   */
  async sellerMedalFacts(
    period: ScopedWindow,
    filters: ConfirmationSellerRatingFilters = {},
  ): Promise<{ months: SellerMedalMonthRow[]; days: SellerMedalDayRow[] }> {
    // Scope first, at the fixed slot $3 — same reason as
    // `confirmationSellerRecords`: `queueSql` needs its placeholder while the
    // string is being built, and the caller's filters number from $4 onwards.
    const params: unknown[] = [period.start, period.end, InsightsRepository.scopeValue(period)]
    const filterClause = InsightsRepository.ratingFilterSql(filters, params)
    const head = InsightsRepository.queueSql('window', '$3')

    const monthRows = await this.prisma.$queryRawUnsafe<
      {
        bucket: string
        employee_id: string
        full_name: string
        confirmed_orders: bigint
        confirmed: MoneyText
        delivered_orders: bigint
        delivered: MoneyText
        place: bigint
      }[]
    >(`${head}${InsightsRepository.medalFactsSql('month', filterClause)}`, ...params)

    const dayRows = await this.prisma.$queryRawUnsafe<
      {
        bucket: string
        employee_id: string
        full_name: string
        confirmed_orders: bigint
        confirmed: MoneyText
        delivered_orders: bigint
        delivered: MoneyText
        place: bigint
      }[]
    >(`${head}${InsightsRepository.medalFactsSql('day', filterClause)}`, ...params)

    return {
      months: monthRows.map((r) => ({
        month: r.bucket,
        employeeId: r.employee_id,
        fullName: r.full_name,
        confirmedOrders: int(r.confirmed_orders),
        confirmedMinor: money(r.confirmed),
        deliveredOrders: int(r.delivered_orders),
        deliveredMinor: money(r.delivered),
        place: int(r.place),
      })),
      days: dayRows.map((r) => ({
        day: r.bucket,
        employeeId: r.employee_id,
        confirmedOrders: int(r.confirmed_orders),
        deliveredMinor: money(r.delivered),
        place: int(r.place),
      })),
    }
  }

  /**
   * Isolated for the same reason `recordsSql` is: it has to be pinned against
   * the board's own predicates without a database.
   *
   * The two grains differ in ONE expression — the bucket — so they share a
   * builder rather than a copy. A copy is where the day cut would quietly
   * stop meaning what the month cut means.
   */
  private static medalFactsSql(grain: 'month' | 'day', filterClause: string): string {
    const bucket = `date_trunc('${grain}', c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE '${env.APP_TIMEZONE}')::date`
    const fakt1 = `sum(d."amountMinor") FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES})`
    const fakt2 = `sum(d."amountMinor") FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')})`

    return `
       SELECT m.bucket::text AS bucket,
              m.employee_id,
              m.full_name,
              m.confirmed_orders,
              m.confirmed::text AS confirmed,
              m.delivered_orders,
              m.delivered::text AS delivered,
              m.place
       FROM (
         SELECT
           ${bucket} AS bucket,
           e."id" AS employee_id,
           e."fullName" AS full_name,
           count(*) FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES})::bigint AS confirmed_orders,
           ${fakt1} AS confirmed,
           count(*) FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')})::bigint AS delivered_orders,
           ${fakt2} AS delivered,
           /*
             The podium's rule, as a window: FAKT 2 decides, FAKT 1 decides
             the buckets nobody has delivered in yet. The tie-break is the
             employee id rather than the name — a name collates differently
             under 'uz' and 'ru' (see `branches.ts`), and a pagon that
             reordered itself between two polls of identical data would look
             broken.
           */
           row_number() OVER (
             PARTITION BY ${bucket}
             ORDER BY ${fakt2} DESC NULLS LAST,
                      ${fakt1} DESC NULLS LAST,
                      e."id"
           ) AS place
         FROM scoped c
         JOIN "deal" d ON d."id" = c.deal_id
         JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")
         LEFT JOIN "deal_stage" ds ON ds."id" = d."stageId"
         WHERE TRUE
           ${filterClause}
         GROUP BY 1, e."id", e."fullName"
         -- A bucket of pure refusals is a row on the board and not a medal.
         HAVING count(*) FILTER (WHERE ${InsightsRepository.FAKT1_OUTCOMES}) > 0
             OR count(*) FILTER (WHERE ${InsightsRepository.faktDeliveredSql('ds."logisticsRole"')}) > 0
       ) m
       ORDER BY m.bucket, m.place`
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/http/sellerMedalFactsSql.test.ts tests/http/confirmationRecordsSql.test.ts`
Expected: PASS — yangi 9 test, va rekord devorining eski testlari hamon yashil (o'sha SQL o'zgarmagan).

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories/insightsRepository.ts tests/http/sellerMedalFactsSql.test.ts
git commit -m "feat(sellers): medal fakti uchun oy va kun kesimi

recordsSql ga tegilmadi — u televizorda ishlab turgan rekord devorining
SQL'i va mixlangan. Kelishuv predikatlarni so'zma-so'z bo'lishish bilan
olinadi, va yangi test buni isbotlaydi."
```

---

### Task 6: Servis — DTO, kesh va `medals(ctx)`

**Files:**
- Modify: `src/server/services/sellerBoardService.ts`
- Test: `tests/services/sellerMedals.test.ts`

**Interfaces:**
- Consumes: `buildSellerMedals` va tiplari (Task 4), `InsightsRepository.sellerMedalFacts` (Task 5), mavjud `RECORDS_FROM`, `recordWindow`, `monthKey`, `boardFilters`, `scopedPeriod`, `ttlCache`, `keyPart`, `toMoneyDto`, `money`.
- Produces: `SellerMedalDto`, `SellerMedalRowDto`, `SellerMedalsDto`, `SellerBoardService.medals(ctx)`, `resetSellerMedalsCache()`.

- [ ] **Step 1: Write the failing test**

`tests/services/sellerMedals.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { SellerBoardService, resetSellerMedalsCache } = await import(
  '@/server/services/sellerBoardService'
)
const { AnalyticsService } = await import('@/server/services/analyticsService')

const MLN = 100_000_000n

/** Faqat `sellerMedalFacts` ni javob beradigan qo'g'irchoq. */
function repoWith(months: unknown[], days: unknown[], calls: { n: number }) {
  return {
    sellerMedalFacts: async () => {
      calls.n++
      return { months, days }
    },
  }
}

const contextAt = (now: Date) =>
  AnalyticsService.context(
    { start: new Date('2026-08-01T00:00:00Z'), end: now, timeZone: 'Asia/Tashkent' },
    'UZS',
    {},
    now,
  )

describe('medal servisi', () => {
  beforeEach(() => resetSellerMedalsCache())

  const months = [
    {
      month: '2026-08-01',
      employeeId: 'e1',
      fullName: 'Marjona Xayrullayeva',
      confirmedOrders: 40,
      confirmedMinor: 50n * MLN,
      deliveredOrders: 30,
      deliveredMinor: 30n * MLN,
      place: 1,
    },
  ]

  it('DTO sotuvchi id si bo‘yicha, pul MoneyDto sifatida chiqadi', async () => {
    const calls = { n: 0 }
    const service = new SellerBoardService(
      {} as never,
      repoWith(months, [], calls) as never,
      {} as never,
    )
    const dto = await service.medals(contextAt(new Date('2026-09-15T06:00:00Z')))
    const row = dto.sellers.find((s) => s.employeeId === 'e1')!

    /*
      ANIQ QIYMAT, «noldan katta» EMAS. `toBeGreaterThan(1)` motorni
      servisga noto‘g‘ri ulagan holatda ham o‘tardi — bu test aynan
      ulanishni tekshirish uchun bor. Hisob, qadam-baqadam:

        kundalik ish  40·10 + 30·25 + 30·5   = 1 300
        🥇 oy chempioni (place 1)            =   500
        🎯 konversiya ustasi (75%, 40 ≥ 20)  =   400
        🌱 birinchi savdo                    =   100
        💎 klub: 30 mln → I va II bosqich    =   250
                                               -----
                                               2 550

      💯 tushmaydi (75% < 80), 📅 tushmaydi (kun fakti yo‘q), 📈/🔥/⭐/🏆
      tushmaydi (bitta yopilgan oy), 🚀 tushmaydi (2026-08 < 2026-09).
      7-daraja 2 100 ballda, 8-daraja 2 800 da.
    */
    expect(row.points).toBe(2_550)
    expect(row.level).toBe(7)
    expect(row.rankTitle).toBe('Sotuvchi')
    expect(row.nextLevelAt).toBe(2_800)
    expect(row.nextTitle).toBe('Katta sotuvchi')
    expect(row.medals.map((m) => m.code).sort()).toEqual([
      'club',
      'conversion-master',
      'first-sale',
      'month-gold',
    ])
    const gold = row.medals.find((m) => m.code === 'month-gold')!
    expect(gold.amount).not.toBeNull()
    expect(gold.amount!.currency).toBe('UZS')
    expect(gold.amount!.amount).toBe(30_000_000)
  })

  it('devorning o‘zi bilan bir oynani o‘qiydi — RECORDS_FROM dan', async () => {
    const calls = { n: 0 }
    const service = new SellerBoardService(
      {} as never,
      repoWith(months, [], calls) as never,
      {} as never,
    )
    const dto = await service.medals(contextAt(new Date('2026-09-15T06:00:00Z')))
    expect(dto.from).toBe(new Date('2026-07-31T19:00:00.000Z').toISOString())
  })

  it('kesh ikkinchi chaqiriqda bazaga bormaydi', async () => {
    const calls = { n: 0 }
    const service = new SellerBoardService(
      {} as never,
      repoWith(months, [], calls) as never,
      {} as never,
    )
    const ctx = contextAt(new Date('2026-09-15T06:00:00Z'))
    await service.medals(ctx)
    await service.medals(ctx)
    expect(calls.n).toBe(1)
  })
})
```

**Konstruktor tartibi** (tekshirilgan, `sellerBoardService.ts:443`):
`new SellerBoardService(repo: SellerBoardRepository, insights: InsightsRepository, reference: ReferenceRepository)` — ya'ni qo'g'irchoq **ikkinchi** slotga, yuqoridagi testdagidek.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/services/sellerMedals.test.ts`
Expected: FAIL — `service.medals is not a function`.

- [ ] **Step 3: Write minimal implementation**

`src/server/services/sellerBoardService.ts`:

Import qo'shiladi:

```ts
import { type SellerMedal, buildSellerMedals } from '@/server/domain/analytics/sellerMedals'
```

`SellerRecordsDto` dan keyin DTO:

```ts
/**
 * Bitta medal — va uning sababi, ekran yig'ib oladigan bo'laklarda.
 *
 * Mirrored in `src/lib/api.ts` as `SellerMedalDto`. Nothing checks the
 * mirror — edit both sides.
 */
export interface SellerMedalDto {
  readonly code: SellerMedal['code']
  readonly count: number
  /** Faqat `club` uchun 1..7. */
  readonly tier: number | null
  readonly points: number
  /** Sababning oyi yoki kuni, `YYYY-MM-DD`. */
  readonly at: string | null
  readonly amount: MoneyDto | null
  readonly orders: number | null
  readonly percent: number | null
}

export interface SellerMedalRowDto {
  readonly employeeId: string
  readonly points: number
  readonly level: number
  readonly rankTitle: string
  readonly levelFloor: number
  readonly nextLevelAt: number
  readonly nextTitle: string | null
  readonly medals: readonly SellerMedalDto[]
}

export interface SellerMedalsDto {
  /** Ball bo'yicha kamayib. */
  readonly sellers: readonly SellerMedalRowDto[]
  /** The first instant the pagon covers. See `RECORDS_FROM`. */
  readonly from: string
}

/**
 * Medal rekord devori bilan bir xil sekin fakt, va uning kogortasi shu
 * ekrandagi eng keng o'qish. Taxtaning oltmish soniyasi emas, devorning
 * o'n daqiqasi.
 */
const medalsCache = ttlCache<SellerMedalsDto>(600_000)

/** Test seam only — see `resetSellerBoardCache`, same hazard. */
export function resetSellerMedalsCache(): void {
  medalsCache.clear()
}
```

`SellerBoardService` ichida, `records()` dan keyin:

```ts
  /**
   * Pagonning ma'lumoti — medal, ball, daraja.
   *
   * DAVR FILTRIGA BO'YSUNMAYDI, va bu ataylab: oyna doim `RECORDS_FROM` dan
   * bugungacha. Medal butun tarixning fakti, «Bugun» tanlanganda yo'qoladigan
   * narsa emas — aks holda filtr motivatsiyani o'chirib qo'yadigan tugmaga
   * aylanardi. Devor ham aynan shu sababdan o'z oynasida yashaydi.
   *
   * Kesh kaliti — `records()` ning kaliti: bir xil oyna, bir xil filtrlar.
   */
  async medals(ctx: AnalyticsContext): Promise<SellerMedalsDto> {
    const filters = boardFilters(ctx)
    const period = recordWindow(ctx.now, ctx.period.timeZone)

    const key = [
      period.start.toISOString(),
      period.end.toISOString(),
      period.timeZone,
      ctx.currency,
      keyPart(filters.employeeIds),
      keyPart(filters.departmentIds),
      keyPart(filters.sourceIds),
    ].join('|')

    return medalsCache.get(key, () => this.buildMedals(ctx, period, filters))
  }

  private async buildMedals(
    ctx: AnalyticsContext,
    period: Period,
    filters: SellerBoardFilters,
  ): Promise<SellerMedalsDto> {
    const facts = await this.insights.sellerMedalFacts(scopedPeriod(period, filters), filters)

    const rows = buildSellerMedals({
      months: facts.months,
      days: facts.days,
      runningMonth: monthKey(ctx.now, period.timeZone),
    })

    return {
      from: period.start.toISOString(),
      sellers: rows.map((row) => ({
        employeeId: row.employeeId,
        points: row.points,
        level: row.level,
        rankTitle: row.rankTitle,
        levelFloor: row.levelFloor,
        nextLevelAt: row.nextLevelAt,
        nextTitle: row.nextTitle,
        medals: row.medals.map((m) => ({
          code: m.code,
          count: m.count,
          tier: m.tier,
          points: m.points,
          at: m.at,
          amount: m.amountMinor === null ? null : toMoneyDto(money(m.amountMinor, ctx.currency)),
          orders: m.orders,
          percent: m.percent === null ? null : roundPercent(m.percent),
        })),
      })),
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/services/sellerMedals.test.ts`
Expected: PASS — 3 test.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/sellerBoardService.ts tests/services/sellerMedals.test.ts
git commit -m "feat(sellers): medal servisi, o'z oynasida va o'z keshida

Davr filtriga bo'ysunmaydi — medal butun tarixning fakti, «Bugun»
tanlanganda yo'qoladigan narsa emas."
```

---

### Task 7: Marshrut va DTO nusxasi

**Files:**
- Modify: `src/app/api/v1/analytics/sellers/route.ts`
- Modify: `src/lib/api.ts`
- Create: `tests/http/sellersRoute.test.ts` (tekshirilgan — hozir yo'q)

**Interfaces:**
- Consumes: `sellerBoardService.medals(context)` (Task 6).
- Produces: `GET /api/v1/analytics/sellers?include=medals` → `{ data: SellerMedalsDto, meta }`; `src/lib/api.ts` da `SellerMedalDto`, `SellerMedalRowDto`, `SellerMedalsDto`, va `MedalCode`.

- [ ] **Step 1: Write the failing test**

`tests/http/sellersRoute.test.ts` (yangi fayl):

```ts
import { describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

/**
 * `?include=` ning qiymatlari — schema darajasida.
 *
 * Yangi qiymat qo'shilganda eskilari joyida turishi kerak: `records` ni
 * rekord devori, `faktTrend` ni Savdo dinamikasining hero grafigi o'qiydi,
 * va ikkalasi ham shu marshrutdan boshqa manzilni bilmaydi.
 */
describe('sellers marshrutining include parametri', () => {
  it('medals, records va faktTrend — uchalasi ham qabul qilinadi', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/app/api/v1/analytics/sellers/route.ts', 'utf8'),
    )
    expect(source).toContain(`z.enum(['records', 'faktTrend', 'medals'])`)
    expect(source).toContain(`ctx.query.include === 'medals'`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/http/sellersRoute.test.ts`
Expected: FAIL — `expected '…' to contain "z.enum(['records', 'faktTrend', 'medals'])"`.

- [ ] **Step 3: Write minimal implementation**

`src/app/api/v1/analytics/sellers/route.ts`:

`include` enum qatorini almashtiring va ustiga izoh qo'shing:

```ts
    /*
      'medals' — pagonning fakti: medal, ball, daraja.

      OPT-IN va ALMASHTIRUVCHI, xuddi 'records' kabi va xuddi shu ikki sabab
      bilan: o'quvchi allaqachon taxtani ushlab turgan ikkinchi react-query
      kaliti, va baribir taxta qurish har o'n daqiqada tashlab yuboriladigan
      ikkinchi kogorta qurilishi bo'lardi.

      OYNASI TAXTANIKI EMAS. Medal `RECORDS_FROM` dan bugungacha bo'lgan
      butun tarixni o'qiydi va so'rovdagi `?from`/`?to` ga qaramaydi —
      sababi `sellerBoardService.medals()` ustida: «Bugun» tanlanganda
      hamma medalini yo'qotadigan taxta motivatsiya asbobi bo'la olmaydi.
    */
    include: z.enum(['records', 'faktTrend', 'medals']).optional(),
```

`GET` ichida, `include === 'records'` blokidan keyin:

```ts
  if (ctx.query.include === 'medals') {
    return {
      data: await sellerBoardService.medals(context),
      meta: AnalyticsService.periodMeta(context),
    }
  }
```

`src/lib/api.ts`, `SellerRecordsDto` dan keyin:

```ts
/** Pagonning medal kodlari. Mirrors `sellerMedals.MEDAL_CODES`. */
export type MedalCode =
  | 'month-gold'
  | 'month-silver'
  | 'month-bronze'
  | 'year-champion'
  | 'streak-fire'
  | 'streak-steady'
  | 'work-month'
  | 'conversion-master'
  | 'clean-month'
  | 'jump'
  | 'rookie'
  | 'day-record'
  | 'day-winner'
  | 'first-sale'
  | 'club'

/**
 * Bitta medal va uning sababi, bo'laklarda.
 *
 * TAYYOR MATN EMAS: qaysi oy/kun, qancha pul, necha buyurtma, necha foiz —
 * jumlani `Pagon.tsx` yig'adi. Sabab: domen qatlami o'zbek tilini bilmaydi va
 * bir xil bo'laklardan seat kartasi uzun, jadval qatori qisqa jumla tuzadi.
 *
 * Mirrors `sellerBoardService.SellerMedalDto`; nothing checks the mirror —
 * edit both sides.
 */
export interface SellerMedalDto {
  readonly code: MedalCode
  /** Takrorlanadiganlar uchun nechta; takrorlanmaydiganda 1. */
  readonly count: number
  /** Faqat `club` uchun 1..7 — eng yuqori o'tilgan bosqich. */
  readonly tier: number | null
  readonly points: number
  /** Sababning oyi yoki kuni, `YYYY-MM-DD`. Takrorlanganda ENG OXIRGISI. */
  readonly at: string | null
  readonly amount: MoneyDto | null
  readonly orders: number | null
  readonly percent: number | null
}

export interface SellerMedalRowDto {
  readonly employeeId: string
  readonly points: number
  readonly level: number
  /** «Usta», «Master» — `titleOf`. */
  readonly rankTitle: string
  readonly levelFloor: number
  readonly nextLevelAt: number
  /** Keyingi daraja unvonni almashtirsa — o'sha unvon; bo'lmasa null. */
  readonly nextTitle: string | null
  /** Ball bo'yicha kamayib — pagon qimmatlisini oldin chizadi. */
  readonly medals: readonly SellerMedalDto[]
}

export interface SellerMedalsDto {
  readonly sellers: readonly SellerMedalRowDto[]
  /** See `SellerRecordsDto.from` — o'sha chegara, o'sha sabab. */
  readonly from: string
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/http/sellersRoute.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck toza.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/analytics/sellers/route.ts src/lib/api.ts tests/http/sellersRoute.test.ts
git commit -m "feat(sellers): ?include=medals va DTO nusxasi"
```

---

### Task 8: PAGON uslublari va `Pagon.tsx`

**Files:**
- Modify: `src/app/globals.css` (PODIUM bo'limidan keyin, `MOTION` (1565-satr) dan oldin)
- Create: `src/features/sellers/Pagon.tsx`
- Test: `tests/features/sellersPagon.test.tsx`

**Interfaces:**
- Consumes: `SellerMedalRowDto`, `SellerMedalDto`, `MedalCode` (Task 7); `monthLabel` — `@/features/sellers/RecordWall` dan **import qilinadi, o'sha fayl o'zgartirilmaydi**; `formatFullUzs`, `formatNumber`, `formatPercent` — `@/lib/format`.
- Produces: `MEDALS: Record<MedalCode, { glyph: string; name: string }>`, `medalReason(medal: SellerMedalDto): string`, `<Pagon row={…} variant="seat" | "row" speaking={…} />`, `CLUB_TIER_NAMES`.

- [ ] **Step 1: Write the failing test**

`tests/features/sellersPagon.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Pagon, medalReason } from '@/features/sellers/Pagon'
import type { SellerMedalDto, SellerMedalRowDto } from '@/lib/api'

const uzs = (amount: number) => ({ amount, currency: 'UZS', minor: amount * 100 })

const medal = (over: Partial<SellerMedalDto> & { code: SellerMedalDto['code'] }): SellerMedalDto => ({
  count: 1,
  tier: null,
  points: 500,
  at: '2026-08-01',
  amount: null,
  orders: null,
  percent: null,
  ...over,
})

const row = (over: Partial<SellerMedalRowDto> = {}): SellerMedalRowDto => ({
  employeeId: 'e1',
  points: 11_000,
  level: 15,
  rankTitle: 'Usta',
  levelFloor: 10_500,
  nextLevelAt: 12_000,
  nextTitle: 'Master',
  medals: [],
  ...over,
})

describe('pagon', () => {
  it('darajani, unvonni va keyingi maqsadni yozadi', () => {
    render(<Pagon row={row()} variant="seat" />)
    expect(screen.getByText(/15-daraja/)).toBeTruthy()
    expect(screen.getByText(/Usta/)).toBeTruthy()
    // Keyingi daraja unvonni almashtiradi — nomi aytiladi, 1 000 ball qolgan.
    expect(screen.getByText(/Master/)).toBeTruthy()
  })

  it('keyingi daraja unvonni almashtirmasa raqam aytiladi', () => {
    render(<Pagon row={row({ level: 12, nextTitle: null, levelFloor: 6_600, nextLevelAt: 7_800, points: 7_000 })} variant="seat" />)
    expect(screen.getByText(/13-darajaga/)).toBeTruthy()
  })

  it('medalsizda faqat daraja chizig‘i qoladi — medal qatori chizilmaydi', () => {
    const { container } = render(<Pagon row={row({ medals: [] })} variant="seat" />)
    expect(container.querySelector('.pagon-medals')).toBeNull()
  })

  it('seat varianti eng ko‘pi 5 medal chizadi va qolganini +N qiladi', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      medal({ code: 'day-winner', points: 100 - i, at: `2026-08-0${i + 1}` }),
    )
    const { container } = render(<Pagon row={row({ medals: many })} variant="seat" />)
    expect(container.querySelectorAll('.pagon-medal')).toHaveLength(5)
    expect(screen.getByText('+3')).toBeTruthy()
  })

  it('qator varianti eng ko‘pi 3 medal chizadi', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      medal({ code: 'day-winner', points: 100 - i, at: `2026-08-0${i + 1}` }),
    )
    const { container } = render(<Pagon row={row({ medals: many })} variant="row" />)
    expect(container.querySelectorAll('.pagon-medal')).toHaveLength(3)
    expect(screen.getByText('+3')).toBeTruthy()
  })

  it('takrorlangan medal sanoq bilan chiziladi', () => {
    render(<Pagon row={row({ medals: [medal({ code: 'month-gold', count: 3 })] })} variant="seat" />)
    expect(screen.getByText('×3')).toBeTruthy()
  })

  it('klub bosqich raqamini ko‘taradi', () => {
    render(<Pagon row={row({ medals: [medal({ code: 'club', tier: 4, amount: uzs(120_000_000) })] })} variant="seat" />)
    expect(screen.getByText('IV')).toBeTruthy()
  })

  it('gapiruvchi medal nomi va sababi bilan ochiladi', () => {
    const speaking = medal({ code: 'conversion-master', percent: 82, orders: 41 })
    render(<Pagon row={row({ medals: [speaking] })} variant="seat" speaking={speaking} />)
    expect(screen.getByText('Konversiya ustasi')).toBeTruthy()
    expect(screen.getByText(/82/)).toBeTruthy()
  })

  it('ekran o‘qiydigan matn har medalda bor — emoji o‘zi hech narsa demaydi', () => {
    render(<Pagon row={row({ medals: [medal({ code: 'month-gold' })] })} variant="row" />)
    expect(screen.getByText('Oy chempioni', { selector: '.sr-only' })).toBeTruthy()
  })
})

describe('medalReason', () => {
  it('oy medali — oy nomi, summa va buyurtma', () => {
    const text = medalReason(medal({ code: 'month-gold', amount: uzs(128_550_000), orders: 74 }))
    expect(text).toContain('Avgust 2026')
    expect(text).toContain('74')
  })

  it('konversiya medali — foiz va buyurtma soni', () => {
    const text = medalReason(medal({ code: 'conversion-master', percent: 82, orders: 41 }))
    expect(text).toContain('82')
    expect(text).toContain('41')
  })

  it('klub — bosqich va jami summa', () => {
    const text = medalReason(medal({ code: 'club', tier: 4, amount: uzs(120_000_000) }))
    expect(text).toContain('IV')
  })

  it('🚀 ning orders maydoni o‘rin deb chiziladi, buyurtma deb emas', () => {
    // Domen qatlami yangi yulduzning o‘rnini `orders` da uzatadi.
    const text = medalReason(medal({ code: 'rookie', at: '2026-10-01', orders: 7 }))
    expect(text).toContain('7-oʻrin')
    expect(text).not.toContain('7 buyurtma')
  })

  it('sababsiz medal bo‘sh satr emas', () => {
    expect(medalReason(medal({ code: 'streak-fire', at: '2026-11-01' }))).not.toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/features/sellersPagon.test.tsx`
Expected: FAIL — `Failed to resolve import "@/features/sellers/Pagon"`.

- [ ] **Step 3: Write minimal implementation**

`src/app/globals.css`, `PODIUM` bo'limining oxirida (`MOTION` sarlavhasidan oldin) yangi bo'lim:

```css
/* ==========================================================================
 * PAGON — the sellers board's medal strip
 *
 * IT INHERITS THE SEAT'S METAL AND CARRIES NO DATA IN IT. The contract at
 * the top of this file stands: `--metal` is chrome — the strip's frame, the
 * chevron, the club lozenge's rim. The points bar is `--seq-550`, the level
 * number is `--ink-primary`, and neither ever becomes gold. Gold sits near
 * `--series-4` and `--status-warning` by nature; it is tolerable here only
 * because nothing in this block encodes a value.
 * ========================================================================== */

.pagon {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  width: 100%;
}

/* The chevron — the «pagon» itself. Its BAR COUNT is the rank band, not the
   level: six bands, one to six bars, so the shape is readable from across a
   room where a two-digit number is not. */
.pagon-chevron {
  display: inline-flex;
  gap: 2px;
  align-items: flex-end;
}

.pagon-chevron span {
  width: 3px;
  border-radius: 1px;
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--metal) 78%, transparent),
    color-mix(in oklab, var(--metal) 38%, transparent)
  );
}

.pagon-chevron span:nth-child(1) { height: 8px; }
.pagon-chevron span:nth-child(2) { height: 10px; }
.pagon-chevron span:nth-child(3) { height: 12px; }
.pagon-chevron span:nth-child(4) { height: 14px; }
.pagon-chevron span:nth-child(5) { height: 16px; }
.pagon-chevron span:nth-child(6) { height: 18px; }

.pagon-level {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ink-primary);
}

.pagon-title {
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-secondary);
  font-size: 0.6875rem;
}

/* The points bar. --seq-550, the same tone the list's FAKT 2 bar uses, so a
   reader who already learned that tone on this screen does not learn a second
   one for the same kind of quantity. */
.pagon-track {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: var(--track);
  overflow: hidden;
}

.pagon-fill {
  position: absolute;
  inset-block: 0;
  left: 0;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    color-mix(in oklab, var(--seq-550) 45%, var(--surface-raised)),
    var(--seq-550)
  );
  transition: width var(--duration-enter) var(--ease-out);
}

.pagon-goal {
  font-size: 0.6875rem;
  color: var(--ink-muted);
}

.pagon-medals {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
}

.pagon-medal {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  padding: 0.125rem 0.3125rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  line-height: 1.2;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  color: var(--ink-secondary);
}

/* The club lozenge is the one medal that earns the metal rim: its tier IS a
   ceremony rank, and the numeral beside it is a roman ordinal rather than a
   measured value. */
.pagon-medal--club {
  border-color: color-mix(in oklab, var(--metal) 40%, var(--border));
}

.pagon-more {
  font-size: 0.6875rem;
  color: var(--ink-muted);
}

/* The speaking medal — one at a time, on the column's own clock. */
.pagon-speech {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-radius: 0.5rem;
  background: var(--surface-sunken);
  border: 1px solid color-mix(in oklab, var(--metal) 28%, var(--border));
  animation: pagon-speak var(--duration-enter) var(--ease-out);
}

.pagon-speech-name {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--ink-primary);
}

.pagon-speech-why {
  font-size: 0.6875rem;
  color: var(--ink-secondary);
}

@keyframes pagon-speak {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .pagon-speech { animation: none; }
  .pagon-fill { transition: none; }
}

/* The row variant sits inside the name cell, under the bar. Smaller, no
   speech — 139 rows changing at once is not a board anyone can read. */
.pagon--row {
  flex-direction: row;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.25rem;
}

.pagon--row .pagon-level { font-size: 0.6875rem; }
.pagon--row .pagon-medal { padding: 0 0.25rem; }
```

`src/features/sellers/Pagon.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/features/sellersPagon.test.tsx`
Expected: PASS — 13 test.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/features/sellers/Pagon.tsx tests/features/sellersPagon.test.tsx
git commit -m "feat(sellers): pagon komponenti va PAGON uslublari

Metall faqat ramkada — ball chizig'i --seq-550, daraja raqami --ink-primary.
Har medal belgi + o'zbek nom + sabab olib yuradi: televizorda sichqoncha yo'q."
```

---

### Task 9: Ustunning bitta soati

**Files:**
- Create: `src/features/sellers/useMedalRotation.ts`
- Test: `tests/features/useMedalRotation.test.ts`

**Interfaces:**
- Consumes: `SellerMedalDto` (Task 7), `useReducedMotion` — `@/lib/useReducedMotion`.
- Produces: `useMedalRotation(slots: readonly { employeeId: string; medals: readonly SellerMedalDto[] }[]): { employeeId: string; medal: SellerMedalDto } | null`, `MEDAL_ROTATION_MS = 6000`.

- [ ] **Step 1: Write the failing test**

`tests/features/useMedalRotation.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MEDAL_ROTATION_MS, useMedalRotation } from '@/features/sellers/useMedalRotation'
import type { SellerMedalDto } from '@/lib/api'

const medal = (code: SellerMedalDto['code']): SellerMedalDto => ({
  code,
  count: 1,
  tier: null,
  points: 100,
  at: '2026-08-01',
  amount: null,
  orders: null,
  percent: null,
})

describe('medal aylanishi', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('bir vaqtda faqat BITTA medal gapiradi', () => {
    const { result } = renderHook(() =>
      useMedalRotation([
        { employeeId: 'a', medals: [medal('month-gold'), medal('club')] },
        { employeeId: 'b', medals: [medal('clean-month')] },
      ]),
    )
    expect(result.current).not.toBeNull()
    expect(result.current!.employeeId).toBe('a')
    expect(result.current!.medal.code).toBe('month-gold')
  })

  it('soat urganda keyingisiga o‘tadi va seatdan seatga aylanadi', () => {
    const { result } = renderHook(() =>
      useMedalRotation([
        { employeeId: 'a', medals: [medal('month-gold')] },
        { employeeId: 'b', medals: [medal('clean-month')] },
      ]),
    )
    act(() => void vi.advanceTimersByTime(MEDAL_ROTATION_MS))
    expect(result.current!.employeeId).toBe('b')
    act(() => void vi.advanceTimersByTime(MEDAL_ROTATION_MS))
    expect(result.current!.employeeId).toBe('a')
  })

  it('medal yo‘q bo‘lsa null — bo‘sh quti chizilmaydi', () => {
    const { result } = renderHook(() => useMedalRotation([{ employeeId: 'a', medals: [] }]))
    expect(result.current).toBeNull()
  })

  it('ro‘yxat qisqarganda indeks chegaradan chiqmaydi', () => {
    const { result, rerender } = renderHook(
      ({ slots }) => useMedalRotation(slots),
      {
        initialProps: {
          slots: [
            { employeeId: 'a', medals: [medal('month-gold')] },
            { employeeId: 'b', medals: [medal('clean-month')] },
          ],
        },
      },
    )
    act(() => void vi.advanceTimersByTime(MEDAL_ROTATION_MS))
    expect(result.current!.employeeId).toBe('b')
    rerender({ slots: [{ employeeId: 'a', medals: [medal('month-gold')] }] })
    expect(result.current!.employeeId).toBe('a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/features/useMedalRotation.test.ts`
Expected: FAIL — `Failed to resolve import "@/features/sellers/useMedalRotation"`.

- [ ] **Step 3: Write minimal implementation**

`src/features/sellers/useMedalRotation.ts`:

```ts
'use client'

import { useEffect, useMemo, useState } from 'react'

import type { SellerMedalDto } from '@/lib/api'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * Qaysi medal «gapirayotgani» — ustunga bitta soat.
 *
 * BIR VAQTDA BITTASI, va bu qaror emas, zarurat. Uch seat bir vaqtda o'z
 * medalini almashtirsa, televizorga qarab turgan odam uchta joyda bir vaqtda
 * o'zgarishni ko'radi va hech birini o'qishga ulgurmaydi. Navbat esa ritm
 * beradi: ekran bir necha daqiqada butun medal alifbosini o'rgatib chiqadi,
 * va aynan shu pastdagi 139 qatorda izohsiz turgan belgilarning javobi.
 *
 * REDUCED MOTION DA TO'XTAYDI va birinchi medal ochiq qoladi — `RecordWall`
 * ning o'z qoidasi. Umuman yo'qotish emas: to'xtagan ekranda ham bitta medal
 * o'zini tanishtirib turadi.
 */
export const MEDAL_ROTATION_MS = 6_000

export interface MedalSlot {
  readonly employeeId: string
  readonly medals: readonly SellerMedalDto[]
}

export function useMedalRotation(
  slots: readonly MedalSlot[],
): { readonly employeeId: string; readonly medal: SellerMedalDto } | null {
  /*
    Navbat — seat emas, MEDAL bo'yicha. Ikki medalli chempion va bitta
    medalli uchinchi o'rin ekranni teng bo'lishsa, ko'proq yutgan odamning
    medallari kamroq ko'rinardi.
  */
  const queue = useMemo(
    () => slots.flatMap((slot) => slot.medals.map((medal) => ({ employeeId: slot.employeeId, medal }))),
    [slots],
  )

  const reduced = useReducedMotion()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (reduced || queue.length < 2) return
    const id = setInterval(() => setTick((t) => t + 1), MEDAL_ROTATION_MS)
    return () => clearInterval(id)
  }, [reduced, queue.length])

  if (queue.length === 0) return null
  // Modul navbat uzunligiga — taxta yangilanib medal soni kamayganda indeks
  // chegaradan chiqmasligi uchun; `tick` o'sishda davom etadi.
  return queue[tick % queue.length]!
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/features/useMedalRotation.test.ts`
Expected: PASS — 4 test.

- [ ] **Step 5: Commit**

```bash
git add src/features/sellers/useMedalRotation.ts tests/features/useMedalRotation.test.ts
git commit -m "feat(sellers): ustunga bitta medal soati

Uch seat bir vaqtda o'zgarsa televizorda hech biri o'qilmaydi. Navbat medal
bo'yicha, seat bo'yicha emas."
```

---

### Task 10: Ekranga o'rnatish — eski blokni olib tashlash

**Files:**
- Modify: `src/features/sellers/SellersPage.tsx`
- Test: `tests/features/sellersTvBoard.test.tsx` (mavjud — unga qo'shiladi)

**Interfaces:**
- Consumes: `Pagon` (Task 8), `useMedalRotation` (Task 9), `SellerMedalsDto` (Task 7).
- Produces: ekranda ko'rinadigan pagon. Yangi eksport yo'q.

- [ ] **Step 1: Write the failing test**

`tests/features/sellersTvBoard.test.tsx` — bu fayl ekranni jsdom bilan RENDER
qiladi va `SellersColumn` allaqachon test uchun eksport qilingan, shuning uchun
testlar manba matniga emas, DOM ga tekshiradi.

**Avval mavjud ikki joyga `medals` qo'shiladi.** `medals` — `ColumnProps` ning
MAJBURIY maydoni (ixtiyoriy qilib qo'yilsa, `SellersPage` uni uzatishni unutsa
hech narsa xato bermaydi va pagon jimgina yo'qoladi). Fayldagi 16 ta render
`PROPS` ni tarqatib chaqiradi, shuning uchun ikki qator yetadi:

```tsx
const PROPS = {
  status: 'ready' as const,
  onRetry: () => {},
  fakt: 'auto' as const,
  onFakt: () => {},
  medals: new Map<string, SellerMedalRowDto>(),   // ← qo'shiladi
}
```

va `Board` ichidagi `props` obyektiga ham xuddi shu maydon. Boshqa hech bir
mavjud test o'zgartirilmaydi.

Importga `import type { SellerMedalRowDto } from '@/lib/api'` va
`import { readFileSync } from 'node:fs'` qo'shiladi.

Keyin fayl oxiriga:

```tsx
function medalRow(
  employeeId: string,
  over: Partial<SellerMedalRowDto> = {},
): SellerMedalRowDto {
  return {
    employeeId,
    points: 11_000,
    level: 15,
    rankTitle: 'Usta',
    levelFloor: 10_500,
    nextLevelAt: 12_000,
    nextTitle: 'Master',
    medals: [
      {
        code: 'month-gold',
        count: 3,
        tier: null,
        points: 1500,
        at: '2026-08-01',
        amount: money(128_550_000),
        orders: 74,
        percent: null,
      },
    ],
    ...over,
  }
}

/* RIPE taxtasining birinchi seati va to'rtinchi qatori — `seller()`
   `employeeId` ni to'liq ismdan yasaydi, shuning uchun kalit ham shu. */
const MEDALS = new Map<string, SellerMedalRowDto>([
  ['154 Marjona Xayrullayeva', medalRow('154 Marjona Xayrullayeva')],
  [
    'Nodira 118 Karimova',
    medalRow('Nodira 118 Karimova', {
      points: 3_000,
      level: 8,
      rankTitle: 'Katta sotuvchi',
      levelFloor: 2_800,
      nextLevelAt: 3_600,
      nextTitle: null,
    }),
  ],
])

/**
 * PAGON — VA MIJOZ OLIB TASHLASHNI SO'RAGAN BLOK.
 *
 * Seat kartasida bitta fakt uch marta chizilgan edi: «Liderga +100 000»
 * chipi, progress chizig'i va «97%». Uchalasi ham «liderdan qancha
 * orqadaman» degan bitta savolga javob berardi, va yonidagi «0 / 2
 * buyurtma» bilan birga ziddiyatli o'qilardi — mijozning o'z ta'rifi
 * «noaniq keraksiz xolat» (2026-09-15).
 *
 * Bu testlar o'sha blokning YO'QLIGINI va o'rniga kelgan pagonning borligini
 * DOM dan tekshiradi. Manba matni faqat bitta narsa uchun o'qiladi —
 * so'rovning ulanishi, uni DOM ko'rsata olmaydi.
 */
describe('pagon', () => {
  it('seat kartasi darajani va unvonni chizadi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(column('tv-sellers').getByText(/15-daraja/)).toBeTruthy()
    expect(column('tv-sellers').getByText(/Master/)).toBeTruthy()
  })

  it('liderga nisbatan foiz chizig\u2018i seatdan olib tashlangan', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(document.querySelector('[aria-label="Liderga nisbatan"]')).toBeNull()
  })

  it('jadval qatorida ham pagon bor, lekin qisqasi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    // 4-o'rindagi Nodira jadvalda, seatda emas.
    expect(column('tv-sellers').getByText(/8-daraja/)).toBeTruthy()
  })

  it('medali yo\u2018q sotuvchida pagon umuman chizilmaydi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    expect(document.querySelector('.pagon')).toBeNull()
  })

  it('daraja va o\u2018rin farqi ustunda BIR MARTA yozilgan', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(column('tv-sellers').getAllByText(/Daraja \u2014 o\u02bbrin emas/)).toHaveLength(1)
  })

  it('jadvalga yangi ustun qo\u2018shilmagan \u2014 390px da yon skroll yomonlashmaydi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(column('tv-sellers').getAllByRole('columnheader')).toHaveLength(6)
  })

  it('jadval qatoridagi masofa saqlangan \u2014 mijoz unga e\u2019tiroz bildirmagan', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    // `Chase` 4-qatorda bronza seatiga bo'lgan masofani yozadi.
    expect(column('tv-sellers').getAllByText(/oldinda|ortda|\+/).length).toBeGreaterThan(0)
  })

  it('medal so\u2018rovi taxtanikidan alohida kalitda va o\u2018z soatida', () => {
    // DOM javob bera olmaydigan yagona narsa: so'rovning ulanishi.
    const source = readFileSync('src/features/sellers/SellersPage.tsx', 'utf8')
    expect(source).toContain("queryKey: ['sellers', 'medals']")
    expect(source).toContain('staleTime: 600_000')
    // Taxta hech qachon medal so'rovining holatiga qaramaydi: u sekin kelsa
    // yoki xato bersa, reyting hech nima sezmasligi kerak.
    expect(source).not.toMatch(/medals\.(isError|isPending)/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/features/sellersTvBoard.test.tsx`
Expected: FAIL — typecheck darajasida `medals` propi `SellersColumn` da yo'q,
va render qilinganda `15-daraja` matni topilmaydi. Mavjud 16 ta test yashil
qolishi kerak: agar ular ham yiqilsa, `PROPS` ga `medals` qo'shilmagan. — `expected '…' not to contain 'aria-label="Liderga nisbatan"'`.

- [ ] **Step 3: Write minimal implementation**

**3a.** Importlar (`SellersPage.tsx` boshida, alifbo tartibida):

```ts
import { Pagon } from '@/features/sellers/Pagon'
import { useMedalRotation } from '@/features/sellers/useMedalRotation'
```

va `@/lib/api` importiga `type SellerMedalsDto`, `type SellerMedalRowDto` qo'shiladi.

**3b.** `SellersPage()` ichida, `board` so'rovidan keyin:

```ts
  /*
    PAGON O'Z SO'ROVIDA VA O'Z SOATIDA — devorning naqshi.

    Uch sabab. Oynasi boshqa: medal `RECORDS_FROM` dan bugungacha, taxta esa
    tanlangan davr — bir payloadga solish medalni filtr tugmasi bilan
    o'chiradigan qilib qo'yardi. Sur'ati boshqa: taxta oltmish soniyada,
    medal o'n daqiqada o'zgaradi. Va eng muhimi — BUZILMASLIK: bu so'rov
    xato bersa yoki kechiksa, televizordagi reyting hech nima sezmaydi,
    faqat pagon ko'rinmaydi.

    `staleTime` va `refetchInterval` — ikkalasi ham, chunki `refetchInterval`
    staleness'ni hech qachon so'ramaydi va bittasini qo'yish hech narsa
    bermaydi (`?include=records` ning o'sha juftligi).
  */
  const medals = useQuery({
    queryKey: ['sellers', 'medals'],
    queryFn: ({ signal }) => apiGet<SellerMedalsDto>('/analytics/sellers', { include: 'medals' }, signal),
    staleTime: 600_000,
    refetchInterval: 600_000,
    placeholderData: (previous) => previous,
  })

  const medalsById = useMemo(() => {
    const map = new Map<string, SellerMedalRowDto>()
    for (const row of medals.data?.data.sellers ?? []) map.set(row.employeeId, row)
    return map
  }, [medals.data])
```

`medalsById` ni `SellersColumn` ga uzating — `ColumnProps` ga qo'shiladi:

```ts
  /** Sotuvchi id si bo'yicha pagon. Komandalar ustuni uchun bo'sh Map. */
  medals: ReadonlyMap<string, SellerMedalRowDto>
```

Sotuvchilar ustuniga `medals={medalsById}`, komandalar ustuniga `medals={EMPTY_MEDALS}` (fayl darajasida `const EMPTY_MEDALS: ReadonlyMap<string, SellerMedalRowDto> = new Map()` — medal shaxsiy, ROP komandasiga berilmaydi).

**3c.** `SellersColumn` ichida, seat'larni chizishdan oldin — ustunning soati:

```ts
  /*
    USTUNGA BITTA SOAT. Uch seatning medallari bitta navbatga yig'iladi va
    bir vaqtda faqat bittasi gapiradi.
  */
  const speaking = useMedalRotation(
    useMemo(
      () =>
        winners.map((entry) => ({
          employeeId: entry.key,
          medals: medals.get(entry.key)?.medals ?? [],
        })),
      [winners, medals],
    ),
  )
```

`winners` — seat'larga uzatilayotgan uchta `BoardEntry`, `SellersPage.tsx:544` da allaqachon mavjud (`ranked.filter(…).slice(0, 3)`). Yangi o'zgaruvchi yaratilmaydi.

Har seat'ga `medal={medals.get(entry.key) ?? null}` va `speaking={speaking?.employeeId === entry.key ? speaking.medal : null}` uzatiladi.

**3c-bis.** Uchta seat chizilgandan keyin, jadval boshlanishidan oldin — ustunga bitta izoh satri:

```tsx
        {/*
          DARAJA — O'RIN EMAS, va buni aytish kerak.

          O'rin — bu tanlangan davrdagi pul, ertaga boshqacha. Daraja —
          2026-avgustdan buyon to'plangan mehnat, va u davr filtriga
          bo'ysunmaydi. Ya'ni 8-o'rindagi odam 12-darajada bo'lishi mumkin va
          bu xato emas. Aytilmasa, floor buni nosozlik deb o'qiydi va
          taxtaning ishonchi shunga ketadi — shuning uchun jumla ustunda bir
          marta, seat'larning ostida turadi.
        */}
        {medals.size > 0 && (
          <p className="pagon-note">
            Daraja — oʻrin emas: 2026-avgustdan buyon toʻplangan ball
          </p>
        )}
```

`globals.css` ning PAGON bo'limiga:

```css
.pagon-note {
  margin-top: 0.5rem;
  text-align: center;
  font-size: 0.6875rem;
  color: var(--ink-muted);
}
```

**3d.** Seat komponenti — `champion ? (…) : (…)` **butun uchlik ifodasi** (`SellersPage.tsx:905–963`) quyidagi bilan almashtiriladi:

```tsx
        {/*
          PAGON — MIJOZNING O'Z SO'ROVI, 2026-09-15.

          Bu yerda ilgari bitta fakt uch marta chizilgan edi: «Liderga
          +100 000» chipi, progress chizig'i va «97%». Uchalasi ham «liderdan
          qancha orqada» degan bitta savolga javob berardi, va yonidagi
          «0 / 2 buyurtma» bilan birga o'qilganda ziddiyatli ko'rinardi —
          mijozning o'z ta'rifi «noaniq keraksiz xolat».

          O'RNIGA TO'PLANGAN NARSA. Masofa — bugungi holat, ertaga boshqacha;
          medal va daraja esa avgustdan buyon qilingan ishning o'zi, va
          aynan shu podiumdan tashqaridagi 123 sotuvchiga ham tegadigan
          yagona narsa.

          MEDALSIZDA FAQAT DARAJA CHIZIG'I qoladi va karta qisqaradi — bu
          ham mijozning qarori. Jadval qatoridagi `Chase` esa o'z joyida:
          u boshqa komponent va unga e'tiroz bo'lmagan.
        */}
        {medal !== null && (
          <div className="relative mt-3 w-full">
            <Pagon row={medal} variant="seat" speaking={speaking} />
          </div>
        )}
```

Seat komponentining propslariga `medal: SellerMedalRowDto | null` va `speaking: SellerMedalDto | null` qo'shiladi; `leader`, `runnerUp`, `totalWon`, `onDelivered` proplari endi `gap`, `closeness`, `lead` ni hisoblamaydi — **ishlatilmay qolgan mahalliy o'zgaruvchilar va proplar olib tashlanadi** (lint `no-unused-vars` bilan ushlaydi).

**3e.** Jadval qatori — ism katakchasida, `<Chase …/>` dan **keyin**:

```tsx
                  {medals.get(entry.key) != null && (
                    <Pagon row={medals.get(entry.key)!} variant="row" />
                  )}
```

**Yangi `<Th>` qo'shilmaydi.**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/features/` — keyin `npm run verify`
Expected: PASS; typecheck va lint toza. Agar lint `chase-chip--lead` uchun ishlatilmay qolgan CSS klassini ko'rsatsa, `globals.css` dagi `.chase-chip--lead` qoidasi ham olib tashlanadi (faqat o'sha selektor; `.chase-chip` jadval qatorida qoladi).

- [ ] **Step 5: Commit**

```bash
git add src/features/sellers/SellersPage.tsx tests/features/sellersTvBoard.test.tsx
git commit -m "feat(sellers): seat kartasiga pagon, uch karrali blok o'rniga

Mijozning 2026-09-15 dagi so'rovi: chip + chiziq + foiz bitta faktni uch
marta chizardi. O'rniga medal, ball va daraja. Jadval qatoridagi Chase
saqlandi; yangi ustun qo'shilmadi."
```

---

### Task 11: Gate, probe tozalash va hujjat

**Files:**
- Delete: `probe-medals.mts`, `probe-medals2.mts`, `probe-medals3.mts`
- Modify: `docs/API.md`

**Interfaces:**
- Consumes: hammasi.
- Produces: yashil gate va yangilangan API hujjati.

- [ ] **Step 1: To'liq gate**

Run:
```bash
npm run verify && npm run build && npm run db:check
```
Expected: uchalasi ham yashil. **Bittasi qizil bo'lsa — to'xtang va tuzating.** `db:check` uchun baza kerak; lokal bazasi bo'lmasa, `docs/DEVELOPMENT.md` dagi ko'rsatmadan foydalaning va natijani xabar qiling — o'tkazib yuborilmaydi.

- [ ] **Step 2: `docs/API.md` ga `include=medals` ni yozish**

`/analytics/sellers` bo'limini toping (`grep -n 'analytics/sellers' docs/API.md`) va `include=records` yozilgan joyning yoniga qo'shing:

```markdown
`?include=medals` — pagonning fakti: har sotuvchining medallari, balli va
darajasi. **Davr filtriga bo'ysunmaydi** — oynasi doim `RECORDS_FROM`
(`2026-08`) dan bugungacha, chunki medal butun tarixning fakti. 10 daqiqa
keshlanadi. Javob: `SellerMedalsDto`.
```

- [ ] **Step 3: Probe fayllarini olib tashlash**

Kalibrlash tugagan va natija spec'ga yozilgan; probe'lar doimiy kod emas.

```bash
git rm --cached probe-medals.mts probe-medals2.mts probe-medals3.mts
rm probe-medals.mts probe-medals2.mts probe-medals3.mts
```

- [ ] **Step 4: Gate'ni qayta yurgizish**

Run: `npm run verify`
Expected: PASS — probe'lar yo'qolgani hech narsani buzmaydi (ular hech qayerdan import qilinmaydi).

- [ ] **Step 5: Commit**

```bash
git add docs/API.md
git commit -m "docs: ?include=medals ni API.md ga yozish, kalibrlash probe'larini olib tashlash"
```

- [ ] **Step 6: Mijozga topshirish**

`main` ga **PUSH QILINMAYDI**. Mijozga aytiladi:
- pagon nima qilishi va qaysi medallar bugun kimda borligi (spec'dagi qamrov jadvali),
- 🔥 ⭐ noyabrgacha, 🏆 2027-yanvargacha, 📈 🚀 oktyabrgacha bo'sh turishi,
- «deploy qil» deganda `git push origin main` qilinishi va `.do/app.yaml` ni `deploy_on_push: true` bilan production'ga chiqishi.
