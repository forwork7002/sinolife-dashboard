// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/Button'

/**
 * `Button` forwards its attributes ONE BY ONE, and that is why this exists.
 *
 * The component does not spread its props onto the DOM — every attribute it
 * passes is written out in the JSX, which is the right default: it keeps
 * arbitrary attributes off the element and makes the contract readable. The
 * cost is that an attribute nobody listed is dropped in SILENCE. TypeScript is
 * happy, React is happy, the button works, and the only thing that changed is
 * that a screen reader is no longer told what state the control is in.
 *
 * That happened on 2026-09-09 to «Статистика» — a real toggle, styled
 * `variant="primary"` when on, which says «pressed» to a reader looking at the
 * screen and nothing at all to one listening to it. The label deliberately
 * does not change (a control that renames itself moves under the pointer), so
 * `aria-pressed` is the whole of what is left to announce with.
 */

describe('Button carries a toggle state', () => {
  it('puts aria-pressed on the element in both positions', () => {
    const { rerender } = render(<Button aria-pressed={false}>Статистика</Button>)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')

    rerender(<Button aria-pressed>Статистика</Button>)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })

  it('leaves the attribute off a button that is not a toggle', () => {
    render(<Button>Qoʻllash</Button>)

    // `aria-pressed="false"` on a plain button announces it as a toggle that
    // happens to be off, which is a different control from the one on screen.
    expect(screen.getByRole('button').hasAttribute('aria-pressed')).toBe(false)
  })
})
