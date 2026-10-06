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

Its three derivatives — `--accent-soft` (a 12% wash), `--accent-line` (a 40%
hairline) and `--accent-ink` (80% accent into ink, for accent-coloured text) —
are declared on `:root` **and on `.page-container`**, the element PageShell
gives the page's `--accent`. A `var()` inside a custom property is resolved
where it is declared, so on `:root` alone they were series-1 blue on every
page. The ink's 80% is measured: the most accent that keeps 4.5:1 for every
pool slot on its own wash over a card, in both themes.

### The palette is computed, not chosen

Re-derived August 2026, and validated again on 2026-10-06 against the
surfaces the marks now sit on — the glass card over the bare page, which is
`--surface-raised` (see «Shisha» below):

| | light on `#fbfcfe` | dark on `#0d142e` |
|---|---|---|
| Lightness band | all 8 in 0.43–0.77 | 7 of 8 in 0.48–0.67 — cyan is 0.757 |
| Chroma floor | all 8 ≥ 0.10 | all 8 ≥ 0.10 |
| CVD separation (worst adjacent) | **ΔE 10.6** | **ΔE 10.9** |
| Normal-vision floor | ΔE 17.2 | **ΔE 23.5** |
| Contrast vs surface | **all 8 ≥ 3:1** (3.82–4.78) | all 8 ≥ 3:1 (4.07–8.77) |

The set it replaced cleared CVD at 9.1 and left three slots *below* 3:1. One
slot moved with glass: **light amber is `#a07410`**, was `#be8b1e`, which read
3.04:1 on white and under 3:1 on every other light surface — 2.38 on the page
where two of the backdrop's pools meet. It now clears 3:1 on every surface over
every sample of the backdrop (3.07 is the light floor, pink on that page), at
the cost of a little normal-vision distance (20.9 → 17.2) and 7.7 ΔE from
`--status-warning`, the distance the dark pair has always had. Dark cyan sits
above its lightness band since the «koʻk» re-tint (it was moved there for the
navy ground) — reported, not changed. **The slot order is unchanged** — blue,
orange, teal, amber, pink, olive, violet, red — because the order is the
colourblind-safety mechanism, not a style choice. Nothing that already reads a
slot changed meaning.

Status steps were darkened in light mode so each clears **4.5:1** and may carry
text, not only a mark — since glass, on every surface status text can land on,
over every sample of the backdrop: light warning `#8d5800` and critical
`#c50f16` (were `#915c00` / `#d02222`, 4.40 and 4.18 on the pooled page, 4.49
on the sunken band), dark critical `#ff655e` (was `#f0524e`, 4.28 on the page
under the blue pool and 4.13 in a card's sheen). They still ship with a word or
an icon; colour alone is never a channel.

### Ink on a series fill

No single ink clears 4.5:1 on all eight slots, so text on a filled chip, badge
or bar takes one of two, measured slot by slot in both themes:

| Token | Slots | Light | Dark |
|---|---|---|---|
| `--ink-on-series` | 1, 2, 6, 7, 8 (and `--ink-muted` as a fill) | `#ffffff` | `#02040c` |
| `--ink-on-series-bright` | 3, 4, 5 — teal, amber, pink | `#02040c` | `#02040c` |

White on the dark steps failed every slot (2.07–4.46:1), and in light it fails
teal, amber and pink. Never a literal `#fff` or `text-white` in a component —
the theme cannot reach it. The house's own brand fills (the active rail item,
the S mark) keep white in both themes on their own token, `--ink-on-brand`.

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
  --mode light --surface "#fbfcfe"
