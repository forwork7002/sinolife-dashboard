# IMPLEMENT — «EMAL» final medal set + «Sayqal» (board polish) for /sellers

Generated 2026-09-18 from `final/gen-defs.js`, `final/gen-css.js`, `final/polish.css`, `final/postprocess.js`.
Everything below was rendered on the frozen production pages (`../base/*.html`) and measured with `final/verify.js` / `final/probe.js`.

Two deliverables, ship in this order of safety:
1. **MEDALS ONLY** (`out/medals-*.html`) — the defs asset, 42 tokens × 3 theme blocks, the ×N chip, four CSS rules. Layout provably untouched (bbox-IDENTICAL on all four snapshots).
2. **MEDALS + SAYQAL** (`out/full-*.html`) — adds `BoardIcon` (114 emoji → line icons, crown fix) and the kept polish CSS. Podium 1 px shorter at 1920 / 2 px at 1366 (emoji line-box slop disappears; never taller). Number columns, row height, name truncation: Δ 0.

---

## 1 · The defs asset → `scripts/genMedalDefs.mjs`

- Asset: `final/final-defs.svg.html` (14.9 KB; shipped ZARB was 30 KB). Copy it to `docs/superpowers/specs/assets/2026-09-18-emal-final/final-defs.svg.html` together with its generator `gen-defs.js` (+ `gen-css.js`), and point `ASSET` in `scripts/genMedalDefs.mjs` at it. Then `node scripts/genMedalDefs.mjs` regenerates `src/features/sellers/medalDefs.ts`.
- 26 ids, every top-level child has one: `eg-gold-ring`, `eg-silver-ring`, `eg-bronze-ring`, `eg-steel-ring`, `eg-gold-dev`, `eg-gilt-dev`, `eg-steel-dev`, `eg-gold-body`, `eg-silver-body`, `eg-bronze-body`, `eg-field`, `eg-field-rare`, `m-year-champion`, `m-month-gold`, `m-month-silver`, `m-month-bronze`, `m-streak-fire`, `m-conversion-master`, `m-day-record`, `m-streak-steady`, `m-clean-month`, `m-jump`, `m-rookie`, `m-day-winner`, `m-work-month`, `m-first-sale`.
- Roots for the closure: the 14 `m-<code>` only. **No `m-laurel-*`, no `n0..n9`/`nx`, no `mg-*-rim`** — the `isRoot` regex in the script can stay (its other branches simply match nothing), but its header comment and the id census in `tests/features/medalDefs.test.ts` must be re-pointed (see §7).
- Passes every refusal of the script: no `color-mix`, no `filter`, no `var(--m-`, no `class="cut"`, no backtick, no `${`. Additionally guaranteed by `gen-defs.js`: no `mask`, no nested `<use>`, no `stop-opacity` anywhere, **every paint is an inline `style`** (no presentation-attribute `fill="var(…)"`).
- Every colour inside the defs is `var(--emal-…)`, resolved on `:root` — no re-binding block on `.medal-defs`/`.medal-mark` is needed any more (delete the shipped `.medal-defs, .medal-mark { --medal-gold: var(--zarb-gold) … }`).
- ONE per-instance custom property: `--emal-seat-o` (default 1) — the stroke-opacity of the seat-only jewellery (the rare tier's second hairline ring, the year champion's bead ring). `.row-medals { --emal-seat-o: 0 }` switches it off in rows; custom properties inherit into the `<use>` shadow tree, so one declaration reaches every symbol. This is `var(--emal-seat-o,1)`, not `var(--m-…)`, so the generator's refusal does not fire.
- Device gradients are `gradientUnits="userSpaceOnUse"` on purpose: horizon / plinth / crown-band strokes are axis-aligned and have a zero-height bbox.
- Nodes per medal (circle|path|g): year-champion 11, month-gold/silver/bronze 8, streak-fire 5, conversion-master 5, day-record 5, streak-steady 5, clean-month 4, jump 4, rookie 4, day-winner 5, work-month 5, first-sale 5.

