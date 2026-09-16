# Daraja va medallar — amalga oshirish rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/sellers` dagi rad etilgan ball-pagonni puldan hisoblanadigan olti darajali lavha-pagon va lentali medal oilasi bilan almashtirish — motor, DTO, komponentlar, CSS, marosim.

**Architecture:** Motor (`sellerMedals.ts`) sof funksiya bo'lib qoladi, lekin daraja jami FAKT 2 dan chiqadi, ball va klub yo'qoladi, medallar darajaga qarab filtrlanadi va `promotedOn` hosila fakt bo'ladi. Servis DTO ni pul (`MoneyDto`) bilan uzatadi. Frontend: bitta sahifa-darajali `<svg><defs>` (`MedalDefs`), `<use>` bilan chiziladigan `Lavha` va `Medal` komponentlari, seat bloki / tokcha / gapiruvchi karta / narvon / qator medallari, va ustun sarlavhasidagi 8 soniyalik e'lon. Repozitoriy va SQL o'zgarmaydi.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, Vitest + Testing Library (jsdom per-file), Tailwind 4 + `globals.css` tokenlari, inline SVG `<symbol>`/`<use>`.

**Spec:** `docs/superpowers/specs/2026-09-16-daraja-va-medallar-design.md` (aktivlar: `docs/superpowers/specs/assets/2026-09-16-daraja/`). Avvalgi spec `2026-09-15-sotuvchilar-medallari-design.md` ning «1. Ma'lumot» bo'limi va medal QOIDALARI o'z kuchida.

## Global Constraints

