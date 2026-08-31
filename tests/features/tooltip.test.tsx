// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Tooltip } from '@/components/ui/Tooltip'

/**
 * A tip with nothing to say.
 *
 * The case that reached production: the sidebar computes its content —
 * `collapsed ? label : ''` — and an empty string still opened a bubble, which
 * on screen is a small dark box torn out of the menu item under the pointer.
 */

describe('a tooltip with no content', () => {
  it('renders its child alone, with no wrapper of its own', () => {
    const { container } = render(
      <Tooltip content="">
        <button type="button">KPI rejalari</button>
      </Tooltip>,
    )

    // The child IS the root: no anchor span around it to shrink it to its
    // own text and cut a full-width row short.
    expect(container.firstElementChild?.tagName).toBe('BUTTON')
  })

  it('opens nothing on hover', () => {
    render(
      <Tooltip content="">
        <button type="button">KPI rejalari</button>
      </Tooltip>,
    )

    fireEvent.mouseEnter(screen.getByRole('button'))

    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('treats whitespace as nothing to say', () => {
    render(
      <Tooltip content="   ">
        <button type="button">KPI rejalari</button>
      </Tooltip>,
    )

    fireEvent.mouseEnter(screen.getByRole('button'))

    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('a tooltip that does have something to say', () => {
  it('still opens on hover', async () => {
    render(
      <Tooltip content="KPI rejalari" delay={0}>
        <button type="button" aria-label="KPI" />
      </Tooltip>,
    )

    fireEvent.mouseEnter(screen.getByRole('button').parentElement!)

    expect((await screen.findByRole('tooltip')).textContent).toBe('KPI rejalari')
  })
})