### The fourteen — construction and glyph
| code | tier | body | device | meaning |
|---|---|---|---|---|
| year-champion | honour | solid satin gold, broad 2.6u gold ring, hairline, bead ring (seat only) | engraved crown — SAME drawing as the board's crown icon | yil yakunida 1-oʻrin |
| month-gold | honour | solid gold | engraved crescent («oy» = moon = month; no numeral — the metal says the place) | oy yakunida 1-oʻrin |
| month-silver | honour | solid silver | engraved crescent | 2-oʻrin |
| month-bronze | honour | solid copper-leaning bronze | engraved crescent | 3-oʻrin |
| streak-fire | rare gold | dark gold-tinted enamel in a 1.9u gold ring + second hairline (seat only) | flame with an enamel heart | 3 oy ketma-ket top-3 |
| conversion-master | rare gold | same | **%** (ties to the KONV. column; cannot be read as the chase target) | oyning eng yuqori konversiyasi |
| day-record | rare gold | same | **bolt** (continuity with shipped ⚡) | eng katta kunlik savdo |
| streak-steady | steel · gilt | enamel in a 2u steel ring | three EQUAL pillars on a plinth | 3 oy ketma-ket top-10 |
| clean-month | steel · gilt | same | one bold tick | ≥ 80 % yetkazilgan |
| jump | steel · gilt | same | broken line rising to an arrow | ×1,5 oʻtgan oydan |
| rookie | steel · gilt | same | solid five-point star («Yangi yulduz») | birinchi oyida top-10 |
| day-winner | steel · gilt | same | sun rising over a horizon («kun» = sun = day) | kun gʻolibi |
| work-month | steel · steel | same | calendar leaf, one row of three days (device as bright as gilt) | oy davomida ishda |
| first-sale | steel · steel | same | sprout | birinchi savdo (rows hide it, as shipped) |

Engraved = the ink shape drawn twice: a 50 % highlight copy offset (+.26, +.32) under the near-black cut. Laurels: **dropped** (no `m-laurel-*`).

---

## 2 · Tokens — DESIGN TOKENS section of `globals.css`, ALL THREE theme blocks

Light on `:root`; the dark values go verbatim into BOTH `@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) }` and `:root[data-theme="dark"]` (`final/medals.css` is the exact text, generated from one object). `tests/features/medalDefs.test.ts` «har token UCHALA mavzu blokida» must be pointed at the `--emal-*` family. Verified: with `data-theme` removed and `prefers-color-scheme: dark`, tokens AND podium pixels are identical to `[data-theme="dark"]`.

| token | light | dark |
|---|---|---|
| `--emal-gold-hi` | `#e2c25f` | `#f8e6a6` |
| `--emal-gold` | `#b3860e` | `#e2bb50` |
| `--emal-gold-lo` | `#785709` | `#8b6a1f` |
| `--emal-silver-hi` | `#d9e0e8` | `#ffffff` |
| `--emal-silver` | `#8f9aab` | `#c8d1dc` |
| `--emal-silver-lo` | `#535d6e` | `#6f7b8c` |
| `--emal-bronze-hi` | `#e6b58d` | `#f6d2b2` |
| `--emal-bronze` | `#ad6d45` | `#cf9161` |
| `--emal-bronze-lo` | `#74421f` | `#8e5833` |
| `--emal-steel-hi` | `#8a99ac` | `#cfd9e4` |
| `--emal-steel` | `#5b6a80` | `#8496ad` |
| `--emal-steel-lo` | `#37424f` | `#4a5666` |
| `--emal-gold-dhi` | `#b5851a` | `#fbe9ad` |
| `--emal-gold-d` | `#8e6710` | `#e6c05a` |
| `--emal-gold-dlo` | `#684a08` | `#a8842a` |
| `--emal-gilt-dhi` | `#b8860b` | `#f7ebc4` |
| `--emal-gilt-d` | `#9c700a` | `#e0c47a` |
| `--emal-gilt-dlo` | `#7a5708` | `#a58a45` |
| `--emal-steel-dhi` | `#4b5b72` | `#eef3f8` |
| `--emal-steel-d` | `#33415a` | `#c3cfdc` |
| `--emal-steel-dlo` | `#222c3c` | `#8d9cae` |
| `--emal-gold-f1` | `#f6e2a0` | `#f9e6a6` |
| `--emal-gold-f2` | `#dcb040` | `#e0b64c` |
| `--emal-gold-f3` | `#b3872a` | `#b4872a` |
| `--emal-gold-ink` | `#2d2106` | `#2a1f07` |
| `--emal-silver-f1` | `#f8fafc` | `#f4f7fb` |
| `--emal-silver-f2` | `#d2d9e2` | `#c5ceda` |
| `--emal-silver-f3` | `#a1acbb` | `#8e9aab` |
| `--emal-silver-ink` | `#1d242e` | `#1b222c` |
| `--emal-bronze-f1` | `#f1c9a5` | `#f3c9a3` |
| `--emal-bronze-f2` | `#d29767` | `#d2925f` |
| `--emal-bronze-f3` | `#ab6e3f` | `#9d6036` |
| `--emal-bronze-ink` | `#2a170a` | `#2a170a` |
| `--emal-field-a` | `#ffffff` | `#1f2531` |
| `--emal-field-b` | `#e9edf3` | `#10141b` |
| `--emal-field-rare-a` | `#fffdf6` | `#252013` |
| `--emal-field-rare-b` | `#f3e8cb` | `#0f0d08` |
| `--emal-key` | `rgba(12, 14, 18, 0.12)` | `rgba(0, 0, 0, 0.4)` |
| `--emal-seat` | `rgba(12, 14, 18, 0.22)` | `rgba(0, 0, 0, 0.55)` |
| `--emal-glow-gold` | `rgba(179, 134, 14, 0.45)` | `rgba(232, 194, 86, 0.6)` |
| `--emal-glow-silver` | `rgba(110, 120, 138, 0.4)` | `rgba(197, 206, 218, 0.5)` |
| `--emal-glow-bronze` | `rgba(165, 102, 58, 0.4)` | `rgba(207, 145, 97, 0.5)` |

