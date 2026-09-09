// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  ColumnFilter,
  ColumnFilterList,
  ColumnFilterRange,
} from '@/components/ui/Controls'

/**
 * The column filters the Тасдиклаш board grew on 2026-09-09.
 *
 * Asked for by name: «jadvaldagi roplar ustuniga exceldagi filtrga oʻxshab
 * filtr beriladigan boʻlsin». Three behaviours here are decisions rather than
 * defaults, and each is invisible when it regresses — the control still opens,
 * still shows the right values, and still applies something.
 *
 *   1. The range COMMITS ON SUBMIT. Every other filter on this dashboard
 *      applies as you touch it, which is right for a checkbox and wrong for a
 *      number: «1», «10», «100» are three complete requests on the way to
 *      1 000 000, and a server answers all of them.
 *   2. A bound of exactly ZERO survives. `if (min)` is the natural way to
 *      write this and it silently drops the one query that finds the orders
 *      somebody saved without a price.
 *   3. The list is only searchable once it stops being scannable, so the
 *      common case does not pay a line of chrome for a field it does not need.
 */

describe('a column opens its own filter', () => {
  it('shows the panel on the funnel and takes it back on Escape', () => {
    render(
      <ColumnFilter label="РЕГИОН" active={false}>
        {() => <p>ichida</p>}
      </ColumnFilter>,
    )

    const trigger = screen.getByRole('button', { name: 'РЕГИОН — filtr' })
    expect(screen.queryByText('ichida')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)
    expect(screen.getByText('ichida')).toBeTruthy()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    // The same dismissal the toolbar's MultiSelect has, so learning one is
    // learning both.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('ichida')).toBeNull()
  })

  it('does not render its children while it is shut', () => {
    const children = vi.fn(() => <p>ichida</p>)

    render(
      <ColumnFilter label="РЕГИОН" active={false}>
        {children}
      </ColumnFilter>,
    )

    /*
      THE РЕГИОН OPTIONS HANG OFF THIS. Their list is a component that fetches
      on mount, so «mounted» has to mean «the reader asked to see it» — if the
      children rendered while shut, every board load would fetch an option list
      nobody opened.
    */
    expect(children).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'РЕГИОН — filtr' }))
    expect(children).toHaveBeenCalled()
  })
})

describe('the value list', () => {
  const OPTIONS = [
    { id: 'Sevinch', label: 'Sevinch', count: 135 },
    { id: 'Azizbek', label: 'Azizbek', count: 116 },
  ]

  it('adds and removes one value at a time', () => {
    const onChange = vi.fn()
    render(<ColumnFilterList options={OPTIONS} selected={['Sevinch']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /Azizbek/ }))
    expect(onChange).toHaveBeenLastCalledWith(['Sevinch', 'Azizbek'])

    fireEvent.click(screen.getByRole('checkbox', { name: /Sevinch/ }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('offers no search box for a list you can already see', () => {
    const { rerender } = render(
      <ColumnFilterList options={OPTIONS} selected={[]} onChange={() => {}} />,
    )
    expect(screen.queryByRole('searchbox')).toBeNull()

    // Twelve is where a list stops being scannable — see SEARCHABLE_FROM.
    rerender(
      <ColumnFilterList
        options={Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, label: `Region ${i}` }))}
        selected={[]}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('searchbox')).toBeTruthy()
  })

  it('says it is loading rather than saying there is nothing', () => {
    render(<ColumnFilterList options={[]} selected={[]} onChange={() => {}} loading />)

    // An empty list and a list still coming look identical otherwise, and the
    // second one is a reader waiting for something that never arrives.
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.queryByText('Hech narsa topilmadi')).toBeNull()
  })
})

describe('the summa range', () => {
  it('applies once, on submit, and not on every digit', () => {
    const onApply = vi.fn()
    render(<ColumnFilterRange unit="soʻm" onApply={onApply} />)

    const from = screen.getByLabelText('Eng kam summa')
    fireEvent.change(from, { target: { value: '1' } })
    fireEvent.change(from, { target: { value: '10' } })
    fireEvent.change(from, { target: { value: '1000000' } })

    // Three complete numbers typed, and not one request made.
    expect(onApply).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Qoʻllash' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({ min: 1_000_000, max: undefined })
  })

  it('keeps a bound of exactly zero', () => {
    const onApply = vi.fn()
    render(<ColumnFilterRange unit="soʻm" onApply={onApply} />)

    fireEvent.change(screen.getByLabelText('Eng koʻp summa'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Qoʻllash' }))

    // `if (max)` would drop this, and with it the only way to find the orders
    // the portal recorded without a price.
    expect(onApply).toHaveBeenCalledWith({ min: undefined, max: 0 })
  })

  it('takes either end on its own', () => {
    const onApply = vi.fn()
    render(<ColumnFilterRange unit="soʻm" onApply={onApply} />)

    fireEvent.change(screen.getByLabelText('Eng kam summa'), { target: { value: '500000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Qoʻllash' }))

    // «Everything over half a million» is the ask this column actually gets;
    // demanding a ceiling would make the reader invent one.
    expect(onApply).toHaveBeenCalledWith({ min: 500_000, max: undefined })
  })

  it('reads a figure pasted with the separators the column prints', () => {
    const onApply = vi.fn()
    render(<ColumnFilterRange unit="soʻm" onApply={onApply} />)

    // The column prints «1,240,000», and copying it back in is the obvious
    // move. `Number('1,240,000')` is NaN, so the separators come out first.
    fireEvent.change(screen.getByLabelText('Eng kam summa'), { target: { value: '1,240,000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Qoʻllash' }))

    expect(onApply).toHaveBeenCalledWith({ min: 1_240_000, max: undefined })
  })

  it('offers Tozalash only when there is something to clear', () => {
    const onApply = vi.fn()
    const { rerender } = render(<ColumnFilterRange unit="soʻm" onApply={onApply} />)
    expect(screen.queryByRole('button', { name: 'Tozalash' })).toBeNull()

    rerender(<ColumnFilterRange unit="soʻm" min={1_000_000} onApply={onApply} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tozalash' }))
    expect(onApply).toHaveBeenCalledWith({})
  })
})
