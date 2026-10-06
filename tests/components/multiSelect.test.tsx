// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MultiSelect } from '@/components/ui/Controls'

/**
 * The toolbar's multi-select, drawn where nothing can cut it off or dim it.
 *
 * Its panel used to hang inside the page. `main` is `overflow-x: hidden`, so a
 * trigger near the right edge — the confirmation board's «Барча статус», last
 * in a right-aligned row — lost about 100px of its 240px list; and
 * `.page-container` dims to 60% while the data behind it is replaced, which
 * is exactly what ticking an option does, so the list went see-through over
 * the tiles mid-use. Both are properties of WHERE the panel sits and of the
 * arithmetic that places it; jsdom has no layout, so the rects are supplied.
 */

const OPTIONS = [
  { id: 'CONFIRM_NEW', label: 'Кутилмоқда' },
  { id: 'CONFIRMED', label: 'Тасдиқланди' },
]

/** The trigger's rect, as a layout engine would report it. */
function triggerAt(left: number, right: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        left,
        right,
        width: right - left,
        top: 100,
        bottom: 132,
        height: 32,
        x: left,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect,
  )
}

function viewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
}

function openIn(page: { selected?: string[]; onChange?: (ids: string[]) => void } = {}) {
  render(
    // The dimmed page the panel must not be part of.
    <div className="page-container" data-testid="page" style={{ opacity: 0.6 }}>
      <MultiSelect
        label="Барча статус"
        options={OPTIONS}
        selected={page.selected ?? []}
        onChange={page.onChange ?? (() => {})}
      />
    </div>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Барча статус/ }))
  return screen.getByRole('listbox')
}

afterEach(() => {
  vi.restoreAllMocks()
  viewport(1024)
})

describe('the MultiSelect panel', () => {
  it('is drawn outside the page, fixed, so neither main nor the dim can reach it', () => {
    triggerAt(100, 220)
    const panel = openIn()

    expect(screen.getByTestId('page').contains(panel)).toBe(false)
    expect(panel.closest('.page-container')).toBeNull()
    expect(panel.style.position).toBe('fixed')
    expect(panel.style.visibility).toBe('visible')
  })

  it('opens rightward under its trigger when the screen has the room', () => {
    viewport(1920)
    triggerAt(100, 220)
    const panel = openIn()

    expect(panel.style.left).toBe('100px')
    expect(panel.style.top).toBe('136px')
  })

  it('ends at the trigger’s right edge near the screen’s — the case that was cut off', () => {
    // «Барча статус» at the end of a right-aligned row on a 1600px window:
    // left-anchored, 240px from 1490 would run 130px past the edge.
    viewport(1600)
    triggerAt(1490, 1580)
    const panel = openIn()

    expect(panel.style.left).toBe(`${1580 - 240}px`)
  })

  it('stays 8px inside a phone however narrow the room', () => {
    viewport(200)
    triggerAt(20, 70)
    const panel = openIn()

    expect(panel.style.left).toBe('8px')
  })

  it('takes focus to the first option, not to the red clear above it, and gives it back on Escape', () => {
    triggerAt(100, 220)
    const panel = openIn({ selected: ['CONFIRMED'] })

    // With a selection the first control is «Tozalash»; a Space pressed on
    // arrival must not clear what the reader came to change.
    expect(document.activeElement).toBe(panel.querySelector('input[type="checkbox"]'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Барча статус/ }))
  })

  it('stays open while it is used, ticks what is pressed, and closes on a press outside', () => {
    triggerAt(100, 220)
    const onChange = vi.fn()
    openIn({ onChange })

    // Inside the panel is inside, though it is no longer in the trigger's box.
    const option = screen.getByRole('checkbox', { name: 'Тасдиқланди' })
    fireEvent.mouseDown(option)
    fireEvent.click(option)
    expect(onChange).toHaveBeenLastCalledWith(['CONFIRMED'])
    expect(screen.queryByRole('listbox')).not.toBeNull()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
