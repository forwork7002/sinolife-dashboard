'use client'

import { useSyncExternalStore } from 'react'

/**
 * Keycap chips.
 *
 * The visual is `.kbd` in globals.css — one class, one definition — so this
 * component only decides WHAT each cap says: `mod` renders ⌘ on Apple
 * hardware and Ctrl everywhere else, symbols stand in for words (⇧ ↵ ↑ ↓,
 * the Linear convention), and single letters are shown uppercase.
 *
 * Platform detection is a `useSyncExternalStore` read, never a render-time
 * `navigator` sniff: the server does not know the visitor's keyboard, so the
 * server snapshot says "Ctrl" and Apple machines swap to ⌘ on hydration —
 * the sanctioned pattern for a value the server cannot know, with no
 * hydration mismatch and no cascading effect render.
 *
 * Symbols are hostile to screen readers ("⌘" announces as nothing useful),
 * so the chips are decoration and a sr-only span speaks the real combination.
 */

// The platform cannot change while the page lives; there is nothing to
// subscribe to, and the no-op keeps useSyncExternalStore honest.
const subscribeNever = () => () => {}

const readIsApple = () =>
  // navigator.platform is deprecated but still the most direct signal;
  // the userAgent fallback covers environments that blank it.
  /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`)

// What the server claims: Ctrl is the majority truth and the safe default.
const readIsAppleOnServer = () => false

/** True on macOS / iOS. Exported for chrome that needs the same decision. */
export function useApplePlatform(): boolean {
  return useSyncExternalStore(subscribeNever, readIsApple, readIsAppleOnServer)
}

interface KeyFace {
  /** What the cap prints on Apple hardware. */
  readonly mac: string
  /** What it prints everywhere else. */
  readonly other: string
  /** What a screen reader hears — words, never symbols. */
  readonly spoken: string
  readonly spokenMac?: string
}

const KEY_FACES: Record<string, KeyFace> = {
  mod: { mac: '⌘', other: 'Ctrl', spoken: 'Ctrl', spokenMac: 'Cmd' },
  shift: { mac: '⇧', other: '⇧', spoken: 'Shift' },
  alt: { mac: '⌥', other: 'Alt', spoken: 'Alt' },
  enter: { mac: '↵', other: '↵', spoken: 'Enter' },
  esc: { mac: 'Esc', other: 'Esc', spoken: 'Escape' },
  up: { mac: '↑', other: '↑', spoken: 'Up' },
  down: { mac: '↓', other: '↓', spoken: 'Down' },
  left: { mac: '←', other: '←', spoken: 'Left' },
  right: { mac: '→', other: '→', spoken: 'Right' },
}

export interface KbdProps {
  /**
   * Key tokens, one chip each: the named tokens above plus plain strings
   * (a single letter renders uppercase). `['mod', 'K']` → ⌘ K / Ctrl K.
   */
  readonly keys: readonly string[]
  readonly className?: string
}

export function Kbd({ keys, className = '' }: KbdProps) {
  const apple = useApplePlatform()

  const faces = keys.map((key) => {
    const face = KEY_FACES[key.toLowerCase()]
    if (face) {
      return {
        printed: apple ? face.mac : face.other,
        spoken: apple ? (face.spokenMac ?? face.spoken) : face.spoken,
      }
    }
    const printed = key.length === 1 ? key.toUpperCase() : key
    return { printed, spoken: printed }
  })

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {faces.map((face, index) => (
        // Index keys are safe here: the list is static per render and carries
        // no state — a chip is only its text.
        <kbd key={index} className="kbd" aria-hidden="true">
          {face.printed}
        </kbd>
      ))}
      <span className="sr-only">{faces.map((face) => face.spoken).join(' ')}</span>
    </span>
  )
}
