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

## The signature layer — "Tungi rasadxona"

The August 2026 pass gave the dashboard one identity: an instrument panel in a
night observatory. Everything in this layer is **light, never content** — it
paints in the negative z phase, takes no pointer events, and none of it may
carry a value. The colour contract above is untouched: every tint here is
mixed from chrome-eligible colours, and no mark that encodes data reads any of
them.

### The aurora

`.page-atmosphere` paints two blurred radial pools — the page's own `--accent`
and `--series-7`, mixed at `--atmos-mix-*` strengths (5% both in light,
12%/11% in dark), blur 70px — behind the page title. It mounts in **exactly
one place**: PageShell's title band, inside the accent subtree. Mixing at the
element rather than on `:root` is what lets each page's aurora follow its own
accent; a token derived on `:root` would freeze to series-1 for every page.

Where it may **not** appear: behind a chart, a table, a card, or any figure.
That is enforced, not hoped for — the mandatory `.page-atmosphere-fade` child
paints solid `--page` from 60% of the band's height down, so the bottom 40% is
clean canvas before the first data pixel. The sky is also **static**: this is
a work tool, and the sky must not drift while someone reads a number.

The strengths are load-bearing, not taste. The worst-case backdrop — one
blob's on-canvas peak, the other's cross-residual, the grain's mean
contribution — keeps every ink at its 4.5:1 floor, with light-mode
`--ink-muted` the tight one. Raising `--atmos-mix-*` or `--grain-alpha`
re-runs that arithmetic or does not happen. Under
`prefers-reduced-transparency`, `prefers-contrast: more` and forced colours
the atmosphere degrades to nothing, never to less-legible.

### Film grain

`body::after` tiles an SVG `feTurbulence` texture over the page ground at
`--grain-alpha` — 2% light, 4% dark, where a flat hex wall is most visibly
flat. It sits at z −1 with `pointer-events: none`, and cards are opaque
surface tokens, so plot areas stay clean by construction: the grain is on the
canvas, never on the data.

### The lead instrument

`.card-hero` is a card that outranks its neighbours three ways: the larger
`--radius-panel-lg`, the raised shadow, and a hairline painted as a
**gradient** (`--edge-hero-top` → `--edge-hero-bottom`, riding in as a second
background clipped to the border box) so the top edge is visibly brighter than
the bottom. At most **one per page** — two of these on a screen is not two
heroes, it is none. Its number is the page's single `.figure-hero`.

`.brackets` draws two 12px L-corners in `--border-strong` at opposing corners,
6px inside the edge — the registration marks of an instrument that has been
aligned. Once per page at most, on the lead instrument; a second pair demotes
both to decoration. Both `.brackets` and `.glow-track` draw with `::after`, so
they never stack on one element: glow on the card, brackets on a wrapper.

In dark mode the hero figure carries a 24px halo of the page accent at
`--glow-hero-mix` (18% dark, 0% light — the mix collapses to transparent, so
there is no rule to un-set). The digits stay in ink; the glow is the panel's
backlight leaking around the figure, constant and therefore unable to encode
anything. A whisper, not neon — glow-on-every-card is the gallery cliché this
layer exists to refuse.

**No blank stat tiles on a hero band.** Every big number there carries a
sparkline, a meter, or the fraction it was computed from. A hero that is only
a number is a poster, not an instrument.

### The hover glow

`.glow-track` is the mouse-tracked radial on interactive cards: ink at 5%,
480px, following `--mx`/`--my` custom properties that **the component sets
from `mousemove`** (pixels from the card's rect; 50%/50% default). Ink, never
the accent — a glow that changed hue per page would make the same gesture look
like a different affordance on different screens. The entire rule lives inside
`(hover: hover) and (prefers-reduced-motion: no-preference)`; outside the
guard the pseudo-element is never created. It sets `position: relative` on the
card (the glow needs a containing block); a call site that needs the card
positioned otherwise wraps it.

### The keyboard layer

Chrome, never data: it borrows the elevation system and may never borrow a
series or status colour.

| Piece | What it is |
|---|---|
| `.kbd` + `Kbd` | keycap chip — 11px, inherited family (a `<kbd>` defaults to monospace), `--surface-sunken`, darkened **bottom** edge via `--kbd-edge` so it reads as pressable |
| `.tip` + `Tooltip` | the tooltip primitive — raised surface, `--border-strong`, `--radius-panel-sm`, 12px text, 120ms fade+2px rise (fade only under reduced motion) |
| `.palette-enter`, `.backdrop-dim` + `CommandPalette` | ⌘K / Ctrl+K — 600px panel in the top third, 150ms scale 0.98→1, page-tinted scrim with a 2px blur |

The **tooltip primitive replaces every native `title` that carries data**: a
`title` cannot be styled, ignores touch and keyboard focus, and takes a second
to appear. `Tooltip` works on hover (~150ms delay), focus and tap, gains
`aria-describedby`, and stays opaque — glass never sits over data. Its shadow
is `--shadow-ambient`: the directional float stack in light, an offset-free
halo in dark, because a night room has no sun and a directional shadow there
reads as a rendering artefact. Decorative `title`s that only repeat the
visible word may stay.

The palette scrim is tinted from `--page`, not black: a black scrim in light
mode turns the app into a different, darker room for the duration of a search,
while a page-coloured frost dims without changing the room.
`prefers-reduced-transparency` trades the blur for opacity; reduced motion
reduces both entrances to fades by keyframe redefinition.

### The button kit

One `Button` component, three variants, and every ad-hoc button swept onto it:
**primary** (ink-primary fill, inverted text — one per view, the action the
screen is for), **secondary** (bordered surface, the default), **ghost**
(borderless, for actions that repeat in every row). Two heights — 28px `sm`,
32px `md` — radius `--radius-panel-sm`, hover/active as token-mixed background
shifts, `.focusable` ring. `href` renders the same treatment on a `next/link`.

### Drawn glyphs

`Icons.tsx` replaces the text glyphs `↑↓●▲■○` with drawn 12px marks: 24-unit
grid, stroke 1.7 held literal by `vector-effect: non-scaling-stroke`,
`currentColor`, `aria-hidden`. Text glyphs came from the UI font at the whim
of the platform; a drawn mark weighs the same everywhere. Every glyph is
decoration beside a word or an accessible name — the glyph+word rule stands,
colour is never the only channel, and the glyph is never the only channel
either.

### The crosshair glides

Two transitions give charts the instrument feel with no scripting: the
Recharts cursor line eases to the hovered index over 90ms instead of
teleporting, and the active dot swells into place over 120ms. Both live inside
the reduced-motion guard — a gliding crosshair is precisely the chased motion
the preference asks to stop, and where an engine cannot transition SVG
geometry the cursor simply snaps, which is the same honest fallback.

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

**Lines glow, faintly.** A `drop-shadow` of the series' own colour under the
data line — the same hue at low opacity, never a new colour. It is most of
the difference between a chart that reads as luminous and a wire on a dark
card.

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
list ranked with `--status-critical` and `--status-serious` says the top item
is a crisis and the rest are serious problems, a judgement nobody made. Rank
takes an ordinal ramp or nothing.

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

**`--ink-muted` carries almost every label, so it clears 4.5:1.** It was
3.38:1.
