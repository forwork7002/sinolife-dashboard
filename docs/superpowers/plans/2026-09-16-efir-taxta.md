# EFIR — «Sotuvchilar reytingi» taxtasini qayta dizayn qilish rejasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/sellers` televizor taxtasining «daraja» (lavha-pagon + lentali medal) ko'rinishini EFIR «timing tower» dizayni bilan almashtirish — bitta aksent (muz-ko'k daraja shkalasi), bitta metall, bitta shrift uch o'lchamda; motor, DTO va so'rovlar tegilmaydi.

**Architecture:** Daraja `--tier-1..6` ORDINAL token oilasi orqali komponentga `--tier` bo'lib keladi (`[data-tier]`); har sotuvchi bitta qator (tasma · rank · gerb · ism · medallar · FAKT 2 · FAKT 1 · buyurtma · konv.), top-3 — o'sha qatorning katta o'rindig'i (`SeatCard`); barcha belgilar mock'ning `<defs>` idan generatsiya qilinadi (`#ch` + 12 ta `#m-*`) va sahifaga bir marta `MedalDefs` orqali o'rnatiladi. `SellersPage.tsx` uch faylga bo'linadi: `board.ts` (saralash), `SellersBoard.tsx`, `TeamsBoard.tsx`; rekord devori ikki statik band bo'ladi. Eski LAVHA/MEDAL/DARAJA BLOKI/PODIUM CSS bo'limlari va ularning komponentlari o'chadi.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, TanStack Query, Vitest + Testing Library (jsdom per-file), Tailwind 4 + `globals.css` tokenlari, inline SVG `<symbol>`/`<use>`.

**Spec:** `docs/superpowers/specs/2026-09-16-efir-taxta-design.md` (aktivlar: `docs/superpowers/specs/assets/2026-09-16-efir/efir.html`, `efir-light.html`, `gen_efir.py` — o'lchamlar, kompozitsiya va SVG belgilar uchun BIRLAMCHI manba). Oldingi spec `2026-09-16-daraja-va-medallar-design.md` ning §1 Daraja, §2 medal ro'yxati, §4 Uzatish, §5 Motor bo'limlari o'z kuchida.

## Global Constraints

- Worktree `/home/smack/Work/ISH-medal`, branch `efir` (HEAD — oldingi «daraja» dizayni, shu almashtiriladi). `/home/smack/Work/ISH` ga `cd` qilinmaydi. HECH QACHON `git add -A` — faqat nomlangan fayllar. `main` ga push YO'Q.
- Commit xabari oxirida: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Frontend (`src/features`, `src/lib`, `src/app`) `src/server` dan import qilmaydi; domen lug'atlari frontend'da NUSXA va `Mirrors …` izohi bilan.
- Pul brauzerda `MoneyDto` (`amount` — so'mda `number`); motor (`sellerMedals.ts`), servis DTO, `?include=medals`, 10 daqiqalik kesh tegilmaydi.
- Ranglar komponent CSS'ida faqat `var(--…)` / `color-mix(in oklab, …)`; `--tier-1..6` — ORDINAL oila, komponentlar uni faqat `--tier` orqali o'qiydi (`[data-tier="N"] { --tier: var(--tier-N) }`, 0 → `--border-strong`); `--medal-*` faqat Oy oilasi maydoni, barcha medallarning asosiy oltini (spec §3: qolgan 11 kod ham `--medal-gold`), rank halqalari, metall rank raqamlari, Legenda toji va rekord yorlig'i (`.medal`, `.halo`, `.crest__crown`, `.trow__rank`, `.record__k` — yozilgan istisno ro'yxati); `.tv-row/.row/.seat/.crest/.medal` da `--series-*` yo'q.
- O'lchamlar 1920 da spec §4/§5/§6, 1366 da §9; shrift shkalasi `--tv-xl/l/m/s` 44/24/16/13 (1600 dan tor ekranda 36/20/14/12); raqamlarda `font-variant-numeric: tabular-nums`.
- Pul grammatikasi: butun sahifada to'liq so'm, guruhlar orasida U+202F (`79 600 000`), birlik yozilmaydi; foiz «91,3 %» (vergul, % dan oldin U+202F). «mln»/«MLN»/«so'm» aralashmalari sahifadan ketadi.
- Mavjud o'zbekcha satrlar o'zining U+2018 `‘` / U+02BB `ʻ` apostroflarini saqlaydi; JSX matnida yalang'och `'` yo'q (`react/no-unescaped-entities`); yangi matnda `ʻ` (U+02BB) ishlatiladi.
- DOM testlari birinchi qatorida `// @vitest-environment jsdom`; jsdom da `matchMedia` yo'q — stub kerak (`useReducedMotion`, `useAutoScroll`, `AnimatedNumber` uni chaqiradi).
- Har vazifa oxirida: `npx vitest run <fayl(lar)>` yashil va `npx tsc --noEmit -p tsconfig.json` yashil (tsconfig `tests/**` ni ham tekshiradi). Yakuniy gate: `npm run verify && npm run build && npm run db:check` (db:check 10/11 — «deal status agrees with its stage category» 21 ta seed qatori, 2026-09-09 dan beri ma'lum, bu ishga aloqasiz).
- Tinchlikda hech narsa qimirlamaydi; `prefers-reduced-motion` barcha harakatni o'chiradi; e'lon (`PromotionBanner`) `.tv-col-head` ustida absolyut overlay bo'lib qoladi, kirishi `translate` keyframe bilan (`transform` emas — markazlashtirish o'sha xususiyatda).
- Aktiv fayl (`efir.html`) — belgilarning YAGONA manbasi: `medalDefs.ts` faqat generator bilan yoziladi, TSX'ga qo'lda SVG ko'chirilmaydi.

## Fayl tuzilmasi

| Fayl | Mas'uliyat |
|---|---|
| `src/app/globals.css` | `--tier-1..6`, `--glow-rare`, `--tv-xl/l/m/s` tokenlari; EFIR bo'limi (gerb, medal, halqa, legenda, o'rindiq, qator, komandalar, e'lon, harakat); qayta yozilgan TV BOARD bo'limi; LAVHA/MEDAL/DARAJA BLOKI/PODIUM bo'limlari o'chadi |
| `src/lib/format.ts` | `formatSomFull` (U+202F), `formatPercentUz` («91,3 %») |
| `src/features/sellers/medalDefs.ts` | `EFIR_DEFS` — mock `<defs>` idan generatsiya (`#ch` + 12 `#m-*`) |
| `src/features/sellers/MedalDefs.tsx` | sahifaga bir marta o'rnatiladigan `<svg><defs>` |
| `src/features/sellers/medalCatalog.ts` | nomlar, tartib, `RARE_MEDALS`, `HIDDEN_IN_ROWS`, `MEDAL_SYMBOL`, `MONTH_NUMERAL`, `metalOfMedal`, `LADDER` (+ `thresholdSom`), `thresholdSomOf`, `sortMedals`, `progressOf`, `nextLevelSentence` |
| `src/features/sellers/MedalMark.tsx` | bitta medal: `<svg class="medal" data-medal data-metal>` + Oy raqami + ×N |
| `src/features/sellers/Crest.tsx` | gerb: olti `<use href="#ch">`, `data-tier`, toj, `animate` |
| `src/features/sellers/Halo.tsx` | rank raqami metall halqada; `metalOfRank` |
| `src/features/sellers/TierLegend.tsx` | 28 px «DARAJA» legendasi — olti gerb + so'z + ostona |
| `src/features/sellers/SeatCard.tsx` | o'rindiq (spec §4): halqa, ikki qatorli ism, komanda·gerb·so'z, raqam, progress, medallar; `splitSeatName` |
| `src/features/sellers/RowMedals.tsx` | qator medallari: first-sale yashirin, tartib, 3 + «+N», ×N yo'q |
| `src/features/sellers/board.ts` | `BoardEntry`, `FaktChoice`, `fromSeller`, `fromTeam`, `rankedBy` (servis oynasi), `resolveOnDelivered` |
| `src/features/sellers/FaktSwitch.tsx` | FAKT 1 / FAKT 2 kaliti (siyoh faol segment) |
| `src/features/sellers/ColumnHead.tsx` | 40 px ustun sarlavhasi: nom · soni · kalit · e'lon uyasi |
| `src/features/sellers/SellersBoard.tsx` | sotuvchilar ustuni: podium (3 `SeatCard`), statik yorliq qatori, `<ol>` qatorlar (`useAutoScroll`), legenda, e'lon |
| `src/features/sellers/TeamsBoard.tsx` | komandalar ustuni: yorliq qatori, 62 px bir qatorli qatorlar, ulush chizig'i, pastki jumla |
| `src/features/sellers/SellersPage.tsx` | sahifa: so'rovlar, `MedalDefs`, telefon kaliti, `SellersColumn`/`TeamsColumn` |
| `src/features/sellers/PromotionBanner.tsx` | EFIR e'loni: tasma + gerb + «Ism — endi USTA · 100 000 000» |
| `src/features/sellers/RecordWall.tsx` | ikki statik rekord bandi; ~1500 px dan tor ekranda bittasi, 10 s da kesib almashadi |
| `tests/features/efirFormat.test.ts` | pul grammatikasi |
| `tests/features/efirCss.test.ts` | tokenlar, rang shartnomasi, EFIR bo'limi faktlari |
| `tests/features/sellersEfir.test.tsx` | gerb, medal, halqa, legenda, o'rindiq, qator medallari |
| `tests/features/sellersTvBoard.test.tsx` | taxta: o'rindiq, qatorlar, komandalar, FAKT kaliti, marosim, yangi medal |
| `tests/features/tvBoardLayout.test.ts` | 1280 chegarasi, skroll qutisi, telefon yig'ilishi |
| `tests/features/recordWall.test.tsx`, `tests/features/recordWallCss.test.ts` | rekord devori statik, tor ekranda kesish |
| o'chadi | `Lavha.tsx`, `Medal.tsx`, `LevelBlock.tsx`, `MedalRail.tsx`, `SpeakingMedal.tsx`, `Narvon.tsx`, `useMedalRotation.ts`, `medalReason.ts`; `tests/features/sellersLavha.test.tsx`, `lavhaCss.test.ts`, `useMedalRotation.test.ts`; `docs/superpowers/specs/assets/2026-09-16-daraja/` |

**Vazifa chegaralari haqida (foydalanuvchi shaklidan farqi, sababi bilan):** `BoardColumn` ikkala ustunga xizmat qiladi va eski o'rindiq komponentlarini import qiladi — komandalar ustunini eski kodda qoldirib sotuvchilar ustunini almashtirib bo'lmaydi. Shuning uchun ikkala ustun 4-vazifada birga almashadi (`SellersBoard` + `TeamsBoard`), eski fayllar va ularning CSS bo'limlari ham o'sha yerda o'chadi (har o'chirilgan faylning oxirgi importeri — `SellersPage.tsx` — o'sha commit'da qayta yoziladi). 3-vazifa faqat qo'shadi (`SeatCard`, yangi `RowMedals`) va eski testlarga uchta kichik yamoq beradi. 2-vazifa EFIR bo'limini eski bo'limlar OLDIGA emas, ular bilan TV BOARD orasiga qo'shadi va `lavhaCss.test.ts` ni o'sha yerda o'chiradi (uning «`--medal-*` faqat Oy qoidasida» tekshiruvi EFIR'ning oltin medallari bilan zid). 5-vazifa rekord devori va sahifa sarlavhasi bilan qoladi; FAKT kalitining siyoh bo'yog'i 4-vazifaga o'tdi, chunki TV BOARD bo'limi o'sha yerda butunlay qayta yoziladi.

---

### Task 1: Tokenlar, shrift shkalasi, pul grammatikasi

**Files:**
- Modify: `src/app/globals.css` — uchala token bloki (`:root {` yorug' blok, `@media (prefers-color-scheme: dark)` bloki, `:root[data-theme="dark"]` bloki — har birida `--medal-bronze` satridan keyin); `.tv-col` qoidasi (TV BOARD bo'limi, `--tv-name:` satrlaridan boshlab); `@media (min-width: 1280px) and (max-width: 1599px)` bloki; `.tv-fakt-tab`, `.tv-seat-name`, `.tv-seat-figure`, `.tv-rank`, `.tv-name`, `.tv-money`, `.tv-small` qoidalari; `.tv-seat--2 { --tv-seat-scale` / `.tv-seat--3 { --tv-seat-scale` satrlari
- Modify: `src/lib/format.ts` — `formatUzs` dan keyin
- Modify: `tests/features/tvBoardLayout.test.ts` — `it('steps the seat type down …')`
- Test: `tests/features/efirFormat.test.ts` (yangi), `tests/features/efirCss.test.ts` (yangi)

**Interfaces:**
- Consumes: hech narsa.
- Produces:
  ```ts
  // src/lib/format.ts
  export const NARROW_NBSP = ' '
  export function formatSomFull(amount: number): string        // 79600000 → '79 600 000'
  export function formatPercentUz(value: number | null, digits = 1): string  // 91.3 → '91,3 %', 100 → '100 %', null → '—'
  ```
  CSS tokenlar: `--tier-1 … --tier-6`, `--glow-rare` (uchala blokda); `--tv-xl`, `--tv-l`, `--tv-m`, `--tv-s` (`:root` da, `@media (max-width: 1599px)` da kichik shkala). Eski `--tv-name/--tv-money/--tv-small/--tv-seat-scale/--tv-seat-name/--tv-seat-figure` YO'Q.

- [ ] **Step 1: Pul grammatikasi testi**

`tests/features/efirFormat.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { NARROW_NBSP, formatPercentUz, formatSomFull } from '@/lib/format'

/**
 * EFIR pul grammatikasi (spec §1): butun sahifada to'liq so'm, guruhlar
 * orasida U+202F, birlik yozilmaydi; foiz vergul bilan va % dan oldin U+202F.
 * Mock (`gen_efir.py`: `money()` va `pct()`) — manba.
 */
describe('formatSomFull — to‘liq so‘m, U+202F guruhlar', () => {
  it('79 600 000', () => {
    expect(formatSomFull(79_600_000)).toBe(`79${NARROW_NBSP}600${NARROW_NBSP}000`)
    expect(NARROW_NBSP).toBe(' ')
  })

  it('ming va yuzlar: 1 234 · 999 · 0', () => {
    expect(formatSomFull(1_234)).toBe(`1${NARROW_NBSP}234`)
    expect(formatSomFull(999)).toBe('999')
    expect(formatSomFull(0)).toBe('0')
  })

  it('yaxlitlaydi va manfiyni saqlaydi', () => {
    expect(formatSomFull(0.01)).toBe('0')
    expect(formatSomFull(1_000_000_000.4)).toBe(`1${NARROW_NBSP}000${NARROW_NBSP}000${NARROW_NBSP}000`)
    expect(formatSomFull(-2_500)).toBe(`-2${NARROW_NBSP}500`)
  })

  it('birlik yo‘q — «so‘m» satrda uchramaydi', () => {
    expect(formatSomFull(5_100_000)).not.toMatch(/so/)
  })
})

describe('formatPercentUz — «91,3 %»', () => {
  it('bir o‘nlik, vergul, U+202F va %', () => {
    expect(formatPercentUz(91.3)).toBe(`91,3${NARROW_NBSP}%`)
    expect(formatPercentUz(72.25)).toBe(`72,3${NARROW_NBSP}%`)
  })

  it('butun son o‘nliksiz: 100 % · 95 % · 0 %', () => {
    expect(formatPercentUz(100)).toBe(`100${NARROW_NBSP}%`)
    expect(formatPercentUz(95.0)).toBe(`95${NARROW_NBSP}%`)
    expect(formatPercentUz(0)).toBe(`0${NARROW_NBSP}%`)
  })

  it('null va cheksizlik — chiziqcha', () => {
    expect(formatPercentUz(null)).toBe('—')
    expect(formatPercentUz(Number.NaN)).toBe('—')
  })

  it('nol bo‘lmagan mayda qiymat nol deb yozilmaydi — «<0,1 %»', () => {
    expect(formatPercentUz(0.02)).toBe(`<0,1${NARROW_NBSP}%`)
  })
})
```

- [ ] **Step 2: Testni ishga tushirish — qizil**

Run: `npx vitest run tests/features/efirFormat.test.ts`
Expected: FAIL — `formatSomFull`/`formatPercentUz`/`NARROW_NBSP` `@/lib/format` da yo'q.

- [ ] **Step 3: `format.ts` ga formatlovchilarni qo‘shish**

`src/lib/format.ts` da `export function formatUzs(amount: number): string { … }` funksiyasidan KEYIN (va `formatNumber` dan oldin) qo'shing:

```ts
/**
 * U+202F NARROW NO-BREAK SPACE — the EFIR board's group separator.
 *
 * A narrow non-breaking space rather than the house `,`: the sellers board
 * prints every figure in full at 24–44 px and reads it from across a room,
 * where «79,600,000» is a string of commas and «79 600 000» is three groups.
 * Non-breaking, so a figure never wraps inside itself. Exported for the
 * tests, which spell the expected strings with it.
 */
export const NARROW_NBSP = ' '

/**
 * Full soʻm for the EFIR board — «79 600 000», U+202F groups, no unit.
 *
 * ONE FORMATTER FOR THE WHOLE PAGE (spec §1): the seat's figure, the row's
 * two facts, the progress sentence, the legend's thresholds and the record
 * wall all go through this, so no reader ever has to reconcile «106 mln»
 * beside «106 432 000». Rounds like `formatFullUzs`; money arrives exact.
 */
export function formatSomFull(amount: number): string {
  const rounded = Math.round(amount)
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP)
  return rounded < 0 ? `-${digits}` : digits
}

/**
 * A percentage the Uzbek way — «91,3 %»: comma decimal, U+202F before the
 * sign, and no trailing «,0». Same honesty rule as `formatPercent`: a value
 * that would round to zero without being zero prints «<0,1 %».
 */
export function formatPercentUz(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return NO_VALUE

  const smallest = 0.5 / 10 ** digits
  if (value !== 0 && Math.abs(value) < smallest) {
    const floor = (smallest * 2).toFixed(digits).replace('.', ',')
    return `${value < 0 ? '>-' : '<'}${floor}${NARROW_NBSP}%`
  }

  const fixed = value.toFixed(digits)
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
  return `${trimmed.replace('.', ',')}${NARROW_NBSP}%`
}
```

`NO_VALUE` fayl pastida e'lon qilingan — funksiya chaqirilganda mavjud, `const` ko'tarilishi bu yerda muammo emas.

- [ ] **Step 4: Testni ishga tushirish — yashil**

Run: `npx vitest run tests/features/efirFormat.test.ts`
Expected: PASS (9 ta test).

- [ ] **Step 5: CSS test skeleti**

`tests/features/efirCss.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * EFIR taxtasining stylesheet faktlari — `theme.test.ts` naqshi: hech biri
 * TypeScript'dan ko'rinmaydi va buzilishi jim. Fayl vazifalar bo'ylab o'sadi.
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

const from = (marker: string) => {
  const i = CSS.indexOf(marker)
  expect(i, `${marker} yo'q`).toBeGreaterThan(-1)
  return i
}

/** Uchala token bloki: yorug' `:root`, tizim-qorong'i media bloki, majburiy qorong'i. */
const LIGHT = CSS.slice(from(':root {\n  color-scheme: light;'), from('@media (prefers-color-scheme: dark)'))
const SYSTEM_DARK = CSS.slice(from('@media (prefers-color-scheme: dark)'), from(':root[data-theme="dark"]'))
const FORCED_DARK = CSS.slice(from(':root[data-theme="dark"]'), from('@theme inline'))

describe('EFIR tokenlari — uchala blokda', () => {
  it('`--tier-1..6` yorug‘ blokda, yorug‘lik tartibida', () => {
    const light = ['#3a4557', '#4a6085', '#2b86c2', '#2bb1ee', '#8ed3f5', '#c9ecff']
    light.forEach((hex, i) => expect(LIGHT).toContain(`--tier-${i + 1}: ${hex};`))
  })

  it('`--tier-1..6` ikkala qorong‘i blokda bir xil va yorug‘ blokdan boshqa', () => {
    const dark = ['#3f4a5c', '#506480', '#3e8fc4', '#7fd0ff', '#bde8ff', '#f2fbff']
    dark.forEach((hex, i) => {
      expect(SYSTEM_DARK).toContain(`--tier-${i + 1}: ${hex};`)
      expect(FORCED_DARK).toContain(`--tier-${i + 1}: ${hex};`)
      expect(LIGHT).not.toContain(`--tier-${i + 1}: ${hex};`)
    })
  })

  it('oila ORDINAL deb hujjatlashtirilgan — `--seq` uslubida, seriya emas', () => {
    expect(LIGHT).toMatch(/ORDINAL/)
    expect(LIGHT).toMatch(/never a series/i)
  })

  it('nodir medal soyasi: yorug‘da shaffof, qorong‘ida oltin aralashmasi', () => {
    expect(LIGHT).toContain('--glow-rare: transparent;')
    expect(SYSTEM_DARK).toContain('--glow-rare: color-mix(in oklab, var(--medal-gold) 55%, transparent);')
    expect(FORCED_DARK).toContain('--glow-rare: color-mix(in oklab, var(--medal-gold) 55%, transparent);')
  })
})

describe('EFIR shrift shkalasi', () => {
  it('`--tv-xl/l/m/s` 44/24/16/13 `:root` da, 1600 dan tor ekranda 36/20/14/12', () => {
    expect(LIGHT).toContain('--tv-xl: 44px;')
    expect(LIGHT).toContain('--tv-l: 24px;')
    expect(LIGHT).toContain('--tv-m: 16px;')
    expect(LIGHT).toContain('--tv-s: 13px;')
    const narrow = CSS.slice(from('@media (max-width: 1599px) {\n  :root {'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n') + 3)
    for (const line of ['--tv-xl: 36px;', '--tv-l: 20px;', '--tv-m: 14px;', '--tv-s: 12px;']) {
      expect(block).toContain(line)
    }
  })

  it('eski `--tv-name/--tv-money/--tv-small/--tv-seat-*` clamplari yo‘q', () => {
    for (const token of ['--tv-name', '--tv-money', '--tv-small', '--tv-seat-scale', '--tv-seat-name', '--tv-seat-figure']) {
      expect(CSS, token).not.toContain(`${token}:`)
      expect(CSS, token).not.toContain(`var(${token})`)
    }
  })
})
```

- [ ] **Step 6: CSS testini ishga tushirish — qizil**

Run: `npx vitest run tests/features/efirCss.test.ts`
Expected: FAIL — `--tier-1` yo'q, `--tv-xl` yo'q, eski `--tv-name` bor.

- [ ] **Step 7: Tokenlarni uchala blokka qo‘shish**

`src/app/globals.css` da UCH joyda, har birida `--medal-bronze: …;` satridan keyin quyidagini qo'shing (uchala blok ham `--medal-bronze` satrini o'z ichida tashiydi — `grep -n -- '--medal-bronze' src/app/globals.css` uchta satr beradi).

Yorug' blokda (`--medal-bronze: #a5663a;` dan keyin):

```css

  /**
   * Level ramp for the sellers board — `--tier-1` … `--tier-6`.
   *
   * ORDINAL, like `--seq`: one hue (ice blue) ordered by LIGHTNESS, so a
   * higher level is always the lighter cell and the ramp reads as a ladder
   * from across a room. Never a series colour, never a status, never mixed
   * with the medal metals. Components read it only through `--tier`, which
   * `[data-tier="N"]` sets in the EFIR section; nothing reads `--tier-N`
   * directly. The polarity is the same in both themes — Usta is lighter than
   * Katta sotuvchi on a dark stage and on a light one — so the family is
   * re-anchored per theme rather than inverted. (`--tier-4` on the dark
   * stage sits near `--seq-550`, which is why the ORDINAL note exists.)
   */
  --tier-1: #3a4557;
  --tier-2: #4a6085;
  --tier-3: #2b86c2;
  --tier-4: #2bb1ee;
  --tier-5: #8ed3f5;
  --tier-6: #c9ecff;

  /* The soft gold under the seven rare medals — dark stage only; daylight
     has no glow. Read in exactly one place: `.medal.rare`. */
  --glow-rare: transparent;

  /**
   * The television board's type scale — three information sizes and one
   * caption size (spec §1): xl the seat figure, l names and money, m the
   * secondary line, s captions. Declared on :root rather than on the board,
   * because the record wall in the page header shares the scale. Narrower
   * than 1600px (a 1366 laptop, a 720p panel, a phone) the four step down
   * together — see the media block after the dark tokens.
   */
  --tv-xl: 44px;
  --tv-l: 24px;
  --tv-m: 16px;
  --tv-s: 13px;
```

`@media (prefers-color-scheme: dark)` blokida (`--medal-bronze: #d89a68;` dan keyin, `--shadow-card` dan oldin):

```css

    /* Level ramp, re-anchored for the dark stage — same lightness ORDER as
       the light block (Usta lighter than Katta sotuvchi), lighter values
       because the stage is near-black. See the light block. */
    --tier-1: #3f4a5c;
    --tier-2: #506480;
    --tier-3: #3e8fc4;
    --tier-4: #7fd0ff;
    --tier-5: #bde8ff;
    --tier-6: #f2fbff;

    --glow-rare: color-mix(in oklab, var(--medal-gold) 55%, transparent);
```

`:root[data-theme="dark"]` blokida (`--medal-bronze: #d89a68;` dan keyin, `--shadow-card` dan oldin):

```css

  /* Level ramp — kept in lockstep with the media-query block above. */
  --tier-1: #3f4a5c;
  --tier-2: #506480;
  --tier-3: #3e8fc4;
  --tier-4: #7fd0ff;
  --tier-5: #bde8ff;
  --tier-6: #f2fbff;

  --glow-rare: color-mix(in oklab, var(--medal-gold) 55%, transparent);
```

So'ng `:root[data-theme="dark"] { … }` blokining yopuvchi `}` dan KEYIN, `/**\n * Page identity.` izohidan OLDIN qo'shing:

```css

/*
 * The television scale, narrower than 1600px: 36/20/14/12. One query for
 * the four, so a 1366 laptop and a 720p panel get the same board a step
 * smaller rather than four sizes that drift apart.
 */
@media (max-width: 1599px) {
  :root {
    --tv-xl: 36px;
    --tv-l: 20px;
    --tv-m: 14px;
    --tv-s: 12px;
  }
}
```

- [ ] **Step 8: Eski `--tv-*` o‘quvchilarini yangi shkalaga o‘tkazish**

Hammasi `src/app/globals.css` ning TV BOARD bo'limida (`grep -n -- '--tv-' src/app/globals.css` bilan har birini toping). Har juftlik — AYNAN eski matn → yangi matn:

1. `.tv-col { … }` qoidasida oltita satrni o'chiring:
   ```css
     --tv-name: clamp(13px, 0.88vw, 18px);
     --tv-money: clamp(13px, 0.88vw, 18px);
     --tv-small: clamp(11px, 0.62vw, 13px);
     --tv-seat-scale: 1;
     --tv-seat-name: clamp(14px, calc(1.05vw * var(--tv-seat-scale)), 21px);
     --tv-seat-figure: clamp(17px, calc(1.35vw * var(--tv-seat-scale)), 28px);
   ```
   (o'rniga hech narsa — shkala endi `:root` da).
2. `.tv-fakt-tab { … font-size: var(--tv-small);` → `font-size: var(--tv-s);`
3. `@media (min-width: 1280px) and (max-width: 1599px) {` blokida:
   ```css
     .tv-col {
       --tv-seat-name: clamp(12px, calc(0.95vw * var(--tv-seat-scale)), 16px);
       --tv-seat-figure: clamp(13px, calc(1.05vw * var(--tv-seat-scale)), 18px);
     }
   ```
   ni butunlay o'chiring (blokda `.tv-col-optional { display: none; }` qoladi).
4. `.tv-seat--2 { --tv-seat-scale: 0.9; }` va `.tv-seat--3 { --tv-seat-scale: 0.82; }` — ikkala satrni o'chiring.
5. `.tv-seat-name { font-size: var(--tv-seat-name);` → `font-size: var(--tv-m);`
6. `.tv-seat-figure { … font-size: var(--tv-seat-figure);` → `font-size: var(--tv-l);`
7. `.tv-rank { … font-size: var(--tv-money);` → `font-size: var(--tv-m);`
8. `.tv-name { font-size: var(--tv-name);` → `font-size: var(--tv-m);`
9. `.tv-money { font-size: var(--tv-money);` → `font-size: var(--tv-m);`
10. `.tv-small { font-size: var(--tv-small);` → `font-size: var(--tv-s);`

(5–10 — o'tkinchi: eski o'rindiq va jadval 4-vazifada butunlay o'chadi; bu yerda ular eng yaqin yangi o'lchamga o'tkaziladi, tokenlar ikki marta e'lon qilinmasin deb.)

Tekshiruv: `grep -n -E -- '--tv-(name|money|small|seat-)' src/app/globals.css` → faqat izohlardagi (`* …`) satrlar qolishi mumkin; qoida satri bo'lmasin. Izohdagi eslatmalar ham o'chirilsin: `.tv-col` bannerining «SIZED FROM THE VIEWPORT …» abzatsidagi `--tv-*` so'zi qoladi (token nomi emas), lekin RECORD WALL banneridagi «It cannot borrow the `--tv-*` tokens — those are declared on `.tv-col`» ikki jumlasini «It shares the `--tv-*` scale declared on :root.» bilan almashtiring.

- [ ] **Step 9: `tvBoardLayout.test.ts` ning bitta testini yangilash**

`tests/features/tvBoardLayout.test.ts` da `it('steps the seat type down over the narrow two-column band only', …)` blokini butunlay quyidagi bilan almashtiring:

```ts
  it('steps the television scale down under 1600 and drops the two desk columns over the narrow band', () => {
    expect(css).toMatch(/@media \(max-width: 1599px\) \{\s*:root \{\s*--tv-xl: 36px;/)
    expect(css).toMatch(
      /@media \(min-width: 1280px\) and \(max-width: 1599px\) \{[\s\S]*?\.tv-col-optional \{\s*display: none;/,
    )
  })
```

- [ ] **Step 10: Testlar va tur tekshiruvi**

Run: `npx vitest run tests/features/efirCss.test.ts tests/features/efirFormat.test.ts tests/features/tvBoardLayout.test.ts tests/features/theme.test.ts tests/features/recordWallCss.test.ts tests/features/lavhaCss.test.ts`
Expected: PASS — hammasi.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: xatosiz.

- [ ] **Step 11: Commit**

```bash
git add src/app/globals.css src/lib/format.ts tests/features/efirFormat.test.ts tests/features/efirCss.test.ts tests/features/tvBoardLayout.test.ts
git commit -m "feat(sellers): EFIR tokenlari — --tier-1..6, --tv-xl/l/m/s shkalasi, to'liq so'm va «91,3 %» formatlovchilari

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 2: Belgilar va katalog — `#ch`, 12 ta `#m-*`, `Crest`, `MedalMark`, `Halo`, `TierLegend`

**Files:**
- Regenerate: `src/features/sellers/medalDefs.ts` (generator bilan, `efir.html` dan)
- Modify: `src/features/sellers/MedalDefs.tsx` (butunlay)
- Modify: `src/features/sellers/medalCatalog.ts` — import satri, `LadderRung`/`LADDER`, fayl oxiriga yangi eksportlar
- Create: `src/features/sellers/MedalMark.tsx`, `src/features/sellers/Crest.tsx`, `src/features/sellers/Halo.tsx`, `src/features/sellers/TierLegend.tsx`
- Modify: `src/app/globals.css` — EFIR bo'limi (1-bo'lak) DARAJA BLOKI bilan TV BOARD bannerlari ORASIGA
- Modify: `tests/features/sellersLavha.test.tsx` — `describe('MedalDefs — …')` bloki o'chadi; `tests/features/sellersTvBoard.test.tsx` — `#khatam` → `#ch`
- Delete: `tests/features/lavhaCss.test.ts` (sababi: uning «`--medal-*` faqat Oy qoidasida» tekshiruvi EFIR'ning oltin medallari va halqalari bilan zid; omon qolgan tekshiruvlari `efirCss.test.ts` ga ko'chadi — shu vazifada)
- Test: `tests/features/sellersEfir.test.tsx` (yangi), `tests/features/efirCss.test.ts` (kengayadi)

**Interfaces:**
- Consumes: `formatSomFull`, `NARROW_NBSP` (1-vazifa); `MEDALS`, `MEDAL_ORDER`, `LADDER`, `levelTitle` (mavjud katalog).
- Produces:
  ```ts
  // medalDefs.ts
  export const EFIR_DEFS: string                               // `<path id="ch">` + 12 `<symbol id="m-…">`
  // medalCatalog.ts (mavjudlarga qo'shimcha)
  export type Metal = 'gold' | 'silver' | 'bronze'
  export const RARE_MEDALS: ReadonlySet<MedalCode>             // 7 ta
  export const HIDDEN_IN_ROWS: readonly MedalCode[]            // ['first-sale']
  export const MEDAL_SYMBOL: Readonly<Record<MedalCode, string>>   // 'streak-fire' → 'm-fire'
  export const MONTH_NUMERAL: Readonly<Partial<Record<MedalCode, '1' | '2' | '3'>>>
  export const LEGENDA_STEP_SOM = 1_000_000_000
  export function metalOfMedal(code: MedalCode): Metal
  export function sortMedals(medals: readonly SellerMedalDto[], hide?: readonly MedalCode[]): readonly SellerMedalDto[]
  export function thresholdSomOf(level: number, legendaTier: number): number | null
  export interface LadderRung { level; title; thresholdLabel; thresholdSom: number | null }  // thresholdSom yangi
  // Crest.tsx
  export type CrestSize = 'row' | 'seat' | 'legend'
  export function Crest(props: { level: number; legendaTier?: number; size: CrestSize; animate?: boolean }): JSX
  //   → <svg class="crest crest--SIZE" data-tier="0..6" role="img" aria-label="4-daraja · Usta">, 6× <use href="#ch" class="on|off">, toj `.crest__crown` (level ≥ 6), animate → eng yangi katakcha `.crest__cell--fill`
  // MedalMark.tsx
  export function MedalMark(props: { code: MedalCode; count?: number; size?: number; isNew?: boolean }): JSX
  //   → <svg class="medal [rare] [medal--new]" data-medal data-metal role="img" aria-label>; count>1 → <span class="medal-group">svg<b class="medal-count">×N</b></span>
  // Halo.tsx
  export type HaloMetal = Metal | 'none'
  export function metalOfRank(rank: number): HaloMetal
  export function Halo(props: { rank: number; size: 'lg' | 'md' }): JSX   // <span class="halo halo--lg" data-metal>N</span>
  // TierLegend.tsx
  export function TierLegend(): JSX   // <div class="tv-legend" role="list"> + 6× <span class="legend__rung" role="listitem" data-tier>
  ```
  CSS: `[data-tier="N"] { --tier: … }`, `.crest*`, `.medal*`, `.halo*`, `.tv-legend`, `.legend__rung`, kamaytirilgan harakat bloki (markeri: `/* EFIR — kamaytirilgan harakat`).

- [ ] **Step 1: Komponent testlari**

`tests/features/sellersEfir.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Crest } from '@/features/sellers/Crest'
import { Halo, metalOfRank } from '@/features/sellers/Halo'
import { MedalDefs } from '@/features/sellers/MedalDefs'
import { MedalMark } from '@/features/sellers/MedalMark'
import { TierLegend } from '@/features/sellers/TierLegend'
import {
  HIDDEN_IN_ROWS,
  LADDER,
  MEDALS,
  MEDAL_ORDER,
  MEDAL_SYMBOL,
  MONTH_NUMERAL,
  RARE_MEDALS,
  metalOfMedal,
  sortMedals,
  thresholdSomOf,
} from '@/features/sellers/medalCatalog'
import type { SellerMedalDto } from '@/lib/api'
import { NARROW_NBSP } from '@/lib/format'

/**
 * EFIR belgilari (spec §2, §3): gerb — olti chevron, daraja `--tier` orqali;
 * medal — bitta metall, gravyura; halqa — rank raqami metallda; legenda —
 * olti pog'ona to'liq so'mda. Bu yerda faqat komponentlar; taxtaga ulanish
 * `sellersTvBoard.test.tsx` da.
 */
const S = NARROW_NBSP

describe('MedalDefs — sahifaga bir marta o‘rnatiladigan belgilar to‘plami', () => {
  it('#ch chevroni va 12 ta #m-* belgisi — 14 kod uchun (Oy oilasi bitta diskni bo‘lishadi)', () => {
    const { container } = render(<MedalDefs />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('path#ch')).not.toBeNull()
    expect(container.querySelector('path#ch')!.getAttribute('d')).toBe('M0 0H7L12 10L7 20H0L5 10Z')
    const ids = new Set(Object.values(MEDAL_SYMBOL))
    expect(ids.size).toBe(12)
    for (const id of ids) expect(container.querySelector(`symbol#${id}`), id).not.toBeNull()
    expect(container.querySelectorAll('symbol')).toHaveLength(12)
    // Eski lavha va lentali medal belgilari yo'q.
    expect(container.querySelector('#khatam')).toBeNull()
    expect(container.querySelector('#medal-month-gold')).toBeNull()
  })
})

