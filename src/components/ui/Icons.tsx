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

export function ChevronUpGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M5.5 15L12 8.5 18.5 15" {...stroke} />
    </Glyph>
  )
}

export function ChevronRightGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M9 5.5l6.5 6.5L9 18.5" {...stroke} />
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

/** Static aliases, for a caret that never animates (aria-sort states it). */
export function SortAscGlyph(props: GlyphProps) {
  return <SortCaretGlyph direction="asc" {...props} />
}

export function SortDescGlyph(props: GlyphProps) {
  return <SortCaretGlyph direction="desc" {...props} />
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

/**
 * The ⌘ mark, for the search chip and palette chrome.
 *
 * Stroke dropped to 1.4: the four loops sit on a 3-unit radius, and at chip
 * size the full 1.7 welds them into blobs. This is the one glyph where the
 * drawing is denser than the grid was designed for.
 */
export function CommandGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path
        d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"
        {...stroke}
        strokeWidth={1.4}
      />
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