Plus the board-icon aliases (all three blocks, same text): `--bi-crown-hi: var(--emal-gold-f1)`, `--bi-crown: var(--emal-gold-f2)`, `--bi-crown-lo: var(--emal-gold-f3)`, `--bi-crown-edge: var(--emal-gold-ink)`, `--bi-ember: var(--emal-gilt-d)`; and `--bi-chase: var(--seq-550)` on `:root` only (it is already themed).

**Dead after the swap** (grep before deleting): the whole «ZARB» family — `--zarb-*`, `--medal-*-hi/-lo/-sh/-patina/-well`, `--medal-steel*`, `--medal-gilt*`, `--medal-key/-cast/-glint/-edge`, `--sheen-*`, `--bloom`, `--ribbon-*`, `--medal-plate-well`. The podium's own `--medal-gold/silver/bronze` chrome STAYS (rank discs, pedestals, plaques read it).

---

## 3 · CSS — MEDALS section of `globals.css` (instance rules; only `var()`, no literal colour)

Replace the shipped instance block (`.medal-defs, .medal-mark {…rebinding…}`, `.medal-mark__plate-rim`, `.medal-mark__plate-well`, `.medal-mark__count…`) with the rules below. Keep unchanged: `.medal-mark { flex: 0 0 auto; display: block; overflow: visible }`, `.medal-mark--new` + its keyframes, `.seat-medals`, `.row-medals` (height 26, row-reverse wrap, overflow hidden) and every `--row-medals-room` media rule.

```css
/* rows: the seat-only jewellery (rare tier's second hairline, the year champion's bead ring) is switched off —
   custom properties inherit into the <use> shadow tree, so one declaration reaches every symbol. */
.row-medals { --emal-seat-o: 0; }

/* the seat: honours and rare golds get the rank disc's own halo (a plain box-shadow, ≤ 10 elements); steel gets none */
.seat-medals > .medal-mark { border-radius: 50%; }
.seat-medals > .medal-mark[data-medal="year-champion"],
.seat-medals > .medal-mark[data-medal="month-gold"],
.seat-medals > .medal-mark[data-medal="streak-fire"],
.seat-medals > .medal-mark[data-medal="conversion-master"],
.seat-medals > .medal-mark[data-medal="day-record"] { box-shadow: 0 6px 16px -8px var(--emal-glow-gold); }
.seat-medals > .medal-mark[data-medal="month-silver"] { box-shadow: 0 6px 16px -8px var(--emal-glow-silver); }
.seat-medals > .medal-mark[data-medal="month-bronze"] { box-shadow: 0 6px 16px -8px var(--emal-glow-bronze); }

/* ×N — the board's own chip, set into the ring's lower right (seat only; rows never carry a count) */
.medal-mark__n-gap { fill: var(--surface-raised); }
.medal-mark__n-pill { fill: var(--surface-sunken); stroke: var(--emal-steel); stroke-width: 1px; vector-effect: non-scaling-stroke; }
.medal-mark__n[data-metal="gold"] > .medal-mark__n-pill { stroke: var(--emal-gold); }
.medal-mark__n[data-metal="silver"] > .medal-mark__n-pill { stroke: var(--emal-silver); }
.medal-mark__n[data-metal="bronze"] > .medal-mark__n-pill { stroke: var(--emal-bronze); }
.medal-mark__n-text {
  fill: var(--ink-primary);
  font-family: inherit;
  font-size: 8.6px; /* user units of the 32 box: 10.75px on a 40px medal, 9.7px at 36 */
  font-weight: 700;
  font-variant-numeric: tabular-nums lining-nums;
  letter-spacing: 0;
  text-anchor: middle;
}
.medal-mark__n-x { fill: var(--ink-muted); font-weight: 600; font-size: 7.2px; }
```

