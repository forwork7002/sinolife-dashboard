import type { CSSProperties, ReactNode } from 'react'

/**
 * The board's line icons — what stands where a colour emoji stood until the
 * EMAL medals (spec `2026-09-18-emal-medallar-design.md`, IMPLEMENT.md §5).
 *
 * WHY NOT THE EMOJI. Every emoji on this board was a different drawing from a
 * different hand — a cartoon trophy beside a struck medal, a tilted cartoon
 * crown over a metal ring — and the client's word for the result was
 * «oʻyinchoqdek». These eight are cut the way the medals are: round caps, ONE
 * stroke weight per box (1.7 in the 16-box chevrons, 1.5 everywhere else —
 * the medals' 2u/32 at the sizes the icons render), ring-and-bull where the
 * rank disc is ring-and-bull, and the crown is the year champion's own crown
 * struck in the medals' gold. No filter anywhere.
 *
 * THE SPAN KEEPS THE EMOJI'S PLACE. `.bi` in globals.css gives the box the
 * advance the emoji had (1.27em; 1.29em for the plaque rosette, 1.45em for
 * the record wall's cup — measured), so nothing beside an icon moves: podium
 * 1px shorter at 1920, 2px at 1366 (the emoji's line-box slop), every number
 * column Δ 0, every row Δ 0, no new truncation. See IMPLEMENT.md §6.
 *
 * ONE COMPONENT, ONE SPAN. `className` is merged onto the SAME span rather
 * than wrapping a second one, because three call sites style the box by a
 * compound selector — `.tv-col-glyph.bi`, `.record-medal.bi`, `.bi--crown`
 * with the seat's `rise absolute …` — and a wrapper would break all three.
 * Decorative throughout, hence `aria-hidden`: every icon stands beside the
 * words that carry its meaning.
 */
export type BoardIconName = 'trophy' | 'shield' | 'medal' | 'crown' | 'lead' | 'target' | 'flame' | 'flag'

/* Mirrors `ICONS` in docs/superpowers/specs/assets/2026-09-18-emal-medallar/postprocess.js
   — the approved mock's drawings, to the coordinate. The crown's gold is the medal defs'
   `#eg-gold-body` (the mock's `#bi-crown-g` is the identical gradient), mounted once by
   `MedalDefs`; its edge and highlight are the `--bi-crown-edge` / `--bi-crown-hi` aliases beside the medal tokens. */