- Worktree `/home/smack/Work/ISH-medal`, branch `daraja` (`origin/main` `b9e93fa` dan). `cd` bilan asosiy daraxtga (`/home/smack/Work/ISH`) o'tilmaydi. HECH QACHON `git add -A` — faqat nomlangan fayllar. `main` ga push YO'Q (faqat mijoz «deploy qil» deganda).
- Commit xabari oxirida: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Pul — `bigint` minor birlik; 1 so'm = 100 minor; 1 mln so'm = `100_000_000n`. Hech qachon `Number` ga bo'lishdan oldin o'tkazilmaydi. `MoneyDto.amount` — so'mda `number`.
- Frontend (`src/features`, `src/lib`, `src/app`) `src/server` dan import qilmaydi (eslint qatlam qoidasi). Domen lug'atlari frontend'da NUSXA qilinadi va `Mirrors …` izohi bilan belgilanadi.
- Ranglar: komponent CSS'ida faqat `var(--…)` va `color-mix(in oklab, …)`; literal hex/rgb yo'q. `--medal-gold/silver/bronze` faqat `.medal[data-medal="month-gold|month-silver|month-bronze|year-champion"]` qoidalarida. Lavha `--medal-*` ga tegmaydi. `--series-1`, `--series-5`, `--series-8` medalda ishlatilmaydi.
- O'lchamlar piksel, `--tv-*` clamp'laridan mustaqil: lavha qator 78×26, narvon 102×34, sharpa 120×40, seat 280×88; medal qator 33 px (lentali), seat 44, gapiruvchi 64.
- Unvonlar: 1 Yangi · 2 Sotuvchi · 3 Katta sotuvchi · 4 Usta · 5 Ustoz · 6 Legenda (II, III …). Ostona: 1 minor / 10 / 30 / 100 / 300 / 1000 mln. 0-daraja = hali savdosiz.
- Nusxa o'zbekcha, lotin; apostrof — U+2018 `‘` va U+02BB `ʻ` mavjud matnlarda qanday bo'lsa shunday saqlanadi (fayllarni sed bilan «tozalash» YO'Q — 2026-09-15 dagi parse xatosi shundan chiqqan). Yangi matnda oddiy `'` ishlatish mumkin.
- Test fayllari jsdom uchun birinchi qatorida `// @vitest-environment jsdom` (DOM testlarida). jsdom da `matchMedia` yo'q — stub kerak (`useReducedMotion` uni chaqiradi).
- Har vazifa oxirida `npx vitest run <fayl(lar)>` yashil; 2-vazifadan boshlab `npx tsc --noEmit -p tsconfig.json` ham yashil (2-vazifa eski UI ni olib tashlaydi, shuning uchun tur xatosi qolmaydi). Yakuniy gate: `npm run verify` + `npm run build` + `npm run db:check` (db:check 10/11 — 21 ta seed qatori, 2026-09-09 dan beri ma'lum, bu ishga aloqasiz).
- Turbopack: worktree `node_modules` haqiqiy papka (symlink emas) — allaqachon shunday.

## Fayl tuzilmasi

| Fayl | Mas'uliyat |
|---|---|
| `src/server/domain/analytics/sellerMedals.ts` | narvon (`levelOf`, `titleOf` …), medal qoidalari, ochilish filtri, `promotedOn`, tartib |
| `src/server/services/sellerBoardService.ts` | `SellerMedal*Dto`, `buildMedals` mapping, `today` |
| `src/lib/api.ts` | DTO nusxasi, `MedalCode` |
| `src/features/sellers/medalCatalog.ts` | frontend lug'atlar: nomlar, oilalar, ochilish, tartib, narvon, `levelTitle`, `dativeOf`, `mlnLabel` |
| `src/features/sellers/medalDefs.ts` | `LAVHA_DEFS`, `MEDAL_DEFS` satrlari (aktivlardan generatsiya) |
| `src/features/sellers/MedalDefs.tsx` | sahifaga bir marta o'rnatiladigan `<svg><defs>` |
| `src/features/sellers/Lavha.tsx` | daraja lavhasi (`row/narvon/ghost/seat`) |
| `src/features/sellers/Medal.tsx` | bitta medal (`row/seat/speaking`) + ×N pill |
| `src/features/sellers/medalReason.ts` | medal sababi matni (eski `Pagon.medalReason`) |
| `src/features/sellers/LevelBlock.tsx` | seat: lavha + sharpa + shtamplar + «… qoldi» |
| `src/features/sellers/MedalRail.tsx` | seat tokchasi 5 + N |
| `src/features/sellers/SpeakingMedal.tsx` | gapiruvchi karta |
| `src/features/sellers/Narvon.tsx` | podium ostidagi legenda |
| `src/features/sellers/RowMedals.tsx` | qator: 3 + N |
| `src/features/sellers/usePromotions.ts` | e'lon navbati (8 s, sessiyada bir marta) va yangi medal farqi |
| `src/features/sellers/PromotionBanner.tsx` | ustun sarlavhasidagi e'lon |
| `src/features/sellers/SellersPage.tsx` | ulash: seat, narvon, qator, e'lon |
| `src/app/globals.css` | PAGON bo'limi o'rniga LAVHA, MEDAL, DARAJA BLOKI bo'limlari |
| `docs/API.md` | `?include=medals` satri |
| o'chiriladi: `src/features/sellers/Pagon.tsx`, `tests/features/sellersPagon.test.tsx` | |

---

### Task 1: Narvon funksiyalari — daraja puldan

**Files:**
- Modify: `src/server/domain/analytics/sellerMedals.ts:17-73` (fayl boshidagi ball-narvoni bloki)
- Test: `tests/domain/sellerMedals.level.test.ts` (to'liq qayta yoziladi)

**Interfaces:**
- Consumes: hech narsa.
- Produces (keyingi vazifalar shularga tayanadi):
  ```ts
  export const MINOR_PER_MLN = 100_000_000n
  export const LEVEL_THRESHOLDS_MINOR: readonly bigint[]      // 6 ta, 1-darajadan 6-gacha
  export const LEVEL_TITLES: readonly string[]               // 6 ta
  export const LEGENDA_STEP_MINOR: bigint                     // 1000 mln
  export interface Level { readonly level: number; readonly legendaTier: number }
  export function levelOf(deliveredMinor: bigint): Level
  export function levelFloorMinorOf(l: Level): bigint
  export function nextLevelAtMinorOf(l: Level): bigint
  export function titleOf(l: Level): string | null
  export function nextTitleOf(l: Level): string
  export function romanOf(n: number): string
  ```
  Eski `levelFloorOf(points)`, `levelOf(points)`, `RANK_TITLES`, `titleOf(level)`, `nextTitleOf(level)` shu vazifada O'CHIRILADI (2-vazifa ularning qolgan ishlatilishlarini olib tashlaydi; shu vazifada `buildSellerMedals` ning oxiridagi `levelOf(d.points)` chaqiruvi vaqtincha `levelOf(lifetimeMinor.get(d.employeeId) ?? 0n).level` ga almashtiriladi, `titleOf(level)` esa `titleOf(levelOf(...)) ?? 'Yangi'` ga, `levelFloorOf(level)` / `levelFloorOf(level + 1)` / `nextTitleOf(level)` — `0` / `0` / `null` ga; bu vaqtinchalik, 2-vazifa hammasini qayta yozadi).

- [ ] **Step 1: Yangi test faylini yozish**

`tests/domain/sellerMedals.level.test.ts` ni butunlay quyidagi bilan almashtiring:

```ts
import { describe, expect, it } from 'vitest'

import {
  LEGENDA_STEP_MINOR,
  LEVEL_THRESHOLDS_MINOR,
  LEVEL_TITLES,
  MINOR_PER_MLN,
  levelFloorMinorOf,
  levelOf,
  nextLevelAtMinorOf,
  nextTitleOf,
  romanOf,
  titleOf,
} from '@/server/domain/analytics/sellerMedals'

/**
 * Narvon — 2026-09-16 da production'da 126 sotuvchi ustida o'lchangan
 * taqsimotdan tanlangan va QOTIRILGAN (spec §1). Ishga tushgan darajani
 * ko'tarish floor uchun jazo — bu fayl raqamlarni himoya qiladi.
 */
const MLN = MINOR_PER_MLN

describe('narvon ostonalari', () => {
  it('olti ostona: birinchi so‘m, 10, 30, 100, 300, 1000 mln', () => {
    expect(LEVEL_THRESHOLDS_MINOR).toEqual([1n, 10n * MLN, 30n * MLN, 100n * MLN, 300n * MLN, 1000n * MLN])
    expect(LEVEL_TITLES).toEqual(['Yangi', 'Sotuvchi', 'Katta sotuvchi', 'Usta', 'Ustoz', 'Legenda'])
    expect(LEGENDA_STEP_MINOR).toBe(1000n * MLN)
  })

  it('nol — 0-daraja, unvonsiz; birinchi so‘m — Yangi', () => {
    expect(levelOf(0n)).toEqual({ level: 0, legendaTier: 0 })
    expect(titleOf(levelOf(0n))).toBeNull()
    expect(levelOf(1n)).toEqual({ level: 1, legendaTier: 0 })
    expect(titleOf(levelOf(1n))).toBe('Yangi')
  })

  it('ostonaning AYNAN ustida ko‘tariladi, bir minor pastda ko‘tarilmaydi', () => {
    expect(levelOf(10n * MLN - 1n).level).toBe(1)
    expect(levelOf(10n * MLN).level).toBe(2)
    expect(levelOf(30n * MLN - 1n).level).toBe(2)
    expect(levelOf(30n * MLN).level).toBe(3)
    expect(levelOf(100n * MLN).level).toBe(4)
    expect(levelOf(300n * MLN).level).toBe(5)
    expect(levelOf(1000n * MLN).level).toBe(6)
  })

  it('production‘dagi haqiqiy raqamlar (2026-09-16): 173 mln — Usta, 30,8 mln — Katta sotuvchi, 7,1 mln — Yangi', () => {
    expect(titleOf(levelOf(173n * MLN))).toBe('Usta')
    expect(titleOf(levelOf(308n * MLN / 10n))).toBe('Katta sotuvchi')
    expect(titleOf(levelOf(71n * MLN / 10n))).toBe('Yangi')
  })

  it('Legenda har keyingi milliardda rim raqami oladi, lavha o‘zgarmaydi', () => {
    expect(levelOf(1000n * MLN)).toEqual({ level: 6, legendaTier: 1 })
    expect(titleOf(levelOf(1000n * MLN))).toBe('Legenda')
    expect(levelOf(2000n * MLN)).toEqual({ level: 6, legendaTier: 2 })
    expect(titleOf(levelOf(2000n * MLN))).toBe('Legenda II')
    expect(levelOf(3999n * MLN)).toEqual({ level: 6, legendaTier: 3 })
    expect(titleOf(levelOf(3999n * MLN))).toBe('Legenda III')
  })

  it('shu darajaning ostonasi va keyingi ostona — pul bilan', () => {
    expect(levelFloorMinorOf(levelOf(0n))).toBe(0n)
    expect(nextLevelAtMinorOf(levelOf(0n))).toBe(1n)
    expect(levelFloorMinorOf(levelOf(5n * MLN))).toBe(1n)
    expect(nextLevelAtMinorOf(levelOf(5n * MLN))).toBe(10n * MLN)
    expect(levelFloorMinorOf(levelOf(173n * MLN))).toBe(100n * MLN)
    expect(nextLevelAtMinorOf(levelOf(173n * MLN))).toBe(300n * MLN)
    // Legenda II ning ostonasi 2 mlrd, keyingisi 3 mlrd — narvon tugamaydi.
    expect(levelFloorMinorOf(levelOf(2500n * MLN))).toBe(2000n * MLN)
    expect(nextLevelAtMinorOf(levelOf(2500n * MLN))).toBe(3000n * MLN)
  })

  it('keyingi unvon HAR DOIM bor — «… ga N mln qoldi» jumlasi hech qachon bo‘sh qolmaydi', () => {
    expect(nextTitleOf(levelOf(0n))).toBe('Yangi')
    expect(nextTitleOf(levelOf(5n * MLN))).toBe('Sotuvchi')
    expect(nextTitleOf(levelOf(173n * MLN))).toBe('Ustoz')
    expect(nextTitleOf(levelOf(300n * MLN))).toBe('Legenda')
    expect(nextTitleOf(levelOf(1000n * MLN))).toBe('Legenda II')
    expect(nextTitleOf(levelOf(2000n * MLN))).toBe('Legenda III')
  })

  it('rim raqamlari', () => {
    expect(romanOf(1)).toBe('I')
    expect(romanOf(4)).toBe('IV')
    expect(romanOf(9)).toBe('IX')
    expect(romanOf(14)).toBe('XIV')
    expect(romanOf(40)).toBe('XL')
  })
})
```

- [ ] **Step 2: Testni ishga tushirib, qizilligini tekshirish**

Run: `cd /home/smack/Work/ISH-medal && npx vitest run tests/domain/sellerMedals.level.test.ts`
Expected: FAIL — `LEVEL_THRESHOLDS_MINOR` eksport qilinmagan (import xatosi / undefined).

- [ ] **Step 3: Narvon funksiyalarini yozish**

`src/server/domain/analytics/sellerMedals.ts` da 17–73 qatorlar (`/** N-darajaga kerak bo'ladigan ball …` izohidan `nextTitleOf` funksiyasining yopilishigacha — `levelFloorOf`, `levelOf`, `RANK_TITLES`, `titleOf`, `nextTitleOf`) o'rniga quyidagi blokni qo'ying. Fayl boshidagi doc-izohning «KOEFFITSIYENTLAR 2026-09-15 da…» xatboshisini ham quyidagiga almashtiring:

```ts
 * NARVON 2026-09-16 da production'da 126 sotuvchi ustida o'lchangan
 * taqsimotdan tanlangan va qotirilgan (jami yetkazilgan pul: p50 30,8 mln,
 * p90 102 mln, max 173 mln). Ishga tushgan ostonani keyin ko'tarish mumkin
 * emas: floor uni jazo deb o'qiydi. Spec:
 * `docs/superpowers/specs/2026-09-16-daraja-va-medallar-design.md`.
 */
```

va narvon bloki:

```ts
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
```

So'ng `buildSellerMedals` ning oxiridagi (fayl oxiri, `return [...drafts.values()]` bloki) eski chaqiruvlarni vaqtincha shunday qiling — 2-vazifa bu blokni butunlay qayta yozadi:

```ts
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
```

- [ ] **Step 4: Testni ishga tushirish**

Run: `npx vitest run tests/domain/sellerMedals.level.test.ts`
Expected: PASS (8 ta test).

- [ ] **Step 5: Tur tekshiruvi — vaqtinchalik holat**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c 'error TS'`
Expected: 0. (Boshqa fayllar hali `points` ishlatadi — ular o'z joyida; `levelOf`ning yangi imzosini faqat shu fayl chaqiradi. Agar boshqa joyda eski `levelOf(number)` chaqiruvi chiqsa — `grep -rn "levelOf\|levelFloorOf\|titleOf\|nextTitleOf" src tests --include=*.ts --include=*.tsx` bilan toping; kutilgan: faqat `sellerMedals.ts` va yangi level testi.)

- [ ] **Step 6: Commit**

```bash
git add src/server/domain/analytics/sellerMedals.ts tests/domain/sellerMedals.level.test.ts
git commit -m "feat(sellers): daraja narvoni — puldan, olti unvon, Legenda II

Ball narvoni (50·N²−50·N) o'rniga 2026-avgustdan beri yetkazilgan jami FAKT 2:
1 minor / 10 / 30 / 100 / 300 / 1000 mln → Yangi … Ustoz … Legenda (II, III…).
buildSellerMedals hali eski shaklda; keyingi commit uni qayta yozadi.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Motor chiqishi, servis DTO, API nusxasi — va eski UI qatlamini olib tashlash

**Files:**
- Modify: `src/server/domain/analytics/sellerMedals.ts` (`MEDAL_CODES`, `SellerMedal`, `SellerMedalRow`, ball konstantalari, `CLUB_RUNGS`, `Draft`, `award`, 🌱/💎 bloki, yakuniy map)
- Modify: `src/server/services/sellerBoardService.ts:518-570` (DTO'lar) va `:1028-1064` (`buildMedals`)
- Modify: `src/lib/api.ts:1404-1470` (DTO nusxasi)
- Modify: `docs/API.md:236`
- Modify: `src/features/sellers/SellersPage.tsx` (Pagon ishlatilishlari olib tashlanadi: import, seat bloki, qator, `.pagon-note`)
- Modify: `src/app/globals.css:2570-2749` (PAGON bo'limi o'chiriladi; TV BOARD banneri 2750 da boshlanadi)
- Delete: `src/features/sellers/Pagon.tsx`, `tests/features/sellersPagon.test.tsx`
- Test: `tests/domain/sellerMedals.test.ts` (ball/klub testlari o'chadi, ochilish/tartib/promotedOn/delivered qo'shiladi), `tests/services/sellerMedals.test.ts` (DTO), `tests/features/useMedalRotation.test.ts` (fixture), `tests/features/sellersTvBoard.test.tsx` (fixture + «pagon» describe olib tashlanadi)

**Interfaces:**
- Consumes: 1-vazifadagi `levelOf`, `levelFloorMinorOf`, `nextLevelAtMinorOf`, `titleOf`, `nextTitleOf`.
- Produces:
  ```ts
  // domain
  export const MEDAL_CODES = [... 14 ta, 'club' YO'Q] as const
  export type MedalCode
  export const MEDAL_UNLOCK_LEVEL: Readonly<Record<MedalCode, number>>
  export const MEDAL_ORDER: readonly MedalCode[]
  export interface SellerMedal { code; count; at; amountMinor; orders; percent }   // tier, points YO'Q
  export interface SellerMedalRow {
    employeeId: string; level: number; legendaTier: number; rankTitle: string | null
    deliveredMinor: bigint; levelFloorMinor: bigint; nextLevelAtMinor: bigint
    nextTitle: string; promotedOn: string | null; medals: readonly SellerMedal[]
  }
  // service + api.ts (ikkalasi bir xil)
  export interface SellerMedalDto { code: MedalCode; count: number; at: string | null; amount: MoneyDto | null; orders: number | null; percent: number | null }
  export interface SellerMedalRowDto {
    employeeId: string; level: number; legendaTier: number; rankTitle: string | null
    delivered: MoneyDto; levelFloor: MoneyDto; nextLevelAt: MoneyDto
    nextTitle: string; promotedOn: string | null; medals: readonly SellerMedalDto[]
  }
  export interface SellerMedalsDto { sellers: readonly SellerMedalRowDto[]; from: string; today: string }
  ```

- [ ] **Step 1: Domen testini yangilash**

`tests/domain/sellerMedals.test.ts` da:

(a) `describe('kundalik ish balli', …)` (42–65 qatorlar) va `describe('klub — bitta medal, yetti bosqich', …)` (67–106) bloklarini butunlay O'CHIRING.

(b) Fayl oxiriga qo'shing:

```ts
describe('daraja — jami yetkazilgan puldan', () => {
  it('oylar qo‘shiladi, joriy oy ham; daraja shundan', () => {
    const rows = build([
      month({ employeeId: 'a', month: '2026-08-01', deliveredOrders: 10, deliveredMinor: 60n * MLN }),
      month({ employeeId: 'a', month: '2026-09-01', deliveredOrders: 5, deliveredMinor: 50n * MLN }),
    ])
    const a = rowOf(rows, 'a')
    expect(a.deliveredMinor).toBe(110n * MLN)
    expect(a.level).toBe(4)
    expect(a.rankTitle).toBe('Usta')
    expect(a.levelFloorMinor).toBe(100n * MLN)
    expect(a.nextLevelAtMinor).toBe(300n * MLN)
    expect(a.nextTitle).toBe('Ustoz')
  })

  it('yetkazilgan savdosi yo‘q sotuvchi 0-darajada, unvonsiz, 🌱 siz', () => {
    const rows = build([month({ employeeId: 'a', confirmedOrders: 5 })])
    const a = rowOf(rows, 'a')
    expect(a.level).toBe(0)
    expect(a.rankTitle).toBeNull()
    expect(a.nextTitle).toBe('Yangi')
    expect(codes(a)).not.toContain('first-sale')
  })

  it('qatorlar jami pul bo‘yicha kamayib', () => {
    const rows = build([
      month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 5n * MLN }),
      month({ employeeId: 'b', deliveredOrders: 1, deliveredMinor: 50n * MLN }),
    ])
    expect(rows.map((r) => r.employeeId)).toEqual(['b', 'a'])
  })
})

describe('promotedOn — joriy darajaga chiqqan kun', () => {
  it('kunlik yig‘ma ostonadan oshgan BIRINCHI kun', () => {
    const rows = build(
      [month({ employeeId: 'a', deliveredOrders: 3, deliveredMinor: 12n * MLN })],
      [
        day({ employeeId: 'a', day: '2026-08-03', deliveredMinor: 4n * MLN }),
        day({ employeeId: 'a', day: '2026-08-05', deliveredMinor: 7n * MLN }), // yig‘ma 11 ≥ 10 → Sotuvchi
        day({ employeeId: 'a', day: '2026-08-09', deliveredMinor: 1n * MLN }),
      ],
    )
    expect(rowOf(rows, 'a').level).toBe(2)
    expect(rowOf(rows, 'a').promotedOn).toBe('2026-08-05')
  })

  it('kunlar tartibsiz kelsa ham sana bo‘yicha sanaladi', () => {
    const rows = build(
      [month({ employeeId: 'a', deliveredOrders: 2, deliveredMinor: 12n * MLN })],
      [
        day({ employeeId: 'a', day: '2026-08-09', deliveredMinor: 7n * MLN }),
        day({ employeeId: 'a', day: '2026-08-03', deliveredMinor: 5n * MLN }),
      ],
    )
    // 08-03: 5; 08-09: 12 ≥ 10 → 08-09 (tartibsiz berilsa ham).
    expect(rowOf(rows, 'a').promotedOn).toBe('2026-08-09')
  })

  it('0-darajada va kunlik fakt bo‘lmaganda null', () => {
    const rows = build([month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 5n * MLN })])
    expect(rowOf(rows, 'a').promotedOn).toBeNull()
    const zero = build([month({ employeeId: 'z', confirmedOrders: 1 })])
    expect(rowOf(zero, 'z').promotedOn).toBeNull()
  })
})

describe('daraja medallarni ochadi', () => {
  it('Yangi‘da 🔥 uzatilmaydi, Usta‘da uzatiladi — qoida bir xil, eshik boshqa', () => {
    const streak = (id: string, perMonth: bigint) => [
      month({ employeeId: id, month: '2026-05-01', deliveredOrders: 1, deliveredMinor: perMonth, place: 1 }),
      month({ employeeId: id, month: '2026-06-01', deliveredOrders: 1, deliveredMinor: perMonth, place: 1 }),
      month({ employeeId: id, month: '2026-07-01', deliveredOrders: 1, deliveredMinor: perMonth, place: 1 }),
    ]
    // 3 × 1 mln = 3 mln → Yangi (1-daraja): 🔥 qoidasi bajarilgan, lekin eshik 4.
    const low = rowOf(build(streak('a', 1n * MLN)), 'a')
    expect(low.level).toBe(1)
    expect(codes(low)).not.toContain('streak-fire')
    // 3 × 40 mln = 120 mln → Usta (4-daraja): ochiq.
    const high = rowOf(build(streak('b', 40n * MLN)), 'b')
    expect(high.level).toBe(4)
    expect(codes(high)).toContain('streak-fire')
  })

  it('Yangi‘da ochiq bo‘lganlar: 🌱, 📅, 🌅, 🚀; Sotuvchi‘da oy podiumi', () => {
    // 5 mln → Yangi: oltin oy QOIDASI bajariladi (place 1), lekin eshik 2.
    const rows = build([month({ employeeId: 'a', deliveredOrders: 1, deliveredMinor: 5n * MLN, place: 1 })])
    expect(codes(rowOf(rows, 'a'))).toEqual(['first-sale'])
    const rich = build([month({ employeeId: 'b', deliveredOrders: 1, deliveredMinor: 15n * MLN, place: 1 })])
    expect(codes(rowOf(rich, 'b'))).toEqual(['month-gold', 'first-sale'])
  })
})

describe('medal tartibi', () => {
  it('MEDAL_ORDER bo‘yicha: oltin oy 🌱 dan oldin, 🌅 📅 dan oldin', () => {
    const rows = build(
      [
        month({ employeeId: 'a', month: '2026-08-01', deliveredOrders: 20, confirmedOrders: 20, deliveredMinor: 40n * MLN, place: 1 }),
      ],
      [
        day({ employeeId: 'a', day: '2026-08-04', confirmedOrders: 1, deliveredMinor: 2n * MLN, place: 1 }),
      ],
    )
    const got = codes(rowOf(rows, 'a'))
    // 40 mln → Katta sotuvchi (3): 🥇 (2), 🎯 (3), ⚡ (2), 💯 (2), 🌅 (1), 📅 (1 — floor 1 kun ishlagan, u ham), 🌱 (1) hammasi ochiq.
    expect(got).toEqual(['month-gold', 'conversion-master', 'day-record', 'clean-month', 'day-winner', 'work-month', 'first-sale'])
  })
})
```

(c) Faylning qolgan testlaridagi `points` va `club` iboralarini tekshiring: `grep -n "points\|club\|tier" tests/domain/sellerMedals.test.ts` — (a) dan keyin faqat izohlarda qolishi mumkin; kod satrida qolsa o'chiring. `'klub'` so'zi izohlarda qolsa mayli.

(d) DIQQAT — eshik ta'siri: mavjud testlardagi fixture'lar kam pul bilan (masalan `deliveredMinor: 1n * MLN`) 🥇/🎯/💯/📈/⚡/🔥/⭐/🏆 kutadi. Ochilish filtridan keyin ular 0/1-darajada bo'lib medal ko'rmaydi. Har bir shunday testda fixture'ning `deliveredMinor` ini mos eshikka yetarli qilib oshiring (2-eshik uchun ≥ 10 mln, 3 uchun ≥ 30 mln, 4 uchun ≥ 100 mln, 5 uchun ≥ 300 mln — jami, barcha oylar bo'yicha) va testning izohiga «eshik: N-daraja» deb yozing. Ochilish jadvali: `first-sale`, `work-month`, `day-winner`, `rookie` → 1; `clean-month`, `jump`, `day-record`, `month-*` → 2; `conversion-master`, `streak-steady` → 3; `streak-fire` → 4; `year-champion` → 5. Pul QOIDANI o'zgartirmaydi (masalan 📈 o'sish foizi, 🎯 konversiya) — faqat eshikni ochadi; kerak bo'lsa pulni `deliveredMinor` ga emas, mavjud qiymatlarni saqlab, qo'shimcha oy qatoriga (`month({ employeeId, month: '2026-05-01', deliveredOrders: 1, deliveredMinor: 300n * MLN, place: 50 })`) qo'shing — lekin 📈 va 🔥 testlarida qo'shimcha oy seriyani/o'sishni buzmasligiga e'tibor bering (📈 uchun qo'shimcha oy ikki qo'shni oydan OLDIN bo'lsin; 🔥 «2 oy yetarli emas» testida qo'shimcha oy `place: 50` bilan seriyani uzmasin — u seriyadan OLDINGI oyda tursin).

- [ ] **Step 2: Domen testini ishga tushirib qizilligini ko‘rish**

Run: `npx vitest run tests/domain/sellerMedals.test.ts`
Expected: FAIL — `deliveredMinor`, `promotedOn` yo'q; ochilish filtrisiz `streak-fire` Yangi'da ham chiqadi.

- [ ] **Step 3: Motorni qayta yozish**

`src/server/domain/analytics/sellerMedals.ts` da:

(a) `MEDAL_CODES` dan `'club'` ni olib tashlang (14 ta qoladi).

(b) `SellerMedal` dan `tier` va `points` maydonlarini (va ularning izohlarini) olib tashlang. `SellerMedalRow` ni almashtiring:

```ts
export interface SellerMedalRow {
  readonly employeeId: string
  /** 0 — hali savdosiz; 1..6. */
  readonly level: number
  readonly legendaTier: number
  /** «Ustoz», «Legenda II»; 0-darajada null. */
  readonly rankTitle: string | null
  /** 2026-avgustdan beri jami FAKT 2. */
  readonly deliveredMinor: bigint
  readonly levelFloorMinor: bigint
  readonly nextLevelAtMinor: bigint
  readonly nextTitle: string
  /** Joriy darajaga chiqqan kun, `YYYY-MM-DD`; 0-darajada yoki kunlik faktsiz null. */
  readonly promotedOn: string | null
  /** `MEDAL_ORDER` bo'yicha; oila ichida eng oxirgisi oldin. Faqat OCHILGANLARI. */
  readonly medals: readonly SellerMedal[]
}
```

(c) `POINTS_PER_CONFIRMED_ORDER`, `POINTS_PER_DELIVERED_ORDER`, `POINTS_PER_MLN`, `MEDAL_POINTS`, `CLUB_RUNGS` konstantalarini (izohlari bilan) O'CHIRING; `const MINOR_PER_MLN` ning ikkinchi (eksportsiz) e'lonini ham o'chiring (1-vazifada eksport qilingani qoladi). O'rniga, `MEDAL_MIN_ORDERS` dan oldin, qo'shing:

```ts
/**
 * DARAJA MEDALLARNI OCHADI — mijozning 2026-09-16 dagi so'zi: «levelga
 * o'tgani sari medallar olishi ham osonlashadi». Motor medalni avvalgidek
 * hisoblaydi, lekin sotuvchining darajasi eshikdan past bo'lsa UZATMAYDI.
 * Daraja faqat ko'tarilgani uchun bir marta ko'ringan medal yo'qolmaydi.
 *
 * Eshiklar hikoya, jazo emas: oy chempioni oy oxirida baribir 10 mln dan
 * oshgan bo'ladi. Eshik faqat yuqori medallarda (🔥, 🏆) haqiqatan sezildi.
 */
export const MEDAL_UNLOCK_LEVEL: Readonly<Record<MedalCode, number>> = Object.freeze({
  'first-sale': 1,
  'work-month': 1,
  'day-winner': 1,
  rookie: 1,
  'clean-month': 2,
  jump: 2,
  'day-record': 2,
  'month-bronze': 2,
  'month-silver': 2,
  'month-gold': 2,
  'conversion-master': 3,
  'streak-steady': 3,
  'streak-fire': 4,
  'year-champion': 5,
})

/** Chizilish tartibi — qimmatlisi oldin. Ball yo'q, shuning uchun tartib ro'yxat. */
export const MEDAL_ORDER: readonly MedalCode[] = Object.freeze([
  'year-champion',
  'month-gold',
  'streak-fire',
  'month-silver',
  'month-bronze',
  'streak-steady',
  'conversion-master',
  'day-record',
  'clean-month',
  'jump',
  'rookie',
  'day-winner',
  'work-month',
  'first-sale',
])
```

(d) `Draft` dan `points` ni olib tashlang:

```ts
interface Draft {
  readonly employeeId: string
  readonly medals: SellerMedal[]
}
```

va `draftOf` ichidagi `d = { employeeId, points: 0, medals: [] }` → `d = { employeeId, medals: [] }`.

(e) `// --- kundalik ish ---` sikli (uch `d.points += …` satri bilan) butunlay O'CHIRILADI.

(f) `award` funksiyasi: parametr turi `code: Exclude<MedalCode, 'club'>` → `code: MedalCode`; `const points = MEDAL_POINTS[code]` va `d.points += points` satrlarini o'chiring; takrorlanganda `points: seen.points + points,` satrini o'chiring; yangi medal push'ida `tier: null,` va `points,` satrlarini o'chiring.

(g) `// --- 🌱 birinchi savdo va 💎 klub ---` bloki o'rniga:

```ts
  // --- 🌱 birinchi savdo — JAMI bo'yicha; jami pul darajani ham beradi ----
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

  for (const [employeeId] of lifetimeMinor) {
    const d = draftOf(employeeId)
    if ((lifetimeDelivered.get(employeeId) ?? 0) > 0) {
      d.medals.push({
        code: 'first-sale',
        count: 1,
        at: firstDeliveredMonth.get(employeeId) ?? null,
        amountMinor: null,
        orders: null,
        percent: null,
      })
    }
  }

  // --- promotedOn: kunlik yig'ma joriy daraja ostonasidan oshgan birinchi kun
  /*
    HOSILA FAKT, XOTIRA EMAS. E'lon («endi USTA») brauzer xotirasiga
    tayansa ikki televizor ikki xil e'lon qilardi; kunlik faktlar esa
    savolga o'zi javob beradi. Kunlik fakt yo'q sotuvchida null — e'lon
    yo'q, lavha bor.
  */
  const daysByEmployee = new Map<string, SellerDayFact[]>()
  for (const d of input.days) {
    const list = daysByEmployee.get(d.employeeId)
    if (list) list.push(d)
    else daysByEmployee.set(d.employeeId, [d])
  }
  const promotedOnOf = (employeeId: string, floorMinor: bigint): string | null => {
    if (floorMinor <= 0n) return null
    const days = [...(daysByEmployee.get(employeeId) ?? [])].sort((a, b) =>
      a.day < b.day ? -1 : a.day > b.day ? 1 : 0,
    )
    let sum = 0n
    for (const d of days) {
      sum += d.deliveredMinor
      if (sum >= floorMinor) return d.day
    }
    return null
  }

  const orderIndex = new Map(MEDAL_ORDER.map((code, i) => [code, i] as const))

  return [...drafts.values()]
    .map((d) => {
      const deliveredMinor = lifetimeMinor.get(d.employeeId) ?? 0n
      const lvl = levelOf(deliveredMinor)
      const levelFloorMinor = levelFloorMinorOf(lvl)
      return {
        employeeId: d.employeeId,
        level: lvl.level,
        legendaTier: lvl.legendaTier,
        rankTitle: titleOf(lvl),
        deliveredMinor,
        levelFloorMinor,
        nextLevelAtMinor: nextLevelAtMinorOf(lvl),
        nextTitle: nextTitleOf(lvl),
        promotedOn: promotedOnOf(d.employeeId, levelFloorMinor),
        medals: d.medals
          .filter((m) => MEDAL_UNLOCK_LEVEL[m.code] <= lvl.level)
          .sort((a, b) => {
            const byOrder = orderIndex.get(a.code)! - orderIndex.get(b.code)!
            if (byOrder !== 0) return byOrder
            return (b.at ?? '') < (a.at ?? '') ? -1 : (b.at ?? '') > (a.at ?? '') ? 1 : 0
          }),
      }
    })
    .sort((a, b) => (a.deliveredMinor > b.deliveredMinor ? -1 : a.deliveredMinor < b.deliveredMinor ? 1 : 0))
```

(h) Fayl boshidagi doc-izohda «pagon, ball va daraja» → «lavha, daraja va medallar»; «matnga aylanishi esa `Pagon.tsx` da» → «`medalReason.ts` da».

- [ ] **Step 4: Domen testlarini ishga tushirish**

Run: `npx vitest run tests/domain/sellerMedals.test.ts tests/domain/sellerMedals.level.test.ts`
Expected: PASS. Agar Step 1 (d) da eshik tufayli qizil qolgan test bo'lsa — fixture pulini oshiring (qoidani emas).

- [ ] **Step 5: Servis DTO va mapping**

`src/server/services/sellerBoardService.ts`:

(a) `SellerMedalDto` (524–541): `tier` va `points` maydonlarini (izohlari bilan) olib tashlang. `SellerMedalRowDto` va `SellerMedalsDto` ni almashtiring:

```ts
export interface SellerMedalRowDto {
  readonly employeeId: string
  /** 0 — hali savdosiz; 1..6. */
  readonly level: number
  /** 6-darajada 1 = Legenda, 2 = Legenda II …; pastda 0. */
  readonly legendaTier: number
  /** «Ustoz», «Legenda II»; 0-darajada null. */
  readonly rankTitle: string | null
  /** 2026-avgustdan beri jami FAKT 2 — daraja shundan. */
  readonly delivered: MoneyDto
  readonly levelFloor: MoneyDto
  /** Keyingi ostona — HAR DOIM bor (0-darajada birinchi so'm, Legendada keyingi milliard). */
  readonly nextLevelAt: MoneyDto
  readonly nextTitle: string
  /** Joriy darajaga chiqqan kun, `YYYY-MM-DD` hisobot mintaqasida; null bo'lishi mumkin. */
  readonly promotedOn: string | null
  /** Faqat daraja ochgan medallar, chizilish tartibida. */
  readonly medals: readonly SellerMedalDto[]
}

export interface SellerMedalsDto {
  /** Jami pul bo'yicha kamayib. */
  readonly sellers: readonly SellerMedalRowDto[]
  /** The first instant the ladder covers. See `RECORDS_FROM`. */
  readonly from: string
  /** `YYYY-MM-DD` hisobot mintaqasida — `promotedOn` bilan solishtirish uchun. */
  readonly today: string
}
```

(b) `buildMedals` (1028–1064) ning `return { … }` qismini almashtiring:

```ts
    return {
      from: period.start.toISOString(),
      today: zonedDateKey(ctx.now, period.timeZone),
      sellers: rows.map((row) => ({
        employeeId: row.employeeId,
        level: row.level,
        legendaTier: row.legendaTier,
        rankTitle: row.rankTitle,
        delivered: toMoneyDto(money(row.deliveredMinor, ctx.currency)),
        levelFloor: toMoneyDto(money(row.levelFloorMinor, ctx.currency)),
        nextLevelAt: toMoneyDto(money(row.nextLevelAtMinor, ctx.currency)),
        nextTitle: row.nextTitle,
        promotedOn: row.promotedOn,
        medals: row.medals.map((m) => ({
          code: m.code,
          count: m.count,
          at: m.at,
          amount: m.amountMinor === null ? null : toMoneyDto(money(m.amountMinor, ctx.currency)),
          orders: m.orders,
          percent: m.percent === null ? null : roundPercent(m.percent),
        })),
      })),
    }
```

(`zonedDateKey` allaqachon shu faylda import qilingan — `buildMedals` uni `runningDay` uchun ishlatadi; tekshiring: `grep -n zonedDateKey src/server/services/sellerBoardService.ts`.)

- [ ] **Step 6: Servis testini yangilash**

`tests/services/sellerMedals.test.ts` dagi birinchi test (`'DTO sotuvchi id si bo‘yicha, pul MoneyDto sifatida chiqadi'`) ichidagi uzun `/* ANIQ QIYMAT … */` izohini va `expect(row.points)…expect(row.medals…)` qatorlarini quyidagi bilan almashtiring:

```ts
    /*
      ANIQ QIYMAT. e1 avgustda 30 mln yetkazgan → 3-daraja (30 mln ostonasi
      AYNAN), keyingi ostona 100 mln (Usta). Medallar: 🥇 (place 1, eshik 2),
      🎯 (75%, 40 ≥ 20, eshik 3), 🌱 — uchalasi 3-darajada ochiq. 💯 tushmaydi
      (75% < 80), 📅 tushmaydi (kun fakti yo‘q), 📈/🔥/⭐/🏆/🚀 tushmaydi.
      Kunlik fakt yo‘q → promotedOn null. today — 2026-09-15T06:00Z Toshkentda
      2026-09-15.
    */
    expect(row.level).toBe(3)
    expect(row.legendaTier).toBe(0)
    expect(row.rankTitle).toBe('Katta sotuvchi')
    expect(row.delivered.amount).toBe(30_000_000)
    expect(row.delivered.currency).toBe('UZS')
    expect(row.levelFloor.amount).toBe(30_000_000)
    expect(row.nextLevelAt.amount).toBe(100_000_000)
    expect(row.nextTitle).toBe('Usta')
    expect(row.promotedOn).toBeNull()
    expect(dto.today).toBe('2026-09-15')
    expect(row.medals.map((m) => m.code)).toEqual(['month-gold', 'conversion-master', 'first-sale'])
    const gold = row.medals.find((m) => m.code === 'month-gold')!
    expect(gold.amount).not.toBeNull()
    expect(gold.amount!.currency).toBe('UZS')
    expect(gold.amount!.amount).toBe(30_000_000)
    expect('points' in gold).toBe(false)
    expect('tier' in gold).toBe(false)
```

Run: `npx vitest run tests/services/sellerMedals.test.ts`
Expected: PASS (4 ta test).

- [ ] **Step 7: `api.ts` nusxasi va `docs/API.md`**

`src/lib/api.ts` 1404–1470: `MedalCode` dan `| 'club'` ni olib tashlang; `SellerMedalDto` dan `tier` va `points` ni olib tashlang; `SellerMedalRowDto` va `SellerMedalsDto` ni Step 5 (a) dagi bilan AYNAN bir xil qiling (izohlar bilan; `Mirrors sellerBoardService…` izohi qolsin). `MoneyDto` shu faylda allaqachon bor.

`docs/API.md:236` dagi `?include=medals` jumlasini almashtiring:

```
`?include=medals` replaces the board with each seller's LEVEL and medals (`SellerMedalsDto`): the level is earned from lifetime delivered money since `RECORDS_FROM` (thresholds 10 / 30 / 100 / 300 / 1000 mln soʻm → Yangi · Sotuvchi · Katta sotuvchi · Usta · Ustoz · Legenda), `promotedOn` is the day that level was reached, and a medal is only transmitted once the seller's level has unlocked it — **its window is fixed to `RECORDS_FROM` (`2026-08`) through now and ignores the caller's period filter**, because a level and a medal are facts about the whole history, not the selected window. Cached 10 minutes
```

- [ ] **Step 8: Eski UI qatlamini olib tashlash**

(a) `git rm src/features/sellers/Pagon.tsx tests/features/sellersPagon.test.tsx`

(b) `src/features/sellers/SellersPage.tsx`:
- 8-qator `import { Pagon } from '@/features/sellers/Pagon'` — o'chiring.
- Seat kartasidagi blok (taxminan 955–978: `PAGON — MIJOZNING O'Z SO'ROVI…` izohi va `{medal !== null && (<div className="relative mt-3 w-full"><Pagon row={medal} variant="seat" speaking={speaking} /></div>)}`) — izoh bilan birga o'chiring. `PodiumSeat` imzosidan `medal` va `speaking` proplarini (destructure va tur) olib tashlang — 5-vazifa ularni qaytadan qo'shadi.
- `Podium` komponentidan `medals` va `speaking` proplarini olib tashlang, `BoardColumn` dagi `<Podium winners onDelivered medals speaking />` chaqiruvidan ham; `BoardColumn` dagi `useMedalRotation` chaqiruvi va `const speaking = …` — o'chiring (11-qator importi ham). `medals` propi `BoardColumn`, `BoardList`, `SellersColumn`, `TeamsColumn`, `ColumnProps` da QOLADI (u `ReadonlyMap<string, SellerMedalRowDto>` — tur hali bor).
- `BoardColumn` dagi `{medals.size > 0 && (<p className="pagon-note">…</p>)}` bloki va uning ustidagi `DARAJA — O'RIN EMAS…` izohi — o'chiring.
- `BoardList` qatoridagi `{medals.get(entry.key) != null && (<Pagon row={medals.get(entry.key)!} variant="row" />)}` — o'chiring.
- `useMedalRotation` importi o'chirilgani uchun `ReturnType<typeof useMedalRotation>` turlari qolmasin: `grep -n useMedalRotation src/features/sellers/SellersPage.tsx` → 0 natija.

(c) `src/app/globals.css`: 2570-qatordagi `/* ==========================================================================\n * PAGON — the sellers board's medal strip` bannerdan boshlab 2749-qatorgacha (TV BOARD bannerining `/* ===…` satridan OLDINGI bo'sh satrgacha) butun PAGON bo'limini o'chiring. Tekshiruv: `grep -n '^\.pagon' src/app/globals.css` → 0; `grep -n 'TV BOARD — the sellers board' src/app/globals.css` → bor.

(d) `tests/features/useMedalRotation.test.ts` dagi `medal` fixture'idan `tier: null,` va `points: 100,` satrlarini o'chiring.

(e) `tests/features/sellersTvBoard.test.tsx`:
- `medalRow` (503–531) ni almashtiring:

```ts
function medalRow(
  employeeId: string,
  over: Partial<SellerMedalRowDto> = {},
): SellerMedalRowDto {
  return {
    employeeId,
    level: 4,
    legendaTier: 0,
    rankTitle: 'Usta',
    delivered: money(173_000_000),
    levelFloor: money(100_000_000),
    nextLevelAt: money(300_000_000),
    nextTitle: 'Ustoz',
    promotedOn: null,
    medals: [
      {
        code: 'month-gold',
        count: 3,
        at: '2026-08-01',
        amount: money(128_550_000),
        orders: 74,
        percent: null,
      },
    ],
    ...over,
  }
}
```

- `MEDALS` xaritasidagi Nodira `over` obyektini almashtiring:

```ts
    medalRow('Nodira 118 Karimova', {
      level: 3,
      rankTitle: 'Katta sotuvchi',
      delivered: money(81_300_000),
      levelFloor: money(30_000_000),
      nextLevelAt: money(100_000_000),
      nextTitle: 'Usta',
    }),
```

- `describe('pagon', …)` blokini (549–612, doc-izohi bilan) butunlay o'chiring — 5-vazifa yangi `describe('lavha va medallar', …)` yozadi. `readFileSync` importi boshqa joyda ishlatilmasa (`grep -n readFileSync tests/features/sellersTvBoard.test.tsx`), importni ham olib tashlang.

- [ ] **Step 9: Hammasini ishga tushirish**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/domain tests/services/sellerMedals.test.ts tests/features/sellersTvBoard.test.tsx tests/features/useMedalRotation.test.ts tests/http/sellersRoute.test.ts && npx eslint src/features/sellers src/server/domain/analytics/sellerMedals.ts src/server/services/sellerBoardService.ts src/lib/api.ts`
Expected: tsc 0 xato; vitest PASS; eslint toza.

- [ ] **Step 10: Commit**

```bash
git add src/server/domain/analytics/sellerMedals.ts src/server/services/sellerBoardService.ts src/lib/api.ts docs/API.md src/features/sellers/SellersPage.tsx src/app/globals.css tests/domain/sellerMedals.test.ts tests/services/sellerMedals.test.ts tests/features/useMedalRotation.test.ts tests/features/sellersTvBoard.test.tsx
git commit -m "feat(sellers): motor puldan daraja beradi, medallarni daraja ochadi; eski pagon UI olib tashlandi

Ball va klub yo'q. SellerMedalRow: level/legendaTier/rankTitle, delivered/
levelFloor/nextLevelAt (pul), promotedOn (kunlik yig'ma), medallar
MEDAL_UNLOCK_LEVEL bilan filtrlanib MEDAL_ORDER bo'yicha. DTO ikki tomonda
yangilandi, today qo'shildi. Pagon.tsx, PAGON css va pagon-note o'chirildi —
yangi qatlam keyingi commit'larda.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Katalog, SVG defs, CSS bloklari, `Lavha` va `Medal`

**Files:**
- Create: `src/features/sellers/medalCatalog.ts`
- Create: `src/features/sellers/medalDefs.ts` (generator bilan)
- Create: `src/features/sellers/MedalDefs.tsx`
- Create: `src/features/sellers/Lavha.tsx`
- Create: `src/features/sellers/Medal.tsx`
- Modify: `src/app/globals.css` (TV BOARD banneridan oldin LAVHA, MEDAL, DARAJA BLOKI bo'limlari)
- Test: `tests/features/sellersLavha.test.tsx` (yangi), `tests/features/lavhaCss.test.ts` (yangi)

**Interfaces:**
- Consumes: `MedalCode`, `SellerMedalDto` (`@/lib/api`), `formatNumber`, `formatCompactUzs` (`@/lib/format`).
- Produces:
  ```ts
  // medalCatalog.ts
  export type MedalFamily = 'oy' | 'seriya' | 'kun' | 'sifat' | 'osish'
  export const MEDALS: Readonly<Record<MedalCode, { readonly name: string; readonly family: MedalFamily }>>
  export const FAMILY_NAMES: Readonly<Record<MedalFamily, string>>
  export const MEDAL_UNLOCK_LEVEL: Readonly<Record<MedalCode, number>>
  export const MEDAL_ORDER: readonly MedalCode[]
  export interface LadderRung { readonly level: number; readonly title: string; readonly thresholdLabel: string }
  export const LADDER: readonly LadderRung[]        // 6 ta
  export function levelTitle(level: number, legendaTier: number): string | null
  export function romanOf(n: number): string
  export function dativeOf(title: string): string   // 'Ustoz' → 'Ustozga', 'Legenda II' → 'Legenda II ga'
  export function mlnLabel(som: number): string     // formatCompactUzs — '127 mln', '9.1 mln', '1.2 mlrd' (ilova o'nlik uchun NUQTA ishlatadi: DECIMAL_SEPARATOR = '.')
  // Lavha.tsx
  export type LavhaSize = 'row' | 'narvon' | 'ghost' | 'seat'
  export function Lavha(props: { level: number; legendaTier?: number; size: LavhaSize; ghost?: boolean; title?: string | null; animate?: boolean }): JSX.Element
  // Medal.tsx
  export type MedalSize = 'row' | 'seat' | 'speaking'
  export function Medal(props: { code: MedalCode; size: MedalSize; count?: number; bare?: boolean; locked?: boolean; label?: boolean; isNew?: boolean }): JSX.Element
  // MedalDefs.tsx
  export function MedalDefs(): JSX.Element
  ```
  CSS sinflari: `.lavha`, `.lavha--{row|narvon|ghost|seat}`, `[data-level]`, `[data-ghost]`, `.lavha__plate/__star/__engrave/__hi/__lo/__title`, `.lavha__star--drop`, `.lavha-word`, `.lavha-word--near`, `.medal`, `.medal--{row|seat|speaking}`, `.medal--bare`, `[data-medal]`, `.medal-slot`, `.medal-slot--new`, `.medal-count`, `.medal-more`, `.lv-block`, `.lv-head`, `.lv-plate`, `.lv-plate--rise`, `.lv-sheen`, `.lv-ghost`, `.lv-stamps`, `.lv-qoldi`, `.lv-qoldi--near`, `.medal-rail`, `.medal-speak`, `.medal-speak-name`, `.medal-speak-why`, `.narvon`, `.narvon-rung`, `.tv-namecell`, `.tv-namecell-main`, `.tv-rowmedals`, `.tv-promo`.

- [ ] **Step 1: Testlarni yozish**

`tests/features/sellersLavha.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Lavha } from '@/features/sellers/Lavha'
import { Medal } from '@/features/sellers/Medal'
import { MedalDefs } from '@/features/sellers/MedalDefs'
import { LADDER, MEDALS, MEDAL_ORDER, MEDAL_UNLOCK_LEVEL, dativeOf, levelTitle, mlnLabel } from '@/features/sellers/medalCatalog'

describe('MedalDefs — sahifaga bir marta o‘rnatiladigan belgilar to‘plami', () => {
  it('lavha, xatam va 14 medal belgisini id bilan chizadi', () => {
    const { container } = render(<MedalDefs />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    for (const id of ['khatam', 'lavha-stars-1', 'lavha-stars-3', 'lavha-plate-3x1', 'lavha-plate-seat', 'lavha-rim-seat', 'lavha-hi-seat']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull()
    }
    for (const code of MEDAL_ORDER) expect(container.querySelector(`#medal-${code}`), code).not.toBeNull()
    expect(container.querySelector('#medal-locked')).not.toBeNull()
    expect(container.querySelector('#medal-club')).toBeNull()
  })
})

describe('Lavha', () => {
  it('qator lavhasi: sinf data-level da, yulduz bandi <use> bilan, yozuvsiz', () => {
    const { container } = render(<Lavha level={3} size="row" />)
    const svg = container.querySelector('svg.lavha.lavha--row')!
    expect(svg.getAttribute('data-level')).toBe('3')
    expect(svg.getAttribute('viewBox')).toBe('0 0 78 26')
    expect(svg.querySelector('use[href="#lavha-plate-3x1"]')).not.toBeNull()
    expect(svg.querySelector('use[href="#lavha-stars-3"]')).not.toBeNull()
    expect(svg.querySelector('text')).toBeNull()
    expect(svg.getAttribute('aria-label')).toBe('3-daraja · Katta sotuvchi')
  })

  it('faxriy lavha (4–5) bir xil siluet, yulduz soni 1 va 2', () => {
    const { container } = render(<><Lavha level={4} size="row" /><Lavha level={5} size="row" /></>)
    const [usta, ustoz] = container.querySelectorAll('svg.lavha')
    expect(usta!.querySelector('use[href="#lavha-stars-1"]')).not.toBeNull()
    expect(ustoz!.querySelector('use[href="#lavha-stars-2"]')).not.toBeNull()
  })

  it('Legenda: ichki o‘yma rom + bitta xatam; sharpada rom yo‘q', () => {
    const { container } = render(<><Lavha level={6} legendaTier={1} size="row" /><Lavha level={6} legendaTier={1} size="row" ghost /></>)
    const [real, ghost] = container.querySelectorAll('svg.lavha')
    expect(real!.querySelector('use[href="#lavha-rim-3x1"]')).not.toBeNull()
    expect(real!.querySelector('use[href="#khatam"]')).not.toBeNull()
    expect(ghost!.hasAttribute('data-ghost')).toBe(true)
    expect(ghost!.querySelector('use[href="#lavha-rim-3x1"]')).toBeNull()
    expect(ghost!.querySelector('use[href="#khatam"]')).not.toBeNull()
  })

  it('0-daraja: faqat plastina, yulduzsiz, «Hali darajasiz»', () => {
    const { container } = render(<Lavha level={0} size="row" />)
    const svg = container.querySelector('svg.lavha')!
    expect(svg.getAttribute('data-level')).toBe('0')
    expect(svg.querySelector('use[href^="#lavha-stars"]')).toBeNull()
    expect(svg.querySelector('use[href="#khatam"]')).toBeNull()
    expect(svg.getAttribute('aria-label')).toBe('Hali darajasiz')
  })

  it('seat lavhasi ikki qavatli: bevel chiziqlari, yulduz bandi va O‘YMA UNVON', () => {
    const { container } = render(<Lavha level={3} size="seat" />)
    const svg = container.querySelector('svg.lavha--seat')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 280 88')
    expect(svg.querySelector('use[href="#lavha-hi-seat"]')).not.toBeNull()
    expect(svg.querySelector('use[href="#lavha-lo-seat"]')).not.toBeNull()
    const band = svg.querySelector('use[href="#lavha-stars-3"]')!
    expect(band.getAttribute('x')).toBe('83.1')
    expect(band.getAttribute('width')).toBe('98')
    expect(svg.querySelector('text.lavha__title')!.textContent).toBe('KATTA SOTUVCHI')
    expect(svg.querySelector('text')!.getAttribute('text-anchor')).toBe('middle')
  })

  it('seat: Legenda II yozuvi va katta yulduz; 0-darajada yozuv yo‘q', () => {
    const { container } = render(<><Lavha level={6} legendaTier={2} size="seat" /><Lavha level={0} size="seat" /></>)
    const [leg, zero] = container.querySelectorAll('svg.lavha--seat')
    expect(leg!.querySelector('text')!.textContent).toBe('LEGENDA II')
    expect(leg!.querySelector('use[href="#khatam"]')!.getAttribute('width')).toBe('36')
    expect(zero!.querySelector('text')).toBeNull()
    expect(zero!.querySelector('use[href="#lavha-hi-seat"]')).toBeNull()
  })

  it('animate — har yulduz alohida <use>, tushish sinfi va 80 ms kechikish bilan', () => {
    const { container } = render(<Lavha level={3} size="seat" animate />)
    const stars = container.querySelectorAll('use.lavha__star--drop')
    expect(stars).toHaveLength(3)
    expect((stars[2] as HTMLElement).style.animationDelay).toBe('160ms')
    expect(container.querySelector('use[href="#lavha-stars-3"]')).toBeNull()
  })
})

describe('Medal', () => {
  it('kod data-medal va href da; o‘lcham sinfda; ekran o‘qiydigan nomi bor', () => {
    const { container } = render(<Medal code="streak-fire" size="row" />)
    const svg = container.querySelector('svg.medal.medal--row')!
    expect(svg.getAttribute('data-medal')).toBe('streak-fire')
    expect(svg.getAttribute('viewBox')).toBe('0 0 32 40')
    expect(svg.querySelector('use')!.getAttribute('href')).toBe('#medal-streak-fire')
    expect(screen.getByText('Olov seriyasi', { selector: '.sr-only' })).toBeTruthy()
  })

  it('×N faqat seat va gapiruvchi o‘lchamda — qatorda yo‘q', () => {
    const { container, rerender } = render(<Medal code="day-winner" size="seat" count={5} />)
    expect(container.querySelector('.medal-count')!.textContent).toBe('×5')
    rerender(<Medal code="day-winner" size="row" count={5} />)
    expect(container.querySelector('.medal-count')).toBeNull()
    rerender(<Medal code="day-winner" size="speaking" count={1} />)
    expect(container.querySelector('.medal-count')).toBeNull()
  })

  it('lentasiz variant — kesilgan viewBox va medal--bare', () => {
    const { container } = render(<Medal code="month-gold" size="row" bare />)
    const svg = container.querySelector('svg.medal--bare')!
    expect(svg.getAttribute('viewBox')).toBe('0 8 32 32')
  })

  it('qulflangan medal — data-medal="locked", nomi «Ochilmagan medal»', () => {
    const { container } = render(<Medal code="year-champion" size="speaking" locked />)
    expect(container.querySelector('svg')!.getAttribute('data-medal')).toBe('locked')
    expect(screen.getByText('Ochilmagan medal', { selector: '.sr-only' })).toBeTruthy()
  })

  it('label={false} sr-only nomni chizmaydi (gapiruvchi karta nomni o‘zi yozadi)', () => {
    const { container } = render(<Medal code="jump" size="speaking" label={false} />)
    expect(container.querySelector('.sr-only')).toBeNull()
  })

  it('yangi medal sinfi', () => {
    const { container } = render(<Medal code="jump" size="seat" isNew />)
    expect(container.querySelector('.medal-slot.medal-slot--new')).not.toBeNull()
  })
})

describe('katalog', () => {
  it('14 medal, hammasi nomli va oilali; tartib va eshik motor bilan bir xil', () => {
    expect(Object.keys(MEDALS)).toHaveLength(14)
    expect(MEDAL_ORDER).toHaveLength(14)
    expect(MEDAL_ORDER[0]).toBe('year-champion')
    expect(MEDAL_ORDER[13]).toBe('first-sale')
    expect(MEDAL_UNLOCK_LEVEL['streak-fire']).toBe(4)
    expect(MEDAL_UNLOCK_LEVEL['first-sale']).toBe(1)
    expect(MEDALS['month-gold']).toEqual({ name: 'Oy chempioni', family: 'oy' })
  })

  it('narvon — olti pog‘ona, aytiladigan ostonalar', () => {
    expect(LADDER.map((r) => r.title)).toEqual(['Yangi', 'Sotuvchi', 'Katta sotuvchi', 'Usta', 'Ustoz', 'Legenda'])
    expect(LADDER.map((r) => r.thresholdLabel)).toEqual(['birinchi soʻm', '10 mln', '30 mln', '100 mln', '300 mln', '1 mlrd'])
  })

  it('unvon: 0 → null, Legenda II', () => {
    expect(levelTitle(0, 0)).toBeNull()
    expect(levelTitle(4, 0)).toBe('Usta')
    expect(levelTitle(6, 1)).toBe('Legenda')
    expect(levelTitle(6, 3)).toBe('Legenda III')
  })

  it('jo‘nalish kelishigi — rim raqamli unvonda «ga» alohida', () => {
    expect(dativeOf('Ustoz')).toBe('Ustozga')
    expect(dativeOf('Katta sotuvchi')).toBe('Katta sotuvchiga')
    expect(dativeOf('Legenda II')).toBe('Legenda II ga')
  })

  it('mln yorlig‘i', () => {
    expect(mlnLabel(127_000_000)).toBe('127 mln')
    expect(mlnLabel(9_100_000)).toBe('9.1 mln')
    expect(mlnLabel(1_240_000_000)).toBe('1.2 mlrd')
  })
})
```

`tests/features/lavhaCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Lavha va medal bo'limlarining stylesheet faktlari — `recordWallCss.test.ts`
 * naqshi. Hech biri TypeScript'dan ko'rinmaydi va buzilishi jim.
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

const from = (marker: string) => {
  const i = CSS.indexOf(marker)
  expect(i, `${marker} yo'q`).toBeGreaterThan(-1)
  return i
}
const REGION = CSS.slice(from('* LAVHA —'), from('* TV BOARD — the sellers board'))
/** Izohlarsiz — bannerlar `--medal-*` ni SO'Z bilan tilga oladi, qoida bilan emas. */
const CODE = REGION.replace(/\/\*[\s\S]*?\*\//g, '')

describe('lavha va medal — stylesheet', () => {
  it('eski PAGON bo‘limi yo‘q, yangi bo‘limlar TV BOARD dan oldin', () => {
    expect(CSS).not.toMatch(/^\.pagon\b/m)
    expect(CSS).not.toContain('* PAGON —')
    for (const sel of ['.lavha {', '.lavha--row', '.lavha--seat', '.medal {', '.medal--row', '.medal--speaking', '.lv-block', '.medal-rail', '.narvon {', '.tv-namecell', '.tv-promo']) {
      expect(REGION, sel).toContain(sel)
    }
  })

  it('literal rang yo‘q — faqat var(--…) va color-mix', () => {
    expect(CODE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(CODE).not.toMatch(/\brgba?\(/)
    expect(CODE).not.toMatch(/\bhsla?\(/)
  })

  it('podium metallari faqat Oy oilasi medallarida — lavha ularga tegmaydi', () => {
    const lines = CODE.split('\n')
    let inMonthRule = false
    for (const line of lines) {
      if (/\.medal\[data-medal="(month-gold|month-silver|month-bronze|year-champion)"\]/.test(line)) inMonthRule = true
      if (line.includes('}')) { if (line.includes('--medal-') && !inMonthRule) throw new Error(line); inMonthRule = false; continue }
      if (line.includes('--medal-') && !inMonthRule) throw new Error(`--medal-* Oy qoidasidan tashqarida: ${line.trim()}`)
    }
    const lavhaPart = CODE.slice(0, CODE.indexOf('.medal {'))
    expect(lavhaPart).not.toContain('--medal-')
  })

  it('kamaytirilgan harakatda hech narsa qimirlamaydi', () => {
    const reduced = REGION.slice(REGION.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    for (const sel of ['.lavha__star--drop', '.lv-sheen', '.medal-slot--new', '.medal-speak', '.tv-promo']) expect(reduced, sel).toContain(sel)
    expect(reduced).toContain('animation: none')
  })
})
```

- [ ] **Step 2: Testlarni ishga tushirib qizilligini ko‘rish**

Run: `npx vitest run tests/features/sellersLavha.test.tsx tests/features/lavhaCss.test.ts`
Expected: FAIL — modullar yo'q; CSS bo'limlari yo'q.

- [ ] **Step 3: `medalCatalog.ts`**

```ts
import type { MedalCode } from '@/lib/api'
import { formatCompactUzs } from '@/lib/format'

/**
 * Medal va daraja lug'atlari — frontend nusxasi.
 *
 * Mirrors `sellerMedals.ts` (`MEDAL_UNLOCK_LEVEL`, `MEDAL_ORDER`,
 * `LEVEL_TITLES`, `titleOf`, `romanOf`). Frontend server domenini import
 * qilmaydi (qatlam qoidasi), shuning uchun nusxa; hech narsa nusxani
 * tekshirmaydi — ikkala tomonni birga o'zgartiring.
 */
export type MedalFamily = 'oy' | 'seriya' | 'kun' | 'sifat' | 'osish'

export const MEDALS: Readonly<Record<MedalCode, { readonly name: string; readonly family: MedalFamily }>> =
  Object.freeze({
    'month-gold': { name: 'Oy chempioni', family: 'oy' },
    'month-silver': { name: 'Kumush oy', family: 'oy' },
    'month-bronze': { name: 'Bronza oy', family: 'oy' },
    'year-champion': { name: 'Yil chempioni', family: 'oy' },
    'streak-fire': { name: 'Olov seriyasi', family: 'seriya' },
    'streak-steady': { name: 'Barqaror', family: 'seriya' },
    'day-record': { name: 'Kun rekordi', family: 'kun' },
    'day-winner': { name: 'Kun gʻolibi', family: 'kun' },
    'conversion-master': { name: 'Konversiya ustasi', family: 'sifat' },
    'clean-month': { name: 'Toza oy', family: 'sifat' },
    jump: { name: 'Sakrash', family: 'osish' },
    rookie: { name: 'Yangi yulduz', family: 'osish' },
    'first-sale': { name: 'Birinchi savdo', family: 'osish' },
    'work-month': { name: 'Ishchan oy', family: 'osish' },
  })

export const FAMILY_NAMES: Readonly<Record<MedalFamily, string>> = Object.freeze({
  oy: 'Oy',
  seriya: 'Seriya',
  kun: 'Kun',
  sifat: 'Sifat',
  osish: 'Oʻsish',
})

/** Qaysi daraja qaysi medalni ochadi. Mirrors `sellerMedals.MEDAL_UNLOCK_LEVEL`. */
export const MEDAL_UNLOCK_LEVEL: Readonly<Record<MedalCode, number>> = Object.freeze({
  'first-sale': 1,
  'work-month': 1,
  'day-winner': 1,
  rookie: 1,
  'clean-month': 2,
  jump: 2,
  'day-record': 2,
  'month-bronze': 2,
  'month-silver': 2,
  'month-gold': 2,
  'conversion-master': 3,
  'streak-steady': 3,
  'streak-fire': 4,
  'year-champion': 5,
})

/** Chizilish tartibi. Mirrors `sellerMedals.MEDAL_ORDER`. */
export const MEDAL_ORDER: readonly MedalCode[] = Object.freeze([
  'year-champion',
  'month-gold',
  'streak-fire',
  'month-silver',
  'month-bronze',
  'streak-steady',
  'conversion-master',
  'day-record',
  'clean-month',
  'jump',
  'rookie',
  'day-winner',
  'work-month',
  'first-sale',
])

export interface LadderRung {
  readonly level: number
  readonly title: string
  /** Narvon legendasi ostidagi yozuv — aytiladigan raqam. */
  readonly thresholdLabel: string
}

/** Mirrors `sellerMedals.LEVEL_THRESHOLDS_MINOR` / `LEVEL_TITLES`. */
export const LADDER: readonly LadderRung[] = Object.freeze([
  { level: 1, title: 'Yangi', thresholdLabel: 'birinchi soʻm' },
  { level: 2, title: 'Sotuvchi', thresholdLabel: '10 mln' },
  { level: 3, title: 'Katta sotuvchi', thresholdLabel: '30 mln' },
  { level: 4, title: 'Usta', thresholdLabel: '100 mln' },
  { level: 5, title: 'Ustoz', thresholdLabel: '300 mln' },
  { level: 6, title: 'Legenda', thresholdLabel: '1 mlrd' },
])

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

/** «Ustoz», «Legenda II»; 0-darajada null. Mirrors `sellerMedals.titleOf`. */
export function levelTitle(level: number, legendaTier: number): string | null {
  const rung = LADDER[level - 1]
  if (!rung) return null
  return level === 6 && legendaTier > 1 ? `${rung.title} ${romanOf(legendaTier)}` : rung.title
}

/**
 * Jo'nalish kelishigi: «Ustozga», «Katta sotuvchiga», «Legenda II ga».
 * Rim raqami bilan tugagan unvonda qo'shimcha alohida — «IIga» o'qilmaydi.
 */
export function dativeOf(title: string): string {
  return /\s[IVXLCDM]+$/.test(title) ? `${title} ga` : `${title}ga`
}

/** «127 mln», «9.1 mln», «1.2 mlrd» — `formatCompactUzs` ning o'zi (o'nlik nuqta bilan), nom aniqroq. */
export function mlnLabel(som: number): string {
  return formatCompactUzs(som)
}
```

- [ ] **Step 4: `medalDefs.ts` ni generatsiya qilish**

Aktivlar repo'da: `docs/superpowers/specs/assets/2026-09-16-daraja/{lavha-defs.html,medal-defs.html}`. Ularni QO'LDA ko'chirmang — generator:

```bash
node - <<'JS'
const fs = require('fs')
const A = 'docs/superpowers/specs/assets/2026-09-16-daraja/'
const inner = (file) => {
  const t = fs.readFileSync(A + file, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const m = /<defs>([\s\S]*?)<\/defs>/.exec(t)
  if (!m) throw new Error(file + ': <defs> topilmadi')
  return m[1].trim()
}
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
const out = `/**
 * Lavha va medal SVG belgilari — \`<defs>\` ichi, sahifaga BIR MARTA
 * o'rnatiladi (\`MedalDefs\`). Ranglar faqat \`var(--…)\` — ular
 * \`globals.css\` dagi LAVHA/MEDAL bo'limlaridan instance <svg> orqali
 * shadow daraxtga meros bo'ladi.
 *
 * GENERATSIYA QILINGAN. Manba: docs/superpowers/specs/assets/2026-09-16-daraja/
 * (lavha-defs.html, medal-defs.html). Qo'lda tahrirlamang — manbani
 * o'zgartirib, rejadagi generatorni qayta ishga tushiring.
 */
export const LAVHA_DEFS = \`${esc(inner('lavha-defs.html'))}\`

export const MEDAL_DEFS = \`${esc(inner('medal-defs.html'))}\`
`
fs.writeFileSync('src/features/sellers/medalDefs.ts', out)
console.log('ok', out.length)
JS
```

Tekshiruv: `grep -c 'symbol id="medal-' src/features/sellers/medalDefs.ts` → 15 (14 + locked); `grep -c 'id="khatam"' src/features/sellers/medalDefs.ts` → 1; `grep -n -oE '#[0-9a-fA-F]{6}\b' src/features/sellers/medalDefs.ts` → bo'sh.

- [ ] **Step 5: `MedalDefs.tsx`**

```tsx
import { LAVHA_DEFS, MEDAL_DEFS } from '@/features/sellers/medalDefs'

/**
 * Sahifaning yagona <defs>. 126 qatorning har biriga alohida <defs> qo'yilsa
 * id'lar takrorlanib, <use> birinchisiga bog'lanib qoladi va mavzu
 * almashganda yarmi eski rangda qoladi — shuning uchun BIR MARTA, taxtaning
 * boshida. `dangerouslySetInnerHTML` — statik, repo'dagi ishonchli satr,
 * foydalanuvchi matni emas.
 */
export function MedalDefs() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute' }}
      dangerouslySetInnerHTML={{ __html: `<defs>${LAVHA_DEFS}${MEDAL_DEFS}</defs>` }}
    />
  )
}
```

- [ ] **Step 6: `Lavha.tsx`**

```tsx
import { levelTitle } from '@/features/sellers/medalCatalog'

/**
 * Daraja lavhasi — pagon silueti, uch sinf, 1–3 xatam yulduz.
 *
 * Geometriya `medalDefs.ts` dagi belgilarda; bu yerda faqat QAYSI belgi,
 * QAYERGA. Koordinatalar plastina markazidan (36,7 ixcham; 132,1 seat) —
 * ustaning o'lchovi, ko'z bilan emas. Ranglar CSS'da (`.lavha[data-level]`),
 * ya'ni mavzu almashganda hech narsa qayta chizilmaydi.
 */
export type LavhaSize = 'row' | 'narvon' | 'ghost' | 'seat'

const DIMS: Readonly<Record<LavhaSize, readonly [number, number]>> = {
  row: [78, 26],
  narvon: [102, 34],
  ghost: [120, 40],
  seat: [280, 88],
}
/** Sinf ichidagi yulduz soni: 1–3 oddiy, 4–5 faxriy (1, 2). Legenda alohida. */
const STARS_OF: Readonly<Record<number, 1 | 2 | 3>> = { 1: 1, 2: 2, 3: 3, 4: 1, 5: 2 }
const COMPACT_X = { 1: 28.7, 2: 18.7, 3: 8.7 } as const
const COMPACT_W = { 1: 16, 2: 36, 3: 56 } as const
const SEAT_X = { 1: 118.1, 2: 100.6, 3: 83.1 } as const
const SEAT_W = { 1: 28, 2: 63, 3: 98 } as const
/** Seat'da yulduzlar 16 birlikdan 28 px ga — 4 birlik oraliq 7 px, qadam 35. */
const SEAT_STEP = 35

export function Lavha({
  level,
  legendaTier = 0,
  size,
  ghost = false,
  title,
  animate = false,
}: {
  level: number
  legendaTier?: number
  size: LavhaSize
  /** Keyingi lavhaning sharpasi — shtrix kontur, yulduzlari xira. */
  ghost?: boolean
  /** Seat yozuvi; berilmasa `levelTitle`. */
  title?: string | null
  /** Ko'tarilish marosimi: har yulduz alohida, tushish animatsiyasi bilan. */
  animate?: boolean
}) {
  const [w, h] = DIMS[size]
  const seat = size === 'seat'
  const apex = level === 6
  const stars = STARS_OF[level]
  const label = title === undefined ? levelTitle(level, legendaTier) : title
  const ariaLabel = level === 0 || label === null ? 'Hali darajasiz' : `${level}-daraja · ${label}`

  return (
    <svg
      className={`lavha lavha--${size}`}
      data-level={level}
      data-ghost={ghost ? '' : undefined}
      viewBox={seat ? '0 0 280 88' : '0 0 78 26'}
      width={w}
      height={h}
      role="img"
      aria-label={ariaLabel}
    >
      {seat ? (
        <>
          <use href="#lavha-plate-seat" className="lavha__plate" />
          {!ghost && level > 0 && (
            <>
              <use href="#lavha-hi-seat" className="lavha__hi" />
              <use href="#lavha-lo-seat" className="lavha__lo" />
            </>
          )}
          {apex && !ghost && <use href="#lavha-rim-seat" className="lavha__engrave" />}
          {apex && (
            <use
              href="#khatam"
              className={`lavha__star${animate ? ' lavha__star--drop' : ''}`}
              x={114.1}
              y={11}
              width={36}
              height={36}
            />
          )}
          {!apex && stars !== undefined && !animate && (
            <use
              href={`#lavha-stars-${stars}`}
              className="lavha__star"
              x={SEAT_X[stars]}
              y={15}
              width={SEAT_W[stars]}
              height={28}
            />
          )}
          {!apex && stars !== undefined && animate &&
            Array.from({ length: stars }, (_, i) => (
              <use
                key={i}
                href="#khatam"
                className="lavha__star lavha__star--drop"
                style={{ animationDelay: `${i * 80}ms` }}
                x={Math.round((SEAT_X[stars] + i * SEAT_STEP) * 10) / 10}
                y={15}
                width={28}
                height={28}
              />
            ))}
          {level > 0 && label !== null && (
            <text className="lavha__title" x={132.1} y={73} textAnchor="middle">
              {label.toUpperCase()}
            </text>
          )}
        </>
      ) : (
        <>
          <use href="#lavha-plate-3x1" className="lavha__plate" />
          {apex && !ghost && <use href="#lavha-rim-3x1" className="lavha__engrave" />}
          {apex && <use href="#khatam" className="lavha__star" x={28.7} y={5} width={16} height={16} />}
          {!apex && stars !== undefined && (
            <use
              href={`#lavha-stars-${stars}`}
              className="lavha__star"
              x={COMPACT_X[stars]}
              y={5}
              width={COMPACT_W[stars]}
              height={16}
            />
          )}
        </>
      )}
    </svg>
  )
}
```

- [ ] **Step 7: `Medal.tsx`**

```tsx
import { MEDALS } from '@/features/sellers/medalCatalog'
import type { MedalCode } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/**
 * Bitta medal — lentali dumaloq disk. Belgi `medalDefs.ts` da, rang
 * `.medal[data-medal]` da. ×N — HTML pill, SVG emas (tabular raqam, mavzu
 * tokenlari); QATORDA chizilmaydi — 26 px da o'qilish chegarasida.
 */
export type MedalSize = 'row' | 'seat' | 'speaking'

export function Medal({
  code,
  size,
  count = 1,
  bare = false,
  locked = false,
  label = true,
  isNew = false,
}: {
  code: MedalCode
  size: MedalSize
  count?: number
  /** Lentasiz disk — mijozning televizordagi tanlovi uchun. */
  bare?: boolean
  /** Hali ochilmagan medal — shtrix kontur, belgisiz. */
  locked?: boolean
  /** `sr-only` nom; nomni yonida o'zi yozadigan karta `false` beradi. */
  label?: boolean
  /** Oxirgi yangilanishda paydo bo'lgan — bir marta kattalashib tushadi. */
  isNew?: boolean
}) {
  const id = locked ? 'locked' : code
  const name = locked ? 'Ochilmagan medal' : MEDALS[code].name
  const showCount = count > 1 && size !== 'row'
  return (
    <span className={`medal-slot${isNew ? ' medal-slot--new' : ''}`} title={name}>
      <svg
        className={`medal medal--${size}${bare ? ' medal--bare' : ''}`}
        data-medal={id}
        viewBox={bare ? '0 8 32 32' : '0 0 32 40'}
        role="img"
        aria-label={name}
      >
        <use href={`#medal-${id}`} />
      </svg>
      {showCount && <span className="medal-count tabular">×{formatNumber(count)}</span>}
      {label && <span className="sr-only">{name}</span>}
    </span>
  )
}
```

- [ ] **Step 8: CSS bo‘limlari**

Yangi qoidalarni vaqtinchalik faylga yozing — `/tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/daraja-block.css` (scratchpad papkasi bo'lmasa `mkdir -p`):

```css
/* ==========================================================================
 * DARAJA BLOKI — seat bloki, tokcha, gapiruvchi karta, narvon, qator, e'lon
 *
 * Spec: docs/superpowers/specs/2026-09-16-daraja-va-medallar-design.md §3.
 * O'lchamlar pikselda va `--tv-*` clamp'laridan MUSTAQIL — 4K DPR 1 da
 * lavha yarimlanib qolmasin. Ranglar faqat token; `--medal-*` bu bo'limda
 * yo'q (u faqat Oy oilasi medallarida, MEDAL bo'limida).
 * ======================================================================== */

/* seat: lavha + sharpa + shtamplar + «… qoldi» */
.lv-block {
  width: 100%;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.lv-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
}
/* Lavha karta kengligiga qarab kichrayadi: 1280 da seat 145 px, 1920 da 252. */
.lv-plate {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 280px;
  overflow: hidden;
  border-radius: 6px;
}
.lv-plate .lavha--seat {
  display: block;
  width: 100%;
  height: auto;
}
.lv-ghost {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
/* O'nta shtamp — uzoqdan SANALADI, foiz sanalmaydi. Ma'lumot rangi. */
.lv-stamps {
  display: flex;
  gap: 4px;
}
.lv-stamps i {
  display: block;
  width: 20px;
  height: 8px;
  border-radius: 3px;
  background: var(--track);
}
.lv-stamps i.on { background: var(--seq-550); }
.tv-seat--1 .lv-stamps i { width: 24px; height: 9px; }
.lv-qoldi {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.tv-seat--1 .lv-qoldi { font-size: 20px; }
/* 90% dan oshganda — «yaqin», ogohlantirish rangisiz: ma'lumot ko'ki. */
.lv-qoldi--near { color: var(--seq-550); }

/* seat tokchasi — o'rindiqning o'z chromi yuvindisida */
.medal-rail {
  width: 100%;
  margin-top: 12px;
  padding: 10px 8px 8px;
  border-radius: 12px;
  background: color-mix(in oklab, var(--metal, var(--ink-muted)) 8%, var(--surface-raised));
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 10px;
}
.medal-slot {
  position: relative;
  display: inline-flex;
  align-items: flex-end;
  justify-content: center;
}
.medal-count {
  position: absolute;
  top: -4px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--ink-primary);
  color: var(--surface-raised);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 0 0 2px var(--surface-raised);
}
.medal-more {
  align-self: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-secondary);
  font-variant-numeric: tabular-nums;
}

/* gapiruvchi karta — ustunning soati bittadan ochadi */
.medal-speak {
  width: 100%;
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface-sunken);
  text-align: left;
  animation: medal-speak-in var(--duration-enter) var(--ease-out);
}
.medal-speak-name {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.15;
  color: var(--ink-primary);
}
.medal-speak-why {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--ink-secondary);
}
@keyframes medal-speak-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: none; }
}

/* narvon — podium ostidagi doimiy legenda; STATIK, hech qachon animatsiya yo'q */
.narvon {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 18px 12px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: color-mix(in oklab, var(--surface-sunken) 55%, var(--surface-raised));
}
.narvon-rung {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 0;
  text-align: center;
}
.narvon-rung b {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.1;
  color: var(--ink-primary);
}
.narvon-rung span {
  font-size: 12px;
  color: var(--ink-secondary);
  font-variant-numeric: tabular-nums;
}
/* Telefon — televizor emas: 3+3 bo'lib o'raladi. */
@media (max-width: 1279px) {
  .narvon { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* qator — chapda lavha (yelka), o'ngda medallar (ko'krak), ustun qo'shilmaydi */
.tv-namecell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.tv-namecell > .lavha { flex: none; }
.tv-namecell-main {
  flex: 1 1 auto;
  min-width: 0;
}
.tv-rowmedals {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 96px;
}
/* Telefonda medallar ism ostiga tushadi — yon skroll qo'shilmaydi. */
@media (max-width: 1279px) {
  .tv-namecell { flex-wrap: wrap; }
  .tv-rowmedals {
    width: 100%;
    min-width: 0;
    padding-left: 90px;
  }
}
.lavha-word.lavha-word--near { color: var(--seq-550); }

/* e'lon — 8 soniya ustun sarlavhasi ostida, keyin jim */
.tv-promo {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 12px;
  background: color-mix(in oklab, var(--accent) 12%, var(--surface-raised));
  border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
  font-weight: 600;
  color: var(--ink-primary);
  animation: tv-promo-in var(--duration-enter) var(--ease-out);
}
.tv-promo small {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-secondary);
}
@keyframes tv-promo-in {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: none; }
}