Notes: the seat halo is a plain `box-shadow` on ≤ 10 elements (no filter); steel medals get none. `border-radius: 50%` on the square svg makes the shadow round; the chip that overhangs the box carries no shadow. The chip's hairline is `1px` with `vector-effect: non-scaling-stroke` so it is exactly the board's 1 px chip border at 40, 36 and 32 px.

---

## 4 · `MedalMark.tsx` / `RowMedals.tsx` / `medalCatalog.ts`

**MedalMark.tsx**
1. Delete the laurel branch (`{seat && size >= 40 && isMonthMedal(code) && <use href=…laurel…/>}`) and the `isMonthMedal` import.
2. Replace `CountPlate` by `CountChip` (same trigger: `seat && count > 1`, cap 99, aria unchanged):

```tsx
/** ×N — the board's own chip set into the ring's lower right. 32-box units. Mirrors final/lib.js chip(). */
function CountChip({ count, body }: { count: number; body: Exclude<Metal, 'gilt'> }) {
  const n = String(Math.min(count, COUNT_CAP))
  const w = n.length === 1 ? 15.4 : 20.2
  const h = 10.4
  const x0 = 34.4 - w   // right edge x = 34.4: the chip leaves the 32 box by 2.4u right and 2u below (3 px / 2.5 px at 40 px)
  const y0 = 23.6
  const g = 1           // the knock-out gap, in the card's colour
  const r = (v: number) => v.toFixed(2)
  return (
    <g className="medal-mark__n" data-metal={body}>
      <rect className="medal-mark__n-gap" x={r(x0 - g)} y={r(y0 - g)} width={r(w + 2 * g)} height={r(h + 2 * g)} rx={r(h / 2 + g)} />
      <rect className="medal-mark__n-pill" x={r(x0)} y={r(y0)} width={w} height={h} rx={r(h / 2)} />
      <text className="medal-mark__n-text" x={r(x0 + w / 2 - 0.15)} y={r(y0 + h / 2 + 3.05)}>
        <tspan className="medal-mark__n-x">×</tspan>{n}
      </text>
    </g>
  )
}
```
   Call: `{seat && count > 1 && <CountChip count={count} body={body} />}` — `dev` is no longer needed by the chip.
3. Nothing else changes: same `<svg class="medal-mark" data-medal viewBox="0 0 32 32" width height role="img" aria-label>`, same single `<use href="#m-<code>">`, same sizes (40 / 36 / 26), same `seatMedals` / `rowMedalsOf`.

**RowMedals.tsx** — unchanged (26 px, no count, no laurel). Rows get `--emal-seat-o: 0` from CSS.

**medalCatalog.ts** — `MEDAL_METAL[code].body` still feeds the chip's `data-metal`; `isMonthMedal` becomes unused (remove or keep for the catalog mirror test). `RARE_MEDALS`, `HIDDEN_IN_ROWS`, `seatMedals` unchanged.

**MedalDefs.tsx** — unchanged (mounts `MEDAL_DEFS` once).

---

## 5 · «Sayqal» — the kept polish (only with the new medals, one deploy)