describe('Crest — gerb', () => {
  it('yoniq katakchalar soni = daraja; qolganlari o‘chiq; data-tier va aria', () => {
    const { container } = render(<Crest level={4} size="row" />)
    const svg = container.querySelector('svg.crest.crest--row')!
    expect(svg.getAttribute('data-tier')).toBe('4')
    expect(svg.getAttribute('viewBox')).toBe('0 -1 66 22')
    expect(svg.querySelectorAll('use[href="#ch"]')).toHaveLength(6)
    expect(svg.querySelectorAll('use.on')).toHaveLength(4)
    expect(svg.querySelectorAll('use.off')).toHaveLength(2)
    expect(svg.getAttribute('aria-label')).toBe('4-daraja · Usta')
    expect(svg.querySelector('.crest__crown')).toBeNull()
  })

  it('katakchalar x = 0/11/22/33/44/55', () => {
    const { container } = render(<Crest level={2} size="row" />)
    expect([...container.querySelectorAll('use')].map((u) => u.getAttribute('x'))).toEqual([
      '0', '11', '22', '33', '44', '55',
    ])
  })

  it('o‘lchamlar: qator 60×20, o‘rindiq 78×26, legenda 42×14', () => {
    const { container } = render(
      <>
        <Crest level={1} size="row" />
        <Crest level={1} size="seat" />
        <Crest level={1} size="legend" />
      </>,
    )
    const [row, seat, legend] = container.querySelectorAll('svg.crest')
    expect([row!.getAttribute('width'), row!.getAttribute('height')]).toEqual(['60', '20'])
    expect([seat!.getAttribute('width'), seat!.getAttribute('height')]).toEqual(['78', '26'])
    expect([legend!.getAttribute('width'), legend!.getAttribute('height')]).toEqual(['42', '14'])
    expect(seat!.classList.contains('crest--seat')).toBe(true)
  })

  it('Legenda: oltita yoniq va oltinchi katakcha ustida toj; Legenda II aria', () => {
    const { container } = render(<Crest level={6} legendaTier={2} size="seat" />)
    const svg = container.querySelector('svg.crest')!
    expect(svg.querySelectorAll('use.on')).toHaveLength(6)
    expect(svg.querySelector('path.crest__crown')).not.toBeNull()
    expect(svg.getAttribute('aria-label')).toBe('6-daraja · Legenda II')
  })

  it('0-daraja: hammasi o‘chiq, data-tier="0", «Hali darajasiz»', () => {
    const { container } = render(<Crest level={0} size="row" />)
    const svg = container.querySelector('svg.crest')!
    expect(svg.getAttribute('data-tier')).toBe('0')
    expect(svg.querySelectorAll('use.on')).toHaveLength(0)
    expect(svg.querySelectorAll('use.off')).toHaveLength(6)
    expect(svg.getAttribute('aria-label')).toBe('Hali darajasiz')
  })

  it('animate — faqat ENG YANGI katakcha to‘lish sinfini oladi', () => {
    const { container } = render(<Crest level={4} size="seat" animate />)
    const fills = container.querySelectorAll('use.crest__cell--fill')
    expect(fills).toHaveLength(1)
    expect(fills[0]!.getAttribute('x')).toBe('33')
    expect(fills[0]!.classList.contains('on')).toBe(true)
  })
})

describe('MedalMark — bitta medal', () => {
  it('kod data-medal da, belgi href da, metall data-metal da; nomi bir marta', () => {
    const { container } = render(<MedalMark code="streak-fire" />)
    const svg = container.querySelector('svg.medal')!
    expect(svg.getAttribute('data-medal')).toBe('streak-fire')
    expect(svg.getAttribute('data-metal')).toBe('gold')
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('width')).toBe('24')
    expect(svg.querySelector('use')!.getAttribute('href')).toBe('#m-fire')
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Olov seriyasi')
    expect(svg.querySelector('text')).toBeNull()
    expect(container.querySelector('.medal-count')).toBeNull()
  })

  it('Oy oilasi: bitta disk, o‘yma 1/2/3 raqami, o‘z metalli', () => {
    const { container } = render(
      <>
        <MedalMark code="month-gold" />
        <MedalMark code="month-silver" />
        <MedalMark code="month-bronze" />
      </>,
    )
    const [g, s, b] = container.querySelectorAll('svg.medal')
    for (const m of [g, s, b]) expect(m!.querySelector('use')!.getAttribute('href')).toBe('#m-month')
    expect(g!.querySelector('text.medal__num')!.textContent).toBe('1')
    expect(s!.querySelector('text.medal__num')!.textContent).toBe('2')
    expect(b!.querySelector('text.medal__num')!.textContent).toBe('3')
    expect(g!.querySelector('text')!.getAttribute('text-anchor')).toBe('middle')
    expect([g, s, b].map((m) => m!.getAttribute('data-metal'))).toEqual(['gold', 'silver', 'bronze'])
    expect(g!.getAttribute('aria-label')).toBe('Oy chempioni')
  })

  it('×N faqat count > 1 da, svg TASHQARISIDA; aria nomga ×N qo‘shadi', () => {
    const { container, rerender } = render(<MedalMark code="day-winner" count={4} />)
    const group = container.querySelector('.medal-group')!
    expect(group.querySelector('svg.medal')).not.toBeNull()
    expect(group.querySelector('b.medal-count')!.textContent).toBe('×4')
    expect(group.querySelector('svg .medal-count')).toBeNull()
    expect(group.querySelector('svg')!.getAttribute('aria-label')).toBe('Kun gʻolibi ×4')
    rerender(<MedalMark code="day-winner" count={1} />)
    expect(container.querySelector('.medal-group')).toBeNull()
    expect(container.querySelector('.medal-count')).toBeNull()
  })

  it('nodir yettilik `rare` sinfini oladi, qolganlari olmaydi', () => {
    const { container } = render(
      <>
        <MedalMark code="day-record" />
        <MedalMark code="work-month" />
      </>,
    )
    const [rare, plain] = container.querySelectorAll('svg.medal')
    expect(rare!.classList.contains('rare')).toBe(true)
    expect(plain!.classList.contains('rare')).toBe(false)
  })

  it('yangi medal sinfi va o‘lcham', () => {
    const { container } = render(<MedalMark code="jump" isNew size={32} />)
    const svg = container.querySelector('svg.medal')!
    expect(svg.classList.contains('medal--new')).toBe(true)
    expect(svg.getAttribute('height')).toBe('32')
  })
})

describe('Halo — rank halqasi', () => {
  it('raqam, o‘lcham sinfi va metall: 1 oltin, 2 kumush, 3 bronza, qolgani none', () => {
    const { container } = render(
      <>
        <Halo rank={1} size="lg" />
        <Halo rank={2} size="md" />
        <Halo rank={3} size="md" />
        <Halo rank={7} size="md" />
      </>,
    )
    const halos = [...container.querySelectorAll('.halo')]
    expect(halos.map((h) => h.textContent)).toEqual(['1', '2', '3', '7'])
    expect(halos.map((h) => h.getAttribute('data-metal'))).toEqual(['gold', 'silver', 'bronze', 'none'])
    expect(halos[0]!.classList.contains('halo--lg')).toBe(true)
    expect(halos[1]!.classList.contains('halo--md')).toBe(true)
    expect(metalOfRank(2)).toBe('silver')
  })
})

describe('TierLegend — 28 px «DARAJA» qatori', () => {
  it('olti pog‘ona, so‘z va to‘liq so‘m ostona; Yangi raqamsiz; Legendada toj', () => {
    const { container } = render(<TierLegend />)
    const rungs = container.querySelectorAll('.legend__rung')
    expect(rungs).toHaveLength(6)
    expect([...rungs].map((r) => r.querySelector('b')!.textContent)).toEqual([
      'Yangi', 'Sotuvchi', 'Katta sotuvchi', 'Usta', 'Ustoz', 'Legenda',
    ])
    expect(rungs[0]!.querySelector('i')).toBeNull()
    expect(rungs[1]!.querySelector('i')!.textContent).toBe(`10${S}000${S}000`)
    expect(rungs[5]!.querySelector('i')!.textContent).toBe(`1${S}000${S}000${S}000`)
    expect(rungs[5]!.querySelector('svg.crest--legend')!.getAttribute('data-tier')).toBe('6')
    expect(rungs[5]!.querySelector('.crest__crown')).not.toBeNull()
    expect(rungs[3]!.querySelectorAll('use.on')).toHaveLength(4)
    expect(container.querySelector('.tv-legend')!.getAttribute('role')).toBe('list')
    expect(screen.getByText('Daraja')).toBeTruthy()
    expect(container.textContent).not.toMatch(/mln|mlrd/)
  })
})

describe('katalog', () => {
  it('14 kod, tartib motor bilan bir xil; belgi va nom hammasida', () => {
    expect(MEDAL_ORDER).toHaveLength(14)
    for (const code of MEDAL_ORDER) {
      expect(MEDALS[code].name).toBeTruthy()
      expect(MEDAL_SYMBOL[code]).toMatch(/^m-[a-z]+$/)
    }
  })

  it('nodir yettilik, qatorda yashirin first-sale, Oy raqamlari, metall', () => {
    expect([...RARE_MEDALS].sort()).toEqual([
      'conversion-master', 'day-record', 'month-bronze', 'month-gold', 'month-silver', 'streak-fire', 'year-champion',
    ])
    expect(HIDDEN_IN_ROWS).toEqual(['first-sale'])
    expect(MONTH_NUMERAL).toEqual({ 'month-gold': '1', 'month-silver': '2', 'month-bronze': '3' })
    expect(metalOfMedal('month-silver')).toBe('silver')
    expect(metalOfMedal('month-bronze')).toBe('bronze')
    expect(metalOfMedal('year-champion')).toBe('gold')
    expect(metalOfMedal('first-sale')).toBe('gold')
  })

  it('narvon ostonalari so‘mda; Legenda bosqichi milliardlab', () => {
    expect(LADDER.map((r) => r.thresholdSom)).toEqual([
      null, 10_000_000, 30_000_000, 100_000_000, 300_000_000, 1_000_000_000,
    ])
    expect(thresholdSomOf(4, 0)).toBe(100_000_000)
    expect(thresholdSomOf(1, 0)).toBeNull()
    expect(thresholdSomOf(6, 1)).toBe(1_000_000_000)
    expect(thresholdSomOf(6, 2)).toBe(2_000_000_000)
  })

  it('sortMedals — MEDAL_ORDER bo‘yicha, yashirinlar filtrlanadi, kirish o‘zgarmaydi', () => {
    const m = (code: SellerMedalDto['code']): SellerMedalDto => ({
      code, count: 1, at: null, amount: null, orders: null, percent: null,
    })
    const input = [m('first-sale'), m('day-winner'), m('month-gold'), m('clean-month')]
    const sorted = sortMedals(input, HIDDEN_IN_ROWS)
    expect(sorted.map((x) => x.code)).toEqual(['month-gold', 'clean-month', 'day-winner'])
    expect(sortMedals(input).map((x) => x.code)).toEqual(['month-gold', 'clean-month', 'day-winner', 'first-sale'])
    expect(input[0]!.code).toBe('first-sale')
  })
})
```

- [ ] **Step 2: Testni ishga tushirish — qizil**

Run: `npx vitest run tests/features/sellersEfir.test.tsx`
Expected: FAIL — `@/features/sellers/Crest` topilmadi (modul yo'q).

- [ ] **Step 3: `medalDefs.ts` ni generatsiya qilish**

Aktiv repo'da: `docs/superpowers/specs/assets/2026-09-16-efir/efir.html` (yorug' nusxasi `efir-light.html` faqat `data-theme` bilan farq qiladi — `diff` bo'sh). QO'LDA ko'chirmang — generator (worktree ildizidan):

```bash
node - <<'JS'
const fs = require('fs')
const SRC = 'docs/superpowers/specs/assets/2026-09-16-efir/efir.html'
const html = fs.readFileSync(SRC, 'utf8')
const m = /<defs>([\s\S]*?)<\/defs>/.exec(html)
if (!m) throw new Error('<defs> topilmadi')
const inner = m[1]
  .replace(/<!--[\s\S]*?-->/g, '')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .join('\n')