/* ko'tarilish: yulduzlar 80 ms oraliqda tushadi, bitta yaltirash, keyin qotadi */
@keyframes lavha-star-drop {
  0% { transform: translateY(-14px) scale(1.15); opacity: 0; }
  60% { transform: translateY(0) scale(1.15); opacity: 1; }
  100% { transform: none; opacity: 1; }
}
@keyframes lavha-sheen {
  from { transform: translateX(-120%) skewX(-20deg); }
  to { transform: translateX(220%) skewX(-20deg); }
}
.lv-plate--rise .lavha__star--drop {
  transform-box: fill-box;
  transform-origin: center;
  animation: lavha-star-drop 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.lv-sheen {
  position: absolute;
  inset: 0;
  width: 40%;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in oklab, var(--surface-raised) 55%, transparent),
    transparent
  );
  opacity: 0;
  pointer-events: none;
}
.lv-plate--rise .lv-sheen {
  opacity: 1;
  animation: lavha-sheen 0.8s ease-out 0.35s 1 both;
}
/* yangi medal — bir marta 0,6 dan kattalashib tushadi */
@keyframes medal-new {
  from { transform: scale(0.6); opacity: 0; }
  to { transform: none; opacity: 1; }
}
.medal-slot--new .medal { animation: medal-new 0.4s var(--ease-out) both; }

