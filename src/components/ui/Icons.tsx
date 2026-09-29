import type { ReactNode, SVGProps } from 'react'

/**
 * Micro-glyphs: the drawn replacements for ↑ ↓ ● ▲ ■ ○ × ⌘.
 *
 * Text glyphs came free but were never ours: their weight, size and baseline
 * shifted with the font, and ▲ rendered as an emoji on some platforms. These
 * are drawn on the same 24-unit grid as Shell's nav icons, stroke 1.7,
 * currentColor — so a glyph inherits the exact ink of the text beside it and
 * the two read as one mark.
 *
 * `vector-effect: non-scaling-stroke` is the deliberate departure from the nav
 * icons. They render at 15px, where a 1.7-unit stroke scales to a pleasant
 * ~1px hairline; these render at 12px and smaller, where the same scaling
 * produces a 0.85px thread that loses to the text it sits next to. Non-scaling
 * keeps the stroke at a literal 1.7 device pixels whatever the rendered size —
 * the weight of the lowercase text these marks accompany.
 *
 * Every glyph is `aria-hidden`: the house rule is glyph PLUS word, so the
 * meaning always travels in the adjacent text and the drawing is decoration a
 * screen reader can skip.
 */

export interface GlyphProps {
  /** Rendered box, px. The drawing scales; the stroke weight does not. */
  readonly size?: number
  readonly className?: string
}

/** Shared stroke recipe — one definition, so a weight change is one edit. */
const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  vectorEffect: 'non-scaling-stroke',
} as const satisfies SVGProps<SVGPathElement>

function Glyph({
  size = 12,
  className,
  children,
}: GlyphProps & { readonly children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

/** Delta up. Pairs with `--delta-up` text; never carries meaning alone. */
export function ArrowUpGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 18.5V5.5" {...stroke} />
      <path d="M6.5 11L12 5.5 17.5 11" {...stroke} />
    </Glyph>
  )
}

/** Delta down. */
export function ArrowDownGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 5.5v13" {...stroke} />
      <path d="M6.5 13L12 18.5 17.5 13" {...stroke} />
    </Glyph>
  )
}

export function ChevronDownGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M5.5 9l6.5 6.5L18.5 9" {...stroke} />
    </Glyph>
  )
}

/**
 * Sort caret: ONE chevron, rotated, not two drawings.
 *
 * When a header flips from ascending to descending the same mark turns over,
 * and the transition makes the flip legible as a change of direction rather
 * than a swap of icons. `motion-safe:` keeps the turn out of reduced-motion;
 * there the caret simply points the other way, which is the whole message.
 */
export function SortCaretGlyph({
  direction,
  size,
  className = '',
}: GlyphProps & { readonly direction: 'asc' | 'desc' }) {
  return (
    <ChevronDownGlyph
      size={size}
      className={`motion-safe:[transition:transform_var(--duration-exit)_var(--ease-out)] ${
        direction === 'asc' ? 'rotate-180' : ''
      } ${className}`}
    />
  )
}

/** Filled dot — the drawn ●. Status "good" in the StatusChip vocabulary. */
export function DotGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="6" fill="currentColor" />
    </Glyph>
  )
}

/**
 * Hollow ring — the drawn ○. The neutral partner to DotGlyph: same bulk, so a
 * column of chips does not jitter when a status changes.
 */
export function RingGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="6" {...stroke} />
    </Glyph>
  )
}

/**
 * Filled triangle — the drawn ▲ for warnings. Stroked as well as filled: the
 * round joins soften the points, matching the hand-drawn nav icons instead of
 * a razor-cornered geometry mark.
 */
export function TriangleGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 5L19.5 18.5H4.5L12 5z" fill="currentColor" {...stroke} />
    </Glyph>
  )
}

/** Filled square — the drawn ■ for critical states. */
export function SquareGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor" {...stroke} />
    </Glyph>
  )
}

/** Em-dash as a mark: "no direction", "no change". */
export function DashGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M5.5 12h13" {...stroke} />
    </Glyph>
  )
}

/** Magnifier, drawn like the one in SearchInput so the two never diverge. */
export function SearchGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="11" cy="11" r="6.5" {...stroke} />
      <path d="M16 16l4 4" {...stroke} />
    </Glyph>
  )
}

/** × for multiples ("×2.4") and for close affordances. */
export function MultiplyGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" {...stroke} />
    </Glyph>
  )
}

/** ⓘ — the trigger mark InfoTip wears. */
export function InfoGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.5" {...stroke} />
      <path d="M12 11v5.5" {...stroke} />
      <circle cx="12" cy="7.8" r="0.4" fill="currentColor" {...stroke} strokeWidth={1.4} />
    </Glyph>
  )
}

// ---------------------------------------------------------------------------
// Confirmation states
//
// Five marks for the five states of the Тасдиклаш queue, drawn rather than
// borrowed from the emoji the Telegram bot uses. The bot's 🕔 🟡 ✅ ❌ 🟣 stay
// the floor's vocabulary and keep the LABELS company in Telegram; as marks
// they were wrong for this surface — an emoji renders in the platform's own
// palette rather than `currentColor`, so it cannot take the state's colour,
// and it lands four different ways across Windows, macOS, Android and Linux.
//
// THEY ARE DRAWN FOR 12px, WHICH IS THE ONLY SIZE THAT MATTERS HERE.
// The first attempt put a tick and a cross each inside a circle, and rendered
// at 12px they were two identical smudges: an 8.5-unit circle with a 1.7-unit
// non-scaling stroke leaves barely three pixels of interior for the mark that
// carries the meaning. A missed-call handset fared worse — at 12px it was a
// blob. So the enclosing circle is gone from the three that do not need it,
// and what is left is the silhouette itself, drawn at stroke 2.
//
// The five are five DIFFERENT OUTLINES — clock, barred circle, tick, cross,
// arrow — not five colours of one disc. That is what keeps them apart for a
// colourblind reader, in greyscale print and in forced-colors mode, which is
// the same rule StatusChip already follows.
// ---------------------------------------------------------------------------

