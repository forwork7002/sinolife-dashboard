'use client'

import { useMemo, type ReactNode } from 'react'

import { encodeQr } from './qr'

/**
 * The enrolment QR, as inline SVG.
 *
 * SVG rather than a canvas or an <img>: it is sharp at any size on any screen,
 * it needs no ref and no effect, and it prints. The whole symbol is one <path>
 * — one move-and-square per dark module — because a few thousand <rect>
 * elements is a few thousand DOM nodes for a picture that never changes.
 *
 * WHY THE COLOURS ARE LITERAL BLACK AND WHITE, in a codebase that otherwise
 * only ever reads tokens. A QR symbol is specified dark-on-light. Plenty of
 * scanners — iOS's camera among them — will read an inverted one, and plenty
 * of Android authenticator apps will not, and the person pointing a phone at
 * this screen has no way to tell which kind they are holding. In dark mode
 * `--surface-raised` is #1c2027 and `--ink-primary` is #f5f6f8, so painting
 * this from tokens produces exactly the inverted symbol that half the world's
 * scanners refuse. The white card behind the code is therefore not a styling
 * choice this file is free to make; it is part of the code working at all.
 *
 * The quiet zone is drawn, not left to margin. Four modules of white on every
 * side is required by the standard — a scanner uses it to find the symbol's
 * edge — and a CSS margin over a dark background is not white.
 */
export function QrCode({
  value,
  label,
  fallback,
}: {
  value: string
  label: string
  /** Shown instead of the symbol when the payload is too long to draw. */
  fallback: ReactNode
}) {
  // Encoding is a few milliseconds of pure arithmetic, but it runs on every
  // keystroke in the confirmation field below without this.
  const matrix = useMemo(() => encodeQr(value), [value])

  if (!matrix) {
    /*
      Honest state, and a reachable one: past version 10 the symbol is not
      drawn. It is not a dead end — the typed secret sitting beside this is a
      complete enrolment path — so the fallback says which of the two to use
      rather than leaving a hole where a picture was. See the header of
      `qr.ts` for why the ceiling is where it is.
    */
    return <>{fallback}</>
  }

  const quiet = 4
  const span = matrix.size + quiet * 2

  // One "move to, then a 1×1 square" per dark module. `h1 v1 h-1 z` is four
  // characters shorter per module than the equivalent rect and reads the same.
  const path = matrix.modules
    .flatMap((row, y) =>
      row.map((dark, x) => (dark ? `M${x + quiet} ${y + quiet}h1v1h-1z` : '')),
    )
    .join('')

  return (
    <svg
      viewBox={`0 0 ${span} ${span}`}
      role="img"
      aria-label={label}
      // `crispEdges` turns off antialiasing: a half-lit module boundary is
      // exactly the ambiguity a scanner has to resolve, and there is no reason
      // to hand it one.
      shapeRendering="crispEdges"
      className="h-auto w-full max-w-[220px] rounded-[var(--radius-panel-sm)]"
      style={{ background: '#ffffff' }}
    >
      <path d={path} fill="#000000" />
    </svg>
  )
}