```

A hue picked by eye will pass the eye and fail a colourblind reader, which is
the entire reason the check exists. Then run
`tests/features/glassContrast.test.ts`, which holds every slot to 3:1 over
every surface and every sample of the backdrop.

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
distinguishable in a figure. The August 2026 pass completed the set with
`cv01`, `cv03`, `cv04` and `cv11` — a serifed 1, open 6 and 9, the
single-storey `a` — because on a screen made of figures, any glyph that *can*
be misread as another digit eventually will be. One trap the stylesheet
documents: `font-feature-settings` does not merge across the cascade, so
`.tabular`, `.figure` and `.figure-hero` restate the whole list rather than
inheriting it.

Two sizes carry the hierarchy. `.display` is for **titles** — the page name at
24–26px, tracked −0.03em. `.figure-hero` is for **the one number a screen
leads with**: `clamp(34px, 24px + 1.5625vw, 40px)`, weight 600, tracking
−0.025em, line-height 1, tabular and unwrappable. The clamp is a slope, not a
step, so the number never snaps between sizes at an arbitrary width. The size
exists for the *ratio* — the most important number differs from a body figure
by roughly 4×, not 2× — which is also why there is at most one per screen:
two heroes cancel the hierarchy both were meant to create.

`.eyebrow` is **the one positive-tracked style in the application**: 11px,
weight 550, +0.045em, uppercase, `--ink-muted`. Uppercase with open tracking
stops meaning anything the moment it is everywhere, so it is rationed to
exactly two places — section headers and table headers. KPI and stat labels
stay 12.5px sentence case: a label is a name, not a department sign.

Self-hosted rather than `next/font/google` for two reasons that are both about
deployment, not taste: the CSP allows `font-src 'self'` and nothing else, and a
build that reaches out to `fonts.googleapis.com` fails on a host with no
outbound network — a deploy failing for a reason unrelated to the deploy.

---

## Surface and depth

| Token | Use |
|---|---|
| `--page` + `--backdrop` | the ground, and four pools of light on it |
| `--glass-card` | cards, chart cards, stat tiles, the hero — translucent |
| `--glass-chrome` | the header, the rail, the phone drawer — translucent |
| `--surface` | inputs and panels that are not glass; the chrome's solid twin |
| `--surface-raised` | everything that must be opaque: every table's ground, pinned cells, tooltips, the org chart, the sellers board |
| `--surface-sunken` | table headers, insets, the well behind a chart |

A card is a border **plus** a lit top edge (`--glass-highlight`): one pixel of
light along its top. That highlight is what separates a raised surface from a
flat rectangle with a blur under it — the eye reads a lit top edge as depth far
more readily than it reads a shadow.

`html` paints the ground: `--page` and `--backdrop`'s four pools, on one element
(a `z-index: -1` pseudo-element would paint them behind the flat colour and
lose them), fixed to the window so a page that scrolls the document — /login —
keeps them in place like light in a room. In the Shell nothing scrolls the
document at all, which is what makes glass cheap; see the next section.

---

## Shisha — 2026-10-06

The client asked for the whole dashboard to become «shaffof, yoqimli, eng
kuchli dizayn» — translucent, pleasant, the strongest design — **and fast**.
Both halves are met by one fact about this layout.

### The fact it rests on

**The document never scrolls.** The Shell is exactly `100dvh` and only `<main>`
scrolls, so what lies behind every card, the header and the rail is `html`'s
own background — `--page` and the backdrop's pools — and it never moves. A
translucent fill over a static backdrop that is already soft looks the same as
a `backdrop-filter` blur of it, and costs nothing: no layer, no render pass, no
re-blur on scroll. So glass here is a **fill, not a filter**. A blur is spent
only where live content really moves under a surface.

### The backdrop

`--backdrop` is four radial pools over `--page`: blue from the top-left
corner, violet from the top-right, cyan from the bottom-left, indigo from the
bottom-right. Each is an ellipse nearly the size of the viewport, falling to
40% of its peak at 45% of its reach, so they meet in the middle at 12–17% of
their peaks and every card has colour behind it — the old two pools
reached the top 300px only. Peaks, dark / light: blue `rgba(56,108,255,.26)` /
`rgba(76,120,255,.11)`, violet `.20` / `.09`, cyan `.12` / `.07`, indigo
`.16` / `.07`, over `#060a1a` / `#edf1fb`. Literal colours, no filter, chrome
only: no mark that encodes a value reads them. The aurora under the title
(`.page-atmosphere`) keeps the page's own accent but lost its
`blur(70px) saturate(1.3)` for wider gradients that are already soft.