Kept (≥ 2 judges kept, nobody dropped for a fidelity reason): **item 1** icons + crown fix · **2b** heading disc · **2c** seat-card lit/inner hairline, champion bezel (also on the `:has(.podium-name:hover/:focus-visible)` rule so the hover ring is not lost), rank-disc field set into its ring · **2d** pedestal satin sheen, lit lip, engraved numeral · **3a** one numeral cut · **3c** case-sensitive heads, ranked head brighter · **4a** drawn lozenge ONLY (no month tracking/size) · **4b** FAKT well/key/lamp.
Dropped: 2a tone-bar strip, 2c foot shade and pill top edges, 2e list-foot fade (veils row 8, changes scrollHeight), 3b «soʻm» scaling (moves the seat sum 1.3 px), 3d, 4a tracking (+16.7 px marquee run).

CSS: `final/polish.css` verbatim — the `@item` blocks go to the PODIUM / TV BOARD sections; its tokens (`--px-*`, `--px4-*`, `--bi-*`) to DESIGN TOKENS, dark values in both dark blocks (already written that way). It uses `color-mix()` (fine in globals.css, never inside `<defs>`).

### BoardIcon — emoji → icon (`<span aria-hidden className="bi bi--<name>"><svg …/></span>`)
The span keeps its place in the flow; `.bi` gives it the emoji's advance so nothing reflows (measured: 1.27em general, **1.29em** for the plaque rosette, **1.45em** for the record-wall trophy — with these the plaque is +0.22 px and the marquee entry +0.34/0.39 px — sub-pixel).