const ICONS: Record<BoardIconName, ReactNode> = {
  /* 🏆 — a cup: bowl, two handles, stem, plinth. Heading disc (sellers), record marquee, phone tab. */
  trophy: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path d="M6.2 3h7.6v4.3a3.8 3.8 0 0 1-7.6 0z" />
      <path d="M6.2 4.6H3.6v1a2.9 2.9 0 0 0 2.9 2.9M13.8 4.6h2.6v1a2.9 2.9 0 0 1-2.9 2.9" />
      <path d="M10 11.1v3.1M7.4 14.2h5.2l.8 2.8H6.6z" />
    </svg>
  ),
  /* 🛡️ — a heraldic shield, parted per pale. Heading disc (teams), phone tab. */
  shield: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path d="M10 2.7v14.6C6.6 15.9 4.2 13 4.2 9.4V4.8z" fill="currentColor" fillOpacity={0.2} stroke="none" />
      <path d="M10 2.7l5.8 2.1v4.6c0 3.6-2.4 6.5-5.8 7.9-3.4-1.4-5.8-4.3-5.8-7.9V4.8z" />
      <path d="M10 2.7v14.6" strokeOpacity={0.55} strokeWidth={1.1} />
    </svg>
  ),
  /* 🥇🥈🥉 — the award rosette: ring + bull (the rank disc in miniature) with two tails; ONE glyph,
     coloured by the seat's `--metal`, so gold, silver and bronze are the same drawing in three metals. */
  medal: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path d="M4.5 1.4h2.6l.9 2.2.9-2.2h2.6L9.4 6H6.6z" fill="currentColor" fillOpacity={0.38} strokeWidth={1.1} />
      <circle cx="8" cy="10.3" r="4.1" />
      <circle cx="8" cy="10.3" r="1.35" fill="currentColor" stroke="none" />
    </svg>
  ),
  /* 🚀 — «oldinda»: a double chevron, the insignia way of saying «ahead». The champion's chip only. */
  lead: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path d="M3.8 8.1 8 4.1l4.2 4M3.8 12.3 8 8.3l4.2 4" />
    </svg>
  ),
  /* 🎯 — the chase: ring + bull in the chase bar's own blue (`--bi-chase`), dimmed to the line's
     ink on a secondary-ink row so the medals stay the only jewel in it. */
  target: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <circle cx="8" cy="8" r="6.2" />
      <circle cx="8" cy="8" r="3" strokeOpacity={0.8} />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  /* 🔥 — «… bilan teng»: the MEDAL's flame (streak-fire outline + enamel heart), mapped from the
     32 box into the 16 box. `--bi-ember`. */
  flame: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <g transform="translate(-3.52 -3.45) scale(.72)">
        <path
          d="M16.3 6.6C16.9 10.4 22.6 12.6 22.6 18.3C22.6 22.4 19.7 25.2 16 25.2C12.3 25.2 9.4 22.4 9.4 18.6C9.4 15.9 10.8 14 12.2 12.6C12.5 14.4 13.2 15.4 14.3 15.9C13.9 12.6 14.7 9 16.3 6.6Z"
          strokeWidth={2.1}
        />
        <path
          d="M16 18.2C16.9 19.4 18.5 20.2 18.5 21.7C18.5 23 17.4 23.8 16 23.8C14.6 23.8 13.5 23 13.5 21.7C13.5 20.3 15.1 19.5 16 18.2Z"
          fill="currentColor"
          fillOpacity={0.85}
          stroke="none"
        />
      </g>
    </svg>
  ),
  /* 🏁 — «Podium hali boʻsh»: a pennant on its pole. NOT in the approved mock (the snapshot had a
     full podium, so the emoji was never on the page) — drawn in the same hand so the one line the
     mock could not see does not keep the last emoji on the board. The line's own ink. */
  flag: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path d="M4.2 2.4v11.2" />
      <path d="M4.2 3.2h7.9l-2 2.7 2 2.7H4.2z" fill="currentColor" fillOpacity={0.2} />
    </svg>
  ),
  /* 👑 — the champion's crown: the year champion's crown, struck in the medals' gold, UPRIGHT (the
     tilt was the cartoon), seated on the ring by `.bi--crown` — see the crown note in globals.css. */
  crown: (
    <svg viewBox="0 0 28 20" focusable="false">
      <path
        d="M5 15.3 2.9 6.2l6 4.2L14 3.2l5.1 7.2 6-4.2L23 15.3z"
        fill="url(#eg-gold-body)"
        stroke="var(--bi-crown-edge)"
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <path d="M5.8 13.2h16.4" stroke="var(--bi-crown-hi)" strokeOpacity={0.5} strokeWidth={0.8} strokeLinecap="round" />
      <rect x="4.7" y="16.2" width="18.6" height="2.6" rx="1.2" fill="url(#eg-gold-body)" stroke="var(--bi-crown-edge)" strokeWidth={0.9} />
    </svg>
  ),
}

export function BoardIcon({
  name,
  dim = false,
  className,
  style,
}: {
  name: BoardIconName
  /** A target on a line set in secondary ink keeps that ink instead of the chase blue. */
  dim?: boolean
  /** Merged onto the icon's own span — never a wrapper (see above). */
  className?: string
  style?: CSSProperties
}) {
  const classes = [className, 'bi', `bi--${name}`, dim ? 'bi--dim' : null].filter(Boolean).join(' ')
  return (
    <span aria-hidden="true" className={classes} style={style}>
      {ICONS[name]}
    </span>
  )
}