### What is glass, and what is not

| Surface | Glass? | Why |
|---|---|---|
| Card, ChartCard, StatTile (`.card`), the hero (`.card-hero`) | translucent fill | static backdrop behind it |
| Header, rail (`.app-header`, `.app-rail`) | translucent fill | static backdrop behind them; the header's old 12px blur blurred nothing |
| Phone drawer (`.app-drawer`) | chrome over the bare page — opaque | it opens over content, which would read through it |
| MultiSelect, column filter, date picker, ⌘K panel, the Users dialog (`.glass-float`) | **frosted**: 90% / 92% fill + `blur(18px) saturate(1.4)` | live content moves or dims under them; only while open |
| Every table in a card, pinned cells, sticky header and total bands | **opaque** | data scrolls under pinned cells; see below |
| Tooltips (`.tip`, chart tooltip, MedalTip) | **opaque** | they carry data |
| Org chart floating controls (`.org-float`) | **opaque** | the tree pans under them on every drag — a standing blur there re-ran every frame |
| The sellers board (`.tv-col`) | **opaque** | pixel-tuned; it repaints the card in its own surface |
| Modal scrim (`.backdrop-dim`) | page tint, **no blur** | the 2px whole-viewport blur was the largest backdrop pass in the house |

**Data never sits on glass.** One rule lays every `<table>` inside a card or a
hero on `--surface-raised`. A pinned column or a sticky band has to be opaque
or the cells scrolling under it show through; on a glass card the cells beside
it were the card's colour while it was the opaque one, so a frozen column read
as a strip wherever the backdrop was lit. On the table's own ground pinned and
moving cells are one colour everywhere. `--surface-raised` is the glass card
composited over the bare page, so the table sits inside the glass as nearly the
same colour. `overflow: clip` on a card holding a table keeps a flush table
inside the card's corners without making the card a scroll container.

**The hero's rim** was a gradient clipped to the border box under a fill
clipped to the padding box. Under a translucent fill that gradient shows
through the whole card as a grey veil, so the rim is a quiet border
(`--edge-hero-bottom`) plus a 1px inset line along the top (`--edge-hero-top`),
which follows the corner and fades down the sides as a lit edge does.

### The tokens

All literal `rgba`, never `color-mix` — the floor's television runs an old
Chromium that can drop a `color-mix` stop — declared in the light block and in
both dark blocks.

