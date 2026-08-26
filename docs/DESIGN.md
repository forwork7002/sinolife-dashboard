# Design system

Everything visual is decided in one file — `src/app/globals.css`. Components
read tokens; they never pick a colour, a radius or a duration of their own.

---

## Colour

### The rule that matters

**Colour follows the entity, never its rank.** A filter that removes three
series must not repaint the survivors. Slot 1 is slot 1 whether or not slots
2–8 are on screen.

Three separate systems, and they never borrow from each other:

| System | Encodes | Where it comes from |
|---|---|---|
| `--series-1..8` | **identity** — which series | fixed slot order, assigned in sequence, never cycled |
| `--seq-250..650` | **magnitude** — how much | one hue, light → dark |
| `--status-*` | **state** — good → critical | reserved; never a series colour |
| `--accent` | **page identity** | set once per screen; no mark that encodes a value may read it |

The last row is the one that gets broken first. `--accent` makes the margin
page orange and the logistics page teal so a glance tells you where you are.
The moment a bar takes its colour from `--accent`, the same bar means two
different things on two screens, and colour stops being readable at all.

### The palette is computed, not chosen

Re-derived August 2026 and validated with the data-visualisation validator in
both modes:

| | light on `#ffffff` | dark on `#131519` |
|---|---|---|
| Lightness band | all 8 in 0.43–0.77 | all 8 in 0.48–0.67 |
| Chroma floor | all 8 ≥ 0.10 | all 8 ≥ 0.10 |
| CVD separation (worst adjacent) | **ΔE 11.5** | **ΔE 10.9** |
| Normal-vision floor | **ΔE 20.9** | ΔE 18.6 |
| Contrast vs surface | **all 8 ≥ 3:1** | all 8 ≥ 3:1 |

The set it replaced cleared CVD at 9.1 and left three slots *below* 3:1, so
every figure above is an improvement rather than a repaint. **The slot order is
unchanged** — blue, orange, teal, amber, pink, olive, violet, red — because the
order is the colourblind-safety mechanism, not a style choice. Nothing that
already reads a slot changed meaning.

Status steps were darkened in light mode so each clears **4.5:1** and may carry
text, not only a mark. They still ship with a word or an icon; colour alone is
never a channel.

### The three-series cap

Scatter, bubble, choropleth and small-multiples charts — anywhere two marks can
end up side by side — are capped at the **first three slots**. That is measured:
no ordering of eight hues clears the all-pairs floor. More than three series in
one of those forms means folding the tail into "Other" or faceting. It does not
mean a different palette.

### Changing a colour

Don't, without re-running the validator:

```bash
node <dataviz-skill>/scripts/validate_palette.js \
  "$(grep -oP '(?<=--series-[1-8]: )#[0-9a-f]{6}' src/app/globals.css | head -8 | paste -sd,)" \
  --mode light --surface "#ffffff"
```

A hue picked by eye will pass the eye and fail a colourblind reader, which is
the entire reason the check exists.

---

## Type

**Inter Variable**, self-hosted and subsetted — see
[FONT-LICENSE.md](FONT-LICENSE.md). Three properties earn it:

- **Cyrillic.** The portal returns Russian stage names. A Latin-only face
  falls back mid-sentence and changes weight in the middle of a label.
- **Tabular figures.** `.tabular` turns them on for every number that sits
  above another number. Without it a column of amounts jitters as digits
  change width, and comparing down the column — the whole job of a figure in a
  table — stops working.
- **An optical-size axis.** `font-optical-sizing: auto` draws headings with
  tighter spacing and a smaller x-height from the same file. A display cut
  without a second download.

`cv05` is on globally: it gives lowercase `l` a tail, so `l`, `I` and `1` stay
distinguishable in a figure.

Self-hosted rather than `next/font/google` for two reasons that are both about
deployment, not taste: the CSP allows `font-src 'self'` and nothing else, and a
build that reaches out to `fonts.googleapis.com` fails on a host with no
outbound network — a deploy failing for a reason unrelated to the deploy.

---

## Surface and depth

| Token | Use |
|---|---|
| `--page` | the ground |
| `--surface` | panels, the sidebar, the header |
| `--surface-raised` | cards |
| `--surface-sunken` | table headers, insets, the well behind a chart |

A card is a border **plus** `--edge-highlight`: one pixel of light along its top
edge. That highlight is what separates a raised surface from a flat rectangle
with a blur under it — the eye reads a lit top edge as depth far more readily
than it reads a shadow.

`body::before` paints two very faint accent-tinted pools, fixed to the viewport.
Fixed rather than scrolled, so it behaves like light in a room instead of like
content.

---

## Motion

One easing curve, `--ease-out`, a decelerating cubic-bezier: things arrive
quickly and settle. Three durations, and their asymmetry is deliberate —
`--duration-exit` (140ms) is shorter than `--duration-enter` (220ms) so the old
view stops competing for attention before the new one asks for it.

| Helper | What it does |
|---|---|
| `.rise` | a single element arrives, 6px up and fading |
| `.stagger` | children arrive in sequence — set `--i` per child, capped at 8 |
| `.grow-x` | a bar scales from its baseline, so the length reads as a value arriving |
| `.draw-in` | a line draws itself once; needs `--len` set to the measured path length |
| `.card-interactive` | hover lift — **only** for a card that actually does something |

Nothing here carries information the static rendering does not. Motion is the
delivery, never the message. Every rule sits inside a
`prefers-reduced-motion: no-preference` guard or has a `reduce` override.

### Page transitions

Navigating between screens is a lateral move. The pages are siblings; there is
no "deeper". So the content crossfades and lifts a few pixels while the
chrome — sidebar and header — is pinned by `viewTransitionName` and its
animation suppressed.

Pinning the chrome is the point. It is the reader's fixed reference: the
content changed, the application did not move. A sidebar that crossfades along
with the content makes the whole screen appear to flicker.

Under `prefers-reduced-motion` the movement goes and a 100ms crossfade stays.
Cutting to zero would make the swap instant, which on a dense screen reads as a
flash — the opacity handover is gentler than no animation at all.

---

## What a screen owes the reader

1. **One thing first.** The hero number is bigger than everything else on the
   screen by a clear margin, or there is no hierarchy.
2. **A rate states its fraction.** `91.6%` with `898 / 2,191` underneath is a
   lie unless 898/2191 is 91.6%. Show the numbers the rate was actually
   computed from.
3. **Never 0 for "unknown".** `NO_VALUE` is an em dash. "No deals were won" and
   "the average deal was nothing" are different claims.
4. **Say when the data is from.** `FreshnessPanel` ticks on its own, so a
   screen left open overnight cannot claim "just now" at 6am.
5. **Say where the data is from.** `DataSourceBadge` reads `meta.dataSource`
   and nothing else, so no screen can present generated numbers as live.