/** Heavier than the 1.7 of the text glyphs: these carry meaning at 12px. */
const mark = { ...stroke, strokeWidth: 2 } as const

/** In the queue, waiting to be worked. */
export function ClockGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.6" {...mark} />
      <path d="M12 7.2V12l3.4 2.2" {...mark} />
    </Glyph>
  )
}

/**
 * Called, not picked up.
 *
 * A barred circle rather than a handset: "could not reach" is the meaning, and
 * the universal prohibition mark survives 12px where a telephone does not.
 */
export function PhoneMissedGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.6" {...mark} />
      <path d="M6 6l12 12" {...mark} />
    </Glyph>
  )
}

/** Reached the customer and confirmed. */
export function CheckCircleGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 12.8 9.5 17.8 19.5 6.6" {...mark} />
    </Glyph>
  )
}

/** Killed in the queue. */
export function CrossCircleGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M6 6l12 12M18 6L6 18" {...mark} />
    </Glyph>
  )
}

/** Left the queue without a yes. */
export function ArrowOutGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 12h13" {...mark} />
      <path d="m12.5 6.5 6 5.5-6 5.5" {...mark} />
    </Glyph>
  )
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/** Reveal. Pairs with EyeOffGlyph on a single toggle. */
export function EyeGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M2.6 12S6.2 6 12 6s9.4 6 9.4 6-3.6 6-9.4 6-9.4-6-9.4-6Z" {...mark} />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </Glyph>
  )
}

/**
 * Hide.
 *
 * The same eye with one straight bar through it. The version that broke the
 * outline into two arcs around the slash turned into a scribble at 12px; a
 * whole shape crossed by a single line stays legible.
 */
export function EyeOffGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M2.6 12S6.2 6 12 6s9.4 6 9.4 6-3.6 6-9.4 6-9.4-6-9.4-6Z" {...mark} />
      <path d="M4 4l16 16" {...mark} />
    </Glyph>
  )
}

/** The statistics panel. Three bars, ranked — what the panel actually shows. */
export function BarsGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 20h16" {...mark} />
      <path d="M8 20v-6M12 20V7.5M16 20v-9" {...mark} />
    </Glyph>
  )
}

/** Remove for good. A bin, for the one irreversible action on the screen. */
export function TrashGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M5 6.5h14M10 6.5V4.6h4v1.9" {...mark} />
      <path d="M7 6.5 7.9 19.4h8.2L17 6.5" {...mark} />
    </Glyph>
  )
}

/**
 * A bell, for work that is waiting.
 *
 * Drawn rather than borrowed from an emoji font: 🔔 renders at a different
 * weight and baseline on every platform, and this one has to sit level with a
 * count badge pinned to its corner.
 */
export function BellGlyph(props: GlyphProps) {
  return (
    <Glyph size={16} {...props}>
      <path
        d="M6 9a6 6 0 0 1 12 0c0 3.2.7 4.7 1.4 5.6.4.5 0 1.4-.7 1.4H5.3c-.7 0-1.1-.9-.7-1.4C5.3 13.7 6 12.2 6 9z"
        {...stroke}
      />
      <path d="M10 19a2 2 0 0 0 4 0" {...stroke} />
    </Glyph>
  )
}

/**
 * A refresh arrow that turns only while something is in flight.
 *
 * The spin is the state, so it is driven by a prop rather than by a hover or
 * a permanent animation — a dashboard whose refresh icon always turns says
 * nothing about whether it is actually working.
 */
export function RefreshGlyph({ spinning = false, ...props }: GlyphProps & { spinning?: boolean }) {
  return (
    <span className={spinning ? 'spin' : undefined} style={{ display: 'inline-flex' }}>
      <Glyph size={16} {...props}>
        <path d="M20 12a8 8 0 1 1-2.6-5.9" {...stroke} />
        <path d="M20 4v4.5h-4.5" {...stroke} />
      </Glyph>
    </span>
  )
}

/**
 * A sun and a moon — the two states of the header's appearance toggle.
 *
 * Drawn here rather than borrowed from ☀️/🌙 for the reason the whole module
 * exists: the emoji pair renders in colour on most platforms, which would put
 * the only two coloured marks in the chrome on a control that carries no data,
 * and they sit on a different baseline from the bell and the refresh arrow
 * beside them.
 *
 * The button shows the mode it will GIVE you, not the one you are in — a moon
 * in daylight, a sun at night — and its label says so in words, because a
 * lone pictogram cannot distinguish "you are here" from "go here".
 */
export function SunGlyph(props: GlyphProps) {
  return (
    <Glyph size={16} {...props}>
      <circle cx="12" cy="12" r="4" {...stroke} />
      <path
        d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4"
        {...stroke}
      />
    </Glyph>
  )
}

export function MoonGlyph(props: GlyphProps) {
  return (
    <Glyph size={16} {...props}>
      <path d="M20.5 13.4A8.5 8.5 0 1 1 10.6 3.5a6.6 6.6 0 0 0 9.9 9.9z" {...stroke} />
    </Glyph>
  )
}