| Token | Light | Dark | Solid twin |
|---|---|---|---|
| `--glass-card` | white 80% | navy `rgba(17,25,58,.64)` | `--surface-raised` |
| `--glass-card-top` | white 50%, top 42% | white 2.5% | none |
| `--glass-chrome` | white 62% | navy `rgba(10,16,40,.62)` | `--surface` |
| `--glass-float` | white 90% | navy 92% | `--surface-raised` |
| `--glass-well` (a control's track, an input, a press) | ink 6% | black 40% | `--surface-sunken` |
| `--glass-raised` (a control's chip, a secondary button) | white 90% | blue 28% | `--surface-raised` |
| `--glass-hover` (the wash under a pointer) | ink 7% | blue-white 10% | `--grid` |
| `--glass-edge`, `--glass-highlight`, `--glass-shadow` | the 1px border, the lit top, the drop | | |
| `--glass-frost` | `blur(18px) saturate(1.4)`, for `--glass-float` only | | `none` |

The sheen is faint on purpose and the light goes on the **edge**: in dark a
brighter fill is lower contrast for every ink, and the old 5% sheen took
`--status-critical` to 4.13:1 at the top of a card.

### Contrast, measured over the backdrop

A glass surface has no single colour — it has one per place on the screen. So
every ink is measured over every surface, composited over every **sample** of
the backdrop: the bare page, each pool at its peak, each pair of pools
overlapping at 60%. Floors: `--ink-primary` 7, secondary / muted / every status
step 4.5, every series slot 3. The worst sample per surface:

| | page | card | card top | chrome | raised | sunken |
|---|---|---|---|---|---|---|
| light `--ink-muted` | 5.04 | 6.14 | 6.29 | 5.88 | 6.28 | 5.41 |
| light status (warning) | 4.66 | 5.68 | 5.81 | 5.43 | 5.80 | 5.00 |
| light series (pink) | 3.07 | 3.74 | 3.83 | 3.58 | 3.82 | 3.30 |
| dark `--ink-muted` | 5.44 | 5.97 | 5.61 | 6.36 | 6.62 | 7.03 |
| dark status (critical) | 5.17 | 5.67 | 5.34 | 6.05 | 6.29 | 6.68 |
| dark series (olive) | 3.34 | 3.67 | 3.45 | 3.91 | 4.07 | 4.32 |

Beyond the six surfaces the same test holds the hero's bloom (muted and status
at 4.5 on its peak, every pool accent — dark's bloom came down from 16% to
8%), the title band (the lead line over the backdrop plus the aurora — dark's
aurora came down from 22% / 18% to 16% / 13%), a filled stat tile, the danger
button at rest, hovered and pressed (its tint is mixed into the glass card:
over bare glass its label read 3.94:1), a floating panel over the worst ink
that can pass beneath it, and control labels in a well, on a chip and under the
hover wash. It is `tests/features/glassContrast.test.ts`, and it re-reads the
tokens from `globals.css`, so a changed value re-runs the check rather than
this table.

### Speed rules

- **`backdrop-filter` only on `.glass-float`**, only while a panel is open; a
  browser without it gets the opaque card. The header's blur, the scrim's 2px
  and the org chart's standing 8px are gone, and a test fails on a
  `backdrop-filter` anywhere else, stylesheet or component.
- **No filter on the aurora** — a blur of a radial gradient is a wider radial
  gradient.
- **The line glow stays dark-only and opted into per series** (see Analysis
  indicators) — the only `filter` left on data marks.
- **Nothing new animates.**

### The fallback

Reduced transparency, more contrast and forced colours share **one block** at
the end of BASE: every translucent glass token points at its solid twin, the
frost becomes `none`, the backdrop and its pools go, the aurora and the grain
with them, and a modal scrim gets denser (`--scrim-mix` 60% → 85%). It reaches
every glass surface because every glass surface is a token or a class — no
component writes a translucent colour of its own, and a test holds both.

### Controls

One radius, `--radius-panel-sm` (the Button's 12px; a chip inside a track two
pixels less), and two heights: **32px** on a desk for every control in a filter
row — Button `md`, MultiSelect, SegmentedControl, the period presets and the
picker, the search box — with Button `sm` at 28; and **40px** under a thumb for
the period control and the search box. One row used to hold 28, 30, 32 and
34px controls at 6, 8 and 12px corners. A track is the glass well, the chosen
segment a raised glass chip with the lit top; a secondary button is a raised
chip whose hover lays the wash over it and whose press sinks it into the well;
the period presets lost the solid-ink active block SegmentedControl retired.
`BrandSwitch` (features, not a shared primitive) still carries its own copy.

---

## The signature layer — "Tungi rasadxona"

The August 2026 pass gave the dashboard one identity: an instrument panel in a
night observatory. Everything in this layer is **light, never content** — it
paints in the negative z phase, takes no pointer events, and none of it may
carry a value. The colour contract above is untouched: every tint here is
mixed from chrome-eligible colours, and no mark that encodes data reads any of
them.

### The aurora

`.page-atmosphere` paints two soft radial pools — the page's own `--accent`
and `--series-7`, mixed at `--atmos-mix-*` strengths (5% both in light,
16%/13% in dark), no filter — behind the page title. It was blurred 70px and
saturated 1.3, rasterised again on every navigation; a blur of a radial
gradient is a wider radial gradient, so the ellipses are wider instead. It mounts in **exactly
one place**: PageShell's title band, inside the accent subtree. Mixing at the
element rather than on `:root` is what lets each page's aurora follow its own
accent; a token derived on `:root` would freeze to series-1 for every page.

Where it may **not** appear: behind a chart, a table, a card, or any figure.
That is enforced, not hoped for — a mask on `.page-atmosphere` fades the aurora
itself to nothing by 60% of the band's height, so the bottom 40% is clean canvas
before the first data pixel. A mask rather than an opaque `--page` overlay,
because the overlay also deleted `html`'s pools inside its own bounds and
read as a darker box on any viewport wider than the container. The sky is
also **static**: this is a work tool, and the sky must not drift while someone
reads a number.

The strengths are load-bearing, not taste. The worst-case backdrop under the
12px lead line — the backdrop's brightest sample (the blue pool's corner is
right there), the accent blob where that line sits, the grain's mean — keeps
every ink at its floor: muted 4.86:1 light, 4.68:1 dark. Dark's strengths came
down from 22%/18% when the backdrop went in, because pool and aurora lighten
the same corner (at 22% dark muted read 4.44:1). Raising `--atmos-mix-*` or
`--grain-alpha` re-runs that arithmetic (`glassContrast.test.ts`) or does not
happen. Under `prefers-reduced-transparency`, `prefers-contrast: more` and
forced colours the atmosphere degrades to nothing, never to less-legible —
the one fallback block, see «Shisha».

