import type { SelectHTMLAttributes } from 'react'

/**
 * The native single-choice picker, dressed as a control.
 *
 * NATIVE ON PURPOSE: these lists are one choice among a dozen or so names,
 * and the platform's own select brings type-to-find, the phone's wheel and
 * screen-reader behaviour for free (see RopPicker for the longer argument).
 * What it did not bring was the house look — four sites drew four selects:
 * 28 and 32px tall, 6 and 8px corners, `--border` on `--surface` with no focus
 * ring at two of them.
 *
 * So: the controls' one radius and their heights (32px on a desk; `touch` is
 * 44px under a thumb, as RNP's toolbar and Roistat's phone sort need), the
 * strong edge a bordered control keeps, and `.focusable`. The ground is the
 * OPAQUE raised surface, not the glass well an input wears: a native list
 * paints its options on the select's own background on some platforms, and
 * over a translucent one the open list would show the page through it.
 *
 * `className` is for width and placement only; the look is this file's.
 */
export function Select({
  height = 'md',
  className = '',
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'style'> & {
  height?: 'md' | 'touch'
  className?: string
}) {
  const size = height === 'touch' ? 'h-11 text-[13px] sm:h-8 sm:text-xs' : 'h-8 text-xs'
  return (
    <select
      {...props}
      className={`focusable rounded-[var(--radius-panel-sm)] border px-2 disabled:opacity-50 ${size} ${className}`}
      style={{
        background: 'var(--surface-raised)',
        borderColor: 'var(--border-strong)',
        color: 'var(--ink-primary)',
      }}
    >
      {children}
    </select>
  )
}