| emoji | name | where (shipped source) | colour |
|---|---|---|---|
| 🏆 | trophy | SellersPage.tsx:204 (phone tab), :380 (`glyph=` heading disc), RecordWall.tsx:161 | heading: tone-lifted ink; record wall: `--metal` |
| 🛡️ | shield | SellersPage.tsx:205, :414 | tone-lifted ink |
| 🥇🥈🥉 | medal (rosette) | SellersPage.tsx:764 (seat plaque) | the seat's `--metal` (one glyph, three metals) |
| 👑 | crown | SellersPage.tsx:842 | `url(#eg-gold-body)` (the medal gold; the mock's `#bi-crown-g` is the identical gradient) + `--bi-crown-edge` |
| 🚀 | lead (double chevron) | SellersPage.tsx:1022 (`lead !== 0`) | `--metal` |
| 🎯 | target (ring + bull) | SellersPage.tsx:1065, :1419 | `--bi-chase` (= chase-bar blue); add `bi--dim` on a line whose text is secondary ink (none in tonight's data — all 🎯 lines are primary; 🔥 lines are the secondary ones) |
| 🔥 | flame (the medal's flame) | SellersPage.tsx:1022 (`lead === 0`), :1065 (`gap === 0`), :1412 | `--bi-ember` |

Stroke discipline: 1.7 in the 16-box, 1.5 in the 20-box, round caps — the medals' 2u/32 at the sizes the icons render. No filter anywhere.

```js
const ICONS = {
    /* 🏆 — a cup: bowl, two handles, stem, plinth. Heading disc (sellers), record marquee, phone tab. */
    trophy: S('20 20',
      '<path d="M6.2 3h7.6v4.3a3.8 3.8 0 0 1-7.6 0z"/>' +
      '<path d="M6.2 4.6H3.6v1a2.9 2.9 0 0 0 2.9 2.9M13.8 4.6h2.6v1a2.9 2.9 0 0 1-2.9 2.9"/>' +
      '<path d="M10 11.1v3.1M7.4 14.2h5.2l.8 2.8H6.6z"/>', 1.5),
    /* 🛡️ — a heraldic shield, parted per pale. Heading disc (teams), phone tab. */
    shield: S('20 20',
      '<path d="M10 2.7v14.6C6.6 15.9 4.2 13 4.2 9.4V4.8z" fill="currentColor" fill-opacity=".2" stroke="none"/>' +
      '<path d="M10 2.7l5.8 2.1v4.6c0 3.6-2.4 6.5-5.8 7.9-3.4-1.4-5.8-4.3-5.8-7.9V4.8z"/>' +
      '<path d="M10 2.7v14.6" stroke-opacity=".55" stroke-width="1.1"/>', 1.5),
    /* 🥇🥈🥉 — the award rosette: ring + bull (the rank disc in miniature) with two tails; colour = the seat's --metal. */
    medal: S('16 16',
      '<path d="M4.5 1.4h2.6l.9 2.2.9-2.2h2.6L9.4 6H6.6z" fill="currentColor" fill-opacity=".38" stroke-width="1.1"/>' +
      '<circle cx="8" cy="10.3" r="4.1"/>' +
      '<circle cx="8" cy="10.3" r="1.35" fill="currentColor" stroke="none"/>', 1.5),
    /* 🚀 — «oldinda»: a double chevron, the insignia way of saying «ahead». Champion's chip only. */
    lead: S('16 16', '<path d="M3.8 8.1 8 4.1l4.2 4M3.8 12.3 8 8.3l4.2 4"/>', 1.7),
    /* 🎯 — the chase: ring + bull in the chase bar's own blue (dimmed to the text's ink on secondary rows). */
    target: S('16 16',
      '<circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="3" stroke-opacity=".8"/>' +
      '<circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/>', 1.5),
    /* 🔥 — «… bilan teng»: the MEDAL's flame (streak-fire outline + enamel heart), mapped from the 32 box into the 16 box. */
    flame: S('16 16',
      '<g transform="translate(-3.52 -3.45) scale(.72)">' +
      '<path d="M16.3 6.6C16.9 10.4 22.6 12.6 22.6 18.3C22.6 22.4 19.7 25.2 16 25.2C12.3 25.2 9.4 22.4 9.4 18.6C9.4 15.9 10.8 14 12.2 12.6C12.5 14.4 13.2 15.4 14.3 15.9C13.9 12.6 14.7 9 16.3 6.6Z" stroke-width="2.1"/>' +
      '<path d="M16 18.2C16.9 19.4 18.5 20.2 18.5 21.7C18.5 23 17.4 23.8 16 23.8C14.6 23.8 13.5 23 13.5 21.7C13.5 20.3 15.1 19.5 16 18.2Z" fill="currentColor" fill-opacity=".85" stroke="none"/>' +
      '</g>', 1.5),
    /* 👑 — the champion's crown: the year champion's crown, struck in the medals' gold, upright, seated on the ring. */
    crown:
      '<svg viewBox="0 0 28 20" focusable="false">' +
      '<path d="M5 15.3 2.9 6.2l6 4.2L14 3.2l5.1 7.2 6-4.2L23 15.3z" fill="url(#bi-crown-g)" stroke="var(--bi-crown-edge)" stroke-width=".9" stroke-linejoin="round"/>' +
      '<path d="M5.8 13.2h16.4" stroke="var(--bi-crown-hi)" stroke-opacity=".5" stroke-width=".8" stroke-linecap="round"/>' +
      '<rect x="4.7" y="16.2" width="18.6" height="2.6" rx="1.2" fill="url(#bi-crown-g)" stroke="var(--bi-crown-edge)" stroke-width=".9"/>' +
      '</svg>',
}
```

**THE CROWN FIX (ship regardless).** SellersPage.tsx:842's span carries `style="…transform: translateX(-50%) rotate(-12deg)"` and class `rise`; `@keyframes rise` ends on `transform: none` with `animation-fill-mode: both`, so the inline transform is wiped for ever and the shipped crown stands 12.5 px right of the ring's centre. Remove the inline transform and centre by margin: `.bi--crown { width: 25px; height: 20px; margin-left: -12.5px } .bi--crown > svg { width: 33px; height: 23.6px; transform: translateY(-2px) }` (upright — the tilt was the cartoon).

---

## 6 · Constraints VERIFIED (final/verify.js · probe.js · pxzoom.js, Chromium headless, dpr 1 full pages)

```
## month-dark-1920
  podium h: base 488.92 · medals 488.92 · full 487.92   |  row#0 h: base 85.80 · medals 85.80 · full 85.80   |  row medal max: 26px  |  truncated names: 0 / 0 / 0  |  chips clipped: 0 / 0
  medals vs base — worst Δ 0.00px  (IDENTICAL)
  full vs base — worst Δ 1.00px
      .tv-podium: max Δ -1.00px (h, #0)
      .tv-seat-card: max Δ -1.00px (h, #0)
      .tv-pedestal: max Δ -1.00px (y, #0)
      .chase-chip: max Δ -1.00px (y, #0)
      .podium-plaque: max Δ 0.22px (w, #0)
      .tv-list: max Δ -1.00px (y, #0)
      .tv-table th: max Δ -1.00px (y, #0)
      .tv-row: max Δ -1.00px (y, #0)
      .tv-row > td: max Δ -1.00px (y, #0)
      .tv-name: max Δ -1.00px (y, #0)
      .tv-money: max Δ -1.00px (y, #0)
      .tv-chase: max Δ -1.00px (y, #0)
      .tv-bar: max Δ -1.00px (y, #0)
      .row-medals: max Δ -1.00px (y, #0)
      .medal-mark: max Δ -1.00px (y, #6)
      .record-entry: max Δ 0.34px (h, #0)

## month-light-1920
  podium h: base 488.92 · medals 488.92 · full 487.92   |  row#0 h: base 85.80 · medals 85.80 · full 85.80   |  row medal max: 26px  |  truncated names: 0 / 0 / 0  |  chips clipped: 0 / 0
  medals vs base — worst Δ 0.00px  (IDENTICAL)
  full vs base — worst Δ 1.00px
      .tv-podium: max Δ -1.00px (h, #0)
      .tv-seat-card: max Δ -1.00px (h, #0)
      .tv-pedestal: max Δ -1.00px (y, #0)
      .chase-chip: max Δ -1.00px (y, #0)
      .podium-plaque: max Δ 0.22px (w, #0)
      .tv-list: max Δ -1.00px (y, #0)
      .tv-table th: max Δ -1.00px (y, #0)
      .tv-row: max Δ -1.00px (y, #0)
      .tv-row > td: max Δ -1.00px (y, #0)
      .tv-name: max Δ -1.00px (y, #0)
      .tv-money: max Δ -1.00px (y, #0)
      .tv-chase: max Δ -1.00px (y, #0)
      .tv-bar: max Δ -1.00px (y, #0)
      .row-medals: max Δ -1.00px (y, #0)
      .medal-mark: max Δ -1.00px (y, #6)
      .record-entry: max Δ 0.34px (h, #0)

## today-dark-1920
  podium h: base 428.13 · medals 428.13 · full 427.13   |  row#0 h: base 61.53 · medals 61.53 · full 61.53   |  row medal max: 26px  |  truncated names: 0 / 0 / 0  |  chips clipped: 0 / 0
  medals vs base — worst Δ 0.00px  (IDENTICAL)
  full vs base — worst Δ 1.00px
      .tv-podium: max Δ -1.00px (h, #0)
      .tv-seat-card: max Δ -1.00px (h, #0)
      .tv-pedestal: max Δ -1.00px (y, #0)
      .chase-chip: max Δ -1.00px (y, #0)
      .podium-plaque: max Δ 0.22px (w, #0)
      .tv-list: max Δ -1.00px (y, #0)
      .tv-table th: max Δ -1.00px (y, #0)
      .tv-row: max Δ -1.00px (y, #0)
      .tv-row > td: max Δ -1.00px (y, #0)
      .tv-name: max Δ -1.00px (y, #0)
      .tv-money: max Δ -1.00px (y, #0)
      .tv-chase: max Δ -1.00px (y, #0)
      .tv-bar: max Δ -1.00px (y, #0)
      .row-medals: max Δ -1.00px (y, #0)
      .medal-mark: max Δ -1.00px (y, #4)
      .record-entry: max Δ 0.34px (h, #0)
      __listScroll: [472,411] → [472,412]

## month-dark-1366
  podium h: base 435.89 · medals 435.89 · full 433.89   |  row#0 h: base 79.77 · medals 79.77 · full 79.77   |  row medal max: 26px  |  truncated names: 0 / 0 / 0  |  chips clipped: 0 / 0
  medals vs base — worst Δ 0.00px  (IDENTICAL)
  full vs base — worst Δ 2.00px
      .tv-podium: max Δ -2.00px (h, #0)
      .tv-seat-card: max Δ -2.00px (h, #0)
      .tv-pedestal: max Δ -2.00px (y, #0)
      .chase-chip: max Δ -2.00px (y, #0)
      .podium-plaque: max Δ 0.22px (w, #0)
      .tv-list: max Δ -2.00px (y, #0)
      .tv-table th: max Δ -2.00px (y, #0)
      .tv-row: max Δ -2.00px (y, #0)
      .tv-row > td: max Δ -2.00px (y, #0)
      .tv-name: max Δ -2.00px (y, #0)
      .tv-money: max Δ -2.00px (y, #0)
      .tv-chase: max Δ -2.00px (y, #0)
      .tv-bar: max Δ -2.00px (y, #0)
      .row-medals: max Δ -2.00px (y, #0)
      .medal-mark: max Δ -2.00px (y, #6)
      .record-entry: max Δ 0.39px (w, #0)
```

- MEDALS ONLY: bbox-IDENTICAL to the frozen production page on all four snapshots — podium, seat cards, pedestals, names, figures, chase chips, plaques, every th, every row, every cell, money, chase, bar, row-medals, every medal box, list scrollHeight, painted-medal count, 0 new truncations. Row medal 26 px (≤ 28). Chips clipped: 0 (walk from each chip to the seat card: no clipping ancestor).
- FULL: only the podium height moves (−1.00 px at 1920, −2.00 px at 1366; the emoji line-box slop) and everything below it by the same amount; width of every number column: Δ 0.00; plaque width +0.22 px and marquee entry +0.34 px (h) / +0.39 px (w, 1366) — sub-pixel, the icon box vs the emoji advance (1.29em / 1.45em already tuned).
- The five medals no production row carries (year-champion, streak-fire, streak-steady, jump, rookie) + month-gold/silver, conversion-master, first-sale were injected on REAL rows and REAL seats (dark + light, dpr 1 and 3x): podium and row heights unchanged (`out/probe-unseen-*.png`).
- Third theme block: `data-theme` removed + `prefers-color-scheme: dark` → tokens equal AND podium pixels byte-equal to `[data-theme="dark"]`.
- Defs: 0 filter, 0 color-mix, 0 mask, 0 nested `<use>`, 0 stop-opacity, 0 presentation-attribute paints, 26 ids, 14.9 KB. Seat halo = box-shadow only.
- Icons placed: 114 (all emoji on the page); `.bi` boxes reflow-free (see §5).
- Chip text: 8.6u = 10.75 px on a 40 px medal, 9.7 px at 36, 8.6 px at 32 (1366); «×12» clears the crescent's lower horn (crescent nudged up-left in the symbol).

## 7 · Tests to re-point
- `tests/features/medalDefs.test.ts`: id census 67 → 26; families `eg-` · `m-` only; no laurels, no `n*`, no `mg-*-rim`; closure still holds; token census → `--emal-*` (+ `--bi-crown-*`, `--bi-ember`) in all three blocks.
- `tests/features/medalMark.test.tsx`: laurel case → asserts NO laurel; ×N plate cases → `g.medal-mark__n[data-metal]`, `rect.medal-mark__n-gap`, `rect.medal-mark__n-pill`, `text.medal-mark__n-text > tspan.medal-mark__n-x`; «dark steel lifted» case → `--emal-steel` (dark #8496ad in both dark blocks, light #5b6a80); the «mid tone re-bound in two places» case → removed (no re-binding any more); «chip painted from tokens» → `--surface-sunken`/`--surface-raised`/`--ink-primary`/`--emal-<metal>`.
- `tests/features/sellersMedals.test.tsx:241`: `rect.medal-mark__plate-rim` → `g.medal-mark__n`; the «one-off medal has no rect» assertion still holds.
- `tests/features/medalCatalogMirror.test.ts`: unchanged.

## 8 · Not verified / known weak points
- Phone (< 640 px) layout and a real TV Chromium were not rendered (only Chromium/Linux headless). `vector-effect: non-scaling-stroke` and inline-style `var()` in `<defs>` are old, safe features; nothing newer is used.
- The «Barqaror» pillars read as «III» to a viewer without the legend (the judges' consensus choice; three chevrons collided with «oldinda»).
- The month medals lose the place numeral («2», «3») — tell the client once: the metal says the place.
- Chip figures (~10.75 px) are a jeweller's detail, not readable from 3 m — same limit as the shipped plate.
- `.bi--target` on ~86 rows is the chase blue at one brightness (all those lines are primary ink tonight); the `bi--dim` hook exists for secondary lines.