/* Kamaytirilgan harakat: hech narsa qimirlamaydi; e'lon statik chiqadi. */
@media (prefers-reduced-motion: reduce) {
  .lv-plate--rise .lavha__star--drop,
  .lv-plate--rise .lv-sheen,
  .medal-slot--new .medal,
  .medal-speak,
  .tv-promo {
    animation: none;
  }
}
```

So'ng uchala bo'limni `globals.css` ga TV BOARD banneridan oldin joylang:

```bash
node - <<'JS'
const fs = require('fs')
const A = 'docs/superpowers/specs/assets/2026-09-16-daraja/'
const S = '/tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/'
const css = fs.readFileSync('src/app/globals.css', 'utf8')
const banner = '/* ===========================================================================\n * TV BOARD — the sellers board'
const at = css.indexOf(banner)
if (at < 0) throw new Error('TV BOARD banner topilmadi')
if (css.includes('* LAVHA —')) throw new Error('LAVHA bo‘limi allaqachon bor')
const head = (title, body) => `/* ==========================================================================\n * ${title}\n * ======================================================================== */\n\n${body.trim()}\n\n`
const lavha = head('LAVHA — daraja lavhasi (pagon silueti), ranglar faqat token. Manba: ' + A + 'lavha.css', fs.readFileSync(A + 'lavha.css', 'utf8'))
const medal = head('MEDAL — lentali disk, besh rang oilasi; --medal-* FAQAT Oy oilasida (rang shartnomasining yozilgan istisnosi, spec §3). Manba: ' + A + 'medal.css', fs.readFileSync(A + 'medal.css', 'utf8'))
const block = fs.readFileSync(S + 'daraja-block.css', 'utf8').trim() + '\n\n'
fs.writeFileSync('src/app/globals.css', css.slice(0, at) + lavha + medal + block + css.slice(at))
console.log('ok')
JS
```

Tekshiruv: `grep -n -E '^\s*\* (LAVHA|MEDAL|DARAJA BLOKI) ' src/app/globals.css` → uch satr, hammasi TV BOARD banneridan oldin.

So'ng rang shartnomasining o'zini yangilang — `src/app/globals.css` 129–136 qatorlardagi `Medal metals — the sellers podium's chrome…` izohida `barred from ever carrying data. See the PODIUM section below.` jumlasidan keyin (o'sha izoh ichida) qo'shing:

```
   * ONE WRITTEN EXCEPTION (2026-09-16): the Oy family of seller medals
   * (`.medal[data-medal="month-gold|month-silver|month-bronze|year-champion"]`)
   * takes these metals as its FIELD, because the fact it encodes — first,
   * second, third in a period — is the same fact the podium seats encode.
   * Nowhere else; the level plate never touches them. See the MEDAL section.
```

- [ ] **Step 9: Testlar**

Run: `npx vitest run tests/features/sellersLavha.test.tsx tests/features/lavhaCss.test.ts && npx tsc --noEmit -p tsconfig.json && npx eslint src/features/sellers`
Expected: PASS; 0 tur xatosi; eslint toza (agar `react/no-danger` qoidasi chiqsa — u loyihada yoqilmagan; chiqsa `MedalDefs.tsx` da `// eslint-disable-next-line react/no-danger` va sababi izohda).

- [ ] **Step 10: Commit**

```bash
git add src/features/sellers/medalCatalog.ts src/features/sellers/medalDefs.ts src/features/sellers/MedalDefs.tsx src/features/sellers/Lavha.tsx src/features/sellers/Medal.tsx src/app/globals.css tests/features/sellersLavha.test.tsx tests/features/lavhaCss.test.ts
git commit -m "feat(sellers): lavha va medal belgilari — katalog, sahifa defs, Lavha/Medal komponentlari, CSS bo'limlari

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Seat bloki, tokcha, gapiruvchi karta, narvon, qator medallari

**Files:**
- Create: `src/features/sellers/medalReason.ts`
- Create: `src/features/sellers/LevelBlock.tsx`
- Create: `src/features/sellers/MedalRail.tsx`
- Create: `src/features/sellers/SpeakingMedal.tsx`
- Create: `src/features/sellers/Narvon.tsx`
- Create: `src/features/sellers/RowMedals.tsx`
- Test: `tests/features/sellersLavha.test.tsx` (qo'shiladi)

**Interfaces:**
- Consumes: 3-vazifa (`Lavha`, `Medal`, katalog), `SellerMedalDto`, `SellerMedalRowDto`, `monthLabel` (`@/features/sellers/RecordWall`), `formatFullUzs`, `formatNumber`, `formatPercent`.
- Produces:
  ```ts
  export function medalReason(medal: SellerMedalDto): string
  export function LevelBlock(props: { row: SellerMedalRowDto; ghost: boolean; rise?: boolean }): JSX.Element
  export function MedalRail(props: { medals: readonly SellerMedalDto[]; newKeys?: ReadonlySet<MedalCode> }): JSX.Element | null
  export function SpeakingMedal(props: { medal: SellerMedalDto }): JSX.Element
  export function Narvon(): JSX.Element
  export function RowMedals(props: { medals: readonly SellerMedalDto[]; newKeys?: ReadonlySet<MedalCode> }): JSX.Element | null
  export const SEAT_MEDALS = 5; export const ROW_MEDALS = 3
  ```

- [ ] **Step 1: Testlarni qo‘shish**

`tests/features/sellersLavha.test.tsx` boshiga importlar:

```tsx
import { LevelBlock } from '@/features/sellers/LevelBlock'
import { MedalRail } from '@/features/sellers/MedalRail'
import { Narvon } from '@/features/sellers/Narvon'
import { RowMedals } from '@/features/sellers/RowMedals'
import { SpeakingMedal } from '@/features/sellers/SpeakingMedal'
import { medalReason } from '@/features/sellers/medalReason'
import type { SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
```

va faylga fixture'lar + testlar:

```tsx
const uzs = (amount: number) => ({ amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount })

const medal = (over: Partial<SellerMedalDto> & { code: SellerMedalDto['code'] }): SellerMedalDto => ({
  count: 1,
  at: '2026-08-01',
  amount: null,
  orders: null,
  percent: null,
  ...over,
})

const row = (over: Partial<SellerMedalRowDto> = {}): SellerMedalRowDto => ({
  employeeId: 'e1',
  level: 4,
  legendaTier: 0,
  rankTitle: 'Usta',
  delivered: uzs(173_000_000),
  levelFloor: uzs(100_000_000),
  nextLevelAt: uzs(300_000_000),
  nextTitle: 'Ustoz',
  promotedOn: null,
  medals: [],
  ...over,
})

describe('LevelBlock — seat bloki', () => {
  it('lavha, shtamplar va «… ga N mln qoldi»: 173 mln Usta → 3 shtamp, Ustozga 127 mln', () => {
    const { container } = render(<LevelBlock row={row()} ghost={false} />)
    expect(container.querySelector('svg.lavha--seat')!.getAttribute('data-level')).toBe('4')
    expect(container.querySelectorAll('.lv-stamps i')).toHaveLength(10)
    expect(container.querySelectorAll('.lv-stamps i.on')).toHaveLength(3)
    expect(screen.getByText('Ustozga 127 mln qoldi')).toBeTruthy()
    expect(container.querySelector('.lv-ghost')).toBeNull()
  })

  it('sharpa faqat so‘ralganda (chempion seat), keyingi lavha va ostonasi bilan', () => {
    const { container } = render(<LevelBlock row={row()} ghost />)
    const ghost = container.querySelector('.lv-ghost')!
    const svg = ghost.querySelector('svg.lavha--ghost')!
    expect(svg.hasAttribute('data-ghost')).toBe(true)
    expect(svg.getAttribute('data-level')).toBe('5')
    expect(ghost.textContent).toContain('Ustoz')
    expect(ghost.textContent).toContain('300 mln')
  })

  it('90% dan oshganda «yaqin» — 9 shtamp va ko‘k matn', () => {
    const near = row({ level: 3, rankTitle: 'Katta sotuvchi', delivered: uzs(95_000_000), levelFloor: uzs(30_000_000), nextLevelAt: uzs(100_000_000), nextTitle: 'Usta' })
    const { container } = render(<LevelBlock row={near} ghost={false} />)
    expect(container.querySelectorAll('.lv-stamps i.on')).toHaveLength(9)
    expect(container.querySelector('.lv-qoldi--near')!.textContent).toBe('Ustaga 5 mln qoldi')
  })

  it('0-daraja: shtrix lavha, shtamplar bo‘sh, «Birinchi savdo kutilmoqda»', () => {
    const zero = row({ level: 0, rankTitle: null, delivered: uzs(0), levelFloor: uzs(0), nextLevelAt: uzs(0.01), nextTitle: 'Yangi' })
    const { container } = render(<LevelBlock row={zero} ghost />)
    expect(container.querySelector('svg.lavha--seat')!.getAttribute('data-level')).toBe('0')
    expect(container.querySelectorAll('.lv-stamps i.on')).toHaveLength(0)
    expect(screen.getByText('Birinchi savdo kutilmoqda')).toBeTruthy()
    expect(container.querySelector('.lv-ghost')!.textContent).toContain('birinchi soʻm')
  })

  it('Legenda: keyingi milliardgacha, «Legenda II ga … qoldi»', () => {
    const leg = row({ level: 6, legendaTier: 1, rankTitle: 'Legenda', delivered: uzs(1_413_000_000), levelFloor: uzs(1_000_000_000), nextLevelAt: uzs(2_000_000_000), nextTitle: 'Legenda II' })
    render(<LevelBlock row={leg} ghost={false} />)
    expect(screen.getByText('Legenda II ga 587 mln qoldi')).toBeTruthy()
  })

  it('rise — plastina ko‘tarilish sinfi va yaltirash qatlami', () => {
    const { container } = render(<LevelBlock row={row()} ghost={false} rise />)
    expect(container.querySelector('.lv-plate.lv-plate--rise')).not.toBeNull()
    expect(container.querySelector('.lv-sheen')).not.toBeNull()
    expect(container.querySelectorAll('use.lavha__star--drop')).toHaveLength(1)
  })
})

describe('MedalRail va RowMedals', () => {
  const seven = [
    medal({ code: 'month-gold', count: 2 }),
    medal({ code: 'streak-fire' }),
    medal({ code: 'conversion-master' }),
    medal({ code: 'day-record' }),
    medal({ code: 'clean-month' }),
    medal({ code: 'day-winner', count: 5 }),
    medal({ code: 'first-sale' }),
  ]

  it('tokcha 5 ta chizadi, qolgani +N, ×N pill seat o‘lchamida bor', () => {
    const { container } = render(<MedalRail medals={seven} />)
    expect(container.querySelectorAll('.medal-rail svg.medal--seat')).toHaveLength(5)
    expect(screen.getByText('+2')).toBeTruthy()
    expect(container.querySelector('.medal-count')!.textContent).toBe('×2')
  })

  it('medalsiz tokcha chizilmaydi — karta qisqaradi', () => {
    const { container } = render(<MedalRail medals={[]} />)
    expect(container.querySelector('.medal-rail')).toBeNull()
  })

  it('qatorda 3 ta + N, pill yo‘q, yangi medal sinfi', () => {
    const { container } = render(<RowMedals medals={seven} newKeys={new Set(['streak-fire'])} />)
    expect(container.querySelectorAll('.tv-rowmedals svg.medal--row')).toHaveLength(3)
    expect(screen.getByText('+4')).toBeTruthy()
    expect(container.querySelector('.medal-count')).toBeNull()
    expect(container.querySelector('.medal-slot--new svg[data-medal="streak-fire"]')).not.toBeNull()
  })
})

describe('SpeakingMedal va Narvon', () => {
  it('gapiruvchi karta — 64 px medal, nom va sabab; nom ikki marta emas', () => {
    const { container } = render(<SpeakingMedal medal={medal({ code: 'conversion-master', percent: 82, orders: 41 })} />)
    expect(container.querySelector('svg.medal--speaking')).not.toBeNull()
    expect(screen.getByText('Konversiya ustasi', { selector: '.medal-speak-name' })).toBeTruthy()
    expect(screen.getAllByText('Konversiya ustasi')).toHaveLength(1)
    expect(container.querySelector('.medal-speak-why')!.textContent).toContain('82')
  })

  it('narvon — olti pog‘ona, unvon va ostona, Legenda ko‘k', () => {
    const { container } = render(<Narvon />)
    const rungs = container.querySelectorAll('.narvon-rung')
    expect(rungs).toHaveLength(6)
    expect(rungs[0]!.textContent).toContain('Yangi')
    expect(rungs[0]!.textContent).toContain('birinchi soʻm')
    expect(rungs[5]!.querySelector('svg.lavha--narvon')!.getAttribute('data-level')).toBe('6')
    expect(rungs[5]!.textContent).toContain('1 mlrd')
  })
})

describe('medalReason', () => {
  it('oy medali — oy nomi, summa va buyurtma', () => {
    const text = medalReason(medal({ code: 'month-gold', amount: uzs(128_550_000), orders: 74 }))
    expect(text).toContain('Avgust 2026')
    expect(text).toContain('74')
  })

  it('🚀 ning orders maydoni o‘rin deb chiziladi, buyurtma deb emas', () => {
    const text = medalReason(medal({ code: 'rookie', at: '2026-10-01', orders: 7 }))
    expect(text).toContain('7-oʻrin')
    expect(text).not.toContain('7 buyurtma')
  })

  it('📅 «ishchan oy» — «N kun · davomat NN%», buyurtma emas', () => {
    const text = medalReason(medal({ code: 'work-month', orders: 24, percent: 77 }))
    expect(text).toContain('24 kun')
    expect(text).toContain('davomat')
    expect(text).not.toContain('24 buyurtma')
  })

  it('faqat oyi bor medal o‘sha oyni yozadi; hech narsasi yo‘q medal o‘z nomini', () => {
    expect(medalReason(medal({ code: 'streak-fire', at: '2026-11-01' }))).toBe('Noyabr 2026')
    expect(medalReason(medal({ code: 'streak-fire', at: null }))).toBe('Olov seriyasi')
  })
})
```

Run: `npx vitest run tests/features/sellersLavha.test.tsx`
Expected: FAIL — modullar yo'q.

- [ ] **Step 2: `medalReason.ts`**

```ts
import { MEDALS } from '@/features/sellers/medalCatalog'
import { monthLabel } from '@/features/sellers/RecordWall'
import type { SellerMedalDto } from '@/lib/api'
import { formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

/**
 * Medalning sababi, bir jumlada — televizorda sichqoncha yo'q, medal o'zini
 * tanishtirishi kerak. Domen qatlami bo'laklar beradi (oy/kun, pul, foiz);
 * jumla shu yerda yig'iladi. Bo'sh satr hech qachon qaytmaydi.
 */
export function medalReason(medal: SellerMedalDto): string {
  const when = medal.at === null ? null : monthLabel(medal.at)
  const parts: string[] = []

  /*
    📅 «ISHCHAN OY»NING `orders` MAYDONI BUYURTMA EMAS, KUN, VA `percent`
    KONVERSIYA EMAS, DAVOMAT — umumiy yo'ldan o'tsa «24 buyurtma» va yorliqsiz
    foiz chiqardi (mijoz 2026-09-15 da o'chirtirgan ziddiyat).
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
  // 🚀 NING `orders` MAYDONI O'RIN — «7 buyurtma» emas, «7-oʻrin».
  if (medal.code === 'rookie' && medal.orders !== null) {
    parts.push(`${formatNumber(medal.orders)}-oʻrin`)
  } else if (medal.orders !== null) {
    parts.push(`${formatNumber(medal.orders)} buyurtma`)
  }
  if (medal.count > 1) parts.push(`${formatNumber(medal.count)} marta`)

  return parts.length > 0 ? parts.join(' · ') : MEDALS[medal.code].name
}
```

- [ ] **Step 3: `LevelBlock.tsx`**

```tsx
import { Lavha } from '@/features/sellers/Lavha'
import { dativeOf, mlnLabel } from '@/features/sellers/medalCatalog'
import type { SellerMedalRowDto } from '@/lib/api'

/**
 * Seat'dagi daraja bloki: lavha + (chempionda) keyingi lavhaning sharpasi,
 * o'nta shtamp va «Ustozga 127 mln qoldi» — sotuvchi qila oladigan yagona
 * narsa. Foiz yo'q: shtamp uzoqdan sanaladi, foiz sanalmaydi.
 */
export function LevelBlock({
  row,
  ghost,
  rise = false,
}: {
  row: SellerMedalRowDto
  /** Keyingi lavhaning sharpasi — faqat chempion seat'ida (kengroq). */
  ghost: boolean
  /** Ko'tarilish marosimi — yulduzlar tushadi, bir marta yaltiraydi. */
  rise?: boolean
}) {
  const floor = row.levelFloor.amount
  const next = row.nextLevelAt.amount
  const have = row.delivered.amount
  const span = Math.max(1, next - floor)
  const share = Math.max(0, Math.min(1, (have - floor) / span))
  const done = Math.min(10, Math.floor(share * 10))
  const near = row.level > 0 && share >= 0.9
  const remaining = Math.max(0, next - have)
  const qoldi =
    row.level === 0 ? 'Birinchi savdo kutilmoqda' : `${dativeOf(row.nextTitle)} ${mlnLabel(remaining)} qoldi`

  const nextLevel = row.level < 6 ? row.level + 1 : 6
  const nextTier = row.level < 6 ? (nextLevel === 6 ? 1 : 0) : row.legendaTier + 1
  const nextLabel = row.level === 0 ? 'birinchi soʻm' : mlnLabel(next)

  return (
    <div className="lv-block">
      <div className="lv-head">
        <div className={`lv-plate${rise ? ' lv-plate--rise' : ''}`}>
          <Lavha level={row.level} legendaTier={row.legendaTier} size="seat" title={row.rankTitle} animate={rise} />
          <span className="lv-sheen" aria-hidden="true" />
        </div>
        {ghost && (
          <div className="lv-ghost">
            <Lavha level={nextLevel} legendaTier={nextTier} size="ghost" ghost />
            <span>
              keyingi · {row.nextTitle} · {nextLabel}
            </span>
          </div>
        )}
      </div>
      <div className="lv-stamps" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < done ? 'on' : undefined} />
        ))}
      </div>
      <p className={`lv-qoldi${near ? ' lv-qoldi--near' : ''}`}>{qoldi}</p>
    </div>
  )
}
```

- [ ] **Step 4: `MedalRail.tsx`, `RowMedals.tsx`, `SpeakingMedal.tsx`, `Narvon.tsx`**

`MedalRail.tsx`:

```tsx
import { Medal } from '@/features/sellers/Medal'
import type { MedalCode, SellerMedalDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/** Seat tokchasida nechta; qolgani «+N». */
export const SEAT_MEDALS = 5

/** Seat tokchasi — o'rindiqning chromi yuvindisida, bo'sh bo'lsa chizilmaydi. */
export function MedalRail({
  medals,
  newKeys,
}: {
  medals: readonly SellerMedalDto[]
  newKeys?: ReadonlySet<MedalCode>
}) {
  if (medals.length === 0) return null
  const shown = medals.slice(0, SEAT_MEDALS)
  const rest = medals.length - shown.length
  return (
    <div className="medal-rail">
      {shown.map((m) => (
        <Medal key={m.code} code={m.code} size="seat" count={m.count} isNew={newKeys?.has(m.code) ?? false} />
      ))}
      {rest > 0 && <span className="medal-more">+{formatNumber(rest)}</span>}
    </div>
  )
}
```

`RowMedals.tsx`:

```tsx
import { Medal } from '@/features/sellers/Medal'
import type { MedalCode, SellerMedalDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/** Qatorda nechta; qolgani «+N». Aylanish yo'q — 126 qator bir vaqtda o'zgarmaydi. */
export const ROW_MEDALS = 3

export function RowMedals({
  medals,
  newKeys,
}: {
  medals: readonly SellerMedalDto[]
  newKeys?: ReadonlySet<MedalCode>
}) {
  if (medals.length === 0) return null
  const shown = medals.slice(0, ROW_MEDALS)
  const rest = medals.length - shown.length
  return (
    <div className="tv-rowmedals">
      {shown.map((m) => (
        <Medal key={m.code} code={m.code} size="row" count={m.count} isNew={newKeys?.has(m.code) ?? false} />
      ))}
      {rest > 0 && <span className="medal-more">+{formatNumber(rest)}</span>}
    </div>
  )
}
```

`SpeakingMedal.tsx`:

```tsx
import { Medal } from '@/features/sellers/Medal'
import { MEDALS } from '@/features/sellers/medalCatalog'
import { medalReason } from '@/features/sellers/medalReason'
import type { SellerMedalDto } from '@/lib/api'

/** Gapiruvchi karta — ustunning soati navbat bergan medal, nomi va sababi bilan. */
export function SpeakingMedal({ medal }: { medal: SellerMedalDto }) {
  return (
    <div className="medal-speak">
      <Medal code={medal.code} size="speaking" count={medal.count} label={false} />
      <div>
        <p className="medal-speak-name">{MEDALS[medal.code].name}</p>
        <p className="medal-speak-why">{medalReason(medal)}</p>
      </div>
    </div>
  )
}
```

`Narvon.tsx`:

```tsx
import { Lavha } from '@/features/sellers/Lavha'
import { LADDER } from '@/features/sellers/medalCatalog'

/**
 * Narvon — podium ostidagi doimiy legenda. Olti lavha, unvon, ostona.
 * Statik: «daraja o'rin emas» jumlasining o'rnini shu chizma bosadi.
 */
export function Narvon() {
  return (
    <div className="narvon" aria-label="Daraja narvoni">
      {LADDER.map((rung) => (
        <div key={rung.level} className="narvon-rung">
          <Lavha level={rung.level} legendaTier={rung.level === 6 ? 1 : 0} size="narvon" />
          <b>{rung.title}</b>
          <span>{rung.thresholdLabel}</span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Testlar**

Run: `npx vitest run tests/features/sellersLavha.test.tsx && npx tsc --noEmit -p tsconfig.json && npx eslint src/features/sellers`
Expected: PASS; toza.

- [ ] **Step 6: Commit**

```bash
git add src/features/sellers/medalReason.ts src/features/sellers/LevelBlock.tsx src/features/sellers/MedalRail.tsx src/features/sellers/RowMedals.tsx src/features/sellers/SpeakingMedal.tsx src/features/sellers/Narvon.tsx tests/features/sellersLavha.test.tsx
git commit -m "feat(sellers): daraja bloki, medal tokchasi, gapiruvchi karta, narvon, qator medallari

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `SellersPage` ulash — seat, narvon, qator, chase

**Files:**
- Modify: `src/features/sellers/SellersPage.tsx` (importlar; `SellersPage` render — `MedalDefs`; `BoardColumn` — rotation, `Podium` proplari, `Narvon`; `Podium`/`PodiumSeat` — `medal`, `speaking`; seat kartasi — `LevelBlock` + `MedalRail` + `SpeakingMedal`, «N / M buyurtma» satri olib tashlanadi; `BoardList` qatori — `tv-namecell`; `Chase` — `next`)
- Test: `tests/features/sellersTvBoard.test.tsx` (yangi `describe('lavha va medallar')`)

**Interfaces:**
- Consumes: 3–4-vazifa komponentlari; `useMedalRotation` (o'zgarmagan); `dativeOf`, `mlnLabel`.
- Produces: `Chase` ga `next?: string | null` propi; `PodiumSeat` ga `medal: SellerMedalRowDto | null`, `speaking: SellerMedalDto | null`, `rise: boolean` proplari; `Podium` ga `medals`, `speaking`, `risingId: string | null`. (6-vazifa `risingId` ni to'ldiradi; shu vazifada `Podium` uni `null` bilan chaqiradi.)

- [ ] **Step 1: Testlarni yozish**

`tests/features/sellersTvBoard.test.tsx` oxiriga (2-vazifada o'chirilgan «pagon» describe o'rniga):

```tsx
/**
 * LAVHA VA MEDALLAR — 2026-09-16 dizayni (spec §3).
 *
 * Seat: daraja bloki (lavha + shtamplar + «… qoldi»), medal tokchasi,
 * gapiruvchi karta. Narvon podium ostida, BIR MARTA. Qator: chapda lavha,
 * ism yonida unvon so'zi, o'ngda medallar; ustun qo'shilmagan; chase
 * chizig'i ikkinchi bo'lak bilan. Medal so'rovi alohida va o'z soatida.
 */
describe('lavha va medallar', () => {
  it('seat kartasi lavhani o‘yma unvon bilan, shtamplarni va «… qoldi»ni chizadi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const col = column('tv-sellers')
    const seat = col.getByText(/154 Marjona Xayrullayeva/).closest('.podium-card')!
    expect(seat.querySelector('svg.lavha--seat')!.getAttribute('data-level')).toBe('4')
    expect(seat.querySelector('text.lavha__title')!.textContent).toBe('USTA')
    expect(seat.querySelectorAll('.lv-stamps i.on')).toHaveLength(3)
    expect(seat.textContent).toContain('Ustozga 127 mln qoldi')
    // Chempion — sharpa bor.
    expect(seat.querySelector('.lv-ghost')).not.toBeNull()
  })

  it('seat tokchasi medalni ×N bilan chizadi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const seat = column('tv-sellers').getByText(/154 Marjona Xayrullayeva/).closest('.podium-card')!
    expect(seat.querySelector('.medal-rail svg[data-medal="month-gold"]')).not.toBeNull()
    expect(seat.querySelector('.medal-count')!.textContent).toBe('×3')
  })

  it('«N / M buyurtma · %» satri seatdan olib tashlangan — mijozning «noaniq keraksiz xolat»i', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const seat = column('tv-sellers').getByText(/154 Marjona Xayrullayeva/).closest('.podium-card')!
    expect(seat.textContent).not.toMatch(/\d+ \/ \d+ buyurtma/)
    expect(document.querySelector('[aria-label="Liderga nisbatan"]')).toBeNull()
  })

  it('narvon podium ostida BIR MARTA, olti pog‘ona', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(document.getElementById('tv-sellers')!.querySelectorAll('.narvon')).toHaveLength(1)
    expect(document.getElementById('tv-sellers')!.querySelectorAll('.narvon-rung')).toHaveLength(6)
  })

  it('medal so‘rovi bo‘sh bo‘lsa — lavha, narvon, tokcha hech qayerda chizilmaydi, reyting o‘z joyida', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    expect(document.querySelector('.lavha')).toBeNull()
    expect(document.querySelector('.narvon')).toBeNull()
    expect(document.querySelector('.medal-rail')).toBeNull()
    expect(column('tv-sellers').getByRole('table')).toBeTruthy()
  })

  it('jadval qatori: chapda lavha, ism yonida unvon so‘zi, o‘ngda medal', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const rowEl = column('tv-sellers').getByText('Nodira 118 Karimova').closest('tr')!
    const cell = rowEl.querySelector('.tv-namecell')!
    expect(cell.querySelector('svg.lavha--row')!.getAttribute('data-level')).toBe('3')
    expect(cell.querySelector('.lavha-word')!.textContent).toBe('Katta sotuvchi')
    expect(cell.querySelector('.tv-rowmedals svg[data-medal="month-gold"]')).not.toBeNull()
    expect(cell.querySelector('.medal-count')).toBeNull()
  })

  it('chase chizig‘i ikkinchi bo‘lakni oladi — «Ustaga 18.7 mln»', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const rowEl = column('tv-sellers').getByText('Nodira 118 Karimova').closest('tr')!
    expect(rowEl.querySelector('.tv-chase')!.textContent).toContain('Ustaga 18.7 mln')
    expect(rowEl.querySelector('.tv-chase')!.textContent).toMatch(/Oldingiga|Lider|teng/)
  })

  it('jadvalga yangi ustun qo‘shilmagan — 390px da yon skroll yomonlashmaydi', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(column('tv-sellers').getAllByRole('columnheader')).toHaveLength(6)
  })

  it('belgilar to‘plami sahifada BIR MARTA', () => {
    render(<Board data={RIPE} />)
    expect(document.querySelectorAll('#khatam')).toHaveLength(1)
  })

  it('medal so‘rovi taxtanikidan alohida kalitda va o‘z soatida', () => {
    const source = readFileSync('src/features/sellers/SellersPage.tsx', 'utf8')
    expect(source).toContain("queryKey: ['sellers', 'medals']")
    expect(source).toContain('staleTime: 600_000')
    expect(source).not.toMatch(/medals\.(isError|isPending)/)
  })
})
```

`readFileSync` importi 2-vazifada olib tashlangan bo'lsa qaytaring: `import { readFileSync } from 'node:fs'`. `Board` helper faylda bor (`function Board({ data })`) — u `SellersPage` emas, `MedalDefs` ni o'z ichiga olmaydi; shuning uchun «belgilar to'plami BIR MARTA» testi uchun `Board` ni shunday o'zgartiring: `<><MedalDefs /><SellersColumn …/><TeamsColumn …/></>` va `import { MedalDefs } from '@/features/sellers/MedalDefs'`. `PROPS` va `Board.props` ga `medalsToday: null` qo'shing (6-vazifa ishlatadi; `ColumnProps` da shu vazifada qo'shiladi — pastda).

Run: `npx vitest run tests/features/sellersTvBoard.test.tsx`
Expected: FAIL — lavha/narvon yo'q.

- [ ] **Step 2: `SellersPage.tsx` ulash**

(a) Importlar (fayl boshiga, mavjud `@/features/sellers/…` importlari yoniga):

```ts
import { Lavha } from '@/features/sellers/Lavha'
import { LevelBlock } from '@/features/sellers/LevelBlock'
import { MedalDefs } from '@/features/sellers/MedalDefs'
import { MedalRail } from '@/features/sellers/MedalRail'
import { Narvon } from '@/features/sellers/Narvon'
import { RowMedals } from '@/features/sellers/RowMedals'
import { SpeakingMedal } from '@/features/sellers/SpeakingMedal'
import { dativeOf, mlnLabel } from '@/features/sellers/medalCatalog'
import { useMedalRotation } from '@/features/sellers/useMedalRotation'
```

`SellerMedalDto` turi importda bo'lmasa qo'shing (`import type { …, SellerMedalDto, SellerMedalRowDto, SellerMedalsDto } from '@/lib/api'`).

(b) `SellersPage` renderida `<div className="tv-board-shell flex min-h-0 flex-col gap-3">` ning BIRINCHI bolasi sifatida `<MedalDefs />`.

(c) `ColumnProps` ga qo'shing:

```ts
  /** `SellerMedalsDto.today` — e'lon `promotedOn` bilan shuni solishtiradi. 6-vazifa ishlatadi. */
  medalsToday: string | null
