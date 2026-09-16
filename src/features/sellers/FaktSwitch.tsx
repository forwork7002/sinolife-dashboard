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
