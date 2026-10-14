// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('keeps «Qoʻllash» disabled until the field reads as a month, rather than pressable and silent', () => {
    const month = openMonth(vi.fn())
    const apply = () => screen.getByRole('button', { name: t.period.apply }) as HTMLButtonElement

    fireEvent.change(month, { target: { value: '' } })
    expect(apply().disabled).toBe(true)

    fireEvent.change(month, { target: { value: '2026-08' } })
    expect(apply().disabled).toBe(false)
  })

  it('keeps it disabled for a range starting before the year list, the fields’ floor', () => {
    render(<PeriodFilter value="today" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: `${t.period.label}: ${t.period.pick}` }))
    fireEvent.click(screen.getByRole('tab', { name: t.period.range }))
    const apply = () => screen.getByRole('button', { name: t.period.apply }) as HTMLButtonElement
    const floorYear = Number(new Date().getFullYear()) - 5

    fireEvent.change(screen.getByLabelText(t.period.from), { target: { value: '2010-01-01' } })
    fireEvent.change(screen.getByLabelText(t.period.to), { target: { value: '2026-08-01' } })
    expect(apply().disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(t.period.from), { target: { value: `${floorYear}-01-01` } })
    expect(apply().disabled).toBe(false)
  })

  it('applies a whole month it can read', () => {
    const onChange = vi.fn()
    const month = openMonth(onChange)

    fireEvent.change(month, { target: { value: '2026-08' } })
    fireEvent.click(screen.getByRole('button', { name: t.period.apply }))

    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', from: '2026-08-01', to: '2026-08-31' })
  })
})

/*
  THE WRONG DAY, 2026-10-14 (the user: «vaqtni tanlashda notoʻgʻri vaqt
  tanlanib ketmasligi zarur»). On a fixed clock — 14.10.2026, 12:00 in
  Tashkent — so «today» is a known day.
*/
describe('the period picker on a fixed day', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T07:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  const open = (props: { value: 'today' | 'custom'; from?: string; to?: string }, onChange = vi.fn()) => {
    render(<PeriodFilter {...props} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Davr|Sana/ }))
    return onChange
  }
  const apply = () => screen.getByRole('button', { name: t.period.apply }) as HTMLButtonElement

  it('reopens a range as the range, so «Qoʻllash» keeps it rather than its first day', () => {
    const onChange = open({ value: 'custom', from: '2026-10-01', to: '2026-10-10' })
    expect(screen.getByRole('tab', { name: t.period.range }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByLabelText(t.period.from) as HTMLInputElement).value).toBe('2026-10-01')
    expect((screen.getByLabelText(t.period.to) as HTMLInputElement).value).toBe('2026-10-10')
    fireEvent.click(apply())
    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', from: '2026-10-01', to: '2026-10-10' })
  })

  it('reopens a whole month as «Oy», this month to today as well, and one day as «Kun»', () => {
    open({ value: 'custom', from: '2026-09-01', to: '2026-09-30' })
    expect(screen.getByRole('tab', { name: t.period.month }).getAttribute('aria-selected')).toBe('true')
    cleanup()
    open({ value: 'custom', from: '2026-10-01', to: '2026-10-14' })
    expect(screen.getByRole('tab', { name: t.period.month }).getAttribute('aria-selected')).toBe('true')
    cleanup()
    open({ value: 'custom', from: '2026-10-07', to: '2026-10-07' })
    expect(screen.getByRole('tab', { name: t.period.day }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByLabelText(t.period.day) as HTMLInputElement).value).toBe('2026-10-07')
  })

  it('applies no day typed past today, nor a year typed halfway («0202»)', () => {
    const onChange = open({ value: 'today' })
    const day = screen.getByLabelText(t.period.day) as HTMLInputElement
    expect(day.value).toBe('2026-10-14')
    fireEvent.change(day, { target: { value: '2026-10-15' } })
    expect(apply().disabled).toBe(true)
    fireEvent.change(day, { target: { value: '0202-10-14' } })
    expect(apply().disabled).toBe(true)
    fireEvent.change(day, { target: { value: '2026-10-13' } })
    fireEvent.click(apply())
    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', from: '2026-10-13', to: '2026-10-13' })
  })

  it('names the year on the button for a window outside this one', () => {
    render(<PeriodFilter value="custom" from="2025-12-01" to="2026-01-14" onChange={vi.fn()} />)
    expect(screen.getByText('01.12.2025 – 14.01.2026')).toBeTruthy()
    cleanup()
    render(<PeriodFilter value="custom" from="2026-10-01" to="2026-10-10" onChange={vi.fn()} />)
    expect(screen.getByText('01.10 – 10.10')).toBeTruthy()
  })
})