```

`SellersPage` ikkala ustunga `medalsToday={medals.data?.data.today ?? null}` beradi; `SellersColumn`/`TeamsColumn` uni `BoardColumn` ga uzatadi (`medalsToday={medalsToday}`); `BoardColumn` imzosiga `medalsToday: string | null` qo'shiladi (hozircha ishlatilmaydi — 6-vazifa; eslint `no-unused-vars` destructure'da shikoyat qilsa, `BoardColumn` ichida `void medalsToday` yozmang — destructure'dan olib tashlab, faqat imzoda qoldiring).

(d) `BoardColumn`: 2-vazifada o'chirilgan rotation qaytadi — `const rows = …` dan keyin:

```ts
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

va podium tarmog'i:

```tsx
        <>
          <Podium winners={winners} onDelivered={onDelivered} medals={medals} speaking={speaking} risingId={null} />
          {tone === 'sellers' && medals.size > 0 && <Narvon />}
          <BoardList entries={rows} allEntries={ranked} noun={noun} onDelivered={onDelivered} medals={medals} />
        </>
```

(e) `Podium`: proplar `medals: ReadonlyMap<string, SellerMedalRowDto>`, `speaking: ReturnType<typeof useMedalRotation>`, `risingId: string | null`; `PodiumSeat` ga `medal={medals.get(entry.key) ?? null}`, `speaking={speaking?.employeeId === entry.key ? speaking.medal : null}`, `rise={risingId === entry.key}`.

