// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PeriodFilter } from '@/components/layout/PeriodFilter'
import { MultiSelect, SegmentedControl } from '@/components/ui/Controls'
import { BrandSwitch } from '@/features/shared/BrandSwitch'

/**
 * Every glass control keeps its keyboard focus ring.
 *
 * The ring is a box-shadow (`.focusable:focus-visible`), and so is a lit chip's
 * highlight. An inline `style.boxShadow` — `none` included — beats any
 * stylesheet rule, so while the period presets, the custom-period trigger, the
 * picker's mode tabs, the MultiSelect trigger, SegmentedControl and
 * BrandSwitch wrote their shadow inline, none of them showed focus to a
 * keyboard reader. The shadow is a layered Tailwind class now, which the
 * unlayered ring outranks; this renders each control in both of its states and
 * holds every `.focusable` in it to no inline box-shadow.
 */

const CHIP = 'shadow-[var(--glass-highlight),var(--shadow-card)]'
const LIT = 'shadow-[var(--glass-highlight)]'

afterEach(cleanup)

function noInlineShadow(root: ParentNode = document.body) {
  const focusables = [...root.querySelectorAll<HTMLElement>('.focusable')]
  expect(focusables.length).toBeGreaterThan(0)
  for (const element of focusables) expect(element.style.boxShadow, element.outerHTML.slice(0, 120)).toBe('')
}

describe('a glass control’s highlight never hides the focus ring', () => {
  it('the period presets, the custom-period trigger and the picker’s mode tabs', () => {
    render(<PeriodFilter value="today" onChange={() => {}} />)
    noInlineShadow()
    // The lit preset still wears its chip, by class.
    expect(screen.getByRole('button', { pressed: true }).className).toContain(CHIP)
    expect(screen.getByRole('button', { expanded: false }).className).toContain(LIT)

    fireEvent.click(screen.getByRole('button', { expanded: false }))
    noInlineShadow()
    expect(screen.getByRole('tab', { selected: true }).className).toContain(CHIP)
    for (const tab of screen.getAllByRole('tab', { selected: false })) expect(tab.className).not.toContain(CHIP)
  })

  it('the custom-period trigger while a custom window is on', () => {
    render(<PeriodFilter value="custom" from="2026-10-01" to="2026-10-05" onChange={() => {}} />)
    noInlineShadow()
    expect(screen.getByRole('button', { expanded: false }).className).not.toContain(LIT)
  })

  it('the MultiSelect trigger, raised and sunk', () => {
    const options = [{ id: 'a', label: 'A' }]
    const { unmount } = render(<MultiSelect label="Status" options={options} selected={[]} onChange={() => {}} />)
    noInlineShadow()
    expect(screen.getByRole('button', { name: /Status/ }).className).toContain(LIT)
    unmount()

    render(<MultiSelect label="Status" options={options} selected={['a']} onChange={() => {}} />)
    noInlineShadow()
    expect(screen.getByRole('button', { name: /Status/ }).className).not.toContain(LIT)
  })

  it('SegmentedControl and BrandSwitch', () => {
    render(
      <>
        <SegmentedControl
          value="a"
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
          onChange={() => {}}
          ariaLabel="Seg"
        />
        <BrandSwitch
          value="all"
          options={[
            { value: 'all', label: 'Hammasi' },
            { value: 'Collagen', label: 'Collagen' },
          ]}
          onChange={() => {}}
        />
      </>,
    )
    noInlineShadow()
    const pressed = screen.getAllByRole('button', { pressed: true })
    expect(pressed).toHaveLength(2)
    for (const chip of pressed) expect(chip.className).toContain(CHIP)
    for (const chip of screen.getAllByRole('button', { pressed: false })) expect(chip.className).not.toContain(CHIP)
  })
})