### Film grain

`body::after` tiles an SVG `feTurbulence` texture over the page ground at
`--grain-alpha` — 2% light, 4% dark, where a flat hex wall is most visibly
flat. It sits at z −1 with `pointer-events: none`. A glass card lets a fifth
of it through in light and a third in dark — 0.4% and 1.4%, paper rather than
texture — and a table's opaque ground blots it out, so the grain is on the
canvas, never on the data.

### The lead instrument

`.card-hero` is a glass card that outranks its neighbours three ways: the
larger `--radius-panel-lg`, the raised shadow, and a rim whose top is visibly
brighter than the rest — a quiet border (`--edge-hero-bottom`) and a 1px inset
line along the top (`--edge-hero-top`). It was a gradient riding in as a
background clipped to the border box, which a translucent fill shows straight
through (see «Shisha»). At most **one per page** — two of these on a screen is
not two heroes, it is none. Its number is the page's single `.figure-hero`. Its
top-left corner holds a bloom of the page accent at `--hero-bloom-mix` — 5% in
light, 8% in dark, the most that keeps muted and status text at 4.5:1 on the
bloom's peak over the backdrop's brightest pool for every pool accent (16%, the
figure for an opaque card, read 3.71:1 for critical once the hero was glass;
before that it borrowed the aurora's 22% and muted read 4.00:1 on cyan pages).

`.brackets` draws two 12px L-corners in `--border-strong` at opposing corners,
6px inside the edge — the registration marks of an instrument that has been
aligned. Once per page at most, on the lead instrument; a second pair demotes
both to decoration. The corners are the element's own `::before` and
`::after`, so anything else that draws a pseudo-element goes on a wrapper.

In dark mode the hero figure carries a 24px halo of the page accent at
`--glow-hero-mix` (40% dark, 0% light — the mix collapses to transparent, so
there is no rule to un-set). The digits stay in ink; the glow is the panel's
backlight leaking around the figure, constant and therefore unable to encode
anything. A whisper, not neon — glow-on-every-card is the gallery cliché this
layer exists to refuse.

**No blank stat tiles on a hero band.** Every big number there carries a
sparkline, a meter, or the fraction it was computed from. A hero that is only
a number is a poster, not an instrument.

### The keyboard layer

Chrome, never data: it borrows the elevation system and may never borrow a
series or status colour.

| Piece | What it is |
|---|---|
| `.kbd` + `Kbd` | keycap chip — 11px, inherited family (a `<kbd>` defaults to monospace), `--surface-sunken`, darkened **bottom** edge via `--kbd-edge` so it reads as pressable |
| `.tip` + `Tooltip` | the tooltip primitive — raised surface, `--border-strong`, `--radius-panel-sm`, 12px text, 120ms fade+2px rise (fade only under reduced motion) |
| `.palette-enter`, `.glass-float`, `.backdrop-dim` + `CommandPalette` | ⌘K / Ctrl+K — 600px frosted panel in the top third, 150ms scale 0.98→1, over a page-tinted scrim |

The **tooltip primitive replaces every native `title` that carries data**: a
`title` cannot be styled, ignores touch and keyboard focus, and takes a second
to appear. `Tooltip` works on hover (~150ms delay), focus and tap, gains
`aria-describedby`, and stays opaque — glass never sits over data. Its shadow
is `--shadow-ambient`: the directional float stack in light, an offset-free
halo in dark, because a night room has no sun and a directional shadow there
reads as a rendering artefact. Decorative `title`s that only repeat the
visible word may stay. The same shadow goes on **every** floating panel — the
MultiSelect and column-filter dropdowns, the date picker, the org chart's
floating controls and roster panel, the skip link; `--shadow-float` is left to
a selected card, which is not chrome. The dropdowns, the date picker, the
palette and the Users dialog are also the house's only **frosted** surfaces
(`.glass-float`, see «Shisha»): live content moves or dims under them, and they
exist only while open.

Every modal scrim is `.backdrop-dim` — the palette's and the Users dialog's —
tinted from `--page`, not black: a black scrim in light mode turns the app into
a different, darker room for as long as the modal is open, while a
page-coloured veil dims without changing the room. It no longer blurs: a 2px
blur of the whole viewport for as long as a modal is open was the largest
backdrop pass in the house, and the frosted panel over it blurs where it
matters. The transparency fallback makes it denser; reduced motion reduces
both entrances to fades by keyframe redefinition.

### The button kit

One `Button` component, four variants, and every ad-hoc button swept onto it:
**primary** (ink-primary fill, inverted text — one per view, the action the
screen is for), **secondary** (a raised glass chip with the lit top, the
default), **ghost** (borderless, for actions that repeat in every row),
**danger** (a red tint mixed into the glass card, for the control that takes
away what the reader set). Two heights — 28px `sm`, 32px `md` — radius
`--radius-panel-sm`, the one radius every control shares; hover lays the glass
wash over the fill, a press sinks it into the well, `.focusable` ring. `href`
renders the same treatment on a `next/link`.

### Drawn glyphs

`Icons.tsx` replaces the text glyphs `↑↓●▲■○` with drawn 12px marks: 24-unit
grid, stroke 1.7 held literal by `vector-effect: non-scaling-stroke`,
`currentColor`, `aria-hidden`. Text glyphs came from the UI font at the whim
of the platform; a drawn mark weighs the same everywhere. Every glyph is
decoration beside a word or an accessible name — the glyph+word rule stands,
colour is never the only channel, and the glyph is never the only channel
either.

---

## Motion

One easing curve, `--ease-out`, a decelerating cubic-bezier: things arrive
quickly and settle. Three durations, and their asymmetry is deliberate —
`--duration-exit` (120ms) is shorter than `--duration-enter` (180ms) so the old
view stops competing for attention before the new one asks for it.

| Helper | What it does |
|---|---|
| `.rise` | a single element arrives, 6px up and fading |
| `.stagger` | children arrive in sequence, indexed by `nth-child` (nothing to set per child), capped at 8 |
| `.grow-x` | a bar scales from its baseline, so the length reads as a value arriving |

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

## Analysis indicators

**Tiles wear rings, table rows wear bars.** A headline rate renders as a
`RingGauge` — a conic gradient swept by a registered `@property`, so the fill
animates as pure CSS with no per-frame JavaScript. Twenty rings in a table
would be noise, which is why `Meter` still exists and neither replaces the
other. Ring colour follows the same rules as every mark: `auto` grades against
the house thresholds, `neutral` states magnitude in the sequential hue, and a
page that grades with its own thresholds resolves the tone itself and the ring
just wears it. Never the page accent.

**Numbers arrive, they do not appear.** Every stat counts up on first paint
and glides when a live refresh moves it (`AnimatedNumber`), with a brief tint
flash so the change is noticed. The formatted string sits in tabular figures,
so a rolling digit never shifts layout; the server renders the final value, so
no crawler or test ever sees a half-counted number; reduced motion renders
instantly and keeps only the flash.

**Deltas are pills.** A 12% tint of the delta's own colour under full
text-grade ink — findable before it is read, contrast untouched, arrow kept
for colourblind readers.

**Cards below the fold rise as they scroll into view** — `animation-timeline:
view()`, composited by the browser, nothing on the main thread. Print disables
it (a scroll-driven animation would freeze unseen cards at opacity 0 on
paper), and so does reduced motion.

**Lines glow, faintly, in dark.** A `drop-shadow` of the series' own colour
under the data line — the same hue at `--line-glow-mix` (55% dark, 0% light),
never a new colour. It is most of the difference between a chart that reads as
luminous and a wire on a dark card. A mark opts in with
`className="glow-series-N"` on its `<Line>` or `<Area>`, N the slot its stroke
wears; there is no app-wide rule (one shipped for a week and gave every line
the same blue). A status line never glows, and neither does a dashed
projection.

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
6. **A number names its basis when a sibling screen computes one differently.**
   The Reyting page and the home screen's leaderboard card rank the same
   sellers from the same endpoint, but the API serves two bases: `revenue`
   ranks what was **delivered**, `closed_value` ranks what the **seller
   closed**. Last August those sets of deals overlapped in 1 152 of 5 375, so a
   name can top one board and not the other with no bug anywhere. Two screens
   showing different orderings under the same word "Reyting" reads as a defect;
   a caption saying *yetkazilgan tushum boʻyicha* makes it a fact. The caption
   names the **scope** in the same breath — these rows are the branch's
   sellers, not the company — because "who is missing" is the other half of
   what a ranking means. The rule generalises past this one board: the basis
   goes in the caption wherever the reader could reach a sibling screen and get
   a different answer to what sounds like the same question.

---

## What the August 2026 audit changed

Seven lanes read every screen against the database and the portal; every
finding was reproduced by a second agent whose instructions were to refute it.
Forty-one survived. The design rules that came out of it, beyond what is
already stated above:

**Never name a token Tailwind already owns.** `--radius-sm` / `--radius-lg` are
Tailwind v4's, declared inside `@layer theme`, and an unlayered `:root` beats a
layer — so redefining them silently changed every `rounded-lg` in the
application from 8px to 18px, on elements that had never asked for a house
radius. House tokens are `--radius-panel-*`.

**A bar and the number beside it state the same quantity.** The funnel drew
`count / max` next to a label reading share-of-total; every row overstated
itself by roughly 2.3×, and the bar is the half the eye reads.

**A rate prints the fraction it was computed from.** `91.6%` над
`898 / 2,191` is a lie — that fraction is 41%. If the denominator is
inconvenient, the fix is a better label, not a different denominator.

**Reserved colours stay reserved.** Status steps are a state, never a rank: a
list ranked with `--status-critical` and `--status-warning` says the top item
is a crisis and the rest are problems, a judgement nobody made. Rank takes an
ordinal ramp or nothing.

**`--series-8` may not be a page accent.** It is 4.1 ΔE from
`--status-critical` in light mode, so a page accented with it makes red mean
two things on the same screen. The accent pool is slots 1, 2, 3, 5, 6, 7.

**Dark mode is not a darker light mode.** The sequential ramp has to flip its
anchor: 650 is the most visible step in both themes. Reusing the light ramp put
the funnel's last stage at 1.8:1 against a near-black page. Elevation flips
too — a black shadow on a near-black surface is invisible, so depth comes from
the border and the lit top edge.

**Loading, failure and a genuine null are three renderings.** They were one em
dash, so a page whose API had just returned 500 read as "no data" — a
confident statement about something nobody knew.

**A cap on every table whose length comes from the data.** The leaderboard was
17,400px and the employee list 16,605px because nothing bounded them.

**`--ink-muted` carries almost every label, so it clears 4.5:1** — on every
surface it lands on, `--grid` included (5.12:1 light), and since glass over
every sample of the backdrop (4.86:1 at its tightest, light, under the title
band). It was 3.38:1.