(f) `PodiumSeat` imzosi: `medal: SellerMedalRowDto | null`, `speaking: SellerMedalDto | null`, `rise: boolean`. Seat kartasida:
- `<div className="tabular relative mt-2.5 text-[11px] leading-snug" …>` blokidan `<p>{formatNumber(entry.wonOrders)} / {formatNumber(entry.orders)} buyurtma …</p>` ni (uning `conversionPercent` qismi bilan) O'CHIRING; FAKT-boshqa-fakt `<p>` qoladi. Blokning ustidagi izohdan «buyurtma» jumlasini ham moslang. Agar `formatPercent` endi shu faylda ishlatilmasa importdan olib tashlang (`grep -n formatPercent src/features/sellers/SellersPage.tsx`).
- O'sha blokdan keyin, `podium-shine` dan OLDIN:

```tsx
        {medal !== null && (
          <>
            <LevelBlock row={medal} ghost={champion} rise={rise} />
            <MedalRail medals={medal.medals} />
            {speaking !== null && <SpeakingMedal medal={speaking} />}
          </>
        )}
```

(g) `BoardList` qatoridagi ism katakchasi `<td>` ni almashtiring (`ahead` va `figureOf` shu joyda allaqachon bor):

```tsx
                <td>
                  <div className="tv-namecell">
                    {medals.get(entry.key) != null && (
                      <Lavha
                        level={medals.get(entry.key)!.level}
                        legendaTier={medals.get(entry.key)!.legendaTier}
                        size="row"
                      />
                    )}
                    <div className="tv-namecell-main">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="tv-name" style={{ color: 'var(--ink-primary)' }}>
                          {entry.name}
                        </span>
                        {entry.badge && <TeamBadge label={entry.badge} />}
                        {medals.get(entry.key) != null && (
                          <span className={`lavha-word${nearOf(medals.get(entry.key)!) ? ' lavha-word--near' : ''}`}>
                            {medals.get(entry.key)!.rankTitle ?? 'hali savdosiz'}
                          </span>
                        )}
                      </div>
                      {/* bar — AVVALGIDEK, o'zgarmaydi */}
                      <div
                        className="tv-bar relative mt-1 h-1 overflow-hidden rounded-full"
                        style={{ background: 'var(--track)' }}
                        aria-hidden="true"
                      >
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${Math.max(1, (entry.ordered / ceiling) * 100)}%`,
                            background: 'var(--seq-250)',
                            transition: 'width var(--duration-enter) var(--ease-out)',
                          }}
                        />
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${Math.max(entry.won > 0 ? 1 : 0, (entry.won / ceiling) * 100)}%`,
                            background: 'var(--seq-550)',
                            transition: 'width var(--duration-enter) var(--ease-out)',
                          }}
                        />
                      </div>
                      <Chase entry={entry} ahead={ahead} figureOf={figureOf} next={nextOf(medals.get(entry.key) ?? null)} />
                    </div>
                    {medals.get(entry.key) != null && <RowMedals medals={medals.get(entry.key)!.medals} />}
                  </div>
                </td>
```

va modul darajasida (`Chase` dan oldin) ikki yordamchi:

```ts
/** 90% dan oshgan — unvon so'zi ko'k bo'ladi. `LevelBlock` bilan bir qoida. */
function nearOf(row: SellerMedalRowDto): boolean {
  const span = Math.max(1, row.nextLevelAt.amount - row.levelFloor.amount)
  return row.level > 0 && (row.delivered.amount - row.levelFloor.amount) / span >= 0.9
}

/** Chase chizig'ining ikkinchi bo'lagi: «Ustaga 18,7 mln»; 0-darajada «Birinchi savdo kutilmoqda». */
function nextOf(row: SellerMedalRowDto | null): string | null {
  if (row === null) return null
  if (row.level === 0) return 'Birinchi savdo kutilmoqda'
  return `${dativeOf(row.nextTitle)} ${mlnLabel(Math.max(0, row.nextLevelAt.amount - row.delivered.amount))}`
}
```

(h) `Chase`: imzoga `next?: string | null` qo'shing; `if (!chase) return null` ni `if (!chase && !next) return null` ga; qaytariladigan `<p>` ichida `{chase}` dan keyin:

```tsx
      {next && (
        <span className="tabular font-medium" style={{ color: 'var(--ink-secondary)' }}>
          {next}
        </span>
      )}
```

- [ ] **Step 3: Testlar**

Run: `npx vitest run tests/features/sellersTvBoard.test.tsx tests/features/sellersLavha.test.tsx && npx tsc --noEmit -p tsconfig.json && npx eslint src/features/sellers`
Expected: PASS. Agar mavjud testlardan biri seat'dagi «N / M buyurtma» satrini pinlagan bo'lsa (`grep -n "buyurtma" tests/features/sellersTvBoard.test.tsx`), uni teskarisiga aylantiring va izohda mijozning 2026-09-16 qarorini yozing.

- [ ] **Step 4: Commit**

```bash
git add src/features/sellers/SellersPage.tsx tests/features/sellersTvBoard.test.tsx
git commit -m "feat(sellers): taxtaga lavha va medallar ulandi — seat bloki, narvon, qator, chase

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Marosim — e'lon, yulduz tushishi, yangi medal

**Files:**
- Create: `src/features/sellers/usePromotions.ts`
- Create: `src/features/sellers/PromotionBanner.tsx`
- Modify: `src/features/sellers/SellersPage.tsx` (`BoardColumn` — hooklar, banner, `risingId`, `newMedals`; `Podium`/`PodiumSeat`/`BoardList` — `newKeys`)
- Test: `tests/features/usePromotions.test.tsx` (yangi), `tests/features/sellersTvBoard.test.tsx` (qo'shiladi)

**Interfaces:**
- Consumes: `SellerMedalRowDto`, `MedalCode`, `LADDER`, `Lavha`, `MedalRail`/`RowMedals` ning `newKeys` propi, `ColumnProps.medalsToday`.
- Produces:
  ```ts
  export const PROMOTION_MS = 8_000
  export interface Promotion { employeeId: string; level: number; legendaTier: number; rankTitle: string; thresholdLabel: string }
  export function usePromotions(rows: ReadonlyMap<string, SellerMedalRowDto>, today: string | null): Promotion | null
  export function resetCelebrations(): void          // test seam
  export function useNewMedals(rows: ReadonlyMap<string, SellerMedalRowDto>): ReadonlyMap<string, ReadonlySet<MedalCode>>
  export function PromotionBanner(props: { promotion: Promotion; name: string }): JSX.Element
  ```

- [ ] **Step 1: Hook testlari**

`tests/features/usePromotions.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PROMOTION_MS, resetCelebrations, useNewMedals, usePromotions } from '@/features/sellers/usePromotions'
import type { SellerMedalDto, SellerMedalRowDto } from '@/lib/api'

const uzs = (amount: number) => ({ amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount })
const medal = (code: SellerMedalDto['code']): SellerMedalDto => ({ code, count: 1, at: '2026-09-01', amount: null, orders: null, percent: null })
const row = (employeeId: string, over: Partial<SellerMedalRowDto> = {}): SellerMedalRowDto => ({
  employeeId,
  level: 4,
  legendaTier: 0,
  rankTitle: 'Usta',
  delivered: uzs(101_000_000),
  levelFloor: uzs(100_000_000),
  nextLevelAt: uzs(300_000_000),
  nextTitle: 'Ustoz',
  promotedOn: '2026-09-16',
  medals: [medal('first-sale')],
  ...over,
})
const map = (...rows: SellerMedalRowDto[]) => new Map(rows.map((r) => [r.employeeId, r]))

describe('usePromotions — e‘lon navbati', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCelebrations()
  })
  afterEach(() => vi.useRealTimers())

  it('bugun ko‘tarilgan sotuvchi e‘lon qilinadi, 8 soniyadan keyin jim', () => {
    const rows = map(row('a'))
    const { result } = renderHook(() => usePromotions(rows, '2026-09-16'))
    expect(result.current).toEqual({ employeeId: 'a', level: 4, legendaTier: 0, rankTitle: 'Usta', thresholdLabel: '100 mln' })
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current).toBeNull()
  })

  it('bir xil ko‘tarilish sessiyada IKKI MARTA e‘lon qilinmaydi', () => {
    const rows = map(row('a'))
    const { result, rerender } = renderHook(({ r }) => usePromotions(r, '2026-09-16'), { initialProps: { r: rows } })
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    rerender({ r: map(row('a')) }) // yangi payload, o‘sha daraja
    expect(result.current).toBeNull()
  })

  it('ikki ko‘tarilish navbat bilan, har biri 8 soniya', () => {
    const rows = map(row('a'), row('b', { level: 2, rankTitle: 'Sotuvchi', levelFloor: uzs(10_000_000), nextLevelAt: uzs(30_000_000), nextTitle: 'Katta sotuvchi' }))
    const { result } = renderHook(() => usePromotions(rows, '2026-09-16'))
    const first = result.current!.employeeId
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current).not.toBeNull()
    expect(result.current!.employeeId).not.toBe(first)
    act(() => vi.advanceTimersByTime(PROMOTION_MS))
    expect(result.current).toBeNull()
  })

  it('kecha ko‘tarilgan yoki sana noma‘lum — e‘lon yo‘q', () => {
    expect(renderHook(() => usePromotions(map(row('a', { promotedOn: '2026-09-15' })), '2026-09-16')).result.current).toBeNull()
    expect(renderHook(() => usePromotions(map(row('a')), null)).result.current).toBeNull()
  })

  it('Legenda II ostonasi — «2 mlrd»', () => {
    const rows = map(row('a', { level: 6, legendaTier: 2, rankTitle: 'Legenda II' }))
    const { result } = renderHook(() => usePromotions(rows, '2026-09-16'))
    expect(result.current!.thresholdLabel).toBe('2 mlrd')
  })
})

describe('useNewMedals — oldingi payload bilan farq', () => {
  it('birinchi payload hech narsani «yangi» demaydi; ikkinchisida qo‘shilgan medal yangi', () => {
    const first = map(row('a', { medals: [medal('first-sale')] }))
    const { result, rerender } = renderHook(({ r }) => useNewMedals(r), { initialProps: { r: first } })
    expect(result.current.size).toBe(0)
    rerender({ r: map(row('a', { medals: [medal('first-sale'), medal('day-winner')] })) })
    expect(result.current.get('a')?.has('day-winner')).toBe(true)
    expect(result.current.get('a')?.has('first-sale')).toBe(false)
  })

  it('bo‘sh xaritadan keyingi birinchi to‘liq payload ham yangi emas', () => {
    const { result, rerender } = renderHook(({ r }) => useNewMedals(r), { initialProps: { r: new Map<string, SellerMedalRowDto>() } })
    rerender({ r: map(row('a')) })
    expect(result.current.size).toBe(0)
  })
})
```

`tests/features/sellersTvBoard.test.tsx` ga (fayl boshida `vi` importi va `resetCelebrations` importi kerak: `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'` — mavjud importga `vi`, `afterEach`, `beforeEach` qo'shing; `import { resetCelebrations } from '@/features/sellers/usePromotions'`):

```tsx
describe('ko‘tarilish marosimi', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCelebrations()
  })
  afterEach(() => vi.useRealTimers())

  it('bugun ko‘tarilgan seat: e‘lon ustun sarlavhasida, lavha ko‘tarilish sinfida; 8 soniyadan keyin jim', () => {
    const today = '2026-09-16'
    const medals = new Map(MEDALS)
    medals.set('154 Marjona Xayrullayeva', medalRow('154 Marjona Xayrullayeva', { promotedOn: today }))
    render(<SellersColumn data={RIPE} {...PROPS} medals={medals} medalsToday={today} />)
    const col = column('tv-sellers')
    expect(col.getByRole('status').textContent).toContain('154 Marjona Xayrullayeva — endi USTA · 100 mln')
    expect(document.getElementById('tv-sellers')!.querySelector('.lv-plate--rise')).not.toBeNull()
    act(() => vi.advanceTimersByTime(8_000))
    expect(col.queryByRole('status')).toBeNull()
    expect(document.getElementById('tv-sellers')!.querySelector('.lv-plate--rise')).toBeNull()
  })

  it('kecha ko‘tarilgan — e‘lon yo‘q', () => {
    const medals = new Map(MEDALS)
    medals.set('154 Marjona Xayrullayeva', medalRow('154 Marjona Xayrullayeva', { promotedOn: '2026-09-15' }))
    render(<SellersColumn data={RIPE} {...PROPS} medals={medals} medalsToday="2026-09-16" />)
    expect(column('tv-sellers').queryByRole('status')).toBeNull()
  })
})
```

