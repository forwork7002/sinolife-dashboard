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

type Variant = 'primary' | 'secondary' | 'ghost'
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
    Hover steps to --grid — the mid-tone between surfaces — which is darker
    than the card in light mode and lighter than it in dark, so the state
    reads as "raised toward the cursor" in both without a per-theme branch.
  */
  secondary: [
    'border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--ink-primary)]',
    'hover:bg-[var(--grid)]',
    'active:bg-[var(--track)]',
  ].join(' '),
  ghost: [
    'bg-transparent text-[var(--ink-secondary)]',
    'hover:bg-[var(--grid)] hover:text-[var(--ink-primary)]',
    'active:bg-[var(--track)]',
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
      className={classes}
    >
      {content}
    </button>
  )
}
