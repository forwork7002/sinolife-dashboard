'use client'

import Link from 'next/link'
import type { MouseEventHandler, ReactNode } from 'react'

/**
 * The button kit.
 *
 * Every ad-hoc `<button className="rounded-md border px-2.5 …">` on these
 * pages was a slightly different height, radius and hover — which is how an
 * interface stops feeling designed without any single button looking wrong.
 * One component, three variants, two heights, and the sweep replaces them all.
 *
 *   primary   — ink fill, inverted text. The one action a screen leads with;
 *               more than one per view and neither is primary.
 *   secondary — bordered raised surface. The workhorse: retry, apply, export.
 *   ghost     — transparent until hovered. Toolbar and inline actions that
 *               must not compete with the data beside them.
 *   danger    — a red tint. For the control that TAKES AWAY what the reader
 *               set — «Filtrlarni tozalash». As a ghost it was grey text in
 *               a row of controls and the client could not find it
 *               (2026-09-11: «koʻrinmay qolayapti… qizil qilib»). It only
 *               ever appears when there is something to clear, so it may be
 *               loud.
 *
 * Colour states are Tailwind arbitrary-value classes rather than inline
 * styles, because an inline `background` would beat the `hover:` class and
 * the button would never respond. Everything reads tokens; there is not a
 * literal colour in the file.
 *
 * `href` turns the same visual into a `<Link>`. A link styled as a button is
 * honest here — navigation presented as an action — while a button that fakes
 * navigation with router.push in onClick would lose middle-click, cmd-click
 * and the status-bar preview.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface BaseProps {
  readonly variant?: Variant
  /** sm = 28px, md = 32px. Two heights; a third is a design decision, not a prop. */
  readonly size?: Size
  /** Leading glyph slot — pass an `Icons.tsx` glyph; it inherits the text ink. */
  readonly icon?: ReactNode
  readonly className?: string
  readonly children: ReactNode
  readonly 'aria-label'?: string
}

interface AsButtonProps extends BaseProps {
  /** Discriminant: absent means a real `<button>`. */
  readonly href?: undefined
  readonly type?: 'button' | 'submit'
  readonly disabled?: boolean
  /**
   * For a button that TOGGLES something rather than doing it once.
   *
   * Buttons here are enumerated, never spread: every attribute this component
   * forwards is written out below, so a prop that is not listed is silently
   * dropped rather than landing on the DOM by accident. That is the right
   * default, and it is why this one has to be declared to exist.
   *
   * A pressed state is not decoration. `variant="primary"` says «on» to
   * somebody looking at the screen and says nothing at all to somebody
   * listening to it, and a toggle whose label does not change — which is the
   * correct design, so the control does not move under the pointer — has
   * nothing else left to announce with.
   */
  readonly 'aria-pressed'?: boolean
  readonly onClick?: MouseEventHandler<HTMLButtonElement>
}

interface AsLinkProps extends BaseProps {
  readonly href: string
  readonly onClick?: MouseEventHandler<HTMLAnchorElement>
}

export type ButtonProps = AsButtonProps | AsLinkProps

const VARIANT_CLASSES: Record<Variant, string> = {
  /*
    Hover mixes the fill toward the surface rather than dropping opacity:
    opacity would dim the label with it, and a translucent primary button over
    a chart would let the gridlines show through the fill.
  */
  primary: [
    'bg-[var(--ink-primary)] text-[var(--surface)]',
    'hover:bg-[color-mix(in_oklab,var(--ink-primary)_85%,var(--surface))]',
    'active:bg-[color-mix(in_oklab,var(--ink-primary)_72%,var(--surface))]',
  ].join(' '),
  /*
    A raised chip of glass («Shisha»): the --glass-raised fill, the glass edge
    and the lit top, like the segmented control's chip. The hover lays the
    glass wash OVER the fill as an image — darker in light, lighter in dark,
    so it reads as "toward the cursor" in both without a per-theme branch —
    and a press sinks the button into the well a track is made of. Both are
    translucent: an opaque --grid hover read as a hole in the glass.
  */
  secondary: [
    'border border-[var(--glass-edge)] bg-[var(--glass-raised)] text-[var(--ink-primary)] shadow-[var(--glass-highlight)]',
    'hover:bg-[image:linear-gradient(var(--glass-hover),var(--glass-hover))]',
    'active:bg-[var(--glass-well)]',
  ].join(' '),
  ghost: [
    'bg-transparent text-[var(--ink-secondary)]',
    'hover:bg-[var(--glass-hover)] hover:text-[var(--ink-primary)]',
    'active:bg-[var(--glass-well)]',
  ].join(' '),
  /*
    A tint and a ring of --status-critical, deepening on hover — never a solid
    red fill, which would out-shout the one primary action a screen may have.
    The text is the token itself, and the tint is mixed into the glass card
    rather than into nothing: a red veil over bare glass sat on whatever the
    backdrop lit, and on the pooled light page the label read 3.94:1 (3.45
    hovered). On 8 / 12 / 16% of the glass card it holds 4.5:1 at rest,
    hovered and pressed over every sample of the backdrop in both themes
    (glassContrast.test.ts).
  */
  danger: [
    'border border-[color:color-mix(in_oklab,var(--status-critical)_45%,transparent)]',
    'bg-[color-mix(in_oklab,var(--status-critical)_8%,var(--glass-card))] text-[var(--status-critical)]',
    'hover:bg-[color-mix(in_oklab,var(--status-critical)_12%,var(--glass-card))]',
    'active:bg-[color-mix(in_oklab,var(--status-critical)_16%,var(--glass-card))]',
  ].join(' '),
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-8 gap-1.5 px-3 text-[13px]',
}

export function Button(props: ButtonProps) {
  const { variant = 'secondary', size = 'md', icon, className = '', children } = props

  const classes = [
    // `.focusable` is the house double-ring; `disabled:pointer-events-none`
    // also silences the hover classes, so a disabled button cannot glow.
    'focusable inline-flex shrink-0 select-none items-center justify-center',
    'rounded-[var(--radius-panel-sm)] font-medium whitespace-nowrap',
    'transition-colors duration-150 ease-[var(--ease-out)]',
    'disabled:pointer-events-none disabled:opacity-45',
    SIZE_CLASSES[size],
    VARIANT_CLASSES[variant],
    className,
  ].join(' ')

  const content = (
    <>
      {icon && (
        // Decoration: the label states the action, the glyph just anchors it.
        <span aria-hidden="true" className="-ml-0.5 inline-flex shrink-0 items-center">
          {icon}
        </span>
      )}
      {children}
    </>
  )

  if (props.href !== undefined) {
    return (
      <Link
        href={props.href}
        onClick={props.onClick}
        aria-label={props['aria-label']}
        className={classes}
      >
        {content}
      </Link>
    )
  }

  return (
    <button
      // Default "button", never "submit": an unmarked button inside any form
      // would otherwise submit it, which is how a filter panel loses its state.
      type={props.type ?? 'button'}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props['aria-label']}
      aria-pressed={props['aria-pressed']}
      className={classes}
    >
      {content}
    </button>
  )
}