(`act` importi: `import { act, render, screen, within } from '@testing-library/react'` — fayldagi mavjud importga `act` ni qo'shing.)

Run: `npx vitest run tests/features/usePromotions.test.tsx tests/features/sellersTvBoard.test.tsx`
Expected: FAIL — modul yo'q / e'lon yo'q.

- [ ] **Step 2: `usePromotions.ts`**

```ts
'use client'

import { useEffect, useState } from 'react'

import { LADDER } from '@/features/sellers/medalCatalog'
import type { MedalCode, SellerMedalRowDto } from '@/lib/api'

/**
 * Ko'tarilish — jamoat voqeasi. 40-o'rindagi odam o'z lavhasining sokin
 * animatsiyasini ko'rmaydi; ustun sarlavhasidagi 8 soniyalik e'lonni hamma
 * ko'radi. Manba — serverning `promotedOn` hosila fakti, brauzer xotirasi
 * emas: ikki televizor ham bir xil e'lon qiladi, tozalangan brauzer qayta
 * e'lon qilmaydi (sahifa sessiyasida bir marta — modul darajasidagi to'plam).
 */
export const PROMOTION_MS = 8_000

export interface Promotion {
  readonly employeeId: string
  readonly level: number
  readonly legendaTier: number
  readonly rankTitle: string
  /** «100 mln», «2 mlrd» — e'londa unvon yonida. */
  readonly thresholdLabel: string
}

const celebrated = new Set<string>()

/** Test seam. */
export function resetCelebrations(): void {
  celebrated.clear()
}

function thresholdLabelOf(level: number, legendaTier: number): string {
  if (level === 6 && legendaTier > 1) return `${legendaTier} mlrd`
  return LADDER[level - 1]?.thresholdLabel ?? ''
}

export function usePromotions(
  rows: ReadonlyMap<string, SellerMedalRowDto>,
  today: string | null,
): Promotion | null {
  const [queue, setQueue] = useState<readonly Promotion[]>([])
  const [current, setCurrent] = useState<Promotion | null>(null)

  // Yangi payload — bugungi, hali nishonlanmagan ko'tarilishlar navbatga.
  useEffect(() => {
    if (today === null) return
    const fresh: Promotion[] = []
    for (const row of rows.values()) {
      if (row.promotedOn !== today || row.rankTitle === null) continue
      const key = `${row.employeeId}:${row.level}:${row.legendaTier}`
      if (celebrated.has(key)) continue
      celebrated.add(key)
      fresh.push({
        employeeId: row.employeeId,
        level: row.level,
        legendaTier: row.legendaTier,
        rankTitle: row.rankTitle,
        thresholdLabel: thresholdLabelOf(row.level, row.legendaTier),
      })
    }
    if (fresh.length > 0) setQueue((q) => [...q, ...fresh])
  }, [rows, today])

  // Navbatdan bittasi ekranda; bo'shaganda keyingisi.
  useEffect(() => {
    if (current !== null || queue.length === 0) return
    setCurrent(queue[0]!)
    setQueue((q) => q.slice(1))
  }, [current, queue])

  // Har e'lon 8 soniya — taymer faqat `current` ga bog'liq, navbat
  // o'zgarganda tozalanib ketmaydi (birinchi yozuvdagi xato shu edi).
  useEffect(() => {
    if (current === null) return
    const id = setTimeout(() => setCurrent(null), PROMOTION_MS)
    return () => clearTimeout(id)
  }, [current])

  return current
}

type NewMedals = ReadonlyMap<string, ReadonlySet<MedalCode>>

const keysOf = (rows: ReadonlyMap<string, SellerMedalRowDto>): ReadonlySet<string> => {
  const keys = new Set<string>()
  for (const row of rows.values()) for (const m of row.medals) keys.add(`${row.employeeId}:${m.code}`)
  return keys
}

/**
 * Oxirgi yangilanishda paydo bo'lgan medallar — bir marta kattalashib tushadi.
 * Oldingi payload bilan farq; birinchi (yoki bo'sh xaritadan keyingi birinchi)
 * payload hech narsani «yangi» demaydi. Render vaqtida holatni moslash —
 * React'ning o'z naqshi, effektda setState emas.
 */
export function useNewMedals(rows: ReadonlyMap<string, SellerMedalRowDto>): NewMedals {
  const [snapshot, setSnapshot] = useState<{ rows: ReadonlyMap<string, SellerMedalRowDto>; fresh: NewMedals }>(
    () => ({ rows, fresh: new Map() }),
  )
  if (snapshot.rows !== rows) {
    const fresh = new Map<string, Set<MedalCode>>()
    if (snapshot.rows.size > 0) {
      const before = keysOf(snapshot.rows)
      for (const row of rows.values()) {
        for (const m of row.medals) {
          if (before.has(`${row.employeeId}:${m.code}`)) continue
          const set = fresh.get(row.employeeId) ?? new Set<MedalCode>()
          set.add(m.code)
          fresh.set(row.employeeId, set)
        }
      }
    }
    setSnapshot({ rows, fresh })
    return fresh
  }
  return snapshot.fresh
}
```

- [ ] **Step 3: `PromotionBanner.tsx`**

```tsx
import { Lavha } from '@/features/sellers/Lavha'
import type { Promotion } from '@/features/sellers/usePromotions'

/** Ustun sarlavhasi ostida 8 soniya: yangi lavha, ism, unvon, ostona. */
export function PromotionBanner({ promotion, name }: { promotion: Promotion; name: string }) {
  return (
    <div className="tv-promo" role="status">
      <Lavha level={promotion.level} legendaTier={promotion.legendaTier} size="narvon" />
      <div>
        {name} — endi {promotion.rankTitle.toUpperCase()} · {promotion.thresholdLabel}
        <small>Daraja ko'tarildi — bugun</small>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `SellersPage.tsx` ulash**

(a) Importlar: `import { PromotionBanner } from '@/features/sellers/PromotionBanner'`, `import { useNewMedals, usePromotions } from '@/features/sellers/usePromotions'`, `MedalCode` turi.

(b) `BoardColumn`: `medalsToday` destructure'ga qaytadi; `speaking` dan keyin:

```ts
  const promotion = usePromotions(tone === 'sellers' ? medals : EMPTY_MEDALS, medalsToday)
  const promotedName =
    promotion === null ? null : (entries.find((e) => e.key === promotion.employeeId)?.name ?? null)
  const newMedals = useNewMedals(medals)
```

(`EMPTY_MEDALS` fayl boshida bor — `const EMPTY_MEDALS: ReadonlyMap<string, SellerMedalRowDto> = new Map()`.)

Header: `</div>` (flex qatorining yopilishi) dan keyin, `</header>` dan oldin:

```tsx
        {promotion !== null && promotedName !== null && (
          <PromotionBanner promotion={promotion} name={promotedName} />
        )}
```

Podium: `risingId={promotion?.employeeId ?? null}` va `newMedals={newMedals}`; BoardList (ikkala chaqiruvda): `newMedals={newMedals}`.

(c) `Podium` imzosi: `newMedals: ReadonlyMap<string, ReadonlySet<MedalCode>>`; `PodiumSeat` ga `newKeys={newMedals.get(entry.key)}`; `PodiumSeat` imzosi `newKeys: ReadonlySet<MedalCode> | undefined`; `<MedalRail medals={medal.medals} newKeys={newKeys} />`.

(d) `BoardList` imzosi: `newMedals: ReadonlyMap<string, ReadonlySet<MedalCode>>`; qatorda `<RowMedals medals={…} newKeys={newMedals.get(entry.key)} />`.

- [ ] **Step 5: Testlar**

Run: `npx vitest run tests/features/usePromotions.test.tsx tests/features/sellersTvBoard.test.tsx tests/features/sellersLavha.test.tsx && npx tsc --noEmit -p tsconfig.json && npx eslint src/features/sellers`
Expected: PASS; toza. Agar `react-hooks` plagini `useNewMedals` dagi render-vaqtida `setSnapshot` ga e'tiroz bildirsa (`react-hooks/set-state-in-render` yo'q, lekin bo'lsa) — sabab izohda, `// eslint-disable-next-line` bilan.

- [ ] **Step 6: Commit**

```bash
git add src/features/sellers/usePromotions.ts src/features/sellers/PromotionBanner.tsx src/features/sellers/SellersPage.tsx tests/features/usePromotions.test.tsx tests/features/sellersTvBoard.test.tsx
git commit -m "feat(sellers): ko'tarilish marosimi — 8 soniyalik e'lon, yulduz tushishi, yangi medal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Belgi sayqali — quyosh, nihol, raketa

**Files:**
- Modify: `docs/superpowers/specs/assets/2026-09-16-daraja/medal-defs.html` (`medal-day-winner`, `medal-first-sale`, `medal-rookie` belgilari)
- Modify: `.gitignore` (render chiqishlari)
- Regenerate: `src/features/sellers/medalDefs.ts` (3-vazifa generatori)
- Test: mavjud `tests/features/sellersLavha.test.tsx` (id'lar o'zgarmaydi)

**Interfaces:** o'zgarmaydi — `#medal-day-winner`, `#medal-first-sale`, `#medal-rookie` id'lari va instance markup aynan qoladi.

Hakamlarning 2-raund topilmalari (spec §2 «Qolgan sayqal»): (1) Kun g'olibi quyoshi tojga o'xshaydi va 3 m da panja/kaft bo'lib o'qiladi; (2) Birinchi savdo niholi «Y» bo'lib o'qiladi; (3) Sakrash va Yangi yulduz 3 m da bir xil diagonal.

- [ ] **Step 1: Render tekshiruv vositasini ishga tushirib, joriy holatni ko‘rish**

```bash
printf '\n# medal belgilarining render tekshiruvi (docs/superpowers/plans/2026-09-16-daraja-va-medallar.md, 7-vazifa)\ndocs/superpowers/specs/assets/2026-09-16-daraja/medal-sheet-*\ndocs/superpowers/specs/assets/2026-09-16-daraja/preview-tokens.css\ndocs/superpowers/specs/assets/2026-09-16-daraja/__pycache__/\n' >> .gitignore
python3 docs/superpowers/specs/assets/2026-09-16-daraja/render.py
ls docs/superpowers/specs/assets/2026-09-16-daraja/medal-sheet-*
```

`Read` bilan `medal-sheet-light.png`, `medal-sheet-light-3m.png`, `medal-sheet-dark-3m.png` ni KO'RING. 3 m simulyatsiyasida SPEAKING qatorida 8-medal (Kun g'olibi) bilan 4-medal (Yil chempioni toji) siluetini, 12/13-medal (Yangi yulduz, Birinchi savdo) ni 11-medal (Sakrash) bilan solishtiring.

- [ ] **Step 2: Uch belgini qayta chizish**

`medal-defs.html` dagi uchala `<symbol id="medal-…">` ichida faqat GLIF qismini (24-katakdagi `<path>`/`<circle>` lar, `transform="translate(7 16) scale(.75)"` guruhi ichida) o'zgartiring; lenta, halqa, disk, yaltirash `<use>`lari aynan qoladi. Talablar (render bilan tekshiriladi):

- **Kun g'olibi** (`medal-day-winner`): yarim disk gorizontda TURADI (oraliq yo'q): `M4 14 A8 8 0 0 1 20 14 Z` (markaz 12,14, r 8 — yuqori yarim); gorizont — disk kengligidan oshmasin: `<rect x="4" y="14.5" width="16" height="2.4" rx="1.2"/>`; BESH nur, har biri ≥ 4 birlik, 0 / ±40 / ±80 gradusda, 2.6 qalinlikda, yarim diskdan 2 birlik tashqaridan boshlanadi — masalan tik nur `<rect x="10.7" y="1" width="2.6" height="4.2" rx="1.3"/>`, qolganlari `transform="rotate(±40 12 14)"` va `rotate(±80 12 14)` bilan o'sha rect. Toj (year-champion) uchta uchi + tekis asos; quyosh — yoy + nurlar; 3 m da farq: yoy dumaloq, toj burchakli.
- **Birinchi savdo** (`medal-first-sale`): poya QISQA (`<rect x="11" y="13" width="2.4" height="9" rx="1.2"/>`), ikki barg SEMIZ oval (kenglik/balandlik ≥ 0.55): chap barg `<ellipse cx="7.5" cy="10" rx="5" ry="3.4" transform="rotate(-35 7.5 10)"/>`, o'ng barg `<ellipse cx="16.5" cy="7.5" rx="5" ry="3.4" transform="rotate(35 16.5 7.5)"/>`; pastki bargning tashqi uchi poya o'rtasidan pastda bo'lsin — kerak bo'lsa `cy` ni oshiring. 3 m da «Y» o'qilmasligi shart.
- **Yangi yulduz** (`medal-rookie`): raketa TIK (burun yuqorida, qanotlar pastda, olov ostida), diagonal EMAS — diagonalni Sakrash strelkasi egallaydi. Korpus `<path d="M12 1.5 C15.5 4.5 16.5 9 16.5 13.5 L16.5 17 L7.5 17 L7.5 13.5 C7.5 9 8.5 4.5 12 1.5 Z"/>`, illyuminator har o'lchamda TESHIK (even-odd yoki korpus rangidagi `<circle cx="12" cy="10" r="2.4" fill="var(--m-field)"/>` — `--m-field` disk rangi, ya'ni teshik bo'lib ko'rinadi; `--m-detail` ga bog'lamang), qanotlar `<path d="M7.5 13 L4 18 L7.5 17 Z"/>` va `<path d="M16.5 13 L20 18 L16.5 17 Z"/>`, olov `<path d="M9.5 17.5 L12 22.5 L14.5 17.5 Z"/>`.

Har bir belgida faqat `fill` (stroke ishlatmang, ≥ 2.4 birlik qalinlik qoidasi). Glif rangi mavjud naqsh bo'yicha (`var(--m-glyph)`).

- [ ] **Step 3: Render va ko‘rish**

```bash
python3 docs/superpowers/specs/assets/2026-09-16-daraja/render.py
```

`Read` bilan to'rtala sheet'ni ko'ring. Qabul mezoni: (1) 3 m SPEAKING va SEAT qatorlarida quyosh va toj konturi turlicha, quyosh panjaga o'xshamaydi; (2) nihol «Y»/«V» bo'lib o'qilmaydi; (3) raketa tik, Sakrash strelkasi diagonal — ikkalasi yashil bo'lsa ham izohsiz farqlanadi. Mezon bajarilmasa — geometriyani sozlab qayta render qiling (eng ko'pi uch marta; keyin holatni izoh bilan commit qiling).

- [ ] **Step 4: `medalDefs.ts` ni qayta generatsiya qilish va testlar**

3-vazifa Step 4 dagi `node - <<'JS' … JS` generatorini AYNAN qayta ishga tushiring. So'ng:

Run: `npx vitest run tests/features/sellersLavha.test.tsx tests/features/lavhaCss.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/assets/2026-09-16-daraja/medal-defs.html docs/superpowers/specs/assets/2026-09-16-daraja/render.py src/features/sellers/medalDefs.ts .gitignore
git commit -m "feat(sellers): medal belgilari sayqali — quyosh, nihol, tik raketa (hakam 2-raund)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Gate va jonli tekshirish

**Files:**
- Modify (faqat kerak bo'lsa): topilgan nuqsonlar; `docs/superpowers/specs/2026-09-16-daraja-va-medallar-design.md` «Holat» satri.

- [ ] **Step 1: Gate**

Run: `npm run verify && npm run build && npm run db:check`
Expected: verify yashil (lint + typecheck + testlar); build toza; db:check 10/11 — «deal status agrees with its stage category» 21 ta seed qatori (2026-09-09 dan beri ma'lum, bu ishga aloqasiz; boshqa invariant qizil bo'lsa — to'xtab, hisobot).

- [ ] **Step 2: Jonli tekshirish — 1920 va 1366, yorug‘ va qorong‘i**

Dev server shu worktree'dan 3000-portda ishlayapti (`pgrep -fa 'next dev'`); ishlamasa: `npm run dev -- -p 3000` (better-auth origin 3000 ni talab qiladi). Postgres 5433 ishlayotganini `pg_isready -h 127.0.0.1 -p 5433` bilan tekshiring; ishlamasa `~/pg16/bin/pg_ctl -D ~/pg-sinolife -o "-p 5433 -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp/claude-1000/pg5433" -l ~/pg-sinolife/server.log start`.

Kirish (parolni chop etmasdan):

```bash
set -a; source .env; set +a
curl -s -c /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/cookies.txt -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}" http://localhost:3000/api/auth/sign-in/username -o /dev/null -w '%{http_code}\n'
```

Playwright MCP (`browser_navigate` http://localhost:3000/sellers; cookie'ni `browser_run_code_unsafe` bilan `context.addCookies` orqali yuklang — memory `local-dev-setup` va `medallar-branch-pending` dagi retsept) yoki `chromium-cli`. Skrinshotlar `/home/smack/Work/.playwright-mcp/` ga: `daraja-1920-light.png`, `daraja-1920-dark.png` (qorong'i: `localStorage.setItem('sinolife.theme.v1','dark')` + reload), `daraja-1366-light.png`. Har birini `Read` bilan KO'RING va tekshiring:

- Seat: lavha o'yma unvon bilan, shtamplar, «… qoldi», chempionda sharpa; tokcha; gapiruvchi karta 6 s da almashadi.
- Narvon podium ostida, olti lavha, Legenda ko'k; qorong'ida faxriy lavha fil suyagi.
- Qator: chapda lavha, ism yonida unvon so'zi, o'ngda medallar, chase'da «… ga N mln».
- 1366 da ikki ustun saqlanadi, seat lavhasi kichraygan, hech narsa kesilmagan.
- Hech qanday eski `.pagon` elementi yo'q; konsolda xato yo'q (`browser_console_messages`).

Nuqson topilsa — tuzating, testga pinlang (DOM yoki CSS), commit.

- [ ] **Step 3: Production ma‘lumoti bilan taqqoslash (o‘qish)**

Lokal baza production nusxasi emas. Darajalar taqsimotini spec §1 jadvali bilan solishtirish uchun production'dan o'qing (faqat o'qish; retsept memory `prod-db-direct-read`): `money-ladder-probe.mts` (scratchpad) yoki uning o'rniga `sellerMedalFacts` + yangi `buildSellerMedals` ni production `PrismaClient` bilan chaqiruvchi qisqa skript — natija: 0-daraja 5, Yangi 35, Sotuvchi 25, Katta sotuvchi 47, Usta 14 (2026-09-16 holati; keyingi kunlarda ozgina siljiydi). Farq katta bo'lsa — motorda xato, to'xtab hisobot.

- [ ] **Step 4: Spec holati va commit**

Spec'ning «Holat» satrini «amalga oshirildi — `daraja` branch'i, deploy kutmoqda» ga o'zgartiring.

```bash
git add docs/superpowers/specs/2026-09-16-daraja-va-medallar-design.md
git commit -m "docs: daraja va medallar spec holati — amalga oshirildi

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline origin/main..HEAD
```

`main` ga push YO'Q — mijozning «deploy qil» so'zi kutiladi.