if (!/<path id="ch" d="M0 0H7L12 10L7 20H0L5 10Z"\/>/.test(inner)) throw new Error('#ch yo‘q yoki o‘zgargan')
const symbols = (inner.match(/<symbol id="m-/g) || []).length
if (symbols !== 12) throw new Error('12 ta #m-* kutilgan edi, topildi: ' + symbols)
if (/#[0-9a-fA-F]{3,8}\b/.test(inner)) throw new Error('belgilarda literal rang bor')
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
const out = `/**
 * EFIR belgilari — \`<defs>\` ichi, sahifaga BIR MARTA o'rnatiladi
 * (\`MedalDefs\`): \`#ch\` — gerbning bitta chevroni (\`Crest\` uni oltita
 * \`<use>\` bilan chizadi), \`#m-*\` — 14 medal kodi uchun 12 belgi (Oy oilasi
 * bitta \`#m-month\` diskini bo'lishadi, raqam \`MedalMark\` da <text>).
 * Faqat-fill: rang instance <svg> dan meros bo'ladi (\`.medal\`, \`.crest .on\`);
 * \`class="cut"\` — sirt rangidagi kesib olish (gravyura), ikkinchi rang emas.
 *
 * GENERATSIYA QILINGAN. Manba: docs/superpowers/specs/assets/2026-09-16-efir/efir.html
 * (birinchi <defs>). Qo'lda tahrirlamang — aktivni o'zgartirib, rejadagi
 * generatorni (2026-09-16-efir-taxta.md, 2-vazifa, 3-qadam) qayta ishga tushiring.
 */
export const EFIR_DEFS = \`${esc(inner)}\`
`
fs.writeFileSync('src/features/sellers/medalDefs.ts', out)
console.log('ok', symbols, 'symbols,', out.length, 'bytes')
JS
```

Tekshiruv: `grep -c '<symbol id="m-' src/features/sellers/medalDefs.ts` → 12; `grep -c 'id="ch"' src/features/sellers/medalDefs.ts` → 1; `grep -c 'khatam\|lavha-\|medal-month' src/features/sellers/medalDefs.ts` → 0; `grep -n -oE '#[0-9a-fA-F]{6}\b' src/features/sellers/medalDefs.ts` → bo'sh.

- [ ] **Step 4: `MedalDefs.tsx`**

`src/features/sellers/MedalDefs.tsx` ni butunlay quyidagi bilan almashtiring:

```tsx
import { EFIR_DEFS } from '@/features/sellers/medalDefs'

/**
 * Sahifaning yagona <defs>. Gerb ham, medal ham `<use href="#…">` bilan
 * chiziladi — 100 qatorning har biriga alohida <defs> qo'yilsa id'lar
 * takrorlanib, <use> birinchisiga bog'lanib qoladi va mavzu almashganda
 * yarmi eski rangda qoladi. Shuning uchun BIR MARTA, taxtaning boshida.
 * `dangerouslySetInnerHTML` — statik, repo'dagi generatsiya qilingan satr,
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
      dangerouslySetInnerHTML={{ __html: `<defs>${EFIR_DEFS}</defs>` }}
    />
  )
}
```

- [ ] **Step 5: Katalogni kengaytirish**

`src/features/sellers/medalCatalog.ts` da:

(a) Birinchi import satrini almashtiring:
```ts
import type { MedalCode } from '@/lib/api'
```
→
```ts
import type { MedalCode, SellerMedalDto } from '@/lib/api'
```

(b) `export interface LadderRung { … }` va `export const LADDER … ])` ni butunlay quyidagi bilan almashtiring:

```ts
export interface LadderRung {
  readonly level: number
  readonly title: string
  /** Eski aytiladigan yorliq («10 mln») — `usePromotions.thresholdLabel` uni hali tashiydi. */
  readonly thresholdLabel: string
  /** Ostona so'mda — legenda va e'lon to'liq raqam yozadi (spec §1). Yangi — birinchi so'm, raqamsiz. */
  readonly thresholdSom: number | null
}

/** Mirrors `sellerMedals.LEVEL_THRESHOLDS_MINOR` / `LEVEL_TITLES`. */
export const LADDER: readonly LadderRung[] = Object.freeze([
  { level: 1, title: 'Yangi', thresholdLabel: 'birinchi soʻm', thresholdSom: null },
  { level: 2, title: 'Sotuvchi', thresholdLabel: '10 mln', thresholdSom: 10_000_000 },
  { level: 3, title: 'Katta sotuvchi', thresholdLabel: '30 mln', thresholdSom: 30_000_000 },
  { level: 4, title: 'Usta', thresholdLabel: '100 mln', thresholdSom: 100_000_000 },
  { level: 5, title: 'Ustoz', thresholdLabel: '300 mln', thresholdSom: 300_000_000 },
  { level: 6, title: 'Legenda', thresholdLabel: '1 mlrd', thresholdSom: 1_000_000_000 },
])

/** Legenda har keyingi milliardda II, III … Mirrors `sellerMedals.LEGENDA_STEP_MINOR`. */
export const LEGENDA_STEP_SOM = 1_000_000_000

/** Shu darajaning ostonasi so'mda; 1-darajada null (birinchi so'm), 6-darajada bosqich × 1 mlrd. */
export function thresholdSomOf(level: number, legendaTier: number): number | null {
  if (level >= 6) return Math.max(1, legendaTier) * LEGENDA_STEP_SOM
  return LADDER[level - 1]?.thresholdSom ?? null
}
```

(c) Fayl OXIRIGA (`mlnLabel` dan keyin) qo'shing:

```ts
/* ---------------------------------------------------------------------------
 * EFIR — belgi xaritasi va tartib (spec §3). Mirrors `gen_efir.py`
 * (MEDAL_SYM, MONTH_NUM, RARE, HIDE_IN_ROWS) — mock va taxta bir xil chizsin.
 * ------------------------------------------------------------------------- */

export type Metal = 'gold' | 'silver' | 'bronze'

/** Nodir yettilik — faqat qorong'i sahnada yumshoq oltin soya (`.medal.rare`). */
export const RARE_MEDALS: ReadonlySet<MedalCode> = new Set<MedalCode>([
  'year-champion',
  'month-gold',
  'month-silver',
  'month-bronze',
  'day-record',
  'conversion-master',
  'streak-fire',
])

/** Qatorda chizilmaydiganlar: 100 dan 92 tasida bor nishon nishon emas. O'rindiqda bor. */
export const HIDDEN_IN_ROWS: readonly MedalCode[] = Object.freeze(['first-sale'])

/** Kod → mock `<defs>` dagi belgi. Oy oilasi bitta diskni bo'lishadi; raqam `MONTH_NUMERAL` dan. */
export const MEDAL_SYMBOL: Readonly<Record<MedalCode, string>> = Object.freeze({
  'month-gold': 'm-month',
  'month-silver': 'm-month',
  'month-bronze': 'm-month',
  'year-champion': 'm-year',
  'streak-fire': 'm-fire',
  'streak-steady': 'm-steady',
  'day-record': 'm-bolt',
  'day-winner': 'm-sun',
  'conversion-master': 'm-target',
  'clean-month': 'm-shield',
  jump: 'm-jump',
  rookie: 'm-star',
  'first-sale': 'm-sprout',
  'work-month': 'm-cal',
})

/** Oy diskiga o'yiladigan raqam — 1/2/3. */
export const MONTH_NUMERAL: Readonly<Partial<Record<MedalCode, '1' | '2' | '3'>>> = Object.freeze({
  'month-gold': '1',
  'month-silver': '2',
  'month-bronze': '3',
})

/** Oy oilasi O'Z metallida, qolgan 11 kod oltin (spec §3). */
export function metalOfMedal(code: MedalCode): Metal {
  if (code === 'month-silver') return 'silver'
  if (code === 'month-bronze') return 'bronze'
  return 'gold'
}

/** `MEDAL_ORDER` bo'yicha (eng nodir avval), `hide` dagilar tashlab yuboriladi; kirish o'zgarmaydi. */
export function sortMedals(
  medals: readonly SellerMedalDto[],
  hide: readonly MedalCode[] = [],
): readonly SellerMedalDto[] {
  return medals
    .filter((m) => !hide.includes(m.code))
    .slice()
    .sort((a, b) => MEDAL_ORDER.indexOf(a.code) - MEDAL_ORDER.indexOf(b.code))
}
```

- [ ] **Step 6: `Crest.tsx`**

`src/features/sellers/Crest.tsx`:

```tsx
import { levelTitle } from '@/features/sellers/medalCatalog'

/**
 * Gerb («pagon») — olti o'ngga qaragan chevron, `0…level−1` katakchalar
 * `--tier` rangida, qolganlari `--track` (spec §2). Geometriya `#ch` da
 * (`medalDefs.ts`), bu yerda faqat QAYSI katakcha yoniq. Rang CSS'da:
 * `[data-tier]` → `--tier`, ya'ni mavzu almashganda hech narsa qayta
 * chizilmaydi.
 *
 * SO'Z BIR MARTA. Daraja so'zi gerb yonida faqat o'rindiqda HTML bilan;
 * gerbning o'zi `aria-label` da to'liq aytadi («4-daraja · Usta»), shuning
 * uchun `sr-only` nusxa yo'q.
 */
export type CrestSize = 'row' | 'seat' | 'legend'

const DIMS: Readonly<Record<CrestSize, readonly [number, number]>> = {
  row: [60, 20],
  seat: [78, 26],
  legend: [42, 14],
}
const CELLS = [0, 1, 2, 3, 4, 5] as const
/** Legenda toji — oltinchi katakcha ustida (mock `crest()`), faqat 6-darajada. */
const CROWN = 'M56 -7l2.5-4 2.5 3 2.5-3 2.5 4z'

export function Crest({
  level,
  legendaTier = 0,
  size,
  animate = false,
}: {
  level: number
  legendaTier?: number
  size: CrestSize
  /** Ko'tarilish marosimi: eng yangi katakcha bir marta to'ladi (`.crest__cell--fill`). */
  animate?: boolean
}) {
  const lit = Math.max(0, Math.min(6, level))
  const title = levelTitle(level, legendaTier)
  const [w, h] = DIMS[size]
  return (
    <svg
      className={`crest crest--${size}`}
      data-tier={lit}
      viewBox="0 -1 66 22"
      width={w}
      height={h}
      role="img"
      aria-label={title === null ? 'Hali darajasiz' : `${level}-daraja · ${title}`}
    >
      {CELLS.map((i) => (
        <use
          key={i}
          href="#ch"
          x={i * 11}
          className={i < lit ? (animate && i === lit - 1 ? 'on crest__cell--fill' : 'on') : 'off'}
        />
      ))}
      {lit >= 6 && <path className="crest__crown" d={CROWN} />}
    </svg>
  )
}
```

- [ ] **Step 7: `MedalMark.tsx`**

`src/features/sellers/MedalMark.tsx`:

```tsx
import { MEDALS, MEDAL_SYMBOL, MONTH_NUMERAL, RARE_MEDALS, metalOfMedal } from '@/features/sellers/medalCatalog'
import type { MedalCode } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/**
 * Bitta medal — 24 birlik quti, faqat-fill, bitta metall (spec §3). Belgi
 * `medalDefs.ts` da, rang `.medal[data-metal]` da; Oy oilasi diskiga 1/2/3
 * raqami <text> bilan o'yiladi (`class="cut"` — sirt rangi).
 *
 * ×N — SVG TASHQARISIDA, HTML <b>: tabular raqam, mavzu tokenlari. Faqat
 * `count > 1` da va faqat chaqiruvchi `count` bersa — qator uni bermaydi
 * (spec §3: qatorda ×N yo'q).
 *
 * NOMI BIR MARTA. `role="img"` + `aria-label` nomni (va ×N ni) o'zi aytadi.
 */
export function MedalMark({
  code,
  count = 1,
  size = 24,
  isNew = false,
}: {
  code: MedalCode
  count?: number
  size?: number
  /** Oxirgi yangilanishda paydo bo'lgan — bir marta 0,6 → 1 kattalashadi. */
  isNew?: boolean
}) {
  const name = MEDALS[code].name
  const numeral = MONTH_NUMERAL[code]
  const label = count > 1 ? `${name} ×${formatNumber(count)}` : name
  const svg = (
    <svg
      className={`medal${RARE_MEDALS.has(code) ? ' rare' : ''}${isNew ? ' medal--new' : ''}`}
      data-medal={code}
      data-metal={metalOfMedal(code)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
    >
      <use href={`#${MEDAL_SYMBOL[code]}`} />
      {numeral !== undefined && (
        <text className="cut medal__num" x="12" y="18.6" textAnchor="middle">
          {numeral}
        </text>
      )}
    </svg>
  )
  if (count <= 1) return svg
  return (
    <span className="medal-group">
      {svg}
      <b className="medal-count">×{formatNumber(count)}</b>
    </span>
  )
}
```

- [ ] **Step 8: `Halo.tsx`**

`src/features/sellers/Halo.tsx`:

```tsx
import type { Metal } from '@/features/sellers/medalCatalog'

/**
 * Rank raqami metall halqada (spec §4): 1 — oltin, 2 — kumush, 3 — bronza,
 * qolgani xira halqa. Metall — bezak: rank raqamning o'zida, va o'rindiq
 * `aria-label` bilan o'rnini aytadi, shuning uchun halqa `aria-hidden`.
 * O'lchamlar CSS'da (`.halo--lg` 80/44, `.halo--md` 64/32; 1366 da 56/48).
 */
export type HaloMetal = Metal | 'none'

export function metalOfRank(rank: number): HaloMetal {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return 'none'
}

export function Halo({ rank, size }: { rank: number; size: 'lg' | 'md' }) {
  return (
    <span className={`halo halo--${size}`} data-metal={metalOfRank(rank)} aria-hidden="true">
      {rank}
    </span>
  )
}
```

- [ ] **Step 9: `TierLegend.tsx`**

`src/features/sellers/TierLegend.tsx`:

```tsx
import { Crest } from '@/features/sellers/Crest'
import { LADDER } from '@/features/sellers/medalCatalog'
import { formatSomFull } from '@/lib/format'

/**
 * Legenda — sotuvchilar ustunining PASTIDA 28 px qator (spec §2): olti gerb,
 * so'z, ostona to'liq so'mda. Yagona kalit; hamma ma'lumot elementidan
 * kichik va yengil; podium bilan ro'yxat orasida hech qachon emas. Statik.
 *
 * Yangi pog'onasi raqamsiz — uning ostonasi «birinchi so'm» (mock ham
 * shunday chizadi); qolgan beshtasi raqam bilan.
 */
export function TierLegend() {
  return (
    <div className="tv-legend" role="list" aria-label="Daraja legendasi">
      <span className="tv-legend__title" aria-hidden="true">
        Daraja
      </span>
      {LADDER.map((rung) => (
        <span key={rung.level} className="legend__rung" role="listitem" data-tier={rung.level}>
          <Crest level={rung.level} legendaTier={rung.level === 6 ? 1 : 0} size="legend" />
          <b>{rung.title}</b>
          {rung.thresholdSom !== null && <i>{formatSomFull(rung.thresholdSom)}</i>}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 10: Komponent testlari — yashil**

Run: `npx vitest run tests/features/sellersEfir.test.tsx`
Expected: PASS (17 ta test).

- [ ] **Step 11: EFIR CSS bo‘limi — 1-bo‘lak**

Avval CSS bo'lagini scratchpad'ga yozing:

```bash
mkdir -p /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir
cat > /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/efir-1.css <<'CSS'
/* ==========================================================================
 * EFIR — sotuvchilar taxtasi: gerb, medal, halqa, legenda, o'rindiq, qator, komandalar, e'lon
 *
 * Spec: docs/superpowers/specs/2026-09-16-efir-taxta-design.md. Mock:
 * docs/superpowers/specs/assets/2026-09-16-efir/efir.html — o'lchamlar shundan.
 *
 * BITTA AKSENT, BITTA METALL. Daraja `--tier` orqali keladi: `[data-tier="N"]`
 * uni `--tier-N` ga bog'laydi va komponentlar `--tier-N` ni hech qachon
 * to'g'ridan-to'g'ri o'qimaydi (oila ORDINAL — token blokidagi izoh).
 * `--medal-*` faqat yozilgan istisnolarda: `.medal` (Oy oilasi o'z
 * metallida, qolgan 11 kod oltin), `.halo`, `.crest__crown`, `.trow__rank`,
 * `.record__k`. `--series-*` bu bo'limda yo'q. Literal rang yo'q.
 *
 * O'lchamlar pikselda (1920) va `@media (max-width: 1599px)` da 0.8×
 * (spec §9) — `--tv-*` shkalasi `:root` da. Sirtlar: ustun `--surface`,
 * o'rindiq `--surface-raised`, chiziqlar `--border`, bo'sh yo'l `--track`.
 * ======================================================================== */

/* ---- daraja: 0…6 → --tier. 0-daraja faqat kontur (`--border-strong`). ---- */
[data-tier="0"] { --tier: var(--border-strong); }
[data-tier="1"] { --tier: var(--tier-1); }
[data-tier="2"] { --tier: var(--tier-2); }
[data-tier="3"] { --tier: var(--tier-3); }
[data-tier="4"] { --tier: var(--tier-4); }
[data-tier="5"] { --tier: var(--tier-5); }
[data-tier="6"] { --tier: var(--tier-6); }

/* ---- gerb (pagon): olti chevron `#ch`, yoniq — --tier, o'chiq — --track ---- */
.crest {
  flex: none;
  display: inline-block;
  vertical-align: middle;
  /* Legenda toji oltinchi katakcha USTIDA, viewBox'dan tashqarida. */
  overflow: visible;
}
.crest--row { width: 60px; height: 20px; }
.crest--seat { width: 78px; height: 26px; }
.crest--legend { width: 42px; height: 14px; }
.crest .on { fill: var(--tier); }
.crest .off { fill: var(--track); }
.crest__crown { fill: var(--medal-gold); }

/* ---- medal: 24 birlik, faqat-fill, bitta metall; kesib olish — sirt rangi ---- */
.medal {
  display: inline-block;
  flex: none;
  vertical-align: middle;
  overflow: visible;
  /* Gravyura rangi — medal turgan sirt. Qatorda ustun sirti; o'rindiq o'zinikini beradi. */
  --cut: var(--surface);
  fill: var(--medal-gold);
}
.medal[data-medal="month-silver"] { fill: var(--medal-silver); }
.medal[data-medal="month-bronze"] { fill: var(--medal-bronze); }
.medal .cut,
.medal .medal__num { fill: var(--cut); }
.medal .medal__num {
  font-family: var(--font-sans);
  font-weight: 800;
  font-size: 11px;
}
/* Nodir yettilik — yumshoq oltin soya; yorug'da token shaffof, ya'ni hech narsa. */
.medal.rare { filter: drop-shadow(0 0 5px var(--glow-rare)); }
.medal-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.medal-count {
  font-size: var(--tv-m);
  font-weight: 600;
  color: var(--ink-secondary);
  font-variant-numeric: tabular-nums;
}

/* ---- halqa: rank raqami metall halqada — 3 px halqa + 8 px xira tashqi halqa ---- */
.halo {
  flex: none;
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  font-size: 32px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums lining-nums;
  --metal: var(--ink-muted);
  color: var(--metal);
  background: var(--surface);
  box-shadow:
    0 0 0 3px var(--metal),
    0 0 0 8px color-mix(in oklab, var(--metal) 14%, transparent);
}
.halo--lg {
  width: 80px;
  height: 80px;
  font-size: var(--tv-xl);
}
.halo[data-metal="gold"] { --metal: var(--medal-gold); }
.halo[data-metal="silver"] { --metal: var(--medal-silver); }
.halo[data-metal="bronze"] { --metal: var(--medal-bronze); }

/* ---- legenda: ustun pastida 28 px, olti gerb + so'z + ostona ---- */
.tv-legend {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  height: 28px;
  padding: 0 16px;
  border-top: 1px solid var(--border);
  font-size: var(--tv-s);
  color: var(--ink-muted);
  white-space: nowrap;
  overflow: hidden;
}
.tv-legend__title {
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.legend__rung {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.legend__rung b {
  color: var(--ink-secondary);
  font-weight: 600;
}
.legend__rung i {
  font-style: normal;
  font-variant-numeric: tabular-nums;
}

/* EFIR — kamaytirilgan harakat: hech narsa qimirlamaydi. Keyingi vazifalarning
   bo'laklari SHU izohdan OLDIN qo'shiladi, ya'ni bu blok bo'limning oxirida qoladi. */
@media (prefers-reduced-motion: reduce) {
  .crest__cell--fill,
  .medal--new,
  .tv-promo {
    animation: none;
  }
  .row__band,
  .seat::before,
  .seat__bar i {
    transition: none;
  }
}
CSS
```

So'ng bo'limni `globals.css` ga TV BOARD banneridan OLDIN (ya'ni DARAJA BLOKI dan keyin) joylang:

```bash
node - <<'JS'
const fs = require('fs')
const S = '/tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/'
const css = fs.readFileSync('src/app/globals.css', 'utf8')
// Banner boshi — sarlavha satridan oldingi `/* ` (`=` soniga bog'lanmaydi).
const title = css.indexOf(' * TV BOARD — the sellers board')
if (title < 0) throw new Error('TV BOARD banner topilmadi')
const at = css.lastIndexOf('/* ', title)
if (css.includes('* EFIR —')) throw new Error('EFIR bo‘limi allaqachon bor')
const chunk = fs.readFileSync(S + 'efir-1.css', 'utf8').trim() + '\n\n'
fs.writeFileSync('src/app/globals.css', css.slice(0, at) + chunk + css.slice(at))
console.log('ok')
JS
```

Tekshiruv: `grep -n -E '^\s*\* (DARAJA BLOKI|EFIR|TV BOARD) ' src/app/globals.css` → uch satr, shu tartibda.

- [ ] **Step 12: `efirCss.test.ts` ni kengaytirish**

`tests/features/efirCss.test.ts` OXIRIGA qo'shing:

```ts

/** EFIR bo'limi — bannerdan TV BOARD bannerigacha. */
const EFIR = () => CSS.slice(from('* EFIR —'), from('* TV BOARD — the sellers board'))
/** Izohlarsiz — bannerlar tokenlarni SO'Z bilan tilga oladi, qoida bilan emas. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

describe('EFIR bo‘limi — rang shartnomasi', () => {
  it('bo‘lim bor va TV BOARD dan oldin turadi; asosiy selektorlar', () => {
    for (const sel of [
      '[data-tier="0"]', '[data-tier="6"]', '.crest {', '.crest--row', '.crest--seat', '.crest--legend',
      '.crest__crown', '.medal {', '.medal.rare', '.medal-count', '.halo {', '.halo--lg', '.tv-legend {',
      '.legend__rung',
    ]) {
      expect(EFIR(), sel).toContain(sel)
    }
  })

  it('literal rang yo‘q — faqat var(--…) va color-mix', () => {
    const code = strip(EFIR())
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).not.toMatch(/\brgba?\(/)
    expect(code).not.toMatch(/\bhsla?\(/)
  })

  it('`--tier-N` faqat `[data-tier="N"]` orqali o‘qiladi; 0-daraja — kontur', () => {
    const code = strip(EFIR())
    for (let n = 1; n <= 6; n += 1) expect(code).toContain(`[data-tier="${n}"] { --tier: var(--tier-${n}); }`)
    expect(code).toContain('[data-tier="0"] { --tier: var(--border-strong); }')
    // Boshqa hech qayerda `--tier-N` o'qilmaydi — komponent faqat `--tier` ni biladi.
    expect(code.match(/var\(--tier-\d\)/g) ?? []).toHaveLength(6)
  })

  it('seriya rangi yo‘q — daraja ham, medal ham `--series-*` ni o‘qimaydi', () => {
    expect(strip(EFIR())).not.toContain('--series-')
  })

  /*
    PODIUM METALLARI — YOZILGAN ISTISNO RO'YXATI (spec §1, §3): Oy oilasi
    maydoni va barcha medallarning asosiy oltini (`.medal`), rank halqasi
    (`.halo`), Legenda toji (`.crest__crown`), komandalar ustunidagi metall
    raqam (`.trow__rank`), rekord yorlig'i (`.record__k`). Boshqa hech qanday
    selektor `--medal-*` ni o'qimaydi — tasma, gerb katakchasi, ism, raqam.
  */
  it('podium metallari faqat yozilgan istisnolarda', () => {
    const code = strip(EFIR())
    const allowed = /^(\.medal\b|\.halo\b|\.crest__crown\b|\.trow__rank\b|\.record__k\b)/
    const rules = code.match(/[^{}]+\{[^{}]*\}/g) ?? []
    expect(rules.length).toBeGreaterThan(10)
    for (const rule of rules) {
      if (!rule.includes('--medal-')) continue
      const selector = rule.slice(0, rule.indexOf('{')).trim()
      expect(selector, rule.trim()).toMatch(allowed)
    }
  })

  it('kamaytirilgan harakatda hech narsa qimirlamaydi — blok bo‘limning oxirida', () => {
    const efir = EFIR()
    const reduced = efir.slice(efir.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    for (const sel of ['.crest__cell--fill', '.medal--new', '.tv-promo', '.row__band', '.seat::before', '.seat__bar i']) {
      expect(reduced, sel).toContain(sel)
    }
    expect(reduced).toContain('animation: none')
    expect(reduced).toContain('transition: none')
    expect(efir.indexOf('/* EFIR — kamaytirilgan harakat')).toBeGreaterThan(efir.indexOf('.legend__rung'))
  })
})
```

- [ ] **Step 13: Eski testlarga yamoq**

(a) `tests/features/sellersLavha.test.tsx` — `describe('MedalDefs — sahifaga bir marta o‘rnatiladigan belgilar to‘plami', () => { … })` blokini (faylning birinchi `describe`, `it('lavha, xatam va 14 medal belgisini id bilan chizadi'` bilan) butunlay o'chiring; `import { MedalDefs } from '@/features/sellers/MedalDefs'` satrini ham o'chiring (boshqa joyda ishlatilmaydi — `grep -n MedalDefs tests/features/sellersLavha.test.tsx` bo'sh bo'lsin).

(b) `tests/features/sellersTvBoard.test.tsx` — `it('belgilar to‘plami sahifada BIR MARTA', …)` ichida:
```ts
    expect(document.querySelectorAll('#khatam')).toHaveLength(1)
```
→
```ts
    expect(document.querySelectorAll('#ch')).toHaveLength(1)
```

(c) `git rm tests/features/lavhaCss.test.ts`

- [ ] **Step 14: Testlar va tur tekshiruvi**

Run: `npx vitest run tests/features/sellersEfir.test.tsx tests/features/efirCss.test.ts tests/features/sellersLavha.test.tsx tests/features/sellersTvBoard.test.tsx tests/features/usePromotions.test.tsx tests/features/theme.test.ts tests/features/tvBoardLayout.test.ts tests/features/recordWallCss.test.ts`
Expected: PASS — hammasi. (Eski `Lavha`/`Medal` komponentlari endi mavjud bo'lmagan `#khatam`/`#medal-*` ga `<use>` qiladi — jsdom da hech narsa chizmaydi, xato ham bermaydi; ular 4-vazifada o'chadi.)

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: xatosiz.

- [ ] **Step 15: Commit**

```bash
git add src/features/sellers/medalDefs.ts src/features/sellers/MedalDefs.tsx src/features/sellers/medalCatalog.ts src/features/sellers/MedalMark.tsx src/features/sellers/Crest.tsx src/features/sellers/Halo.tsx src/features/sellers/TierLegend.tsx src/app/globals.css tests/features/sellersEfir.test.tsx tests/features/efirCss.test.ts tests/features/sellersLavha.test.tsx tests/features/sellersTvBoard.test.tsx
git status --short
git commit -m "feat(sellers): EFIR belgilari — #ch gerbi, 12 medal belgisi, Crest/MedalMark/Halo/TierLegend, EFIR CSS 1-bo'lak

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: `SeatCard` va `RowMedals`

**Files:**
- Create: `src/features/sellers/SeatCard.tsx`
- Modify: `src/features/sellers/RowMedals.tsx` (butunlay)
- Modify: `src/features/sellers/medalCatalog.ts` — import satri; fayl oxiriga `progressOf`, `nextLevelSentence`
- Modify: `src/app/globals.css` — EFIR bo'limi 2-bo'lak (o'rindiq), kamaytirilgan-harakat markeridan OLDIN
- Modify: `tests/features/sellersEfir.test.tsx` (kengayadi; `matchMedia` stub qo'shiladi), `tests/features/efirCss.test.ts` (kengayadi)
- Modify: `tests/features/sellersTvBoard.test.tsx` — uchta assertion (`.tv-rowmedals` → `.row__medals`); `tests/features/sellersLavha.test.tsx` — `RowMedals` `it` i va importi o'chadi
- Delete: hech narsa (eski komponentlar 4-vazifada, oxirgi importeri bilan birga)

**Interfaces:**
- Consumes: `Crest`, `Halo`, `MedalMark`, `sortMedals`, `HIDDEN_IN_ROWS`, `dativeOf` (2-vazifa / mavjud); `formatSomFull`, `NARROW_NBSP` (1-vazifa); `AnimatedNumber` (`@/components/ui/AnimatedNumber`, `{ value, format, duration }`).
- Produces:
  ```ts
  // medalCatalog.ts
  export function progressOf(row: SellerMedalRowDto): number          // 0-daraja → 0; aks holda clamp((delivered−floor)/(next−floor), 0.03, 1)
  export function nextLevelSentence(row: SellerMedalRowDto): string   // «Ustozga 127 000 000 qoldi» | «Birinchi savdo kutilmoqda» | «Legenda II ga … qoldi»
  // SeatCard.tsx
  export function splitSeatName(name: string): readonly [string, string]
  export function SeatCard(props: {
    rank: number; place: 1 | 2 | 3; name: string; team: string | null
    won: number; ordered: number; onDelivered: boolean
    medal: SellerMedalRowDto | null; rise?: boolean; newKeys?: ReadonlySet<MedalCode>
  }): JSX
  //   → <article class="seat seat--PLACE" data-tier data-seat-name=NAME aria-label="N-oʻrin">
  //       .seat__top (.halo, .seat__who > h3.seat__name > span×2, p.seat__sub > .seat__team, .crest--seat, .seat__level)
  //       .seat__fig (.seat__figure, p.seat__facts > .seat__cap, .seat__other > b)
  //       .seat__prog (.seat__bar > i[style.width], p.seat__next)      — faqat medal !== null
  //       .seat__medals (MedalMark×N, count bilan)                      — faqat medal !== null && medals.length > 0
  // RowMedals.tsx
  export const ROW_MEDALS = 3
  export function RowMedals(props: { medals: readonly SellerMedalDto[]; newKeys?: ReadonlySet<MedalCode> }): JSX
  //   → HAR DOIM <span class="row__medals"> (grid uyasi bo'sh qolmasin), ichida ≤3 MedalMark (count'siz) + <span class="row__more">+N</span>
  ```

- [ ] **Step 1: Testlarni yozish**

`tests/features/sellersEfir.test.tsx` da:

(a) Importlarga qo'shing (mavjud `import { TierLegend } …` satridan keyin):
```tsx
import { RowMedals } from '@/features/sellers/RowMedals'
import { SeatCard, splitSeatName } from '@/features/sellers/SeatCard'
```
va katalog importiga `nextLevelSentence`, `progressOf` ni qo'shing (alifbo tartibida: `metalOfMedal, nextLevelSentence, progressOf, sortMedals, thresholdSomOf`); `import type { SellerMedalDto } from '@/lib/api'` → `import type { SellerMedalDto, SellerMedalRowDto } from '@/lib/api'`.

(b) `const S = NARROW_NBSP` satridan KEYIN qo'shing:

```tsx

/*
  jsdom da `matchMedia` yo'q; `AnimatedNumber` (o'rindiq raqami) uni chaqiradi.
  Kamaytirilgan harakat «ha»: raqam bir marta yakuniy qiymatini yozadi.
*/
window.matchMedia = ((query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

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

const ZERO = row({ level: 0, rankTitle: null, delivered: uzs(0), levelFloor: uzs(0), nextLevelAt: uzs(0.01), nextTitle: 'Yangi' })
const LEGENDA = row({
  level: 6,
  legendaTier: 1,
  rankTitle: 'Legenda',
  delivered: uzs(1_413_000_000),
  levelFloor: uzs(1_000_000_000),
  nextLevelAt: uzs(2_000_000_000),
  nextTitle: 'Legenda II',
})

/** Mock'dagi chempion — «Shahtiyarovna 197 Marjona», FAKT 2 79 600 000, FAKT 1 103 200 000. */
const SEAT = {
  rank: 1,
  place: 1 as const,
  name: 'Shahtiyarovna 197 Marjona',
  team: 'Marjona',
  won: 79_600_000,
  ordered: 103_200_000,
  onDelivered: true,
}
```

(c) Fayl OXIRIGA qo'shing:

```tsx

describe('splitSeatName — ism ikki qatorga', () => {
  it('Familiya Raqam Ism → Familiya / Raqam Ism', () => {
    expect(splitSeatName('Shahtiyarovna 197 Marjona')).toEqual(['Shahtiyarovna', '197 Marjona'])
  })

  it('Raqam Ism Familiya → Raqam Ism / Familiya', () => {
    expect(splitSeatName('268 Ozoda Yuldosheva')).toEqual(['268 Ozoda', 'Yuldosheva'])
  })

  it('boshqa shakllar: birinchi so‘z / qolgani; bitta so‘z — ikkinchi qator bo‘sh', () => {
    expect(splitSeatName('Karimova Aziza Botirovna')).toEqual(['Karimova', 'Aziza Botirovna'])
    expect(splitSeatName('Karimova')).toEqual(['Karimova', ''])
    expect(splitSeatName('154')).toEqual(['154', ''])
    expect(splitSeatName('  Ali   Valiyev ')).toEqual(['Ali', 'Valiyev'])
  })
})

describe('progressOf va nextLevelSentence — to‘liq so‘m', () => {
  it('173 mln Usta → 0,365; «Ustozga 127 000 000 qoldi»', () => {
    expect(progressOf(row())).toBeCloseTo(0.365, 3)
    expect(nextLevelSentence(row())).toBe(`Ustozga 127${S}000${S}000 qoldi`)
  })

  it('qisish: 0,03 dan kam emas, 1 dan ko‘p emas; oshib ketgan — nol qoldi, manfiy emas', () => {
    expect(progressOf(row({ delivered: uzs(100_100_000) }))).toBe(0.03)
    expect(progressOf(row({ delivered: uzs(400_000_000) }))).toBe(1)
    expect(nextLevelSentence(row({ delivered: uzs(400_000_000) }))).toBe('Ustozga 0 qoldi')
  })

  it('0-daraja — bo‘sh yo‘l va «Birinchi savdo kutilmoqda»', () => {
    expect(progressOf(ZERO)).toBe(0)
    expect(nextLevelSentence(ZERO)).toBe('Birinchi savdo kutilmoqda')
  })

  it('Legenda: «Legenda II ga 587 000 000 qoldi»', () => {
    expect(nextLevelSentence(LEGENDA)).toBe(`Legenda II ga 587${S}000${S}000 qoldi`)
  })
})

describe('SeatCard — o‘rindiq (spec §4)', () => {
  it('halqa, ikki qatorli ism, komanda · gerb · so‘z, raqam, FAKT 1 satri, progress, medallar ×N bilan', () => {
    const { container } = render(
      <SeatCard
        {...SEAT}
        medal={row({
          medals: [medal({ code: 'day-winner', count: 4 }), medal({ code: 'first-sale' }), medal({ code: 'day-record' })],
        })}
      />,
    )
    const seat = container.querySelector('article.seat.seat--1')!
    expect(seat.getAttribute('data-tier')).toBe('4')
    expect(seat.getAttribute('data-seat-name')).toBe('Shahtiyarovna 197 Marjona')
    expect(seat.getAttribute('aria-label')).toBe('1-oʻrin')
    expect(seat.querySelector('.halo.halo--lg')!.textContent).toBe('1')
    expect([...seat.querySelectorAll('.seat__name span')].map((s) => s.textContent)).toEqual([
      'Shahtiyarovna',
      '197 Marjona',
    ])
    expect(seat.querySelector('.seat__team')!.textContent).toBe('Marjona')
    expect(seat.querySelector('svg.crest--seat')!.getAttribute('data-tier')).toBe('4')
    expect(seat.querySelectorAll('.seat__level')).toHaveLength(1)
    expect(seat.querySelector('.seat__level')!.textContent).toBe('Usta')
    expect(seat.querySelector('.seat__figure')!.textContent).toContain(`79${S}600${S}000`)
    expect(seat.querySelector('.seat__cap')!.textContent).toBe('FAKT 2')
    expect(seat.querySelector('.seat__other')!.textContent).toBe(`FAKT 1 103${S}200${S}000`)
    expect((seat.querySelector('.seat__bar i') as HTMLElement).style.width).toBe('36.5%')
    expect(seat.querySelector('.seat__next')!.textContent).toBe(`Ustozga 127${S}000${S}000 qoldi`)
    // MEDAL_ORDER bo'yicha: day-record, day-winner ×4, first-sale — O'RINDIQDA first-sale BOR.
    expect([...seat.querySelectorAll('.seat__medals svg.medal')].map((m) => m.getAttribute('data-medal'))).toEqual([
      'day-record',
      'day-winner',
      'first-sale',
    ])
    expect(seat.querySelectorAll('.medal-count')).toHaveLength(1)
    expect(seat.querySelector('.medal-count')!.textContent).toBe('×4')
    // Buyurtma soni, konversiya, birlik va «mln» o'rindiqda yo'q.
    expect(seat.textContent).not.toMatch(/mln|soʻm|so‘m|buyurtma|%/)
  })

  it('2- va 3-o‘rin: kichik halqa', () => {
    const { container } = render(<SeatCard {...SEAT} rank={2} place={2} medal={row()} />)
    expect(container.querySelector('.seat--2 .halo--md')!.textContent).toBe('2')
    expect(container.querySelector('.halo--lg')).toBeNull()
  })

  it('FAKT 1 rejimida raqam va yorliqlar almashadi', () => {
    const { container } = render(<SeatCard {...SEAT} onDelivered={false} medal={row()} />)
    expect(container.querySelector('.seat__figure')!.textContent).toContain(`103${S}200${S}000`)
    expect(container.querySelector('.seat__cap')!.textContent).toBe('FAKT 1')
    expect(container.querySelector('.seat__other')!.textContent).toBe(`FAKT 2 79${S}600${S}000`)
  })

  it('boshqa fakt nol bo‘lsa uning satri chizilmaydi', () => {
    const { container } = render(<SeatCard {...SEAT} ordered={0} medal={row()} />)
    expect(container.querySelector('.seat__other')).toBeNull()
    expect(container.querySelector('.seat__cap')!.textContent).toBe('FAKT 2')
  })

  it('progress qisiladi: 3,0 % va 100,0 %', () => {
    const { container, rerender } = render(<SeatCard {...SEAT} medal={row({ delivered: uzs(100_100_000) })} />)
    expect((container.querySelector('.seat__bar i') as HTMLElement).style.width).toBe('3.0%')
    rerender(<SeatCard {...SEAT} medal={row({ delivered: uzs(400_000_000) })} />)
    expect((container.querySelector('.seat__bar i') as HTMLElement).style.width).toBe('100.0%')
  })

  it('0-daraja: bo‘sh gerb, data-tier="0", bo‘sh yo‘l, so‘z yo‘q, «Birinchi savdo kutilmoqda»', () => {
    const { container } = render(<SeatCard {...SEAT} medal={ZERO} />)
    const seat = container.querySelector('article.seat')!
    expect(seat.getAttribute('data-tier')).toBe('0')
    expect(seat.querySelectorAll('svg.crest use.on')).toHaveLength(0)
    expect(seat.querySelector('.seat__level')).toBeNull()
    expect((seat.querySelector('.seat__bar i') as HTMLElement).style.width).toBe('0.0%')
    expect(seat.querySelector('.seat__next')!.textContent).toBe('Birinchi savdo kutilmoqda')
    expect(seat.querySelector('.seat__medals')).toBeNull()
  })

  it('Legenda II: so‘z, toj, jumla', () => {
    const { container } = render(<SeatCard {...SEAT} medal={{ ...LEGENDA, legendaTier: 2, rankTitle: 'Legenda II', nextTitle: 'Legenda III', nextLevelAt: uzs(3_000_000_000), levelFloor: uzs(2_000_000_000), delivered: uzs(2_413_000_000) }} />)
    const seat = container.querySelector('article.seat')!
    expect(seat.getAttribute('data-tier')).toBe('6')
    expect(seat.querySelector('.seat__level')!.textContent).toBe('Legenda II')
    expect(seat.querySelector('.crest__crown')).not.toBeNull()
    expect(seat.querySelector('.seat__next')!.textContent).toBe(`Legenda III ga 587${S}000${S}000 qoldi`)
  })

  it('medal qatori bo‘lmagan sotuvchi (yuklanish): faqat halqa, ism, komanda, raqam', () => {
    const { container } = render(<SeatCard {...SEAT} medal={null} />)
    const seat = container.querySelector('article.seat')!
    expect(seat.getAttribute('data-tier')).toBe('0')
    expect(seat.querySelector('.halo')).not.toBeNull()
    expect(seat.querySelector('.seat__name')).not.toBeNull()
    expect(seat.querySelector('.seat__team')!.textContent).toBe('Marjona')
    expect(seat.querySelector('.seat__figure')).not.toBeNull()
    expect(seat.querySelector('.crest')).toBeNull()
    expect(seat.querySelector('.seat__level')).toBeNull()
    expect(seat.querySelector('.seat__prog')).toBeNull()
    expect(seat.querySelector('.seat__medals')).toBeNull()
  })

  it('komandasiz sotuvchi — «komandasiz»; medalsiz — medal qatori yo‘q, progress bor', () => {
    const { container } = render(<SeatCard {...SEAT} team={null} medal={row({ medals: [] })} />)
    expect(container.querySelector('.seat__team')!.textContent).toBe('komandasiz')
    expect(container.querySelector('.seat__prog')).not.toBeNull()
    expect(container.querySelector('.seat__medals')).toBeNull()
  })

  it('rise — gerbning eng yangi katakchasi to‘ladi; yangi medal sinfi', () => {
    const { container } = render(
      <SeatCard {...SEAT} rise medal={row({ medals: [medal({ code: 'jump' })] })} newKeys={new Set(['jump'])} />,
    )
    expect(container.querySelectorAll('use.crest__cell--fill')).toHaveLength(1)
    expect(container.querySelector('.seat__medals svg.medal--new[data-medal="jump"]')).not.toBeNull()
  })
})

describe('RowMedals — qator medallari (spec §3)', () => {
  const seven = [
    medal({ code: 'month-gold', count: 2 }),
    medal({ code: 'streak-fire' }),
    medal({ code: 'conversion-master' }),
    medal({ code: 'day-record' }),
    medal({ code: 'clean-month' }),
    medal({ code: 'day-winner', count: 5 }),
    medal({ code: 'first-sale' }),
  ]

  it('first-sale yashirin, MEDAL_ORDER bo‘yicha 3 ta, qolgani «+N», ×N yo‘q', () => {
    const { container } = render(<RowMedals medals={[...seven].reverse()} />)
    expect([...container.querySelectorAll('.row__medals svg.medal')].map((m) => m.getAttribute('data-medal'))).toEqual([
      'month-gold',
      'streak-fire',
      'conversion-master',
    ])
    expect(container.querySelector('.row__more')!.textContent).toBe('+3')
    expect(container.querySelector('.medal-count')).toBeNull()
    expect(container.querySelector('.medal-group')).toBeNull()
    expect(container.querySelector('svg[data-medal="month-gold"]')!.getAttribute('aria-label')).toBe('Oy chempioni')
  })

  it('uchta yoki kamroq — «+N» yo‘q', () => {
    const { container } = render(<RowMedals medals={seven.slice(0, 3)} />)
    expect(container.querySelectorAll('svg.medal')).toHaveLength(3)
    expect(container.querySelector('.row__more')).toBeNull()
  })

  it('faqat first-sale — uya bo‘sh, lekin konteyner grid uchun qoladi', () => {
    const { container } = render(<RowMedals medals={[medal({ code: 'first-sale' })]} />)
    expect(container.querySelector('.row__medals')).not.toBeNull()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('.row__more')).toBeNull()
  })

  it('yangi medal sinfi — faqat o‘sha medalda', () => {
    const { container } = render(<RowMedals medals={seven} newKeys={new Set(['streak-fire'])} />)
    expect(container.querySelector('svg.medal--new[data-medal="streak-fire"]')).not.toBeNull()
    expect(container.querySelectorAll('.medal--new')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Testni ishga tushirish — qizil**

Run: `npx vitest run tests/features/sellersEfir.test.tsx`
Expected: FAIL — `@/features/sellers/SeatCard` topilmadi.

- [ ] **Step 3: Katalog yordamchilari**

`src/features/sellers/medalCatalog.ts` da:

(a) Importlar (fayl boshi) — ikki satrni shunday qiling:
```ts
import type { MedalCode, SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { formatCompactUzs, formatSomFull } from '@/lib/format'
```

(b) Fayl OXIRIGA (`sortMedals` dan keyin) qo'shing:

```ts

/**
 * Keyingi darajagacha bosib o'tilgan yo'l, 0,03…1 ga qisilgan (spec §4).
 *
 * PASTDAN 0,03: bo'sh yo'l bilan «endigina boshlandi» bir xil ko'rinmasin —
 * uch foiz 10 px yo'lda ko'rinadigan eng kichik uch. YUQORIDAN 1: `nextLevelAt`
 * motordan keladi va bir yetkazishda ostonadan oshib ketish mumkin. 0-daraja
 * — bo'sh yo'l: kutilayotgan voqea, bosib o'tilgan yo'l emas.
 */
export function progressOf(row: SellerMedalRowDto): number {
  if (row.level === 0) return 0
  const span = Math.max(1, row.nextLevelAt.amount - row.levelFloor.amount)
  const share = (row.delivered.amount - row.levelFloor.amount) / span
  return Math.max(0.03, Math.min(1, share))
}

/**
 * «Ustozga 127 010 000 qoldi» — keyingi darajagacha qolgan pul, TO'LIQ SO'M
 * (spec §1: «mln» sahifadan ketdi). 0-darajada gap boshqacha — qoladigan pul
 * emas, kutilayotgan voqea. Jo'nalish kelishigi `dativeOf` da («Legenda II ga»).
 */
export function nextLevelSentence(row: SellerMedalRowDto): string {
  if (row.level === 0) return 'Birinchi savdo kutilmoqda'
  const left = Math.max(0, row.nextLevelAt.amount - row.delivered.amount)
  return `${dativeOf(row.nextTitle)} ${formatSomFull(left)} qoldi`
}
```

(`mlnLabel` va `formatCompactUzs` hozircha qoladi — `LevelBlock.tsx` va eski test ularni o'qiydi; 4-vazifada o'chadi.)

- [ ] **Step 4: `SeatCard.tsx`**

`src/features/sellers/SeatCard.tsx`:

```tsx
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
```

- [ ] **Step 5: `RowMedals.tsx`**

`src/features/sellers/RowMedals.tsx` ni butunlay quyidagi bilan almashtiring:

```tsx
import { MedalMark } from '@/features/sellers/MedalMark'
import { HIDDEN_IN_ROWS, sortMedals } from '@/features/sellers/medalCatalog'
import type { MedalCode, SellerMedalDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/** Qatorda nechta; qolgani «+N». Aylanish yo'q — 100 qator bir vaqtda o'zgarmaydi. */
export const ROW_MEDALS = 3

/**
 * Qator medallari (spec §3): `first-sale` yashirin (100 dan 92 tasida bor),
 * `MEDAL_ORDER` bo'yicha eng nodir avval, 3 ta + «+N», ×N YO'Q (aria ham
 * sanoqsiz — `count` berilmaydi).
 *
 * KONTEYNER HAR DOIM CHIZILADI. Qator — CSS grid, va bolalar tartib bilan
 * uyalarga tushadi: bo'sh uya o'rniga hech narsa qaytarilsa FAKT 2 medal
 * ustuniga surilib ketadi.
 */
export function RowMedals({
  medals,
  newKeys,
}: {
  medals: readonly SellerMedalDto[]
  newKeys?: ReadonlySet<MedalCode>
}) {
  const visible = sortMedals(medals, HIDDEN_IN_ROWS)
  const shown = visible.slice(0, ROW_MEDALS)
  const rest = visible.length - shown.length
  return (
    <span className="row__medals">
      {shown.map((m) => (
        <MedalMark key={m.code} code={m.code} isNew={newKeys?.has(m.code) ?? false} />
      ))}
      {rest > 0 && <span className="row__more">+{formatNumber(rest)}</span>}
    </span>
  )
}
```

- [ ] **Step 6: Testni ishga tushirish — yashil**

Run: `npx vitest run tests/features/sellersEfir.test.tsx`
Expected: PASS (17 + 21 = 38 ta test).

- [ ] **Step 7: O‘rindiq CSS — EFIR 2-bo‘lak**

```bash
cat > /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/efir-2.css <<'CSS'
/* ---- podium: 2-1-3, pastlari tekislangan, ierarxiya massa bilan (spec §4) ---- */
.tv-podium {
  flex: none;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 12px;
  padding: 12px 6px 4px;
}
/* O'rindiqlar ustun kengligiga qarab qisqaradi (yon panel ochiq bo'lsa ustun
   torroq); spec o'lchamlari — maksimum. DOM tartibi 1-2-3 (ekran o'quvchi
   chempionni birinchi eshitadi), ko'z uchun `order` 2-1-3. */
.seat {
  position: relative;
  flex: 1 1 0;
  max-width: 308px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px 12px 24px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.seat--1 {
  flex: 1.48 1 0;
  max-width: 456px;
  padding: 12px 16px 12px 24px;
  order: 2;
}
.seat--2 { order: 1; }
.seat--3 { order: 3; }
/* Chap chetida 10 px `--tier` tasma; 0-daraja — 1 px kontur. */
.seat::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 10px;
  background: var(--tier);
  transition: background var(--duration-move) var(--ease-out);
}
.seat[data-tier="0"]::before {
  background: transparent;
  box-shadow: inset 1px 0 0 var(--tier);
}
.seat__top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.seat--1 .seat__top { gap: 14px; }
.seat__who { min-width: 0; }
.seat__name {
  margin: 0;
  display: flex;
  flex-direction: column;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.14;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
}
.seat--1 .seat__name { font-size: var(--tv-l); }
.seat__sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 0;
  font-size: var(--tv-m);
  color: var(--ink-muted);
}
.seat__team {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}
/* Daraja so'zi — BIR MARTA, gerb yonida, `--tier` rangida. */
.seat__level {
  font-weight: 600;
  color: var(--tier);
  white-space: nowrap;
}
.seat__figure {
  display: block;
  font-size: var(--tv-xl);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--ink-primary);
  font-variant-numeric: tabular-nums lining-nums;
  white-space: nowrap;
}
.seat__facts {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin: 5px 0 0;
  white-space: nowrap;
}
.seat__cap {
  font-size: var(--tv-s);
  color: var(--ink-muted);
}
.seat__other {
  font-size: var(--tv-m);
  color: var(--ink-secondary);
  font-variant-numeric: tabular-nums;
}
.seat__other b {
  color: var(--ink-primary);
  font-weight: 600;
}
.seat__bar {
  height: 10px;
  border-radius: 5px;
  background: var(--track);
  overflow: hidden;
}
.seat__bar i {
  display: block;
  height: 100%;
  border-radius: 5px;
  background: var(--tier);
  transition: width var(--duration-move) var(--ease-out);
}
.seat__next {
  margin: 6px 0 0;
  font-size: var(--tv-m);
  color: var(--ink-secondary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.seat__medals {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 24px;
}
/* Gravyura rangi o'rindiqda — ko'tarilgan sirt. */
.seat .medal { --cut: var(--surface-raised); }
CSS
node - <<'JS'
const fs = require('fs')
const S = '/tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/'
const css = fs.readFileSync('src/app/globals.css', 'utf8')
const marker = '/* EFIR — kamaytirilgan harakat'
const at = css.indexOf(marker)
if (at < 0) throw new Error('EFIR marker topilmadi')
if (css.includes('.seat--1 {')) throw new Error('o‘rindiq CSS allaqachon bor')
const chunk = fs.readFileSync(S + 'efir-2.css', 'utf8').trim() + '\n\n'
fs.writeFileSync('src/app/globals.css', css.slice(0, at) + chunk + css.slice(at))
console.log('ok')
JS
```

- [ ] **Step 8: `efirCss.test.ts` ga o‘rindiq faktlari**

`tests/features/efirCss.test.ts` OXIRIGA qo'shing:

```ts

describe('EFIR — o‘rindiq', () => {
  it('uchta karta 2-1-3 tartibida, pastlari tekis; tasma va yo‘l `--tier` da; o‘rindiq medali ko‘tarilgan sirtga o‘yiladi', () => {
    const code = strip(EFIR())
    expect(code).toMatch(/\.tv-podium \{[^}]*align-items: flex-end;/)
    expect(code).toContain('.seat--1 {\n  flex: 1.48 1 0;\n  max-width: 456px;')
    expect(code).toContain('.seat--2 { order: 1; }')
    expect(code).toContain('.seat--3 { order: 3; }')
    expect(code).toMatch(/\.seat::before \{[^}]*width: 10px;[^}]*background: var\(--tier\);/)
    expect(code).toMatch(/\.seat\[data-tier="0"\]::before \{[^}]*box-shadow: inset 1px 0 0 var\(--tier\);/)
    expect(code).toMatch(/\.seat__bar i \{[^}]*background: var\(--tier\);/)
    expect(code).toMatch(/\.seat__level \{[^}]*color: var\(--tier\);/)
    expect(code).toContain('.seat .medal { --cut: var(--surface-raised); }')
    // Pedestal, bevel, xrom, sharpa, shtamp — hech biri yo'q.
    for (const gone of ['pedestal', 'lv-stamps', 'lv-ghost', 'lv-sheen', 'podium-shine']) expect(code).not.toContain(gone)
  })
})
```

- [ ] **Step 9: Eski testlarga yamoq**

(a) `tests/features/sellersTvBoard.test.tsx` — uchta joy, aynan:

1. `it('jadval qatori: chapda lavha, ism yonida unvon so‘zi, o‘ngda medal'` ichida
   ```ts
       expect(cell.querySelector('.tv-rowmedals svg[data-medal="month-gold"]')).not.toBeNull()
   ```
   → `expect(cell.querySelector('.row__medals svg[data-medal="month-gold"]')).not.toBeNull()`
2. `it('ostonaga yaqin qator ko‘karadi; hali savdosiz qator 0-daraja plastinasi bilan turadi'` ichida
   ```ts
       expect(zero.querySelector('.tv-rowmedals')).toBeNull()
   ```
   → `expect(zero.querySelector('.row__medals svg')).toBeNull()`
3. `it('qo‘shilgan medal seatda ham, qatorda ham kattalashib tushadi — va boshqa hech qayerda'` ichida
   ```ts
       expect(rowEl.querySelector('.tv-rowmedals .medal-slot--new svg[data-medal="day-winner"]')).not.toBeNull()
   ```
   → `expect(rowEl.querySelector('.row__medals svg.medal--new[data-medal="day-winner"]')).not.toBeNull()`
   va
   ```ts
       expect(col.querySelectorAll('.medal-slot--new')).toHaveLength(2)
   ```
   → `expect(col.querySelectorAll('.medal-slot--new, .medal--new')).toHaveLength(2)`

(b) `tests/features/sellersLavha.test.tsx` — `describe('MedalRail va RowMedals'` ichidagi `it('qatorda 3 ta + N, pill yo‘q, yangi medal sinfi', …)` blokini butunlay o'chiring va `import { RowMedals } from '@/features/sellers/RowMedals'` satrini o'chiring (`grep -n RowMedals tests/features/sellersLavha.test.tsx` → faqat `describe` nomida qoladi; uni ham `describe('MedalRail', …)` qiling).

- [ ] **Step 10: Testlar va tur tekshiruvi**

Run: `npx vitest run tests/features/sellersEfir.test.tsx tests/features/efirCss.test.ts tests/features/sellersTvBoard.test.tsx tests/features/sellersLavha.test.tsx`
Expected: PASS — hammasi.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: xatosiz.

- [ ] **Step 11: Commit**

```bash
git add src/features/sellers/SeatCard.tsx src/features/sellers/RowMedals.tsx src/features/sellers/medalCatalog.ts src/app/globals.css tests/features/sellersEfir.test.tsx tests/features/efirCss.test.ts tests/features/sellersTvBoard.test.tsx tests/features/sellersLavha.test.tsx
git commit -m "feat(sellers): EFIR o'rindig'i — SeatCard (halqa, ikki qatorli ism, gerb, progress, medallar) va qator medallari

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 4: `SellersPage` — ikkala ustun EFIR'ga, eski kod va CSS o‘chadi

**Files:**
- Create: `src/features/sellers/board.ts`, `src/features/sellers/FaktSwitch.tsx`, `src/features/sellers/ColumnHead.tsx`, `src/features/sellers/SellersBoard.tsx`, `src/features/sellers/TeamsBoard.tsx`
- Modify: `src/features/sellers/SellersPage.tsx` (butunlay qayta), `src/features/sellers/PromotionBanner.tsx` (butunlay), `src/features/sellers/medalCatalog.ts` (`mlnLabel` va `formatCompactUzs` importi o'chadi)
- Modify: `src/app/globals.css` — PODIUM, LAVHA, MEDAL, DARAJA BLOKI bo'limlari butunlay o'chadi; TV BOARD bo'limi qayta yoziladi (rekord devori bloki saqlanadi); EFIR 3-bo'lak (qator, komandalar, e'lon, harakat)
- Modify: `CLAUDE.md` — bitta satr (`rankedBy` ning joyi)
- Delete: `src/features/sellers/Lavha.tsx`, `Medal.tsx`, `LevelBlock.tsx`, `MedalRail.tsx`, `SpeakingMedal.tsx`, `Narvon.tsx`, `useMedalRotation.ts`, `medalReason.ts` (yagona importeri `SpeakingMedal` edi); `tests/features/sellersLavha.test.tsx`, `tests/features/useMedalRotation.test.ts`; `docs/superpowers/specs/assets/2026-09-16-daraja/` (spec §10)
- Test: `tests/features/sellersTvBoard.test.tsx` (butunlay qayta), `tests/features/tvBoardLayout.test.ts` (butunlay qayta), `tests/features/efirCss.test.ts` (kengayadi)

Importerlar (o'chirilayotgan fayllarni kim o'qiydi — `grep -rn --include='*.ts' --include='*.tsx' -E "sellers/(Lavha|Medal|LevelBlock|MedalRail|SpeakingMedal|Narvon|useMedalRotation|medalReason)'" src tests`): `SellersPage.tsx` (Lavha, LevelBlock, MedalRail, Narvon, SpeakingMedal, useMedalRotation), `PromotionBanner.tsx` (Lavha), `LevelBlock.tsx`/`Narvon.tsx` (Lavha — o'zlari o'chadi), `MedalRail.tsx`/`SpeakingMedal.tsx` (Medal — o'chadi), `SpeakingMedal.tsx` (medalReason — o'chadi), `tests/features/sellersLavha.test.tsx` va `useMedalRotation.test.ts` (o'chadi). Hammasi shu vazifada.

**Interfaces:**
- Consumes: `SeatCard`, `RowMedals` (3-vazifa); `Crest`, `Halo`, `metalOfRank`, `TierLegend`, `MedalDefs`, `thresholdSomOf` (2-vazifa); `formatSomFull`, `formatPercentUz`, `NARROW_NBSP` (1-vazifa); `usePromotions`, `useNewMedals`, `useAutoScroll`, `PageShell`, `useDashboardFilters`, `EmptyState`, `ErrorState` (mavjud).
- Produces:
  ```ts
  // board.ts
  export type FaktChoice = 'auto' | 'fakt1' | 'fakt2'
  export interface BoardEntry { key; rank; name; badge: string | null; sellers: number | null; won; ordered; wonOrders; orders; openOrders: number | null; conversionPercent: number | null; sharePercent: number | null }
  export function fromSeller(row: SellerBoardRowDto): BoardEntry
  export function fromTeam(row: SellerTeamRowDto): BoardEntry
  export function rankedBy(entries: readonly BoardEntry[], onDelivered: boolean): readonly BoardEntry[]   // servis oynasi — o'zgarmaydi
  export function resolveOnDelivered(entries: readonly BoardEntry[], fakt: FaktChoice): boolean
  export function figureOf(entry: BoardEntry, onDelivered: boolean): number
  // FaktSwitch.tsx
  export function FaktSwitch(props: { fakt: 'fakt1' | 'fakt2'; onFakt: (choice: FaktChoice) => void }): JSX   // .tv-fakt[data-fakt] > button.tv-fakt-tab[aria-pressed]×2
  // ColumnHead.tsx
  export function ColumnHead(props: { id: string; title: string; count: string | null; fakt: 'fakt1' | 'fakt2'; onFakt; children?: ReactNode }): JSX  // header.tv-col-head > h2#ID-heading, .tv-col-head__count, FaktSwitch (count !== null), children (e'lon)
  // SellersBoard.tsx / TeamsBoard.tsx
  export type Status = 'loading' | 'error' | 'ready'
  export function SellersBoard(props: { entries; status; errorMessage?; onRetry; parked; fakt; onFakt; medals; medalsToday }): JSX
  export function TeamsBoard(props: { entries; teamless: number; status; errorMessage?; onRetry; parked; fakt; onFakt }): JSX
  // SellersPage.tsx
  export interface ColumnProps { data; status; errorMessage?; onRetry; parked?; fakt; onFakt; medals; medalsToday }
  export function SellersColumn(props: ColumnProps): JSX   // <section id="tv-sellers" class="tv-col tv-col--sellers">
  export function TeamsColumn(props: ColumnProps): JSX     // <section id="tv-teams" class="tv-col tv-col--teams">
  ```
  DOM shartnomasi (testlar shunga tayanadi): sotuvchilar ustuni = `.tv-col-head` → (`.tv-podium` > `article.seat[data-seat-name]`×≤3 | `p.tv-empty-podium`) → `div.tv-cols[data-read]` (yorliq qatori, 8 ta yorliq) → `ol.tv-rows[data-read]` > `li.row[data-tier]` (`.row__band .row__rank .crest .row__name>.row__team .row__medals .row__f2 .row__f1 .row__orders .row__conv`) → `.tv-legend` (medal so'rovi kelganda). Komandalar = `.tv-col-head` → `div.tv-tcols` → `ol.tv-trows[data-read]` > `li.trow[style --share]` (`.trow__rank[data-metal] .trow__name .trow__cnt .trow__f2 .trow__share .trow__f1 .trow__orders .trow__conv`) → `p.tv-tfoot`.

- [ ] **Step 1: `sellersTvBoard.test.tsx` ni butunlay qayta yozish**

`tests/features/sellersTvBoard.test.tsx` ni quyidagi bilan ALMASHTIRING (eski fayl o'rniga):

```tsx
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MedalDefs } from '@/features/sellers/MedalDefs'
import { resetCelebrations } from '@/features/sellers/usePromotions'
import type { MedalCode, SellerBoardDto, SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { NARROW_NBSP, formatSomFull } from '@/lib/format'

/**
 * THE TELEVISION BOARD — EFIR (spec 2026-09-16-efir-taxta): two columns,
 * the sellers' a podium of three seats over a timing-tower list, the teams'
 * a one-line list with metal numerals.
 *
 * What these tests pin is what a seller reading the floor's TV from a desk
 * away would notice if it broke — and could not tell anyone about, because
 * nothing errors:
 *
 * - The seat says WHICH FACT put the person there («FAKT 2» caption, the
 *   other fact beside it). Production 2026-09-04: «Bugun» printed confirmed
 *   money in the slot «Shu oy» printed delivered, and the month read as
 *   smaller than the day.
 * - The rows continue the podium: the first three are on screen once, the
 *   label strip is OUTSIDE the scroll box so the fourth row is never hidden.
 * - The level WORD is said once, on the seat; rows carry the band and the
 *   crest only. `first-sale` is never drawn in a row.
 * - The FAKT 1 / FAKT 2 switch re-ranks the board it is pressed on AND the
 *   one beside it, with the service's own competition ranking.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/sellers',
  useSearchParams: () => new URLSearchParams(''),
}))

/*
  Reduced motion, answered "yes": `AnimatedNumber` then prints its final
  value once, and `useAutoScroll` — a list that moves on its own — stays off.
*/
window.matchMedia = ((query: string) => ({
  matches: query.includes('prefers-reduced-motion'),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const { SellersColumn, TeamsColumn } = await import('@/features/sellers/SellersPage')

const S = NARROW_NBSP

function money(amount: number) {
  return { amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount }
}

/** Only the fields the seats and rows read. */
function seller(fullName: string, rank: number, won: number, ordered: number, rop: string | null = null) {
  return {
    employeeId: fullName,
    rank,
    fullName,
    rop,
    orders: 3,
    wonOrders: won > 0 ? 2 : 0,
    openOrders: 0,
    ordered: money(ordered),
    won: money(won),
    sharePercent: null,
    conversionPercent: won > 0 ? 91.3 : null,
    bonus: { earned: money(0), toNext: null, toNextPercent: null, eligible: false },
  }
}

function team(rop: string, rank: number, sellers: number, won: number, ordered: number) {
  return {
    rank,
    rop,
    sellers,
    orders: 10,
    wonOrders: won > 0 ? 6 : 0,
    ordered: money(ordered),
    won: money(won),
    open: money(0),
    conversionPercent: null,
    sharePercent: null,
  }
}

function board(over: {
  rows?: ReturnType<typeof seller>[]
  teams?: ReturnType<typeof team>[]
  orders: number
  wonOrders: number
  won?: number
  teamlessSellers?: number
}): SellerBoardDto {
  return {
    rows: over.rows ?? [],
    teams: over.teams ?? [],
    totals: {
      orders: over.orders,
      wonOrders: over.wonOrders,
      won: money(over.won ?? 0),
      teamlessSellers: over.teamlessSellers ?? 0,
    },
  } as unknown as SellerBoardDto
}

const PROPS = {
  status: 'ready' as const,
  onRetry: () => {},
  fakt: 'auto' as const,
  onFakt: () => {},
  medals: new Map<string, SellerMedalRowDto>(),
  medalsToday: null,
}

/**
 * The page's own wiring: ONE choice, pressed from either heading.
 * `SellersPage` holds this state — see the block there for why it is not two.
 */
function Board({ data, medals = PROPS.medals }: { data: SellerBoardDto; medals?: ReadonlyMap<string, SellerMedalRowDto> }) {
  const [fakt, setFakt] = useState<'auto' | 'fakt1' | 'fakt2'>('auto')
  const props = {
    status: 'ready' as const,
    onRetry: () => {},
    fakt,
    onFakt: setFakt,
    medals,
    medalsToday: null,
  }
  return (
    <>
      <MedalDefs />
      <SellersColumn data={data} {...props} />
      <TeamsColumn data={data} {...props} />
    </>
  )
}

const column = (id: 'tv-sellers' | 'tv-teams') => within(document.getElementById(id)!)

/** Presses FAKT 1 (or FAKT 2) in one column's heading. */
function press(id: 'tv-sellers' | 'tv-teams', label: string) {
  fireEvent.click(column(id).getByRole('button', { name: label }))
}

/** The seats of the sellers column, in DOM order — which is 1, 2, 3. */
const seatsOf = () =>
  [...document.querySelectorAll('#tv-sellers .seat')].map((s) => s.getAttribute('data-seat-name'))

/** The rank each seat's halo states: the RANKING, not the seat. */
const ranksOf = () => [...document.querySelectorAll('#tv-sellers .halo')].map((h) => h.textContent)

const rowNamesOf = (id: 'tv-sellers' | 'tv-teams') =>
  [...document.querySelectorAll(`#${id} .row__name, #${id} .trow__name`)].map(
    (n) => n.firstChild?.textContent ?? '',
  )

const rowOf = (name: string) => screen.getByText(name, { selector: '.row__name' }).closest('li.row')!
const seatOf = (name: string) => document.querySelector(`#tv-sellers .seat[data-seat-name="${name}"]`)!

/* «Shu oy» on 2026-09-04: 22 of 263 orders delivered, so 8% decides the rank. */
const THIN = board({
  orders: 263,
  wonOrders: 22,
  won: 32_000_000,
  rows: [
    seller('Sotuvchi 156', 1, 3_300_000, 4_300_000),
    seller('164 Sotuvchi', 2, 3_200_000, 12_500_000),
    seller('Axtamova 177 Sabina', 3, 3_100_000, 7_800_000),
  ],
  teams: [
    team('Gulzora', 1, 12, 20_000_000, 200_000_000),
    team('Sevinch', 2, 9, 12_000_000, 150_000_000),
  ],
})

/* «Bugun»: nothing delivered, so the places fall back to confirmed money. */
const FALLBACK = board({
  orders: 79,
  wonOrders: 0,
  rows: [
    seller('Saparboyeva 110 Farida', 1, 0, 12_900_000),
    seller('Ashrafova 172 Marjona', 2, 0, 9_000_000),
  ],
})

/* «Oʻtgan oy»: 73 of 99 delivered — the ranking rests on the majority. */
const RIPE = board({
  orders: 99,
  wonOrders: 73,
  won: 234_950_000,
  rows: [
    seller('154 Marjona Xayrullayeva', 1, 126_950_000, 154_350_000, 'Gulzora'),
    seller('Saparboyeva 110 Farida', 2, 108_000_000, 144_500_000, 'Sevinch'),
    seller('Yusupova 139 Mahliyo', 3, 41_000_000, 60_000_000, 'Lola'),
    seller('Nodira 118 Karimova', 4, 39_000_000, 52_000_000, 'Gulzora'),
    seller('Aziza 121 Toshmatova', 5, 20_000_000, 31_000_000, null),
    /* Qator chekkalari: ostonaga yaqin turgan va hali savdo qilmagan ikki
       sotuvchi. Medal oynasi taxtanikidan boshqa — davr puli kichkina bo'lsa
       ham daraja katta bo'lishi mumkin. */
    seller('Qodirova 188 Zilola', 6, 8_000_000, 11_000_000, 'Lola'),
    seller('Rustamov 201 Diyor', 7, 0, 0, 'Azizbek'),
  ],
  teams: [
    team('Gulzora', 1, 12, 165_950_000, 206_350_000),
    team('Sevinch', 2, 9, 108_000_000, 144_500_000),
    team('Lola', 3, 7, 41_000_000, 60_000_000),
    team('Azizbek', 4, 8, 12_000_000, 30_000_000),
  ],
  teamlessSellers: 1,
})

/* «Bugun» on the teams side: four teams, nothing delivered — read on FAKT 1. */
const TEAM_FALLBACK = board({
  orders: 120,
  wonOrders: 0,
  teams: [
    team('Gulzora', 1, 12, 0, 40_000_000),
    team('Azizbek', 2, 14, 0, 15_000_000),
    team('Asliddin', 3, 8, 0, 2_000_000),
    team('Baza', 4, 5, 0, 1_000_000),
  ],
})

/*
  «Shu oy», crossed: the order the floor has DELIVERED is not the order it has
  CONFIRMED. Reading FAKT 2 seats Marjona, Farida, Mahliyo — reading FAKT 1
  seats Farida, Nodira, Marjona, and not one assertion below is true of both.
*/
const CROSSED = board({
  orders: 300,
  wonOrders: 120,
  won: 285_000_000,
  rows: [
    seller('Ashrafova 172 Marjona', 1, 120_000_000, 130_000_000, 'Gulzora'),
    seller('Saparboyeva 110 Farida', 2, 90_000_000, 240_000_000, 'Sevinch'),
    seller('Yusupova 139 Mahliyo', 3, 60_000_000, 70_000_000, 'Gulzora'),
    seller('Nodira 118 Karimova', 4, 10_000_000, 200_000_000, 'Lola'),
    seller('Aziza 121 Toshmatova', 5, 5_000_000, 20_000_000, 'Lola'),
  ],
  teams: [
    team('Gulzora', 1, 12, 180_000_000, 200_000_000),
    team('Sevinch', 2, 9, 90_000_000, 240_000_000),
    team('Lola', 3, 7, 15_000_000, 220_000_000),
  ],
})

/*
  Two sellers level on BOTH facts, one ahead of them on FAKT 1 alone, one
  behind them on everything. Competition ranking is the service's own rule and
  the switch has to keep it whichever way the keys are ordered.
*/
const TIED = board({
  orders: 60,
  wonOrders: 12,
  won: 26_000_000,
  rows: [
    seller('Karimova Aziza', 1, 10_000_000, 30_000_000),
    seller('Karimova Barno', 1, 10_000_000, 30_000_000),
    seller('Toshmatova Charos', 3, 5_000_000, 90_000_000),
    seller('Yusupova Dilnoza', 4, 1_000_000, 10_000_000),
  ],
})

function medalRow(employeeId: string, over: Partial<SellerMedalRowDto> = {}): SellerMedalRowDto {
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
      { code: 'month-gold', count: 3, at: '2026-08-01', amount: money(128_550_000), orders: 74, percent: null },
      { code: 'first-sale', count: 1, at: '2026-08-03', amount: null, orders: null, percent: null },
    ],
    ...over,
  }
}

/* RIPE taxtasining o'rindiqlari va qatorlari — `seller()` `employeeId` ni
   to'liq ismdan yasaydi, shuning uchun kalit ham shu. */
const MEDALS = new Map<string, SellerMedalRowDto>([
  ['154 Marjona Xayrullayeva', medalRow('154 Marjona Xayrullayeva')],
  [
    'Nodira 118 Karimova',
    medalRow('Nodira 118 Karimova', {
      level: 3,
      rankTitle: 'Katta sotuvchi',
      delivered: money(81_300_000),
      levelFloor: money(30_000_000),
      nextLevelAt: money(100_000_000),
      nextTitle: 'Usta',
    }),
  ],
  /* Faqat «Birinchi savdo»si bor sotuvchi — qatorda medal uyasi ataylab bo'sh. */
  [
    'Qodirova 188 Zilola',
    medalRow('Qodirova 188 Zilola', {
      level: 3,
      rankTitle: 'Katta sotuvchi',
      delivered: money(95_000_000),
      levelFloor: money(30_000_000),
      nextLevelAt: money(100_000_000),
      nextTitle: 'Usta',
      medals: [{ code: 'first-sale', count: 1, at: '2026-08-03', amount: null, orders: null, percent: null }],
    }),
  ],
  /* Hali savdosiz: 0-daraja, unvonsiz, medalsiz. */
  [
    'Rustamov 201 Diyor',
    medalRow('Rustamov 201 Diyor', {
      level: 0,
      rankTitle: null,
      delivered: money(0),
      levelFloor: money(0),
      nextLevelAt: money(0.01),
      nextTitle: 'Yangi',
      medals: [],
    }),
  ],
])

describe('o‘rindiq qaysi faktni aytadi', () => {
  it('yetkazilgan pul o‘rin bergan bo‘lsa — «FAKT 2» yozuvi, yonida FAKT 1 raqami', () => {
    render(<SellersColumn data={THIN} {...PROPS} />)
    const caps = [...document.querySelectorAll('#tv-sellers .seat__cap')].map((c) => c.textContent)
    expect(caps).toEqual(['FAKT 2', 'FAKT 2', 'FAKT 2'])
    expect(seatOf('Sotuvchi 156').querySelector('.seat__other')!.textContent).toBe(`FAKT 1 4${S}300${S}000`)
  })

  it('hech kim yetkazmagan bo‘lsa — «FAKT 1» yozuvi, FAKT 2 satri chizilmaydi', () => {
    render(<SellersColumn data={FALLBACK} {...PROPS} />)
    const caps = [...document.querySelectorAll('#tv-sellers .seat__cap')].map((c) => c.textContent)
    expect(caps).toEqual(['FAKT 1', 'FAKT 1'])
    expect(document.querySelector('#tv-sellers .seat__other')).toBeNull()
  })

  it('sarlavha ostida qoida yozuvi va legenda yo‘q; sarlavhada soni', () => {
    render(<SellersColumn data={THIN} {...PROPS} />)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/oʻrinlar hozircha/)
    expect(text).not.toMatch(/Avval FAKT 2/)
    expect(document.querySelector('.tv-legend-swatch')).toBeNull()
    expect(column('tv-sellers').getByText('3 sotuvchi')).toBeDefined()
  })
})

describe('o‘rindiqda nima bor, nima yo‘q', () => {
  it('bonus, «oldinda», pedestal, podium xromi — hech biri yo‘q', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    expect(document.body.textContent).not.toMatch(/bonus/i)
    expect(document.body.textContent).not.toMatch(/oldinda/)
    for (const gone of ['.tv-pedestal', '.podium-card', '.podium-plaque', '.medal-ring', '.tv-seat-card']) {
      expect(document.querySelector(gone), gone).toBeNull()
    }
  })

  it('uch o‘rindiq: halqada rank, metall 1/2/3, DOM tartibi 1-2-3', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    expect(seatsOf()).toEqual(['154 Marjona Xayrullayeva', 'Saparboyeva 110 Farida', 'Yusupova 139 Mahliyo'])
    expect(ranksOf()).toEqual(['1', '2', '3'])
    expect([...document.querySelectorAll('#tv-sellers .halo')].map((h) => h.getAttribute('data-metal'))).toEqual([
      'gold', 'silver', 'bronze',
    ])
    expect(document.querySelector('#tv-sellers .seat--1 .halo--lg')).not.toBeNull()
  })

  it('daraja so‘zi HAR o‘rindiqda bir marta, qatorlarda hech qachon', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const seat = seatOf('154 Marjona Xayrullayeva')
    expect(seat.querySelectorAll('.seat__level')).toHaveLength(1)
    expect(seat.querySelector('.seat__level')!.textContent).toBe('Usta')
    expect(document.querySelectorAll('#tv-sellers .tv-rows .seat__level')).toHaveLength(0)
    const rows = document.getElementById('tv-sellers')!.querySelector('.tv-rows')!
    expect(rows.textContent).not.toMatch(/Katta sotuvchi|Usta|hali savdosiz/)
  })
})

describe('o‘rindiq ostidagi qatorlar (spec §5)', () => {
  it('4-o‘rindan boshlanadi; yorliq qatori skroll qutisidan TASHQARIDA, uning oldida', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    const col = document.getElementById('tv-sellers')!
    const strip = col.querySelector('.tv-cols')!
    const rows = col.querySelector('ol.tv-rows')!
    expect(strip.nextElementSibling).toBe(rows)
    expect(rows.contains(strip)).toBe(false)
    expect(rows.querySelector('.tv-cols')).toBeNull()
    expect(rowNamesOf('tv-sellers')[0]).toBe('Nodira 118 Karimova')
    expect(rowNamesOf('tv-sellers')).not.toContain('154 Marjona Xayrullayeva')
    expect(rowOf('Nodira 118 Karimova').querySelector('.row__rank')!.textContent).toBe('4')
  })

  it('sakkizta yorliq: # Daraja Sotuvchi Medallar FAKT 2 FAKT 1 Buyurtma Konv.', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    const labels = [...document.querySelectorAll('#tv-sellers .tv-cols span')]
      .map((s) => s.textContent)
      .filter((t) => t !== '')
    expect(labels).toEqual([
      '#', 'Daraja', 'Sotuvchi', 'Medallar', 'FAKT 2, yetkazilgan', 'FAKT 1, tasdiqlangan', 'Buyurtma', 'Konv.',
    ])
  })

  it('har qatorda ikkala fakt to‘liq so‘mda, buyurtma va konversiya «91,3 %»; «Oldingiga» satri yo‘q', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    const row = rowOf('Nodira 118 Karimova')
    expect(row.querySelector('.row__f2')!.textContent).toBe(`39${S}000${S}000`)
    expect(row.querySelector('.row__f1')!.textContent).toBe(`52${S}000${S}000`)
    expect(row.querySelector('.row__orders')!.textContent).toBe('3')
    expect(row.querySelector('.row__conv')!.textContent).toBe(`91,3${S}%`)
    expect(row.querySelector('.row__team')!.textContent).toBe('Gulzora')
    expect(document.querySelector('.tv-chase')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Oldingiga|Lider/)
    expect(document.body.textContent).not.toMatch(/mln|soʻm|so‘m/)
  })

  it('puli yo‘q qator rank o‘rniga chiziqcha, konversiyasi chiziqcha', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    const zero = rowOf('Rustamov 201 Diyor')
    expect(zero.querySelector('.row__rank')!.textContent).toBe('—')
    expect(zero.querySelector('.row__conv')!.textContent).toBe('—')
  })

  it('podium hammani o‘tqazganda qatorlar ham, yorliq qatori ham chizilmaydi', () => {
    render(<SellersColumn data={THIN} {...PROPS} />)
    expect(document.querySelector('.tv-rows')).toBeNull()
    expect(document.querySelector('.tv-cols')).toBeNull()
  })

  it('o‘qilayotgan fakt qatorda `data-read` bilan belgilanadi', () => {
    render(<Board data={CROSSED} />)
    expect(document.querySelector('#tv-sellers .tv-rows')!.getAttribute('data-read')).toBe('fakt2')
    expect(document.querySelector('#tv-sellers .tv-cols')!.getAttribute('data-read')).toBe('fakt2')
    press('tv-sellers', 'FAKT 1')
    expect(document.querySelector('#tv-sellers .tv-rows')!.getAttribute('data-read')).toBe('fakt1')
  })
})

describe('komandalar ustuni (spec §6)', () => {
  it('podium yo‘q; bir qatorli qatorlar; 1–3 metall raqam, qolgani none', () => {
    render(<TeamsColumn data={RIPE} {...PROPS} />)
    const col = document.getElementById('tv-teams')!
    expect(col.querySelector('.seat')).toBeNull()
    expect(col.querySelector('.tv-podium')).toBeNull()
    expect(col.querySelectorAll('li.trow')).toHaveLength(4)
    expect(rowNamesOf('tv-teams')).toEqual(['Gulzora', 'Sevinch', 'Lola', 'Azizbek'])
    expect([...col.querySelectorAll('.trow__rank')].map((r) => r.textContent)).toEqual(['1', '2', '3', '4'])
    expect([...col.querySelectorAll('.trow__rank')].map((r) => r.getAttribute('data-metal'))).toEqual([
      'gold', 'silver', 'bronze', 'none',
    ])
    expect(column('tv-teams').getByText('4 komanda')).toBeDefined()
  })

  it('sotuvchi soni, FAKT 2, ulush «50,8 %», FAKT 1; ulush chizig‘i = ulush ÷ yetakchi ulushi', () => {
    render(<TeamsColumn data={RIPE} {...PROPS} />)
    const rows = [...document.querySelectorAll('#tv-teams li.trow')] as HTMLElement[]
    expect(rows[0]!.querySelector('.trow__cnt')!.textContent).toBe('12')
    expect(rows[0]!.querySelector('.trow__f2')!.textContent).toBe(`165${S}950${S}000`)
    expect(rows[0]!.querySelector('.trow__f1')!.textContent).toBe(`206${S}350${S}000`)
    // 165 950 000 / 326 950 000 = 50,76 %; Sevinch 108 / 326,95 = 33,03 %.
    expect(rows[0]!.querySelector('.trow__share')!.textContent).toBe(`50,8${S}%`)
    expect(rows[1]!.querySelector('.trow__share')!.textContent).toBe(`33${S}%`)
    // `--share` inline style'da CSS uchun; jsdom'ning custom-property qo'llovi
    // versiyaga bog'liq, shuning uchun o'sha qiymat `data-share` da ham turadi.
    expect(rows[0]!.getAttribute('data-share')).toBe('1.000')
    expect(rows[1]!.getAttribute('data-share')).toBe('0.651')
  })

  it('yorliq qatori va pastki jumla: «1 sotuvchi komandasiz, ulushlar ularsiz»', () => {
    render(<TeamsColumn data={RIPE} {...PROPS} />)
    const labels = [...document.querySelectorAll('#tv-teams .tv-tcols span')].map((s) => s.textContent)
    expect(labels).toEqual(['#', 'Komanda (ROP)', 'Sotuvchi', 'FAKT 2, yetkazilgan', 'Ulush', 'FAKT 1', 'Buyurtma', 'Konv.'])
    expect(document.querySelector('#tv-teams .tv-tfoot')!.textContent).toBe('1 sotuvchi komandasiz, ulushlar ularsiz')
  })

  it('komandasiz sotuvchi bo‘lmasa pastki jumla chizilmaydi', () => {
    render(<TeamsColumn data={THIN} {...PROPS} />)
    expect(document.querySelector('#tv-teams .tv-tfoot')).toBeNull()
  })

  /*
    THE STATE THE BOARD OPENS IN: «Bugun», nothing delivered, the teams read
    on FAKT 1 in FAKT 1 order — the service's FAKT 2 tie-break on the ROP's
    NAME must not leak through as the ranking.
  */
  it('hech kim yetkazmagan — FAKT 1 bo‘yicha tartib, kalit FAKT 1 da yoniq', () => {
    render(<TeamsColumn data={TEAM_FALLBACK} {...PROPS} />)
    expect(rowNamesOf('tv-teams')).toEqual(['Gulzora', 'Azizbek', 'Asliddin', 'Baza'])
    expect(column('tv-teams').getByRole('button', { name: 'FAKT 1' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('#tv-teams .tv-trows')!.getAttribute('data-read')).toBe('fakt1')
    expect(document.body.textContent).not.toContain('+-')
  })
})

describe('bir taxtani boshqa faktda o‘qish', () => {
  it('ikkala sarlavhada ikkita tugma, ma‘lumot hal qilgan faktda yoniq', () => {
    render(<Board data={CROSSED} />)
    for (const id of ['tv-sellers', 'tv-teams'] as const) {
      expect(column(id).getByRole('button', { name: 'FAKT 1' }).getAttribute('aria-pressed')).toBe('false')
      expect(column(id).getByRole('button', { name: 'FAKT 2' }).getAttribute('aria-pressed')).toBe('true')
    }
    expect(document.querySelector('.tv-fakt-dot')).toBeNull()
  })

  it('tasdiqlangan pulga qayta o‘tqazadi va har o‘rindiqda aytadi', () => {
    render(<Board data={CROSSED} />)
    expect(seatsOf()).toEqual(['Ashrafova 172 Marjona', 'Saparboyeva 110 Farida', 'Yusupova 139 Mahliyo'])

    press('tv-sellers', 'FAKT 1')

    expect(seatsOf()).toEqual(['Saparboyeva 110 Farida', 'Nodira 118 Karimova', 'Ashrafova 172 Marjona'])
    expect([...document.querySelectorAll('#tv-sellers .seat__cap')].map((c) => c.textContent)).toEqual([
      'FAKT 1', 'FAKT 1', 'FAKT 1',
    ])
    // The champion's seat prints the figure it was seated on, to the last digit.
    expect(document.querySelector('#tv-sellers .seat--1 .seat__figure')!.textContent).toContain(
      formatSomFull(240_000_000),
    )
    // The seller the delivered board seated third is a row now.
    expect(rowNamesOf('tv-sellers')).toContain('Yusupova 139 Mahliyo')
    // And the seat still carries the OTHER fact beside the caption.
    expect(document.querySelector('#tv-sellers .seat--1 .seat__other')!.textContent).toBe(
      `FAKT 2 ${formatSomFull(90_000_000)}`,
    )
  })

  it('ikkinchi ustunni ham suradi, qaysi sarlavhadan bosilsa ham', () => {
    render(<Board data={CROSSED} />)
    expect(rowNamesOf('tv-teams')[0]).toBe('Gulzora')

    press('tv-sellers', 'FAKT 1')
    expect(rowNamesOf('tv-teams')[0]).toBe('Sevinch')
    expect(column('tv-teams').getByRole('button', { name: 'FAKT 1' }).getAttribute('aria-pressed')).toBe('true')

    press('tv-teams', 'FAKT 2')
    expect(seatsOf()[0]).toBe('Ashrafova 172 Marjona')
    expect(column('tv-sellers').getByRole('button', { name: 'FAKT 2' }).getAttribute('aria-pressed')).toBe('true')
  })

  /*
    THE RANKS IT DERIVES ARE THE RANKS THE SERVICE SENT. `rankedBy` mirrors
    `SellerBoardService`; read on FAKT 2 it must reproduce it exactly.
  */
  it('servis reytingini takrorlaydi — teng o‘rinlar va sakrash bilan', () => {
    render(<Board data={TIED} />)
    expect(ranksOf()).toEqual(['1', '1', '3'])
    expect(document.querySelector('#tv-sellers .row__rank')!.textContent).toBe('4')
  })

  it('kalitlar almashganda ham o‘sha qoida', () => {
    render(<Board data={TIED} />)
    press('tv-sellers', 'FAKT 1')
    expect(seatsOf()).toEqual(['Toshmatova Charos', 'Karimova Aziza', 'Karimova Barno'])
    expect(ranksOf()).toEqual(['1', '2', '2'])
    expect(document.querySelector('#tv-sellers .row__rank')!.textContent).toBe('4')
  })
})

/**
 * EFIR — o'rindiq, qator, legenda (spec §2–§5). Medal so'rovi alohida va o'z
 * soatida; kelmasa taxta hech nima sezmaydi.
 */
describe('EFIR — daraja va medallar taxtada', () => {
  it('o‘rindiq: tasma darajasi, gerb, so‘z, «… qoldi» to‘liq so‘mda, medallar ×N bilan (first-sale bor)', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const seat = seatOf('154 Marjona Xayrullayeva')
    expect(seat.getAttribute('data-tier')).toBe('4')
    expect(seat.querySelector('svg.crest--seat')!.querySelectorAll('use.on')).toHaveLength(4)
    expect(seat.querySelector('.seat__level')!.textContent).toBe('Usta')
    expect(seat.querySelector('.seat__next')!.textContent).toBe(`Ustozga 127${S}000${S}000 qoldi`)
    expect((seat.querySelector('.seat__bar i') as HTMLElement).style.width).toBe('36.5%')
    expect([...seat.querySelectorAll('.seat__medals svg.medal')].map((m) => m.getAttribute('data-medal'))).toEqual([
      'month-gold', 'first-sale',
    ])
    expect(seat.querySelector('.medal-count')!.textContent).toBe('×3')
  })

  it('qator: tasma va gerb darajada, so‘z yo‘q, medallar first-sale siz va ×N siz', () => {
    render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    const row = rowOf('Nodira 118 Karimova')
    expect(row.getAttribute('data-tier')).toBe('3')
    expect(row.querySelector('.row__band')).not.toBeNull()
    expect(row.querySelector('svg.crest--row')!.querySelectorAll('use.on')).toHaveLength(3)
    expect([...row.querySelectorAll('.row__medals svg.medal')].map((m) => m.getAttribute('data-medal'))).toEqual([
      'month-gold',
    ])
    expect(row.querySelector('.medal-count')).toBeNull()
    expect(row.querySelector('.seat__level')).toBeNull()

    // Faqat «Birinchi savdo»si bor — uya ataylab bo'sh.
    const only = rowOf('Qodirova 188 Zilola')
    expect(only.querySelector('.row__medals')).not.toBeNull()
    expect(only.querySelector('.row__medals svg')).toBeNull()

    // Hali savdosiz — 0-daraja: kontur tasma, bo'sh gerb, bo'sh uya.
    const zero = rowOf('Rustamov 201 Diyor')
    expect(zero.getAttribute('data-tier')).toBe('0')
    expect(zero.querySelector('svg.crest--row')!.querySelectorAll('use.on')).toHaveLength(0)
    expect(zero.querySelector('.row__medals svg')).toBeNull()
  })

  it('legenda ustunning PASTIDA bir marta, olti pog‘ona, to‘liq so‘m — komandalar ustunida yo‘q', () => {
    render(<Board data={RIPE} medals={MEDALS} />)
    const col = document.getElementById('tv-sellers')!
    expect(col.querySelectorAll('.tv-legend')).toHaveLength(1)
    expect(col.querySelectorAll('.legend__rung')).toHaveLength(6)
    expect(col.lastElementChild!.classList.contains('tv-legend')).toBe(true)
    expect(col.querySelector('.tv-legend')!.textContent).toContain(`100${S}000${S}000`)
    expect(document.getElementById('tv-teams')!.querySelector('.tv-legend')).toBeNull()
  })

  it('medal so‘rovi bo‘sh bo‘lsa — gerb, so‘z, progress, legenda hech qayerda; reyting o‘z joyida', () => {
    render(<SellersColumn data={RIPE} {...PROPS} />)
    expect(document.querySelector('.crest')).toBeNull()
    expect(document.querySelector('.seat__level')).toBeNull()
    expect(document.querySelector('.seat__prog')).toBeNull()
    expect(document.querySelector('.tv-legend')).toBeNull()
    expect(document.querySelectorAll('#tv-sellers li.row')).toHaveLength(4)
    expect(document.querySelectorAll('#tv-sellers .row__medals')).toHaveLength(4)
  })

  it('podium bo‘sh bo‘lsa ham legenda turadi — qatorlarda gerb izohsiz qolmaydi', () => {
    render(<SellersColumn data={FALLBACK} {...PROPS} fakt="fakt2" medals={MEDALS} />)
    expect(column('tv-sellers').getByText(/Podium hali boʻsh/)).toBeTruthy()
    expect(document.querySelectorAll('#tv-sellers .tv-legend')).toHaveLength(1)
    expect(document.querySelectorAll('#tv-sellers li.row')).toHaveLength(2)
  })

  it('belgilar to‘plami sahifada BIR MARTA', () => {
    render(<Board data={RIPE} />)
    expect(document.querySelectorAll('#ch')).toHaveLength(1)
  })

  it('medal so‘rovi taxtanikidan alohida kalitda va o‘z soatida; `MedalDefs` taxta boshida', () => {
    const source = readFileSync('src/features/sellers/SellersPage.tsx', 'utf8')
    expect(source).toContain("queryKey: ['sellers', 'medals']")
    expect(source).toContain('staleTime: 600_000')
    expect(source).not.toMatch(/medals\.(isError|isPending)/)
    expect(source.match(/<MedalDefs \/>/g)).toHaveLength(1)
    const defs = source.indexOf('<MedalDefs />')
    expect(defs).toBeGreaterThan(source.indexOf('tv-board-shell'))
    expect(defs).toBeLessThan(source.indexOf('tv-switch'))
  })
})

/**
 * MAROSIM — ko'tarilish jamoat voqeasi (spec §8). `resetCelebrations()` har
 * testdan oldin: to'plam modul darajasida, testlar orasida ham yashaydi.
 */
describe('ko‘tarilish marosimi', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCelebrations()
  })
  afterEach(() => vi.useRealTimers())

  it('bugun ko‘tarilgan: e‘lon EFIR tilida sarlavha ustida, gerbning yangi katakchasi to‘ladi; 8 soniyadan keyin jim', () => {
    const today = '2026-09-16'
    const medals = new Map(MEDALS)
    medals.set('154 Marjona Xayrullayeva', medalRow('154 Marjona Xayrullayeva', { promotedOn: today }))
    render(<SellersColumn data={RIPE} {...PROPS} medals={medals} medalsToday={today} />)
    const col = column('tv-sellers')
    const status = col.getByRole('status')
    expect(status.textContent).toBe(`154 Marjona Xayrullayeva — endi USTA · 100${S}000${S}000`)
    expect(status.classList.contains('tv-promo')).toBe(true)
    expect(status.getAttribute('data-tier')).toBe('4')
    expect(status.querySelector('.tv-promo__band')).not.toBeNull()
    expect(status.querySelector('svg.crest')!.querySelectorAll('use.on')).toHaveLength(4)
    expect(status.parentElement!.classList.contains('tv-col-head')).toBe(true)
    expect(seatOf('154 Marjona Xayrullayeva').querySelectorAll('.crest__cell--fill')).toHaveLength(1)
    expect(status.textContent).not.toMatch(/mln/)
    act(() => vi.advanceTimersByTime(8_000))
    expect(col.queryByRole('status')).toBeNull()
    expect(seatOf('154 Marjona Xayrullayeva').querySelector('.crest__cell--fill')).toBeNull()
  })

  it('daraja payloadlar orasida OSHDI — e‘lon «endi USTOZ · 300 000 000»', () => {
    const grown = new Map(MEDALS)
    grown.set(
      '154 Marjona Xayrullayeva',
      medalRow('154 Marjona Xayrullayeva', {
        level: 5,
        rankTitle: 'Ustoz',
        delivered: money(310_000_000),
        levelFloor: money(300_000_000),
        nextLevelAt: money(1_000_000_000),
        nextTitle: 'Legenda',
      }),
    )
    const { rerender } = render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(column('tv-sellers').queryByRole('status')).toBeNull()

    rerender(<SellersColumn data={RIPE} {...PROPS} medals={grown} />)
    const col = column('tv-sellers')
    expect(col.getByRole('status').textContent).toBe(`154 Marjona Xayrullayeva — endi USTOZ · 300${S}000${S}000`)
    const fill = seatOf('154 Marjona Xayrullayeva').querySelectorAll('use.crest__cell--fill')
    expect(fill).toHaveLength(1)
    expect(fill[0]!.getAttribute('x')).toBe('44')

    act(() => vi.advanceTimersByTime(8_000))
    expect(col.queryByRole('status')).toBeNull()
  })

  it('kecha ko‘tarilgan — e‘lon yo‘q', () => {
    const medals = new Map(MEDALS)
    medals.set('154 Marjona Xayrullayeva', medalRow('154 Marjona Xayrullayeva', { promotedOn: '2026-09-15' }))
    render(<SellersColumn data={RIPE} {...PROPS} medals={medals} medalsToday="2026-09-16" />)
    expect(column('tv-sellers').queryByRole('status')).toBeNull()
  })
})

/**
 * YANGI MEDAL — oxirgi yangilanishda paydo bo'lgani, va faqat o'sha; ustun →
 * o'rindiq/qator → medal simi tortilgan.
 */
describe('yangi medal ustundan uyagacha', () => {
  const extra = (key: string, code: MedalCode): SellerMedalRowDto => {
    const base = MEDALS.get(key)!
    const added: SellerMedalDto = { code, count: 1, at: '2026-09-16', amount: null, orders: null, percent: null }
    return { ...base, medals: [...base.medals, added] }
  }

  it('qo‘shilgan medal o‘rindiqda ham, qatorda ham bir marta kattalashadi — boshqa hech qayerda', () => {
    const { rerender } = render(<SellersColumn data={RIPE} {...PROPS} medals={MEDALS} />)
    expect(document.querySelectorAll('.medal--new')).toHaveLength(0)

    const grown = new Map(MEDALS)
    grown.set('154 Marjona Xayrullayeva', extra('154 Marjona Xayrullayeva', 'day-winner'))
    grown.set('Nodira 118 Karimova', extra('Nodira 118 Karimova', 'day-winner'))
    rerender(<SellersColumn data={RIPE} {...PROPS} medals={grown} />)

    expect(seatOf('154 Marjona Xayrullayeva').querySelector('.seat__medals svg.medal--new[data-medal="day-winner"]')).not.toBeNull()
    expect(rowOf('Nodira 118 Karimova').querySelector('.row__medals svg.medal--new[data-medal="day-winner"]')).not.toBeNull()
    expect(document.querySelectorAll('.medal--new')).toHaveLength(2)
  })
})
```

- [ ] **Step 2: `tvBoardLayout.test.ts` ni butunlay qayta yozish**

`tests/features/tvBoardLayout.test.ts` ni quyidagi bilan almashtiring:

```ts
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * THE BOARD'S TWO LAYOUTS SWITCH ON ONE WIDTH, AND NOTHING IN TYPESCRIPT CAN
 * SEE IT. `/sellers` is two columns from 1280px — 60 / 40, each a
 * viewport-high card whose ROWS scroll inside it — and one column at a time
 * below it. The label strip above the rows is a sibling of the scroll box,
 * never inside it, so the fourth rank is never hidden under a sticky header.
 */

const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8')

/** The width of the `@media (min-width: <px>)` block that encloses `selector`, or null. */
function queryFor(selector: string): number | null {
  const at = css.indexOf(selector)
  if (at < 0) return null
  const before = css.slice(0, at)
  const opens = [...before.matchAll(/@media\s*\(min-width:\s*(\d+)px\)\s*\{/g)]
  if (opens.length === 0) return null
  const last = opens[opens.length - 1]!
  const between = before.slice(last.index! + last[0].length)
  let depth = 1
  for (const ch of between) {
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    if (depth === 0) return null
  }
  return Number(last[1])
}

describe('the television board switches layout on one width', () => {
  it('turns the board into two columns — 60 / 40 — from 1280px', () => {
    expect(queryFor('.tv-board {\n    display: grid')).toBe(1280)
    expect(css).toMatch(/\.tv-board \{\s*display: grid;\s*grid-template-columns: minmax\(0, 60fr\) minmax\(0, 40fr\);/)
  })

  it('gives the page its viewport-height column on the same query', () => {
    expect(queryFor('.tv-board-shell {')).toBe(1280)
  })

  it('draws the switch and parks a column on the same width', () => {
    expect(css).toMatch(/@media \(min-width: 1280px\) \{\s*\.tv-switch \{\s*display: none;/)
    expect(css).toMatch(/@media \(max-width: 1279px\) \{\s*\.tv-col--parked \{\s*display: none;/)
  })

  it('makes ONLY the rows a scroll box, from the two-column width — the label strip stays put', () => {
    expect(queryFor('.tv-rows {\n    overflow: auto')).toBe(1280)
    expect(queryFor('.tv-trows {\n    overflow: auto')).toBe(1280)
    expect(css).not.toMatch(/\.tv-cols \{[^}]*overflow: auto/)
    expect(css).not.toMatch(/^\.tv-list \{/m)
    expect(css).not.toContain('.tv-table')
  })

  it('wears no column tone, no pedestal and no podium chrome any more', () => {
    for (const gone of [
      '--tv-tone', '.tv-pedestal', '.podium-card', '.podium-col--', '.medal-ring', '.chase-chip', '.rank-row',
      '.tv-seat-card', '.tv-chase', '.tv-namecell', '.lavha', '.narvon', '.lv-block', '.medal-rail', '.medal-speak',
      '.tv-col-optional', '.tv-col-glyph',
    ]) {
      expect(css, gone).not.toContain(gone)
    }
  })

  it('steps the television scale down under 1600', () => {
    expect(css).toMatch(/@media \(max-width: 1599px\) \{\s*:root \{\s*--tv-xl: 36px;/)
  })

  it('lights the pressed fact in ink, never in a hue', () => {
    expect(css).toMatch(/\.tv-fakt-tab\[aria-pressed='true'\] \{\s*background: var\(--ink-primary\);\s*color: var\(--surface\);/)
  })
})
```

- [ ] **Step 3: `efirCss.test.ts` ga qator, komandalar, e‘lon faktlari**

`tests/features/efirCss.test.ts` OXIRIGA qo'shing:

```ts

describe('EFIR — qator, komandalar, e‘lon', () => {
  it('eski bo‘limlar yo‘q: PODIUM, LAVHA, MEDAL, DARAJA BLOKI', () => {
    for (const banner of ['* PODIUM —', '* LAVHA —', '* MEDAL —', '* DARAJA BLOKI']) expect(CSS, banner).not.toContain(banner)
    expect(CSS).not.toContain('--tv-tone')
  })

  it('qator gridi spec §5 bo‘yicha, yorliq qatori bilan bir xil; tasma `--tier`; o‘qilayotgan fakt qalin', () => {
    const code = strip(EFIR())
    expect(code).toContain('.tv-cols,\n.row {\n  display: grid;\n  grid-template-columns: 10px 52px 70px minmax(0, 1fr) 84px 160px 146px 60px 68px;')
    expect(code).toMatch(/\.row \{[^}]*height: 50px;/)
    expect(code).toMatch(/\.row__band \{[^}]*background: var\(--tier\);/)
    expect(code).toMatch(/\.row\[data-tier="0"\] \.row__band \{[^}]*box-shadow: inset 1px 0 0 var\(--tier\);/)
    expect(code).toContain('.tv-rows[data-read="fakt2"] .row__f2,\n.tv-rows[data-read="fakt1"] .row__f1 {')
    expect(code).toMatch(/\.row__name \{[^}]*text-overflow: ellipsis;/)
  })

  it('komandalar: 62 px qatorlar, ulush chizig‘i `--share`, metall raqamlar faqat 1–3', () => {
    const code = strip(EFIR())
    expect(code).toContain('.tv-tcols,\n.trow {\n  display: grid;\n  grid-template-columns: 36px minmax(0, 1fr) 40px 146px 58px 104px 48px 58px;')
    expect(code).toMatch(/\.trow \{[^}]*height: 62px;/)
    expect(code).toMatch(/\.trow::after \{[^}]*width: calc\(\(100% - 56px\) \* var\(--share, 0\)\);/)
    expect(code).toContain('.trow__rank[data-metal="gold"] { color: var(--medal-gold); font-weight: 700; }')
    expect(code).toContain('.trow__rank[data-metal="silver"] { color: var(--medal-silver); font-weight: 700; }')
    expect(code).toContain('.trow__rank[data-metal="bronze"] { color: var(--medal-bronze); font-weight: 700; }')
  })

  /*
    E'LON USTUNNI SURMAYDI: sarlavha USTIDA absolyut, kirishi `translate` da
    (`transform` markazlashtirishga ketgan — keyframe uni bosmasin).
  */
  it('e‘lon oqimdan tashqarida, tasma va gerb bilan; kirishi `transform` ni bosmaydi', () => {
    const code = strip(EFIR())
    const rule = code.slice(code.indexOf('.tv-promo {'))
    expect(rule.slice(0, rule.indexOf('\n}') + 2)).toContain('position: absolute')
    expect(code).toMatch(/\.tv-promo__band \{[^}]*background: var\(--tier\);/)
    const kf = code.slice(code.indexOf('@keyframes tv-promo-in'))
    expect(kf.slice(0, kf.indexOf('\n}') + 2)).not.toContain('transform:')
    expect(kf.slice(0, kf.indexOf('\n}') + 2)).toContain('translate:')
  })

  it('voqea harakati: gerb katakchasi 400 ms to‘ladi, yangi medal 0,6 → 1; yaltirash, marquee, pulsatsiya yo‘q', () => {
    const code = strip(EFIR())
    expect(code).toMatch(/@keyframes crest-fill \{\s*from \{ fill: var\(--track\); \}\s*to \{ fill: var\(--tier\); \}\s*\}/)
    expect(code).toMatch(/\.crest__cell--fill \{ animation: crest-fill 400ms var\(--ease-out\) both; \}/)
    expect(code).toMatch(/@keyframes medal-new \{\s*from \{ transform: scale\(0\.6\); opacity: 0; \}/)
    expect(code).not.toMatch(/shine|sheen|marquee|pulse|infinite/)
  })
})
```

- [ ] **Step 4: Testlarni ishga tushirish — qizil**

Run: `npx vitest run tests/features/sellersTvBoard.test.tsx tests/features/tvBoardLayout.test.ts tests/features/efirCss.test.ts`
Expected: FAIL — `.seat` topilmadi (eski podium), `.tv-rows` yo'q, eski bannerlar bor.

- [ ] **Step 5: `board.ts`**

`src/features/sellers/board.ts`:

```ts
import type { SellerBoardRowDto, SellerTeamRowDto } from '@/lib/api'

/**
 * Taxtaning saralash mantig'i — `SellersPage` dan ajratilgan, ikkala ustun
 * (`SellersBoard`, `TeamsBoard`) shu bitta qoidani o'qiydi.
 */

/**
 * Which of the two facts the board is ranked and read on.
 *
 * 'auto' is not a third reading — it is the absence of a decision, and it
 * resolves to one of the other two on every render: FAKT 2 once anybody has
 * delivered, FAKT 1 until then. It has to stay reachable as the OPENING
 * state, or a board left on «Bugun» overnight opens pinned to a fact nobody
 * has any money in yet.
 */
export type FaktChoice = 'auto' | 'fakt1' | 'fakt2'

/**
 * One line of either board, in the words both boards share. A seller and a
 * team are ranked by the same two figures under the same rule; what differs
 * is what stands beside the name — a seller's team, a team's headcount.
 */
export interface BoardEntry {
  readonly key: string
  readonly rank: number
  readonly name: string
  /** Sotuvchining ROP komandasi; komanda qatorida null. */
  readonly badge: string | null
  /** Komandaning sotuvchilar soni; sotuvchi qatorida null. */
  readonly sellers: number | null
  /** FAKT 2 — Доставланди, in soʻm. */
  readonly won: number
  /** FAKT 1 — Тасдиқланди + Тасдиқланмай чиқди, in soʻm. */
  readonly ordered: number
  readonly wonOrders: number
  readonly orders: number
  /** Null where the DTO does not carry it (teams). */
  readonly openOrders: number | null
  readonly conversionPercent: number | null
  readonly sharePercent: number | null
}

export function fromSeller(row: SellerBoardRowDto): BoardEntry {
  return {
    key: row.employeeId,
    rank: row.rank,
    name: row.fullName,
    badge: row.rop,
    sellers: null,
    won: row.won.amount,
    ordered: row.ordered.amount,
    wonOrders: row.wonOrders,
    orders: row.orders,
    openOrders: row.openOrders,
    conversionPercent: row.conversionPercent,
    sharePercent: row.sharePercent,
  }
}

export function fromTeam(row: SellerTeamRowDto): BoardEntry {
  return {
    key: row.rop,
    rank: row.rank,
    name: row.rop,
    badge: null,
    sellers: row.sellers,
    won: row.won.amount,
    ordered: row.ordered.amount,
    wonOrders: row.wonOrders,
    orders: row.orders,
    openOrders: null,
    conversionPercent: row.conversionPercent,
    sharePercent: row.sharePercent,
  }
}

/** The figure the board is being read on. */
export function figureOf(entry: BoardEntry, onDelivered: boolean): number {
  return onDelivered ? entry.won : entry.ordered
}

/**
 * 'auto' resolves the way the board always did: FAKT 2 the moment anybody
 * has delivered, FAKT 1 while nobody has. Delivery takes days, so for most
 * of a working day nobody has FAKT 2, and a podium gated on it stood empty
 * over a floor that had confirmed 148 mln soʻm between 55 people.
 */
export function resolveOnDelivered(entries: readonly BoardEntry[], fakt: FaktChoice): boolean {
  return fakt === 'auto' ? entries.some((e) => e.won > 0) : fakt === 'fakt2'
}

/**
 * The board's own order, over whichever fact is being read.
 *
 * THIS MIRRORS `SellerBoardService` — `buildBoard` for the sellers and
 * `teamRows` for the teams — AND HAS TO KEEP MIRRORING IT: the fact being
 * read, then the other one, then the key, with competition ranking over BOTH
 * figures so equal money is an equal rank and the next rank skips. Read on
 * FAKT 2 it reproduces the ranks the service already sent, which is what
 * `sellersTvBoard.test.tsx` asserts row by row; read on FAKT 1 it is the same
 * rule with the two keys swapped, and that swap is the whole of what the
 * switch does. Ranking on the leading fact alone is the failure both those
 * comments record: on «Bugun» nobody has FAKT 2, the comparison ties for all
 * fifteen teams, and the tie-break — a name, an employee id — becomes the
 * ranking, under a seat claiming a fact.
 *
 * WHY IT IS DONE HERE AND NOT ASKED OF THE API. Every row is already on the
 * payload carrying both facts; this is ONE answer read two ways, not a second
 * question. So the switch costs no request, cannot straddle a sync, cannot
 * flash a stale board while a second one lands, and cannot disagree with the
 * totals beside it. The key stays the last resort — an employee id, a ROP's
 * name — so two rows level on both figures do not swap places between two
 * refreshes of one screen.
 */
export function rankedBy(entries: readonly BoardEntry[], onDelivered: boolean): readonly BoardEntry[] {
  const read = (e: BoardEntry) => (onDelivered ? e.won : e.ordered)
  const other = (e: BoardEntry) => (onDelivered ? e.ordered : e.won)

  const ordered = [...entries].sort(
    (a, b) => read(b) - read(a) || other(b) - other(a) || a.key.localeCompare(b.key),
  )

  let rank = 0
  return ordered.map((entry, index) => {
    const previous = index > 0 ? ordered[index - 1]! : null
    // Equal on BOTH figures, because both decide the order. Otherwise two
    // sellers level on the fact being read but far apart on the other would
    // share a rank the sort has already separated them by, and the board
    // would print 1, 1, 3 over rows that visibly differ.
    if (!previous || previous.won !== entry.won || previous.ordered !== entry.ordered) {
      rank = index + 1
    }
    return { ...entry, rank }
  })
}
```

- [ ] **Step 6: `FaktSwitch.tsx` va `ColumnHead.tsx`**

`src/features/sellers/FaktSwitch.tsx`:

```tsx
import type { FaktChoice } from '@/features/sellers/board'

/**
 * FAKT 1 / FAKT 2 — the switch in each heading, and the only thing on this
 * board that answers a press.
 *
 * IT SHOWS THE RESOLVED FACT, NOT THE STORED CHOICE. The board opens on
 * 'auto', and an 'auto' that lit neither button would leave a reader unable
 * to tell which fact they are looking at. So the button that is lit is the
 * one the board is actually ranked on, and pressing it changes nothing but
 * the fact that it is now pinned. Two buttons and no way back to 'auto'.
 *
 * EFIR: the lit segment is INK on the stage (spec §7) — no hue is spent on
 * chrome; the band and the crest are the only coloured things on the board.
 */
export function FaktSwitch({
  fakt,
  onFakt,
}: {
  fakt: 'fakt1' | 'fakt2'
  onFakt: (choice: FaktChoice) => void
}) {
  return (
    <div className="tv-fakt" data-fakt={fakt} role="group" aria-label="Reyting qaysi fakt boʻyicha">
      {(
        [
          ['fakt1', 'FAKT 1'],
          ['fakt2', 'FAKT 2'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          className="tv-fakt-tab focusable"
          aria-pressed={fakt === key}
          onClick={() => onFakt(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
```

`src/features/sellers/ColumnHead.tsx`:

```tsx
import type { ReactNode } from 'react'

import type { FaktChoice } from '@/features/sellers/board'
import { FaktSwitch } from '@/features/sellers/FaktSwitch'

/**
 * 40 px ustun sarlavhasi (spec §6/§7): nom · soni · FAKT kaliti. `children`
 * — e'lon (`PromotionBanner`), sarlavha USTIDA absolyut (`.tv-col-head`
 * relative). Kalit faqat taxta tayyor bo'lganda (`count !== null`): bo'sh yoki
 * xato holatda bosadigan narsa yo'q.
 *
 * THE ONE CONTROL ON THIS BOARD, drawn in both headings on purpose — a phone
 * shows one column at a time, so a switch over only one of them would be
 * unreachable from the other. Both press the page's single choice.
 */
export function ColumnHead({
  id,
  title,
  count,
  fakt,
  onFakt,
  children,
}: {
  id: string
  title: string
  /** «100 sotuvchi» / «14 komanda»; null — taxta hali tayyor emas. */
  count: string | null
  fakt: 'fakt1' | 'fakt2'
  onFakt: (choice: FaktChoice) => void
  children?: ReactNode
}) {
  return (
    <header className="tv-col-head">
      <h2 id={`${id}-heading`} className="tv-col-head__title">
        {title}
      </h2>
      {count !== null && <span className="tv-col-head__count">{count}</span>}
      <span className="tv-col-head__spacer" />
      {count !== null && <FaktSwitch fakt={fakt} onFakt={onFakt} />}
      {children}
    </header>
  )
}
```

- [ ] **Step 7: `PromotionBanner.tsx`**

`src/features/sellers/PromotionBanner.tsx` ni butunlay quyidagi bilan almashtiring:

```tsx
import { Crest } from '@/features/sellers/Crest'
import { thresholdSomOf } from '@/features/sellers/medalCatalog'
import type { Promotion } from '@/features/sellers/usePromotions'
import { formatSomFull } from '@/lib/format'

/**
 * Ustun sarlavhasi USTIDA 8 soniya, EFIR tilida (spec §8): tasma + gerb +
 * «Ism — endi USTA · 100 000 000». Ostona to'liq so'mda — `Promotion.
 * thresholdLabel` («100 mln») bu sahifada o'qilmaydi, `usePromotions`
 * o'zgarmaydi. 1-darajada ostona yo'q (birinchi so'm) — nuqta ham yo'q.
 *
 * `role="status"` — fokusni tortmaydi, lekin ekran o'quvchiga aytiladi:
 * marosim hech kimning ishini bo'lmasligi kerak.
 */
export function PromotionBanner({ promotion, name }: { promotion: Promotion; name: string }) {
  const threshold = thresholdSomOf(promotion.level, promotion.legendaTier)
  return (
    <div className="tv-promo" role="status" data-tier={promotion.level}>
      <span className="tv-promo__band" aria-hidden="true" />
      <Crest level={promotion.level} legendaTier={promotion.legendaTier} size="row" />
      <span className="tv-promo__text">
        {name} — endi {promotion.rankTitle.toUpperCase()}
        {threshold !== null && ` · ${formatSomFull(threshold)}`}
      </span>
    </div>
  )
}
```

- [ ] **Step 8: `SellersBoard.tsx`**

`src/features/sellers/SellersBoard.tsx`:

```tsx
'use client'

import { useMemo } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import { type BoardEntry, type FaktChoice, figureOf, rankedBy, resolveOnDelivered } from '@/features/sellers/board'
import { ColumnHead } from '@/features/sellers/ColumnHead'
import { Crest } from '@/features/sellers/Crest'
import { PromotionBanner } from '@/features/sellers/PromotionBanner'
import { RowMedals } from '@/features/sellers/RowMedals'
import { SeatCard } from '@/features/sellers/SeatCard'
import { TierLegend } from '@/features/sellers/TierLegend'
import { useAutoScroll } from '@/features/sellers/useAutoScroll'
import { useNewMedals, usePromotions } from '@/features/sellers/usePromotions'
import type { MedalCode, SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { NO_VALUE, formatNumber, formatPercentUz, formatSomFull } from '@/lib/format'

export type Status = 'loading' | 'error' | 'ready'

const NO_MEDALS: readonly SellerMedalDto[] = []

/**
 * Sotuvchilar ustuni — EFIR (spec §4, §5): sarlavha · uch o'rindiq (2-1-3) ·
 * STATIK yorliq qatori · siljiydigan qatorlar (`useAutoScroll` faqat shu
 * qutida) · legenda. Qaysi FAKT o'rin berganini bir marta shu yerda hisoblab
 * har o'rindiq va qatorga uzatadi, ikkalasi birlik haqida kelisha olmasligi
 * uchun.
 *
 * THE TOP THREE OF WHOEVER HAS THE FACT BEING READ. An empty podium is an
 * answer — «hech kim yetkazmagan hali» — and the branch below has words for
 * it; the rows then start at first place.
 *
 * MAROSIM SHU YERDA: e'lon ustun sarlavhasi USTIDA (`ColumnHead` children),
 * ko'tarilgan odam o'rindiqda bo'lsa gerbi to'ladi. `onBoard` — shu ustunda
 * chizilgan kalitlar; `useMemo` SHART, to'plam effektning bog'liqliklarida.
 */
export function SellersBoard({
  entries,
  status,
  errorMessage,
  onRetry,
  parked = false,
  fakt,
  onFakt,
  medals,
  medalsToday,
}: {
  entries: readonly BoardEntry[]
  status: Status
  errorMessage?: string
  onRetry: () => void
  /** Hidden under 1280px while the switch shows the other board. */
  parked?: boolean
  fakt: FaktChoice
  onFakt: (choice: FaktChoice) => void
  /** Sotuvchi id si bo'yicha daraja va medallar; so'rov kelmagan bo'lsa bo'sh Map. */
  medals: ReadonlyMap<string, SellerMedalRowDto>
  /** `SellerMedalsDto.today` — e'lonning birinchi tetigi (`usePromotions`). */
  medalsToday: string | null
}) {
  const onDelivered = resolveOnDelivered(entries, fakt)
  const ranked = useMemo(() => rankedBy(entries, onDelivered), [entries, onDelivered])
  const winners = ranked.filter((e) => figureOf(e, onDelivered) > 0).slice(0, 3)
  const seated = new Set(winners.map((w) => w.key))
  const rows = winners.length === 0 ? ranked : ranked.filter((e) => !seated.has(e.key))

  const onBoard = useMemo(() => new Set(entries.map((e) => e.key)), [entries])
  const promotion = usePromotions(medals, medalsToday, onBoard)
  const promotedName =
    promotion === null ? null : (entries.find((e) => e.key === promotion.employeeId)?.name ?? null)
  const newMedals = useNewMedals(medals)
  const ready = status === 'ready' && entries.length > 0

  return (
    <section
      id="tv-sellers"
      className={`tv-col tv-col--sellers${parked ? ' tv-col--parked' : ''}`}
      aria-labelledby="tv-sellers-heading"
    >
      <ColumnHead
        id="tv-sellers"
        title="Sotuvchilar"
        count={ready ? `${formatNumber(entries.length)} sotuvchi` : null}
        fakt={onDelivered ? 'fakt2' : 'fakt1'}
        onFakt={onFakt}
      >
        {promotion !== null && promotedName !== null && (
          <PromotionBanner promotion={promotion} name={promotedName} />
        )}
      </ColumnHead>

      {status === 'loading' ? (
        <SellersSkeleton />
      ) : status === 'error' ? (
        <div className="tv-empty">
          <ErrorState message={errorMessage} onRetry={onRetry} />
        </div>
      ) : entries.length === 0 ? (
        <div className="tv-empty">
          <EmptyState
            title="Bu davrda buyurtma yoʻq"
            body="Tanlangan davrda hech kim buyurtma olmagan — podium keyingi buyurtmani kutmoqda."
          />
        </div>
      ) : (
        <>
          {winners.length === 0 ? (
            <p className="tv-empty-podium">
              <span aria-hidden="true">🏁</span> Podium hali boʻsh — oʻrinlar hammaga ochiq
            </p>
          ) : (
            <div className="tv-podium">
              {winners.map((entry, index) => (
                <SeatCard
                  key={entry.key}
                  rank={entry.rank}
                  place={(index + 1) as 1 | 2 | 3}
                  name={entry.name}
                  team={entry.badge}
                  won={entry.won}
                  ordered={entry.ordered}
                  onDelivered={onDelivered}
                  medal={medals.get(entry.key) ?? null}
                  rise={promotion?.employeeId === entry.key}
                  newKeys={newMedals.get(entry.key)}
                />
              ))}
            </div>
          )}
          <SellerRows rows={rows} onDelivered={onDelivered} medals={medals} newMedals={newMedals} />
          {/* LEGENDA USTUN PASTIDA, BIR MARTA — medal so'rovi kelganda. Podium
              bilan ro'yxat orasida hech qachon emas (spec §2). */}
          {medals.size > 0 && <TierLegend />}
        </>
      )}
    </section>
  )
}

/**
 * Qatorlar — timing tower (spec §5). Yorliq qatori `.tv-cols` STATIK va
 * skroll qutisi `.tv-rows` ning TASHQARISIDA, ya'ni 4-rank hech qachon
 * yashirinmaydi. Bitta baseline: tasma · rank · gerb · ism + komanda ·
 * medallar · FAKT 2 · FAKT 1 · buyurtma · konv. «Oldingiga +…» satri YO'Q.
 *
 * `data-read` — o'qilayotgan fakt; CSS o'sha ustunni qalin qiladi, tartib
 * o'zgarmaydi (FAKT 2 har doim chapda).
 */
function SellerRows({
  rows,
  onDelivered,
  medals,
  newMedals,
}: {
  rows: readonly BoardEntry[]
  onDelivered: boolean
  medals: ReadonlyMap<string, SellerMedalRowDto>
  newMedals: ReadonlyMap<string, ReadonlySet<MedalCode>>
}) {
  const listRef = useAutoScroll<HTMLOListElement>(rows.length > 0)
  if (rows.length === 0) return null
  const read = onDelivered ? 'fakt2' : 'fakt1'

  return (
    <>
      <div className="tv-cols" data-read={read}>
        <span />
        <span className="tv-cols__c">#</span>
        <span>Daraja</span>
        <span className="tv-cols__name">Sotuvchi</span>
        <span>Medallar</span>
        <span className="tv-cols__r tv-cols__f2">FAKT 2, yetkazilgan</span>
        <span className="tv-cols__r tv-cols__f1">FAKT 1, tasdiqlangan</span>
        <span className="tv-cols__r">Buyurtma</span>
        <span className="tv-cols__r">Konv.</span>
      </div>
      <ol ref={listRef} className="tv-rows" data-read={read} aria-label="Reyting qatorlari">
        {rows.map((entry) => {
          // A place is only a place once there is money to rank on; a row
          // with none prints a dash, not a rank it was handed by the tie-break.
          const ranked = entry.won > 0 || entry.ordered > 0
          // BIR MARTA QIDIRILADI — katakcha uni bir necha joyda o'qiydi.
          const medal = medals.get(entry.key) ?? null
          return (
            <li key={entry.key} className="row" data-tier={medal?.level ?? 0}>
              <span className="row__band" aria-hidden="true" />
              <span className="row__rank">
                {ranked ? entry.rank : <span aria-label="Hali puli yoʻq">—</span>}
              </span>
              {medal !== null ? (
                <Crest level={medal.level} legendaTier={medal.legendaTier} size="row" />
              ) : (
                <span />
              )}
              <span className="row__name">
                {entry.name}
                {entry.badge && <span className="row__team">{entry.badge}</span>}
              </span>
              <RowMedals medals={medal?.medals ?? NO_MEDALS} newKeys={newMedals.get(entry.key)} />
              <span className="row__f2">{formatSomFull(entry.won)}</span>
              <span className="row__f1">{formatSomFull(entry.ordered)}</span>
              <span className="row__orders">{formatNumber(entry.orders)}</span>
              <span className="row__conv">
                {entry.conversionPercent === null ? NO_VALUE : formatPercentUz(entry.conversionPercent)}
              </span>
            </li>
          )
        })}
      </ol>
    </>
  )
}

/** Sized to the ready layout: three seats, then rows. */
function SellersSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Yuklanmoqda</span>
      <div className="tv-podium" aria-hidden="true">
        <div className="seat seat--2 skeleton tv-skeleton-seat" />
        <div className="seat seat--1 skeleton tv-skeleton-seat" />
        <div className="seat seat--3 skeleton tv-skeleton-seat" />
      </div>
      <div className="tv-skeleton-rows" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton tv-skeleton-row" />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 9: `TeamsBoard.tsx`**

`src/features/sellers/TeamsBoard.tsx`:

```tsx
'use client'

import { type CSSProperties, useMemo } from 'react'

import { EmptyState, ErrorState } from '@/components/states/States'
import { type BoardEntry, type FaktChoice, figureOf, rankedBy, resolveOnDelivered } from '@/features/sellers/board'
import { ColumnHead } from '@/features/sellers/ColumnHead'
import { metalOfRank } from '@/features/sellers/Halo'
import type { Status } from '@/features/sellers/SellersBoard'
import { useAutoScroll } from '@/features/sellers/useAutoScroll'
import { NO_VALUE, formatNumber, formatPercentUz, formatSomFull } from '@/lib/format'

/**
 * Komandalar ustuni — EFIR (spec §6): podium YO'Q, 40 px sarlavha, 24 px
 * statik yorliq qatori, bir qatorli 62 px qatorlar — rank (1–3 metall raqam)
 * · nom · sotuvchi soni · FAKT 2 · ulush · FAKT 1 · buyurtma · konv.; har
 * qator pastida ulush chizig'i (ulush ÷ yetakchi ulushi). Sotuvchilar
 * ro'yxati bilan bir xil lug'at; plastina, chip, qizil delta yo'q.
 *
 * ULUSH BRAUZERDA, O'QILAYOTGAN FAKT USTIDA: komanda puli ÷ komandalar
 * jami puli. Servisning `sharePercent` i FAKT 2 ulushi — FAKT 1 rejimida u
 * yolg'on bo'lardi. Komandasiz sotuvchilar jamiga kirmaydi (pastdagi jumla
 * shuni aytadi). Daraja shaxsiy — komandalar ustunida gerb, e'lon, legenda
 * yo'q.
 */
export function TeamsBoard({
  entries,
  teamless,
  status,
  errorMessage,
  onRetry,
  parked = false,
  fakt,
  onFakt,
}: {
  entries: readonly BoardEntry[]
  /** `totals.teamlessSellers` — pastdagi jumla uchun. */
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
  const listRef = useAutoScroll<HTMLOListElement>(ranked.length > 0)
  const total = ranked.reduce((sum, e) => sum + figureOf(e, onDelivered), 0)
  const leader = ranked.length > 0 ? figureOf(ranked[0]!, onDelivered) : 0
  const read = onDelivered ? 'fakt2' : 'fakt1'
  const ready = status === 'ready' && entries.length > 0

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
            <span className="tv-tcols__c">#</span>
            <span className="tv-tcols__name">Komanda (ROP)</span>
            <span className="tv-tcols__r">Sotuvchi</span>
            <span className="tv-tcols__r tv-tcols__f2">FAKT 2, yetkazilgan</span>
            <span className="tv-tcols__r">Ulush</span>
            <span className="tv-tcols__r tv-tcols__f1">FAKT 1</span>
            <span className="tv-tcols__r">Buyurtma</span>
            <span className="tv-tcols__r">Konv.</span>
          </div>
          <ol ref={listRef} className="tv-trows" data-read={read} aria-label="Komandalar reytingi">
            {ranked.map((entry) => {
              const figure = figureOf(entry, onDelivered)
              const isRanked = entry.won > 0 || entry.ordered > 0
              const share = total > 0 ? (figure / total) * 100 : null
              const rel = leader > 0 ? (figure / leader).toFixed(3) : '0.000'
              return (
                <li
                  key={entry.key}
                  className="trow"
                  data-share={rel}
                  style={{ '--share': rel } as CSSProperties}
                >
                  <span className="trow__rank" data-metal={isRanked ? metalOfRank(entry.rank) : 'none'}>
                    {isRanked ? entry.rank : '—'}
                  </span>
                  <span className="trow__name">{entry.name}</span>
                  <span className="trow__cnt">{entry.sellers === null ? NO_VALUE : formatNumber(entry.sellers)}</span>
                  <span className="trow__f2">{formatSomFull(entry.won)}</span>
                  <span className="trow__share">{share === null ? NO_VALUE : formatPercentUz(share)}</span>
                  <span className="trow__f1">{formatSomFull(entry.ordered)}</span>
                  <span className="trow__orders">{formatNumber(entry.orders)}</span>
                  <span className="trow__conv">
                    {entry.conversionPercent === null ? NO_VALUE : formatPercentUz(entry.conversionPercent)}
                  </span>
                </li>
              )
            })}
          </ol>
          {teamless > 0 && (
            <p className="tv-tfoot">{formatNumber(teamless)} sotuvchi komandasiz, ulushlar ularsiz</p>
          )}
        </>
      )}
    </section>
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
```

- [ ] **Step 10: `SellersPage.tsx` ni qayta yozish**

`src/features/sellers/SellersPage.tsx` ni butunlay quyidagi bilan almashtiring:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { type FaktChoice, fromSeller, fromTeam } from '@/features/sellers/board'
import { MedalDefs } from '@/features/sellers/MedalDefs'
import { RecordWall } from '@/features/sellers/RecordWall'
import { SellersBoard, type Status } from '@/features/sellers/SellersBoard'
import { TeamsBoard } from '@/features/sellers/TeamsBoard'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type SellerBoardDto, type SellerMedalRowDto, type SellerMedalsDto, apiGet } from '@/lib/api'
import { t } from '@/lib/messages'

/**
 * Sotuvchilar reytingi — the board on the television. EFIR (2026-09-16).
 *
 * THIS SCREEN HAS ONE AUDIENCE AND ONE PLACE: the sellers themselves, reading
 * it off a TV on the sales floor — «sotuvchilar reytingi faqat sotuvchilar
 * oʻz reytingini televizordan koʻrishi uchun kerak» (2026-09-07). Two
 * columns, nothing that is not a rank: sellers left (three seats over a
 * timing-tower list), teams right (one-line rows). Everything analytical
 * lives on Savdo dinamikasi. No bonus is printed here at all.
 *
 * A TELEVISION HAS NO MOUSE: nothing opens or filters; both columns take
 * the screen's height (`PageShell fill`) and each LIST drifts inside its
 * column (`useAutoScroll`) with its label strip standing still above it.
 * Type is the `--tv-*` scale (44/24/16/13, a step smaller under 1600).
 *
 * ONE ACCENT, ONE METAL. Level is the only hue on the board — the `--tier`
 * band and crest on every row and seat — and gold the only metal (rank
 * halos, medals, the record wall's labels). The two columns are told apart
 * by their content and their headings, not by a frame colour.
 *
 * NO ROP COLOUR CODING, still: fifteen teams exceed the palette, and the
 * team rides as muted text beside the name.
 */
export function SellersPage() {
  const { apiParams: filterParams } = useDashboardFilters()

  /*
    ONE CLOCK. The board reads the floor's own FAKT 1 / FAKT 2 — dated by the
    order's arrival in C4:NEW — and there is no control to change it. The
    'intake' reading still exists behind `?basis=intake` as the oracle a
    queue regression is checked against; it was never a second board.
  */
  const basis = 'queue' as const
  const apiParams = useMemo(() => ({ ...filterParams, basis }), [filterParams, basis])

  const board = useQuery({
    queryKey: ['sellers', 'board', apiParams],
    queryFn: ({ signal }) => apiGet<SellerBoardDto>('/analytics/sellers', apiParams, signal),
    placeholderData: (previous) => previous,
  })

  /*
    DARAJA VA MEDALLAR O'Z SO'ROVIDA VA O'Z SOATIDA — devorning naqshi.

    Oynasi boshqa: medal `RECORDS_FROM` dan bugungacha, taxta esa tanlangan
    davr — bir payloadga solish medalni filtr tugmasi bilan o'chiradigan qilib
    qo'yardi. Sur'ati boshqa: taxta oltmish soniyada, medal o'n daqiqada. Va
    BUZILMASLIK: bu so'rov xato bersa yoki kechiksa, televizordagi reyting
    hech nima sezmaydi — faqat gerb, progress, legenda va medallar ko'rinmaydi.

    `staleTime` va `refetchInterval` — ikkalasi ham: `refetchInterval`
    staleness'ni hech qachon so'ramaydi, bittasini qo'yish hech narsa bermaydi.
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

  const data = board.data?.data
  const status: Status = board.isPending ? 'loading' : board.isError ? 'error' : 'ready'
  const errorMessage = (board.error as Error | null)?.message
  const retry = () => void board.refetch()

  /*
    ONE BOARD AT A TIME UNDER 1280px — a phone gets a switch and sees one
    column («scroll qilish qiyinlashgan», 2026-09-07); the television sees
    both and no switch. Local state, not the URL.
  */
  const [shown, setShown] = useState<'sellers' | 'teams'>('sellers')

  /*
    WHICH FACT THE BOARD IS READ ON — ONE CHOICE FOR BOTH COLUMNS
    (2026-09-10: «ikkita boʻlimni … fakt 1 va fakt 2 boʻyicha koʻrish mumkin
    boʻlsin»). Both headings carry the switch and both press the SAME state:
    a team's money is its sellers' money summed, so two halves reading
    different facts would be the reconciliation the seat caption exists to
    prevent. 'auto' is the opening state — FAKT 2 once anybody has delivered.
    Local state: a URL write on this dashboard is a server round trip.
  */
  const [fakt, setFakt] = useState<FaktChoice>('auto')

  return (
    <PageShell
      title={t.nav.sellers}
      meta={board.data?.meta}
      /* THE RECORD WALL RIDES THE TITLE LINE — two static bands between the
         title and the period control (spec §7), on its own ten-minute clock. */
      banner={<RecordWall />}
      stale={board.isPlaceholderData}
      accent="var(--series-5)"
      controlsAlign="end"
      fill
    >
      <div className="tv-board-shell flex min-h-0 flex-col gap-3">
        {/*
          SAHIFANING YAGONA <defs>. Gerb ham, medal ham `<use href="#…">`
          bilan chiziladi — belgilar bir marta, taxtaning boshida.
        */}
        <MedalDefs />

        <div className="tv-switch" role="tablist" aria-label="Qaysi reyting">
          {(
            [
              ['sellers', 'Sotuvchilar'],
              ['teams', 'Komandalar'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={shown === key}
              aria-controls={`tv-${key}`}
              className="tv-switch-tab"
              onClick={() => setShown(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="tv-board">
          <SellersColumn
            data={data}
            status={status}
            errorMessage={errorMessage}
            onRetry={retry}
            parked={shown !== 'sellers'}
            fakt={fakt}
            onFakt={setFakt}
            medals={medalsById}
            medalsToday={medals.data?.data.today ?? null}
          />
          <TeamsColumn
            data={data}
            status={status}
            errorMessage={errorMessage}
            onRetry={retry}
            parked={shown !== 'teams'}
            fakt={fakt}
            onFakt={setFakt}
            medals={medalsById}
            medalsToday={medals.data?.data.today ?? null}
          />
        </div>

        {/* The one line on this board that is not a rank: who made it. */}
        <p className="tv-credit">Developed by Yusuf</p>
      </div>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------

/** Ikkala ustun bir xil shaklni oladi — testlar ikkalasiga bir `PROPS` beradi. */
export interface ColumnProps {
  data: SellerBoardDto | undefined
  status: Status
  errorMessage?: string
  onRetry: () => void
  /** Hidden under 1280px while the switch shows the other board. */
  parked?: boolean
  /** Which fact BOTH columns are read on — the page owns it, not the column. */
  fakt: FaktChoice
  onFakt: (choice: FaktChoice) => void
  /** Sotuvchi id si bo'yicha daraja va medallar. Komandalar ustuni o'qimaydi — daraja shaxsiy. */
  medals: ReadonlyMap<string, SellerMedalRowDto>
  /** `SellerMedalsDto.today` — e'lonning birinchi tetigi; komandalar ustuni o'qimaydi. */
  medalsToday: string | null
}

/** Exported for the tests. */
export function SellersColumn({
  data,
  status,
  errorMessage,
  onRetry,
  parked = false,
  fakt,
  onFakt,
  medals,
  medalsToday,
}: ColumnProps) {
  const entries = useMemo(() => data?.rows.map(fromSeller) ?? [], [data])
  return (
    <SellersBoard
      entries={entries}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      parked={parked}
      fakt={fakt}
      onFakt={onFakt}
      medals={medals}
      medalsToday={medalsToday}
    />
  )
}

export function TeamsColumn({ data, status, errorMessage, onRetry, parked = false, fakt, onFakt }: ColumnProps) {
  const entries = useMemo(() => data?.teams.map(fromTeam) ?? [], [data])
  return (
    <TeamsBoard
      entries={entries}
      teamless={data?.totals.teamlessSellers ?? 0}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      parked={parked}
      fakt={fakt}
      onFakt={onFakt}
    />
  )
}
```

- [ ] **Step 11: Katalogdan `mlnLabel` ni olib tashlash; eski fayllarni o‘chirish**

`src/features/sellers/medalCatalog.ts` da:
- import satrini `import { formatCompactUzs, formatSomFull } from '@/lib/format'` → `import { formatSomFull } from '@/lib/format'`
- `/** «127 mln», «9.1 mln», «1.2 mlrd» — … */` izohi bilan birga `export function mlnLabel(som: number): string { … }` funksiyasini o'chiring.

O'chirish (hammasi shu commit'da; importerlari yuqorida sanalgan, hammasi shu vazifada qayta yozildi yoki o'chdi):

```bash
git rm -q src/features/sellers/Lavha.tsx src/features/sellers/Medal.tsx src/features/sellers/LevelBlock.tsx src/features/sellers/MedalRail.tsx src/features/sellers/SpeakingMedal.tsx src/features/sellers/Narvon.tsx src/features/sellers/useMedalRotation.ts src/features/sellers/medalReason.ts tests/features/sellersLavha.test.tsx tests/features/useMedalRotation.test.ts
git rm -r -q docs/superpowers/specs/assets/2026-09-16-daraja
```

Tekshiruv: `grep -rn --include='*.ts' --include='*.tsx' -E "sellers/(Lavha|Medal|LevelBlock|MedalRail|SpeakingMedal|Narvon|useMedalRotation|medalReason)'|mlnLabel|formatCompactUzs" src/features/sellers tests/features` → bo'sh.

- [ ] **Step 12: CSS — eski bo‘limlar o‘chadi, TV BOARD qayta, EFIR 3-bo‘lak**

(a) Yangi TV BOARD bo'limi (scratchpad):

```bash
cat > /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/tv-board.css <<'CSS'
/* ===========================================================================
 * TV BOARD — the sellers board as it is read on the floor's television
 *
 * `/sellers` is two columns — sellers left (60 %), teams right (40 %) — from
 * 1280px, one column at a time below it. From 1280 the board takes the height
 * the shell leaves it (`PageShell fill`) and each column's ROWS scroll inside
 * it: `min-height: 0` on every flex and grid ancestor is what lets an overflow
 * box shrink below its content, and `grid-auto-rows: minmax(0, 1fr)` is the
 * same rule for the grid track; drop either and the page scrolls instead.
 *
 * EFIR (2026-09-16): the column is a plain surface with a hairline — no tone,
 * no frame colour, no glyph disc. Level is the only hue on the board and it
 * rides on the rows and seats (see the EFIR section), never on the chrome.
 * The pressed FAKT segment is ink. Type is the `--tv-*` scale on :root.
 * ======================================================================== */

.tv-board {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tv-col {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

/*
 * THE PHONE'S SWITCH — «Sotuvchilar | Komandalar», one board at a time
 * under 1280px. Not drawn from 1280, where both boards are on screen.
 * The selected tab is ink on the surface, like every other lit control here.
 */
.tv-switch {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
}
.tv-switch-tab {
  flex: 1;
  padding: 9px 12px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-secondary);
  transition: background var(--duration-enter) var(--ease-out), color var(--duration-enter) var(--ease-out);
}
.tv-switch-tab[aria-selected="true"] {
  color: var(--surface);
  background: var(--ink-primary);
}
@media (min-width: 1280px) {
  .tv-switch {
    display: none;
  }
}
@media (max-width: 1279px) {
  .tv-col--parked {
    display: none;
  }
}

/* 40 px column head: title · count · FAKT switch. `position: relative` is
   load-bearing — the promotion banner (`.tv-promo`, EFIR section) is pinned
   to this box and floats over it. */
.tv-col-head {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  height: 40px;
  padding: 0 16px 0 20px;
  border-bottom: 1px solid var(--border);
}
.tv-col-head__title {
  margin: 0;
  font-size: var(--tv-l);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
  white-space: nowrap;
}
.tv-col-head__count {
  font-size: var(--tv-m);
  color: var(--ink-muted);
  white-space: nowrap;
}
.tv-col-head__spacer {
  flex: 1;
}

/*
 * FAKT 1 / FAKT 2 — which fact the board is ranked on, in each column's head.
 * Drawn at every width. The lit segment is the fact the board is ACTUALLY
 * ranked on (under the opening 'auto' the data decides — `FaktSwitch`), and
 * it is INK: no hue is spent on chrome on this board.
 */
.tv-fakt {
  display: flex;
  flex: none;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
}
.tv-fakt-tab {
  padding: 4px 12px;
  border-radius: 7px;
  font-size: var(--tv-s);
  font-weight: 600;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--ink-secondary);
  transition: background var(--duration-enter) var(--ease-out), color var(--duration-enter) var(--ease-out);
}
.tv-fakt-tab:hover {
  color: var(--ink-primary);
}
.tv-fakt-tab[aria-pressed='true'] {
  background: var(--ink-primary);
  color: var(--surface);
}
/* Forced colours discard the ink wash; `aria-pressed` gets a border the mode keeps. */
@media (forced-colors: active) {
  .tv-fakt-tab[aria-pressed='true'] {
    border: 2px solid CanvasText;
  }
}

/* Empty, error and «podium hali bo'sh» states. */
.tv-empty {
  padding: 24px 16px;
}
.tv-empty-podium {
  margin: 0;
  padding: 12px 20px 8px;
  font-size: var(--tv-m);
  font-weight: 600;
  color: var(--ink-primary);
}

/* Skeleton — the ready layout's shape: three seats, then rows. */
.tv-skeleton-seat {
  height: 200px;
}
.seat--1.tv-skeleton-seat {
  height: 240px;
}
.tv-skeleton-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
}
.tv-skeleton-row {
  height: 42px;
  border-radius: 6px;
}
.tv-skeleton-row--team {
  height: 54px;
}

/*
 * `min-height: 0` ONLY FROM the two-column width. Under it the page scrolls
 * as a whole, and a shrinkable board inside a viewport-high wrapper squeezed
 * both lists to nothing on a phone.
 */
@media (min-width: 1280px) {
  /* The page's own column, so the viewport-height layout and the two-column
     one switch on ONE query. */
  .tv-board-shell {
    height: 100%;
  }
  .tv-board {
    display: grid;
    grid-template-columns: minmax(0, 60fr) minmax(0, 40fr);
    grid-auto-rows: minmax(0, 1fr);
    /* `flex: 1`, not `height: 100%`: the shell also carries the credit line. */
    flex: 1;
    min-height: 0;
  }
  .tv-col {
    min-height: 0;
  }
  /* ONLY THE ROWS SCROLL — the label strip above them is a sibling and stays
     put, so the fourth rank is never hidden under a sticky header. */
  .tv-rows {
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
    flex: 1;
    min-height: 0;
  }
  .tv-trows {
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
    flex: 1;
    min-height: 0;
  }
}

/*
 * THE CREDIT LINE — who built the board, in the quietest voice the page has.
 * Never a link, never a colour the board uses for a value.
 */
.tv-credit {
  flex-shrink: 0;
  padding: 2px 4px 0;
  text-align: right;
  font-size: 10px;
  letter-spacing: 0.06em;
  line-height: 1.2;
  color: color-mix(in oklab, var(--ink-secondary) 45%, transparent);
  user-select: none;
}
CSS
```

(b) EFIR 3-bo'lak — qator, komandalar, e'lon, harakat (scratchpad):

```bash
cat > /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/efir-3.css <<'CSS'
/* ---- ro'yxat: timing tower (spec §5). Yorliq qatori STATIK, skroll qutisi TASHQARISIDA. ---- */
.tv-cols,
.row {
  display: grid;
  grid-template-columns: 10px 52px 70px minmax(0, 1fr) 84px 160px 146px 60px 68px;
  align-items: center;
  padding-right: 16px;
}
.tv-cols {
  flex: none;
  height: 24px;
  font-size: var(--tv-s);
  color: var(--ink-muted);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.tv-cols__c { text-align: center; }
.tv-cols__name { padding-left: 12px; }
.tv-cols__r {
  text-align: right;
  padding-left: 8px;
}
.tv-cols[data-read="fakt2"] .tv-cols__f2,
.tv-cols[data-read="fakt1"] .tv-cols__f1 {
  color: var(--ink-secondary);
  font-weight: 600;
}
.tv-rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  height: 50px;
  border-bottom: 1px solid var(--border);
}
/* Tasma — 10 px to'liq balandlikda `--tier`; 3 metrdan ro'yxat rang bo'yicha
   saralangan umurtqa bo'lib o'qiladi. Ko'tarilishda yangi darajaga 380 ms da o'tadi. */
.row__band {
  align-self: stretch;
  background: var(--tier);
  transition: background var(--duration-move) var(--ease-out);
}
.row[data-tier="0"] .row__band {
  background: transparent;
  box-shadow: inset 1px 0 0 var(--tier);
}
.row__rank {
  font-size: var(--tv-l);
  font-weight: 600;
  text-align: center;
  letter-spacing: -0.02em;
  color: var(--ink-primary);
  font-variant-numeric: tabular-nums lining-nums;
}
.row .crest { margin-left: 6px; }
.row__name {
  padding-left: 12px;
  font-size: var(--tv-l);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row__team {
  margin-left: 14px;
  font-size: var(--tv-m);
  font-weight: 400;
  color: var(--ink-muted);
}
.row__medals {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: visible;
}
.row__more {
  font-size: var(--tv-s);
  color: var(--ink-muted);
}
.row__f2,
.row__f1 {
  font-size: var(--tv-m);
  color: var(--ink-secondary);
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums lining-nums;
}
/* O'qilayotgan fakt — 24 px qalin; ustun tartibi o'zgarmaydi. */
.tv-rows[data-read="fakt2"] .row__f2,
.tv-rows[data-read="fakt1"] .row__f1 {
  font-size: var(--tv-l);
  font-weight: 700;
  color: var(--ink-primary);
  letter-spacing: -0.02em;
}
.row__orders,
.row__conv {
  font-size: var(--tv-m);
  text-align: right;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

/* ---- komandalar (spec §6): bir qatorli 62 px, ulush chizig'i, metall raqam faqat 1–3 ---- */
.tv-tcols,
.trow {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 40px 146px 58px 104px 48px 58px;
  column-gap: 8px;
  align-items: center;
  padding-right: 12px;
}
.tv-tcols {
  flex: none;
  height: 24px;
  font-size: var(--tv-s);
  color: var(--ink-muted);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.tv-tcols__c { text-align: center; }
.tv-tcols__name { padding-left: 2px; }
.tv-tcols__r { text-align: right; }
.tv-tcols[data-read="fakt2"] .tv-tcols__f2,
.tv-tcols[data-read="fakt1"] .tv-tcols__f1 {
  color: var(--ink-secondary);
  font-weight: 600;
}
.tv-trows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.trow {
  position: relative;
  height: 62px;
  border-bottom: 1px solid var(--border);
}
/* Ulush chizig'i — ulush ÷ yetakchi ulushi, 40 % siyoh, qator pastida 2 px. */
.trow::after {
  content: "";
  position: absolute;
  left: 44px;
  bottom: -1px;
  height: 2px;
  width: calc((100% - 56px) * var(--share, 0));
  background: var(--ink-muted);
  opacity: 0.4;
}
.trow__rank {
  font-size: var(--tv-l);
  font-weight: 600;
  text-align: center;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums lining-nums;
}
.trow__rank[data-metal="gold"] { color: var(--medal-gold); font-weight: 700; }
.trow__rank[data-metal="silver"] { color: var(--medal-silver); font-weight: 700; }
.trow__rank[data-metal="bronze"] { color: var(--medal-bronze); font-weight: 700; }
.trow__name {
  padding-left: 2px;
  font-size: var(--tv-l);
  font-weight: 600;
  color: var(--ink-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trow__cnt,
.trow__share,
.trow__orders,
.trow__conv {
  font-size: var(--tv-m);
  text-align: right;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}
.trow__f2,
.trow__f1 {
  font-size: var(--tv-m);
  color: var(--ink-secondary);
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums lining-nums;
}
.tv-trows[data-read="fakt2"] .trow__f2,
.tv-trows[data-read="fakt1"] .trow__f1 {
  font-size: var(--tv-l);
  font-weight: 700;
  color: var(--ink-primary);
  letter-spacing: -0.02em;
}
.tv-tfoot {
  flex: none;
  display: flex;
  align-items: center;
  height: 28px;
  margin: 0;
  padding: 0 20px;
  border-top: 1px solid var(--border);
  font-size: var(--tv-s);
  color: var(--ink-muted);
}

/* ---- e'lon (spec §8): ustun sarlavhasi USTIDA 8 s, oqimdan tashqarida — hech narsa surilmaydi.
   `left` ga qadalgan, `fit-content`; `pointer-events: none` — tugma ostida bosilaveradi.
   `transform` markazlashtirishga ketgan — kirish MUSTAQIL `translate` da. ---- */
.tv-promo {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  max-width: calc(100% - 36px);
  width: fit-content;
  z-index: 3;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 32px;
  padding: 0 14px 0 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  font-size: var(--tv-m);
  font-weight: 600;
  color: var(--ink-primary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  animation: tv-promo-in var(--duration-enter) var(--ease-out);
}
.tv-promo__band {
  align-self: stretch;
  width: 10px;
  background: var(--tier);
}
.tv-promo .crest { flex: none; }
.tv-promo__text {
  overflow: hidden;
  text-overflow: ellipsis;
}
@keyframes tv-promo-in {
  from { opacity: 0; translate: 0 -6px; }
  to { opacity: 1; translate: 0 0; }
}

/* ---- voqea harakati (spec §8): yangi chevron 400 ms da bir marta to'ladi, yangi medal 0,6 → 1.
   Yaltirash, marquee, pulsatsiya yo'q. ---- */
@keyframes crest-fill {
  from { fill: var(--track); }
  to { fill: var(--tier); }
}
.crest__cell--fill { animation: crest-fill 400ms var(--ease-out) both; }
@keyframes medal-new {
  from { transform: scale(0.6); opacity: 0; }
  to { transform: none; opacity: 1; }
}
.medal--new {
  transform-origin: center;
  animation: medal-new 400ms var(--ease-out) both;
}
CSS
```

(c) Almashtirish — bitta skript (bannerlarni SARLAVHA satri bo'yicha topadi, `=` soniga bog'lanmaydi):

```bash
node - <<'JS'
const fs = require('fs')
const S = '/tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/'
let css = fs.readFileSync('src/app/globals.css', 'utf8')
/** Banner boshi — sarlavha satridan oldingi `/* ` */
const bannerStart = (text, title) => {
  const t = text.indexOf(title)
  if (t < 0) throw new Error(title + ' topilmadi')
  const b = text.lastIndexOf('/* ', t)
  if (b < 0) throw new Error(title + ': banner boshi topilmadi')
  return b
}
const cut = (title, nextTitle) => {
  const a = bannerStart(css, title)
  const b = bannerStart(css, nextTitle)
  if (b <= a) throw new Error(title + ' → ' + nextTitle + ': tartib noto‘g‘ri')
  const removed = css.slice(a, b)
  css = css.slice(0, a) + css.slice(b)
  return removed
}
// 1. PODIUM bo'limi (PODIUM … LAVHA) butunlay.
cut(' * PODIUM — the sellers board', ' * LAVHA —')
// 2. LAVHA + MEDAL + DARAJA BLOKI (LAVHA … EFIR) butunlay.
cut(' * LAVHA —', ' * EFIR —')
// 3. TV BOARD (TV BOARD … ORG CHART): rekord devori blokini saqlab, qolganini yangisi bilan.
const old = cut(' * TV BOARD — the sellers board', ' * ORG CHART')
const rwA = bannerStart(old, ' * THE RECORD WALL')
const rwB = old.indexOf("/*\n * THE PHONE'S SWITCH")
if (rwB < 0 || rwB <= rwA) throw new Error('rekord devori blokining oxiri topilmadi')
const recordWall = old.slice(rwA, rwB).trim() + '\n\n'
const fresh = fs.readFileSync(S + 'tv-board.css', 'utf8').trim() + '\n\n'
const org = bannerStart(css, ' * ORG CHART')
css = css.slice(0, org) + fresh + recordWall + css.slice(org)
// 4. EFIR 3-bo'lak — kamaytirilgan-harakat markeridan oldin.
const marker = '/* EFIR — kamaytirilgan harakat'
const m = css.indexOf(marker)
if (m < 0) throw new Error('EFIR marker topilmadi')
if (css.includes('.row__band {')) throw new Error('qator CSS allaqachon bor')
css = css.slice(0, m) + fs.readFileSync(S + 'efir-3.css', 'utf8').trim() + '\n\n' + css.slice(m)
fs.writeFileSync('src/app/globals.css', css)
console.log('ok')
JS
```

Tekshiruv: `grep -n -E '^\s*\* (PODIUM|LAVHA|MEDAL|DARAJA BLOKI|EFIR|TV BOARD|THE RECORD WALL|ORG CHART)' src/app/globals.css` → EFIR, TV BOARD, THE RECORD WALL, ORG CHART — shu tartibda, boshqasi yo'q; `grep -c -- '--tv-tone' src/app/globals.css` → 0; `grep -c 'tv-pedestal\|podium-card\|\.lavha\|\.narvon\|tv-table' src/app/globals.css` → 0.

(d) Token blokidagi eskirgan izoh. Yorug' `:root` blokida `--medal-gold` dan oldingi izohning oxirgi abzatsini almashtiring:
```
   * ONE WRITTEN EXCEPTION (2026-09-16): the Oy family of seller medals
   * (`.medal[data-medal="month-gold|month-silver|month-bronze|year-champion"]`)
   * takes these metals as its FIELD, because the fact it encodes — first,
   * second, third in a period — is the same fact the podium seats encode.
   * Nowhere else; the level plate never touches them. See the MEDAL section.
```
→
```
   * THE WRITTEN EXCEPTIONS (EFIR, 2026-09-16): the seller medals (`.medal` —
   * the Oy family in its own metal, every other code in gold), the seats'
   * rank halos (`.halo`), the Legenda crown (`.crest__crown`), the teams'
   * metal rank numerals (`.trow__rank`) and the record wall's labels
   * (`.record__k`). Nowhere else — never the level band, the crest cells, a
   * name or a figure. `tests/features/efirCss.test.ts` holds the list.
```

- [ ] **Step 13: `CLAUDE.md` — bitta satr**

`CLAUDE.md` da («Sotuvchilar reytingi» bandida):
```
  cache key, nothing that can straddle a sync. `rankedBy` in `SellersPage`
```
→
```
  cache key, nothing that can straddle a sync. `rankedBy` in `sellers/board.ts`
```

- [ ] **Step 14: Testlar va tur tekshiruvi**

Run: `npx vitest run tests/features/sellersTvBoard.test.tsx tests/features/tvBoardLayout.test.ts tests/features/efirCss.test.ts tests/features/sellersEfir.test.tsx tests/features/usePromotions.test.tsx tests/features/recordWallCss.test.ts tests/features/theme.test.ts`
Expected: PASS — hammasi.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: xatosiz. (Xato chiqsa — birinchi navbatda o'chirilgan modulning qolgan importi; `grep -rn "sellers/Lavha\|sellers/Medal'\|LevelBlock\|MedalRail\|SpeakingMedal\|Narvon\|useMedalRotation\|medalReason" src tests`.)

Run: `npx eslint src/features/sellers src/lib/format.ts tests/features/sellersTvBoard.test.tsx tests/features/sellersEfir.test.tsx`
Expected: xatosiz (`react/no-unescaped-entities`, ishlatilmagan importlar).

- [ ] **Step 15: Commit**

```bash
git add src/features/sellers/board.ts src/features/sellers/FaktSwitch.tsx src/features/sellers/ColumnHead.tsx src/features/sellers/SellersBoard.tsx src/features/sellers/TeamsBoard.tsx src/features/sellers/SellersPage.tsx src/features/sellers/PromotionBanner.tsx src/features/sellers/medalCatalog.ts src/app/globals.css CLAUDE.md tests/features/sellersTvBoard.test.tsx tests/features/tvBoardLayout.test.ts tests/features/efirCss.test.ts
git status --short
git commit -m "feat(sellers): EFIR taxtasi — o'rindiqlar, timing-tower qatorlar, bir qatorli komandalar; lavha, lentali medal, podium xromi va gapiruvchi karta o'chdi

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(`git rm` bilan o'chirilgan fayllar allaqachon indeksda; `git status --short` da faqat shu vazifaning fayllari va `D` satrlari ko'rinishi kerak.)

---
### Task 5: Rekord devori — ikki statik band; sahifa sarlavhasi

**Files:**
- Modify: `src/features/sellers/RecordWall.tsx` (butunlay)
- Modify: `src/app/globals.css` — TV BOARD oxiridagi «THE RECORD WALL» bloki butunlay yangisi bilan
- Modify: `tests/features/recordWallCss.test.ts` (butunlay qayta), `tests/features/efirCss.test.ts` (kengayadi)
- Test: `tests/features/recordWall.test.tsx` (yangi)
- `PageShell` TEGILMAYDI (pastdagi 6-qadam).

**Interfaces:**
- Consumes: `formatSomFull`, `formatNumber`, `NARROW_NBSP` (1-vazifa); `useReducedMotion` (`@/lib/useReducedMotion`); `SellerRecordDto`, `SellerRecordsDto`, `apiGet`.
- Produces:
  ```ts
  export const RECORD_CUT_MS = 10_000
  export const RECORD_WIDE_QUERY = '(min-width: 1500px)'
  export function RecordWall(): JSX                    // so'rov + `RecordWallView`
  export function RecordWallView(props: { months: readonly SellerRecordDto[]; wide: boolean; reduced: boolean }): JSX | null
  //   → <div class="record-wall"> > span.record×(2 | 1) > .record__k .record__n .record__v .record__note
  export function monthName(month: string): string     // '2026-09-01' → 'Sentabr'
  export function monthLabel(month: string): string    // '2026-08-01' → 'Avgust 2026' (mavjud imzo)
  ```

- [ ] **Step 1: DOM testi**

`tests/features/recordWall.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RECORD_CUT_MS, RecordWallView, monthLabel, monthName } from '@/features/sellers/RecordWall'
import type { SellerRecordDto } from '@/lib/api'
import { NARROW_NBSP } from '@/lib/format'

/**
 * Rekord devori — sahifa sarlavhasining o'rtasida IKKI STATIK band (spec §7):
 * sudralmaydi, tor sarlavhada bittasi 10 s da KESIB almashadi, kamaytirilgan
 * harakatda birinchisi turadi. So'rov `RecordWall` da; bu yerda ko'rinish.
 */
const S = NARROW_NBSP
const money = (amount: number) => ({ amountMinor: String(Math.round(amount * 100)), currency: 'UZS', amount })

function record(
  month: string,
  running: boolean,
  fullName: string,
  amount: number,
  orders: number,
  basis: SellerRecordDto['basis'] = 'delivered',
): SellerRecordDto {
  return {
    month,
    running,
    employeeId: fullName,
    fullName,
    rop: null,
    basis,
    amount: money(amount),
    orders,
    confirmed: money(amount),
    confirmedOrders: orders,
    delivered: money(amount),
    deliveredOrders: orders,
  }
}

/* Payload — eng yangi oy birinchi (`SellerRecordsDto.months`). */
const MONTHS = [
  record('2026-09-01', true, 'Shahtiyarovna 197 Marjona', 79_600_000, 57),
  record('2026-08-01', false, '154 Marjona Xayrullayeva', 128_550_000, 74),
  record('2026-07-01', false, 'Saparboyeva 110 Farida', 90_000_000, 40, 'confirmed'),
]

const labels = (c: HTMLElement) => [...c.querySelectorAll('.record')].map((r) => r.querySelector('.record__k')!.textContent)

describe('rekord devori — ikki statik band (spec §7)', () => {
  it('keng sarlavhada eng yangi ikki oy: yetakchi va rekord; to‘liq so‘m; «57 ta yetkazilgan»', () => {
    const { container } = render(<RecordWallView months={MONTHS} wide reduced={false} />)
    expect(labels(container)).toEqual(['Sentabr yetakchisi', 'Avgust 2026 rekordi'])
    const [lead, rec] = container.querySelectorAll('.record')
    expect(lead!.querySelector('.record__n')!.textContent).toBe('Shahtiyarovna 197 Marjona')
    expect(lead!.querySelector('.record__v')!.textContent).toBe(`79${S}600${S}000`)
    expect(lead!.querySelector('.record__note')!.textContent).toBe('57 ta yetkazilgan')
    expect(rec!.querySelector('.record__v')!.textContent).toBe(`128${S}550${S}000`)
    expect(container.querySelector('.record-wall')!.getAttribute('aria-label')).toBe('Har oyning eng yaxshi sotuvchisi')
    // Marquee, lozenge, kubok — hech biri yo'q.
    expect(container.querySelector('.record-track')).toBeNull()
    expect(container.textContent).not.toMatch(/mln|soʻm|🏆|◆|Rekord ·|Yetakchi ·/)
  })

  it('tasdiqlangan pul bilan o‘lchangan oy «tasdiqlangan» deb yoziladi', () => {
    const { container } = render(<RecordWallView months={MONTHS.slice(2)} wide reduced={false} />)
    expect(labels(container)).toEqual(['Iyul 2026 rekordi'])
    expect(container.querySelector('.record__note')!.textContent).toBe('40 ta tasdiqlangan')
  })

  it('oy yo‘q — hech narsa chizilmaydi', () => {
    const { container } = render(<RecordWallView months={[]} wide reduced={false} />)
    expect(container.firstChild).toBeNull()
  })

  describe('tor sarlavha (~1500 px dan kam) — bitta band, 10 s da kesib almashadi', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('avval yetakchi, 10 s dan keyin rekord, yana 10 s dan keyin yetakchi', () => {
      const { container } = render(<RecordWallView months={MONTHS} wide={false} reduced={false} />)
      expect(labels(container)).toEqual(['Sentabr yetakchisi'])
      act(() => vi.advanceTimersByTime(RECORD_CUT_MS))
      expect(labels(container)).toEqual(['Avgust 2026 rekordi'])
      act(() => vi.advanceTimersByTime(RECORD_CUT_MS))
      expect(labels(container)).toEqual(['Sentabr yetakchisi'])
      // Uchinchi oy hech qachon — devor eng yangi ikki oyni ko'rsatadi.
      expect(container.textContent).not.toContain('Iyul')
    })

    it('kamaytirilgan harakatda kesish yo‘q — birinchisi turadi', () => {
      const { container } = render(<RecordWallView months={MONTHS} wide={false} reduced />)
      act(() => vi.advanceTimersByTime(RECORD_CUT_MS * 3))
      expect(labels(container)).toEqual(['Sentabr yetakchisi'])
    })

    it('bitta oy — kesadigan narsa yo‘q', () => {
      const { container } = render(<RecordWallView months={MONTHS.slice(0, 1)} wide={false} reduced={false} />)
      act(() => vi.advanceTimersByTime(RECORD_CUT_MS * 2))
      expect(labels(container)).toEqual(['Sentabr yetakchisi'])
    })
  })

  it('oy nomlari satrdan, brauzer mintaqasidan emas: «Sentabr», «Avgust 2026»', () => {
    expect(monthName('2026-09-01')).toBe('Sentabr')
    expect(monthLabel('2026-08-01')).toBe('Avgust 2026')
    expect(monthLabel('2026-13-01')).toBe('2026-13-01')
  })
})
```

- [ ] **Step 2: Testni ishga tushirish — qizil**

Run: `npx vitest run tests/features/recordWall.test.tsx`
Expected: FAIL — `RecordWallView`/`RECORD_CUT_MS`/`monthName` eksport qilinmagan.

- [ ] **Step 3: `RecordWall.tsx` ni qayta yozish**

`src/features/sellers/RecordWall.tsx` ni butunlay quyidagi bilan almashtiring:

```tsx
'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'

import { type SellerRecordDto, type SellerRecordsDto, apiGet } from '@/lib/api'
import { formatNumber, formatSomFull } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * The record wall — the two newest months, standing still in the title line.
 *
 * TWO STATIC BANDS, NOT A TICKER (EFIR, spec §7 / §8): «Sentabr yetakchisi ·
 * name · figure · 57 ta yetkazilgan» and «Avgust 2026 rekordi · …», a hairline
 * between them. The crawl it replaces was the one thing on this page that
 * moved at rest, and the redesign's rule is that nothing does: the list
 * drifts, everything else stands. The running month is a LEAD, the closed
 * one a RECORD, and the word says which.
 *
 * NARROWER THAN ~1500px THE HEADER HOLDS ONE BAND, and it CUTS to the other
 * every ten seconds — a cut, never a slide. Reduced motion stops the cut and
 * leaves the lead on screen. Under 1280 the wall is not drawn at all (CSS):
 * the page stops being a television there.
 *
 * ITS OWN QUERY, ON ITS OWN CLOCK. `?include=records` spans every month since
 * the attribution became trustworthy, and the answer only changes when a
 * month closes: ten minutes for both `staleTime` and `refetchInterval`
 * (`refetchInterval` never consults staleness, so one alone buys nothing).
 */
export const RECORD_CUT_MS = 10_000
export const RECORD_WIDE_QUERY = '(min-width: 1500px)'

function subscribeWide(onChange: () => void): () => void {
  const media = window.matchMedia(RECORD_WIDE_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** Whether the title line has room for two bands. The server answers yes. */
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(RECORD_WIDE_QUERY).matches,
    () => true,
  )
}

export function RecordWall() {
  const records = useQuery({
    queryKey: ['sellers', 'records'],
    queryFn: ({ signal }) =>
      apiGet<SellerRecordsDto>('/analytics/sellers', { include: 'records' }, signal),
    staleTime: 600_000,
    refetchInterval: 600_000,
    placeholderData: (previous) => previous,
  })
  const wide = useWide()
  const reduced = useReducedMotion()

  return <RecordWallView months={records.data?.data.months ?? []} wide={wide} reduced={reduced} />
}

/** The view, without the query — what the tests render. */
export function RecordWallView({
  months,
  wide,
  reduced,
}: {
  /** Newest month first, as the payload sends them. */
  months: readonly SellerRecordDto[]
  wide: boolean
  reduced: boolean
}) {
  const shown = months.slice(0, 2)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (wide || reduced || shown.length < 2) return
    const id = setInterval(() => setTick((n) => n + 1), RECORD_CUT_MS)
    return () => clearInterval(id)
  }, [wide, reduced, shown.length])

  // Nothing to say yet, and nothing worth holding the line open for.
  if (shown.length === 0) return null

  const items = wide ? shown : [shown[tick % shown.length]!]

  return (
    <div className="record-wall" aria-label="Har oyning eng yaxshi sotuvchisi">
      {items.map((m) => (
        <RecordItem key={m.month} record={m} />
      ))}
    </div>
  )
}

function RecordItem({ record }: { record: SellerRecordDto }) {
  /*
    THE MONTH'S STATE, IN THE WORD. «rekordi» is a month that is over and can
    no longer change; «yetakchisi» is the month still running, whose leader
    may yet lose the place. Without it a running month's smaller figure reads
    as a record having collapsed.
  */
  const label = record.running ? `${monthName(record.month)} yetakchisi` : `${monthLabel(record.month)} rekordi`
  return (
    <span className="record">
      <span className="record__k">{label}</span>
      <span className="record__n">{record.fullName}</span>
      <span className="record__v">{formatSomFull(record.amount.amount)}</span>
      {/*
        WHICH FIGURE THIS IS, ALWAYS SAID. The wall switches between FAKT 2
        and FAKT 1 by the podium's rule — FAKT 2 decides, FAKT 1 only where
        nobody has delivered yet — so a month can print a bigger number purely
        because none of it is on the road.
      */}
      <span className="record__note">
        {formatNumber(record.orders)} ta {record.basis === 'delivered' ? 'yetkazilgan' : 'tasdiqlangan'}
      </span>
    </span>
  )
}

/**
 * «Avgust 2026» from `2026-08-01`, «Sentabr» from `2026-09-01`.
 *
 * Built from the string rather than from a Date: the value is already a
 * calendar month resolved in the reporting timezone, and putting it through a
 * Date would re-resolve it in the BROWSER's zone — which for a machine set to
 * UTC turns the first of the month into the last of the one before.
 */
const MONTHS = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
] as const

export function monthName(month: SellerRecordDto['month']): string {
  const [, index] = month.split('-')
  return MONTHS[Number(index) - 1] ?? month
}

export function monthLabel(month: SellerRecordDto['month']): string {
  const [year, index] = month.split('-')
  const name = MONTHS[Number(index) - 1]
  return name ? `${name} ${year}` : month
}
```

- [ ] **Step 4: DOM testi — yashil**

Run: `npx vitest run tests/features/recordWall.test.tsx`
Expected: PASS (8 ta test).

- [ ] **Step 5: CSS — rekord devori bloki**

```bash
cat > /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/record-wall.css <<'CSS'
/* ==========================================================================
 * THE RECORD WALL — two static bands in the title line (EFIR, spec §7)
 *
 * «Sentabr yetakchisi» · «Avgust 2026 rekordi»: the label in the podium's
 * gold — the one place metal appears in the header, chrome and never a value
 * — the name and the figure in ink, the note muted. NO CRAWL: nothing on
 * this page moves at rest (spec §8); under ~1500px the component shows one
 * band and cuts to the other every ten seconds. Not drawn under 1280, the
 * width where the page stops being a television. Shares the `--tv-*` scale
 * on :root.
 * ======================================================================== */

.record-wall {
  display: none;
  flex: 1;
  min-width: 0;
  justify-content: center;
  align-items: baseline;
  gap: 28px;
  margin-inline: 26px;
  font-size: var(--tv-m);
  color: var(--ink-secondary);
  white-space: nowrap;
  overflow: hidden;
}
@media (min-width: 1280px) {
  .record-wall {
    display: flex;
  }
}
.record {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
/* The second band is set off by a hairline, never a box. */
.record + .record {
  border-left: 1px solid var(--border-strong);
  padding-left: 28px;
}
.record__k {
  color: var(--medal-gold);
  font-size: var(--tv-s);
  font-weight: 600;
}
.record__n,
.record__v {
  color: var(--ink-primary);
  font-weight: 600;
}
.record__v {
  font-variant-numeric: tabular-nums lining-nums;
}
.record__note {
  color: var(--ink-muted);
}
CSS
node - <<'JS'
const fs = require('fs')
const S = '/tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/'
let css = fs.readFileSync('src/app/globals.css', 'utf8')
const bannerStart = (title) => {
  const t = css.indexOf(title)
  if (t < 0) throw new Error(title + ' topilmadi')
  return css.lastIndexOf('/* ', t)
}
const a = bannerStart(' * THE RECORD WALL')
const b = bannerStart(' * ORG CHART')
if (b <= a) throw new Error('tartib noto‘g‘ri')
css = css.slice(0, a) + fs.readFileSync(S + 'record-wall.css', 'utf8').trim() + '\n\n' + css.slice(b)
fs.writeFileSync('src/app/globals.css', css)
console.log('ok')
JS
```

Tekshiruv: `grep -c 'record-crawl\|record-track\|record-run\|record-sep\|record-medal' src/app/globals.css` → 0.

- [ ] **Step 6: Sahifa sarlavhasi (spec §7) — nima o‘zgarmaydi va nega**

`PageShell` o'nta ekranga xizmat qiladi; unga tegilmaydi. §7 ning sarlavha tuzilmasi allaqachon shunday: `title` (24 px, `text-2xl`) + davr satri chapda, `banner={<RecordWall />}` markazda (`flex-1`), davr boshqaruvi o'ngda (`controlsAlign="end"`). Davr satrining o'lchami (house 12 px) va davr boshqaruvining faol segmenti (umumiy komponent) shu ish doirasida o'zgarmaydi — bu hal qilingan noaniqlik, reja hisobotida aytiladi. Bu qadamda hech narsa yozilmaydi.

- [ ] **Step 7: CSS testlari**

`tests/features/recordWallCss.test.ts` ni butunlay quyidagi bilan almashtiring:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The record wall's stylesheet facts, pinned the way `theme.test.ts` pins
 * the theme guard — nothing in TypeScript can see them and every symptom
 * they prevent is silent: the metal on the label, the width under which the
 * wall is not drawn, and the ABSENCE of the crawl it replaced.
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/** One declaration block by selector, without the rules that follow it. */
function ruleFor(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  expect(start, `${selector} is missing from globals.css`).toBeGreaterThan(-1)
  return CSS.slice(start, CSS.indexOf('}', start))
}

describe('the record wall, as the stylesheet defines it', () => {
  it('takes its metal from the same token the champion’s halo does — on the label only', () => {
    expect(ruleFor('.record__k')).toContain('color: var(--medal-gold)')
    expect(ruleFor('.record__n,\n.record__v')).not.toContain('--medal-')
    expect(ruleFor('.record__note')).not.toContain('--medal-')
  })

  it('is not drawn under 1280px, the same line the board itself draws', () => {
    expect(ruleFor('.record-wall')).toMatch(/display:\s*none/)
    const after = CSS.slice(CSS.indexOf('.record-wall {'))
    const media = after.slice(0, after.indexOf('.record {'))
    expect(media).toContain('@media (min-width: 1280px)')
    expect(media).toMatch(/\.record-wall\s*\{[^}]*display:\s*flex/)
  })

  it('does not crawl, mask or loop — nothing on this page moves at rest', () => {
    expect(CSS).not.toContain('@keyframes record-crawl')
    expect(CSS).not.toContain('.record-track')
    expect(CSS).not.toContain('--record-travel')
    expect(ruleFor('.record-wall')).not.toContain('mask-image')
    expect(ruleFor('.record-wall')).not.toContain('animation')
  })

  it('separates the two bands with a hairline, never a box', () => {
    expect(ruleFor('.record + .record')).toContain('border-left: 1px solid var(--border-strong)')
    expect(ruleFor('.record-wall')).not.toMatch(/background:/)
  })

  it('reads the television scale rather than a ramp of its own', () => {
    expect(ruleFor('.record-wall')).toContain('font-size: var(--tv-m)')
    expect(ruleFor('.record__k')).toContain('font-size: var(--tv-s)')
    expect(CSS).not.toContain('--record-name')
  })
})
```

`tests/features/efirCss.test.ts` OXIRIGA qo'shing:

```ts

/*
  Rekord devori TV BOARD bo'limida turadi; metall shartnomasi unga ham
  tegishli — mintaqa EFIR bannerdan ORG CHART bannerigacha kengaytiriladi.
*/
describe('EFIR — sahifa sarlavhasi va rekord devori', () => {
  it('podium metallari EFIR + TV BOARD bo‘ylab faqat yozilgan istisnolarda; `.record__k` shulardan biri', () => {
    const code = strip(CSS.slice(from('* EFIR —'), from('* ORG CHART')))
    const allowed = /^(\.medal\b|\.halo\b|\.crest__crown\b|\.trow__rank\b|\.record__k\b)/
    const rules = code.match(/[^{}]+\{[^{}]*\}/g) ?? []
    let metalRules = 0
    for (const rule of rules) {
      if (!rule.includes('--medal-')) continue
      metalRules += 1
      const selector = rule.slice(0, rule.indexOf('{')).trim()
      expect(selector, rule.trim()).toMatch(allowed)
    }
    expect(metalRules).toBeGreaterThanOrEqual(7)
    expect(code).not.toContain('--series-')
    expect(code).not.toContain('--tv-tone')
  })
})
```

- [ ] **Step 8: Testlar va tur tekshiruvi**

Run: `npx vitest run tests/features/recordWall.test.tsx tests/features/recordWallCss.test.ts tests/features/efirCss.test.ts tests/features/sellersTvBoard.test.tsx tests/features/tvBoardLayout.test.ts`
Expected: PASS — hammasi.

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: xatosiz.

- [ ] **Step 9: Commit**

```bash
git add src/features/sellers/RecordWall.tsx src/app/globals.css tests/features/recordWall.test.tsx tests/features/recordWallCss.test.ts tests/features/efirCss.test.ts
git commit -m "feat(sellers): rekord devori — ikki statik band, tor sarlavhada 10 s kesish; marquee o'chdi

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Moslashuv (1366, telefon), jonli tekshirish, gate

**Files:**
- Modify: `src/app/globals.css` — EFIR 4-bo'lak (1366 va telefon), kamaytirilgan-harakat markeridan OLDIN
- Modify: `tests/features/tvBoardLayout.test.ts` (kengayadi)
- Modify: `docs/superpowers/specs/2026-09-16-efir-taxta-design.md` — «Holat» satri
- Modify (faqat kerak bo'lsa): jonli tekshirishda topilgan nuqsonlar, har biri testga pinlangan holda

**Interfaces:**
- Consumes: 4-vazifaning DOM shartnomasi (`.tv-cols`/`.row` grid tartibi: 1 tasma · 2 rank · 3 gerb · 4 ism · 5 medallar · 6 FAKT 2 · 7 FAKT 1 · 8 buyurtma · 9 konv.; `.tv-tcols`/`.trow`: 1 rank · 2 nom · 3 soni · 4 FAKT 2 · 5 ulush · 6 FAKT 1 · 7 buyurtma · 8 konv.) — telefon qoidalari `nth-child` bilan, markup o'zgarmaydi.
- Produces: hech qanday yangi eksport.

- [ ] **Step 1: Layout testini kengaytirish**

`tests/features/tvBoardLayout.test.ts` OXIRIGA (oxirgi `})` dan OLDIN, `describe` ichiga) qo'shing:

```ts

  /*
    1366 — 720p televizor yoki zoom qilingan panel: ikki ustun saqlanadi, hamma
    narsa 0.8× (spec §9). Gerb va halqa piksel o'lchamlari CSS'da, shrift
    shkalasi `:root` da — ikkalasi bitta 1599 chegarasida.
  */
  it('scales the crest, halo, seats and rows down under 1600 (spec §9)', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 1599px) {\n  .crest--row'))
    const block = narrow.slice(0, narrow.indexOf('\n}\n') + 3)
    expect(block).toContain('.crest--row { width: 48px; height: 16px; }')
    expect(block).toContain('.crest--seat { width: 62px; height: 21px; }')
    expect(block).toMatch(/\.halo--lg \{[^}]*width: 56px;/)
    expect(block).toMatch(/\.halo \{[^}]*width: 48px;/)
    expect(block).toContain('.row { height: 44px; }')
    expect(block).toMatch(/\.seat--1 \{[^}]*max-width: 365px;/)
    expect(block).toMatch(/\.seat \{[^}]*max-width: 246px;/)
  })

  /*
    Telefon — televizor emas (spec §9): ustunlar bittadan (`.tv-switch`),
    qator tasma · rank · gerb · ism · FAKT 2; FAKT 1, buyurtma, konv. va
    medallar yashirin. Markup o'zgarmaydi — uyalar `nth-child` bilan yopiladi.
  */
  it('collapses a phone row to band · rank · crest · name · FAKT 2 and hides the desk columns', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 1279px) {\n  .tv-podium'))
    const block = phone.slice(0, phone.indexOf('\n}\n') + 3)
    expect(block).toMatch(/\.tv-cols,\s*\.row \{\s*grid-template-columns: 8px 44px 58px minmax\(0, 1fr\) 132px;/)
    expect(block).toMatch(/\.tv-cols > span:nth-child\(5\),\s*\.tv-cols > span:nth-child\(7\),\s*\.tv-cols > span:nth-child\(8\),\s*\.tv-cols > span:nth-child\(9\),\s*\.row > \*:nth-child\(5\),\s*\.row > \*:nth-child\(7\),\s*\.row > \*:nth-child\(8\),\s*\.row > \*:nth-child\(9\) \{\s*display: none;/)
    expect(block).toMatch(/\.tv-tcols,\s*\.trow \{\s*grid-template-columns: 32px minmax\(0, 1fr\) 36px 124px 52px;/)
    expect(block).toMatch(/\.trow > \*:nth-child\(6\),[\s\S]*?display: none;/)
    expect(block).toMatch(/\.seat,\s*\.seat--1 \{\s*flex: 1 1 100%;/)
  })
```

- [ ] **Step 2: Testni ishga tushirish — qizil**

Run: `npx vitest run tests/features/tvBoardLayout.test.ts`
Expected: FAIL — ikkala yangi test (`.crest--row { width: 48px` bloki yo'q).

- [ ] **Step 3: EFIR 4-bo‘lak — 1366 va telefon**

```bash
cat > /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/efir-4.css <<'CSS'
/* ---- 1366 va tor televizor (spec §9): 0.8× — gerb 48×16 / 62×21, halqa 56/48, qator 44,
   o'rindiq 0.8× (365 / 246), gridlar torroq; shrift shkalasi `:root` da 36/20/14/12. ---- */
@media (max-width: 1599px) {
  .crest--row { width: 48px; height: 16px; }
  .crest--seat { width: 62px; height: 21px; }
  .crest--legend { width: 34px; height: 11px; }
  .halo {
    width: 48px;
    height: 48px;
    font-size: 26px;
  }
  .halo--lg {
    width: 56px;
    height: 56px;
    font-size: 30px;
  }
  .seat {
    max-width: 246px;
    gap: 5px;
    padding: 10px 12px 10px 20px;
  }
  .seat--1 {
    max-width: 365px;
    padding: 10px 14px 10px 20px;
  }
  .seat::before { width: 8px; }
  .seat__name { font-size: 18px; }
  .seat__medals { gap: 10px; }
  .medal {
    width: 20px;
    height: 20px;
  }
  .row { height: 44px; }
  .tv-cols,
  .row {
    grid-template-columns: 8px 44px 58px minmax(0, 1fr) 84px 136px 124px 52px 60px;
    padding-right: 12px;
  }
  .trow { height: 52px; }
  .tv-tcols,
  .trow {
    grid-template-columns: 32px minmax(0, 1fr) 36px 124px 52px 92px 44px 52px;
    column-gap: 6px;
  }
  .tv-legend { gap: 10px; }
}

/* ---- telefon (spec §9): ustunlar bittadan (`.tv-switch`, TV BOARD); o'rindiqlar ustma-ust;
   qator tasma · rank · gerb · ism · FAKT 2 — FAKT 1, buyurtma, konv., medallar yashirin.
   Uyalar `nth-child` bilan: 5 medallar, 7 FAKT 1, 8 buyurtma, 9 konv. (sotuvchilar);
   6 FAKT 1, 7 buyurtma, 8 konv. (komandalar). Markup o'zgarmaydi. ---- */
@media (max-width: 1279px) {
  .tv-podium {
    flex-wrap: wrap;
    align-items: stretch;
    padding: 12px 12px 4px;
  }
  .seat,
  .seat--1 {
    flex: 1 1 100%;
    max-width: none;
  }
  .tv-cols,
  .row {
    grid-template-columns: 8px 44px 58px minmax(0, 1fr) 132px;
    padding-right: 12px;
  }
  .tv-cols > span:nth-child(5),
  .tv-cols > span:nth-child(7),
  .tv-cols > span:nth-child(8),
  .tv-cols > span:nth-child(9),
  .row > *:nth-child(5),
  .row > *:nth-child(7),
  .row > *:nth-child(8),
  .row > *:nth-child(9) {
    display: none;
  }
  .tv-tcols,
  .trow {
    grid-template-columns: 32px minmax(0, 1fr) 36px 124px 52px;
  }
  .tv-tcols > span:nth-child(6),
  .tv-tcols > span:nth-child(7),
  .tv-tcols > span:nth-child(8),
  .trow > *:nth-child(6),
  .trow > *:nth-child(7),
  .trow > *:nth-child(8) {
    display: none;
  }
  .tv-legend {
    flex-wrap: wrap;
    height: auto;
    padding: 8px 12px;
    row-gap: 6px;
    white-space: normal;
  }
}
CSS
node - <<'JS'
const fs = require('fs')
const S = '/tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/'
const css = fs.readFileSync('src/app/globals.css', 'utf8')
const marker = '/* EFIR — kamaytirilgan harakat'
const at = css.indexOf(marker)
if (at < 0) throw new Error('EFIR marker topilmadi')
if (css.includes('.crest--row { width: 48px')) throw new Error('1366 CSS allaqachon bor')
fs.writeFileSync('src/app/globals.css', css.slice(0, at) + fs.readFileSync(S + 'efir-4.css', 'utf8').trim() + '\n\n' + css.slice(at))
console.log('ok')
JS
```

- [ ] **Step 4: Testlar — yashil**

Run: `npx vitest run tests/features/tvBoardLayout.test.ts tests/features/efirCss.test.ts tests/features/recordWallCss.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate**

Run: `npm run verify && npm run build && npm run db:check`
Expected: verify yashil (typecheck + lint + testlar); build toza; db:check 10/11 — «deal status agrees with its stage category» 21 ta seed qatori (ma'lum, bu ishga aloqasiz; BOSHQA invariant qizil bo'lsa — to'xtab, hisobot).

`git status --short` da `AGENTS.md` paydo bo'lsa — uni `next dev`/`next build` qayta yozadi, bu ishga aloqasi yo'q: commit qilinmaydi, tegilmaydi.

- [ ] **Step 6: Jonli tekshirish — dev server va kirish**

Postgres: `pg_isready -h 127.0.0.1 -p 5433`; ishlamasa: `~/pg16/bin/pg_ctl -D ~/pg-sinolife -o "-p 5433 -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp/claude-1000/pg5433" -l ~/pg-sinolife/server.log start`.

Dev server SHU worktree'dan, 3000-portda (better-auth faqat `localhost:3000` origin'ini qabul qiladi). `ss -ltn | grep 3000` — band bo'lsa va u boshqa katalogning serveri bo'lsa (`pgrep -fa 'next dev'`), uni ALOHIDA chaqiruvda to'xtating (`pkill -f "next dev"` compound buyruq ichida O'ZINI ham o'ldiradi). So'ng:

```bash
nohup npx next dev -p 3000 > /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/dev.log 2>&1 &
```

Tayyor bo'lguncha: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/login` → 200 (bir necha soniya).

Kirish — parol TRANSKRIPTGA CHIQMAYDI (`.env` bir buyruq ichida source qilinadi):

```bash
sh -c 'set -a; . ./.env; set +a; curl -s -c /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/cookies.txt -X POST http://localhost:3000/api/auth/sign-in/username -H "Content-Type: application/json" -H "Origin: http://localhost:3000" -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}" -o /dev/null -w "%{http_code}\n"'
```
Expected: `200` va jar yozildi.

Cookie'ni Playwright uchun FAYLGA (`async (page) => {…}` funksiya — `context` o'zgaruvchisi yo'q, `page.context()` ishlatiladi; curl `#HttpOnly_` prefiksini yozadi — olib tashlanadi; fayl `/home/smack/Work` ostida bo'lishi shart):

```bash
mkdir -p /home/smack/Work/.playwright-mcp
awk -F'\t' 'BEGIN { print "async (page) => {"; print "  await page.context().addCookies([" } /\t/ { d = $1; sub(/^#HttpOnly_/, "", d); printf "    { name: %c%s%c, value: %c%s%c, domain: %c%s%c, path: %c%s%c, httpOnly: true, secure: false },\n", 39, $6, 39, 39, $7, 39, 39, d, 39, 39, $3, 39 } END { print "  ])"; print "}" }' /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/cookies.txt > /home/smack/Work/.playwright-mcp/efir-cookies.js
```

- [ ] **Step 7: Skrinshotlar — 1920 qorong‘i/yorug‘, 1366, telefon; mock bilan yonma-yon**

Playwright MCP bilan, shu tartibda («Browser is already in use» desa — boshqa sessiya haydayotgan bo'lishi mumkin, `browser_close` qilmang; memory `local-dev-setup` dagi headless-node yo'li):

1. `browser_run_code_unsafe` — `filename: /home/smack/Work/.playwright-mcp/efir-cookies.js`
2. `browser_resize` — width 1920, height 1080
3. `browser_navigate` — `http://localhost:3000/sellers`; `browser_wait_for` — text «Sotuvchilar»
4. `browser_take_screenshot` — `filename: /home/smack/Work/.playwright-mcp/efir-1920-light.png`
5. `browser_evaluate` — `() => { localStorage.setItem('sinolife.theme.v1', 'dark'); location.reload() }`; `browser_wait_for` — text «Sotuvchilar»
6. `browser_take_screenshot` — `filename: /home/smack/Work/.playwright-mcp/efir-1920-dark.png`
7. `browser_resize` — 1366 × 768; `browser_take_screenshot` — `efir-1366-dark.png`
8. `browser_resize` — 390 × 844; `browser_take_screenshot` — `efir-390-dark.png`
9. `browser_console_messages` — xato yo'qligi (`Warning`/`Error` yo'q)
10. Mock: `browser_resize` — 1920 × 1080; `browser_navigate` — `file:///home/smack/Work/ISH-medal/docs/superpowers/specs/assets/2026-09-16-efir/efir.html`; `browser_take_screenshot` — `efir-mock-dark.png`; `file://…/efir-light.html` → `efir-mock-light.png`

Har PNG ni `Read` bilan KO'RING va mock bilan solishtiring:

- 1920: sahifa sarlavhasida ikki rekord bandi (oltin yorliq, to'liq so'm), o'ngda davr boshqaruvi; sotuvchilar ustuni 60 %, komandalar 40 %; uch o'rindiq 2-1-3, pastlari tekis, chap chetida daraja tasmasi, halqa metallda, ism ikki qatorda, FAKT 44 px, progress + «… qoldi» to'liq so'mda, medallar ×N bilan; yorliq qatori podium ostida STATIK, 4-rank to'liq ko'rinadi; qatorlarda tasma + gerb, so'z yo'q, ≤3 medal + «+N», `first-sale` yo'q; pastda legenda; komandalar bir qatorli, 1–3 metall raqam, ulush chizig'i, pastki jumla. Pushti/yashil ustun ramkalari YO'Q; pedestal, lavha, shtamp, gapiruvchi karta YO'Q.
- Qorong'i va yorug': tasma va gerb ranglari YORUG'LIK TARTIBIDA (Usta har doim Katta sotuvchidan yorug'roq); nodir medallarda faqat qorong'ida yumshoq oltin soya; yorug'da Ustoz/Legenda katakchalari oqish bo'lsa — spec §13 ga ko'ra qabul qilinadi (1 px kontur keyingi ish).
- 1366: ikki ustun saqlangan, gerb 48×16, halqa 56/48, qator 44 px, hech narsa kesilmagan/toshmagan (o'rindiqlar ustun ichida, ism ellipsis bilan).
- 390: `.tv-switch` bor, bitta ustun, o'rindiqlar ustma-ust, qator tasma · rank · gerb · ism · FAKT 2; yon skroll yo'q.
- Konsolda xato yo'q.

Nuqson topilsa — tuzating, testga pinlang (DOM yoki CSS), alohida commit.

- [ ] **Step 8: Majburiy ko‘tarilish overlay tekshiruvi**

`/home/smack/Work/.playwright-mcp/efir-promo.js` (birinchi tetik — `promotedOn === today` — so'rovni ushlab, HAR sotuvchiga bugungi sanani yozamiz; taxtada birinchi turgan odam e'lon qilinadi; `celebrated` modul ichida — sahifa qayta yuklanganda tozalanadi):

```js
async (page) => {
  const medals = /\/api\/v1\/analytics\/sellers\?include=medals/
  await page.route(medals, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    for (const seller of body.data.sellers) {
      if (seller.rankTitle === null) continue
      seller.promotedOn = body.data.today
    }
    await route.fulfill({ response, json: body })
  })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('http://localhost:3000/sellers')
  await page.waitForSelector('.tv-promo', { timeout: 20000 })
  await page.screenshot({ path: '/home/smack/Work/.playwright-mcp/efir-promo-1920-dark.png' })
  await page.unroute(medals)
}
```

`browser_run_code_unsafe` — `filename: /home/smack/Work/.playwright-mcp/efir-promo.js`; so'ng `efir-promo-1920-dark.png` ni `Read` bilan ko'ring: e'lon ustun SARLAVHASI USTIDA (podium surilmagan), tasma + gerb + «Ism — endi USTA · 100 000 000» (to'liq so'm, «mln» yo'q); e'lon qilingan odam o'rindiqda bo'lsa gerbning eng yangi katakchasi to'liq. 8 soniyadan keyin `browser_snapshot` — `role="status"` yo'q.

Tekshiruv tugagach — sirni olib tashlang (sessiya tokeni bor):

```bash
rm -f /home/smack/Work/.playwright-mcp/efir-cookies.js /tmp/claude-1000/-home-smack-Work/d2262204-4e68-4568-a1e8-723d4985ca3f/scratchpad/efir/cookies.txt
```

Dev serverni siz ishga tushirgan bo'lsangiz — ALOHIDA chaqiruvda to'xtating (`pkill -f "next dev -p 3000"`), boshqa sessiyaniki bo'lsa tegmang.

- [ ] **Step 9: Spec holati va commit**

`docs/superpowers/specs/2026-09-16-efir-taxta-design.md` ning ikkinchi satrida:
```
**Sana:** 2026-09-16 (kechqurun). **Holat:** tasdiqlangan konsepsiya, amalga oshirish rejasi yozilmoqda.
```
→
```
**Sana:** 2026-09-16 (kechqurun). **Holat:** amalga oshirildi — `efir` branch'i, deploy kutmoqda.
```

```bash
git add src/app/globals.css tests/features/tvBoardLayout.test.ts docs/superpowers/specs/2026-09-16-efir-taxta-design.md
git commit -m "feat(sellers): EFIR — 1366 va telefon moslashuvi; spec holati amalga oshirildi

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git log --oneline origin/main..HEAD
```

`main` ga push YO'Q — mijozning «deploy qil» so'zi kutiladi (deploy'dan keyin: televizor tabini yangilash, `?include=medals` o'zgarmaganini tekshirish — spec §12).

---

## Spec qamrovi (o‘z-o‘zini tekshirish)

| Spec | Vazifa |
|---|---|
| §1 Sahna — tokenlar (`--tier-*`, sirtlar, `--tv-tone` o'chadi), shrift shkalasi, pul grammatikasi | 1 (tokenlar, shkala, formatlovchilar), 4 (`--tv-tone` va ramkalar o'chadi) |
| §2 Tasma va gerb, so'z bir marta, legenda | 2 (`Crest`, `TierLegend`, CSS), 3 (o'rindiqda so'z), 4 (qatorda tasma, so'z yo'q, legenda ustun pastida) |
| §3 Medallar — bitta metall, gravyura, qatorda 3 + «+N», first-sale yashirin, o'rindiqda ×N, nodir soya | 2 (`MedalMark`, `medalDefs`, katalog, CSS), 3 (`RowMedals`, `SeatCard`) |
| §4 O'rindiq | 3 (`SeatCard`, CSS), 4 (podium 2-1-3, `order`) |
| §5 Qator | 4 (`SellerRows`, statik yorliq qatori, CSS) |
| §6 Komandalar ustuni | 4 (`TeamsBoard`, CSS) |
| §7 Sarlavha va rekordlar, FAKT kaliti siyoh, 60/40 | 5 (rekord devori), 4 (`FaktSwitch` siyoh, grid 60/40), 5 §6-qadam (PageShell tegilmaydi) |
| §8 Harakat | 2 (kamaytirilgan-harakat bloki), 4 (`crest-fill`, `medal-new`, tasma o'tishi, e'lon overlay), 5 (rekord sudralmaydi) |
| §9 Moslashuv | 1 (shkala 1599), 6 (gerb/halqa/qator/o'rindiq 0.8×, telefon) |
| §10 Fayl xaritasi | 2–5 (yangi fayllar), 4 (o'chirishlar, eski aktivlar papkasi) |
| §11 Test | 1 (`efirCss` skeleti), 2–3 (`sellersEfir`), 4 (`sellersTvBoard`, `tvBoardLayout`), 5 (`recordWall*`), 6 (jonli) |
| §12 Ishga tushirish | 6 (gate; push mijoz so'zi bilan) |
| §13 Xavflar | qarorlar rejaning «Hal qilingan noaniqliklar» ro'yxatida |

## Hal qilingan noaniqliklar

- Mock `<defs>` da 14 kod uchun 12 ta `#m-*` belgi (Oy oilasi bitta `#m-month`, raqam `<text>`); generator 12 ni tekshiradi.
- `--medal-*` istisno ro'yxati: `.medal` (Oy oilasi o'z metallida + qolgan 11 kodning asosiy oltini, spec §3), `.halo`, `.crest__crown` (Legenda toji), `.trow__rank[data-metal]`, `.record__k` — `efirCss.test.ts` shu ro'yxatni tekshiradi.
- Legenda: Yangi pog'onasi raqamsiz (mock shunday; ostonasi «birinchi so'm»).
- Halqa metalli RANK bo'yicha (1/2/3), o'rindiq o'rni bo'yicha emas — teng birinchilar ikkala oltin oladi; raqam — musobaqa ranki.
- O'rindiq kengliklari spec o'lchamlari MAKSIMUM (`max-width` 456/308, `flex` 1.48 : 1 : 1): yon panel ochiq bo'lsa ustun mock'dagidan tor.
- Komandalar ulushi BRAUZERDA, o'qilayotgan fakt ustida (komanda puli ÷ komandalar jami); servisning `sharePercent` i FAKT 1 rejimida yolg'on bo'lardi.
- `usePromotions` va uning testlari tegilmaydi (`thresholdLabel` «100 mln» qoladi); e'lon ostonani `thresholdSomOf` bilan o'zi to'liq so'mga aylantiradi.
- `isNearNextLevel` EFIR'da o'quvchisiz — o'chadi (spec §10 «ko'chadi» dedi, lekin §2/§4 «yaqin» rangini ishlatmaydi).
- `medalReason.ts` o'chadi — yagona importeri `SpeakingMedal` edi.
- `PageShell` tegilmaydi: sarlavha 24 px allaqachon; davr satri house o'lchamida qoladi, davr boshqaruvi umumiy komponent.
- Rekord devori — payloadning eng yangi ikki oyi (yetakchi + oxirgi rekord); tor rejimda shu ikkisi kesib almashadi.
- 1366 gridlari spec'da yo'q — mutanosib toraytirildi (`8 44 58 1fr 84 136 124 52 60`, komandalar `32 1fr 36 124 52 92 44 52`).
- Telefonda uyalar `nth-child` bilan yashiriladi — markup ikki o'lchamga bitta.
