// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PeriodFilter } from '@/components/layout/PeriodFilter'
import { t } from '@/lib/messages'

/**
 * A MONTH FIELD HALF TYPED OR CLEARED APPLIES NOTHING.
 *
 * Firefox and Safari on a desk draw `<input type="month">` as plain text, so
 * «2026-9» was applied as `from=2026-9-01` — a 400 on every request, then
 * remembered and carried on every sidebar link — and «09.2026» or an emptied
 * field threw a RangeError inside the click handler. jsdom empties a month
 * field it cannot read, which is the emptied case.
 */

afterEach(cleanup)

function openMonth(onChange: () => void) {
  render(<PeriodFilter value="today" onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: `${t.period.label}: ${t.period.pick}` }))
  fireEvent.click(screen.getByRole('tab', { name: t.period.month }))
  return screen.getByLabelText(t.period.month) as HTMLInputElement
}

describe('the period picker', () => {
  it('applies nothing, and throws nothing, from an emptied month field', () => {
    const onChange = vi.fn()
    const month = openMonth(onChange)

    fireEvent.change(month, { target: { value: '' } })
    // A throw inside a click handler is reported on `window`, not to the caller.
    const thrown: unknown[] = []
    const report = (event: ErrorEvent) => {
      thrown.push(event.error)
      event.preventDefault()
    }
    window.addEventListener('error', report)
    fireEvent.click(screen.getByRole('button', { name: t.period.apply }))
    window.removeEventListener('error', report)

    expect(thrown).toEqual([])
    expect(onChange).not.toHaveBeenCalled()
    // Still open, so the reader can finish the month they were typing.
    expect(screen.getByRole('dialog', { name: t.period.pick })).toBeTruthy()
  })

  it('applies a whole month it can read', () => {
    const onChange = vi.fn()
    const month = openMonth(onChange)

    fireEvent.change(month, { target: { value: '2026-08' } })
    fireEvent.click(screen.getByRole('button', { name: t.period.apply }))

    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', from: '2026-08-01', to: '2026-08-31' })
  })
})
