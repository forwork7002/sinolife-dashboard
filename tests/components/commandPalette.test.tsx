// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { CommandPalette, type CommandGroup } from '@/components/ui/CommandPalette'

/**
 * The ⌘K widget on its own: what a STALE group is.
 *
 * A stale group is the previous search's hits, kept on screen while the next
 * lookup runs so the list does not blink empty. Selectable, they were what
 * Enter opened — a phone number pasted and entered at once opened the
 * customer of the PREVIOUS lookup.
 */

beforeAll(() => {
  // The palette keeps the selection in view; jsdom has no layout to scroll.
  Element.prototype.scrollIntoView = () => {}
})

afterEach(cleanup)

const box = () => screen.getByRole('combobox')

function open(groups: readonly CommandGroup[]) {
  render(<CommandPalette open onClose={() => {}} groups={groups} busy />)
}

describe('a stale group', () => {
  it('is drawn but never run — not by Enter, not by a click', () => {
    const opened = vi.fn()
    open([
      {
        label: 'Buyurtmalar',
        prefiltered: true,
        stale: true,
        items: [{ id: 'deal-d1', label: 'Dilnoza', hint: 'ID 925842', onSelect: opened }],
      },
    ])

    const row = screen.getByRole('option', { name: /Dilnoza/ })
    expect(row.getAttribute('aria-disabled')).toBe('true')
    // The kept rows fill the list: no «Qidirilmoqda…» over them.
    expect(screen.queryByText('Qidirilmoqda…')).toBeNull()

    fireEvent.keyDown(box(), { key: 'Enter' })
    fireEvent.click(row)
    expect(opened).not.toHaveBeenCalled()
    expect(screen.getByText('0 ta')).toBeTruthy()
  })

  it('leaves the live rows walkable, and Enter runs the first of them', () => {
    const stale = vi.fn()
    const live = vi.fn()
    open([
      { label: 'Buyurtmalar', prefiltered: true, stale: true, items: [{ id: 'old', label: 'Dilnoza', onSelect: stale }] },
      { label: 'Boʻlimlar', items: [{ id: '/sverka', label: 'Sverka', onSelect: live }] },
    ])

    expect(screen.getByRole('option', { name: 'Sverka' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(live).toHaveBeenCalledTimes(1)
    expect(stale).not.toHaveBeenCalled()
  })
})
