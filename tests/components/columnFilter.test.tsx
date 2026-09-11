// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

/**
 * WHICH SIDE THE PANEL HANGS FROM, and why it is measured.
 *
 * This shipped broken on 2026-09-09. The side was a fixed `right-0`, chosen
 * because two of the three columns are near the table's right edge — but the
 * panel hangs INSIDE the table's own `overflow-x: auto` scroll box, and РОП is
 * the LEFTMOST column. Right-anchored, its 240px panel opened leftward and the
 * container clipped it: measured on production at `left: -157` against a box
 * starting at 29, so 186px of 240 was simply not drawn. The list was correct
 * the whole time — the reader saw a sliver with a scrollbar in it and reported
 * the filter as broken, which it was.
 *
 * A fixed side cannot be right in any case, because the table scrolls
 * sideways: one column is near the left edge at one scroll position and near
 * the right edge at another.
 *
 * jsdom has no layout, so the rects are supplied. That is the honest way to
 * test this: the RULE is what regressed, and the rule is arithmetic over two
 * rectangles.
 */
describe('the panel opens on the side that has room', () => {
  const SCROLLER = 'data-scroller'

  /** Puts a trigger of the given span inside a clipping box of another. */
  function layout(trigger: { left: number; right: number }, box: { left: number; right: number }) {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const source = this.hasAttribute(SCROLLER) ? box : trigger
      return {
        left: source.left,
        right: source.right,
        width: source.right - source.left,
        top: 0,
        bottom: 0,
        height: 0,
        x: source.left,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect
    })
  }

  const openFilter = (label: string) =>
    render(
      // The inline overflow is what the component walks up to find; it does
      // not know about DataTable's class names, and must not.
      <div {...{ [SCROLLER]: '' }} style={{ overflowX: 'auto' }}>
        <ColumnFilter label={label} active={false}>
          {() => <p>ichida</p>}
        </ColumnFilter>
      </div>,
    )

  const panel = () => screen.getByRole('dialog')

  afterEach(() => vi.restoreAllMocks())

  it('opens leftward from a column near the right edge', () => {
    // СУММА at 1 700 in a box ending at 1 860: 240px would not fit rightward.
    layout({ left: 1690, right: 1706 }, { left: 29, right: 1860 })
    openFilter('СУММА')
    fireEvent.click(screen.getByRole('button', { name: 'СУММА — filtr' }))

    expect(panel().dataset.side).toBe('right')
  })

  it('opens rightward from the leftmost column — the case that shipped broken', () => {
    // РОП's funnel at 190 in a box starting at 29: right-anchored it would
    // begin at -50 and 79px of it would be clipped away.
    layout({ left: 174, right: 190 }, { left: 29, right: 1860 })
    openFilter('РОП')
    fireEvent.click(screen.getByRole('button', { name: 'РОП — filtr' }))

    expect(panel().dataset.side).toBe('left')
  })

  it('takes the roomier side when neither can hold the whole panel', () => {
    // A 300px box: 240 fits on neither side, so it leans to the larger gap
    // rather than picking a fixed one and losing more of the panel.
    layout({ left: 250, right: 266 }, { left: 29, right: 300 })
    openFilter('РЕГИОН')
    fireEvent.click(screen.getByRole('button', { name: 'РЕГИОН — filtr' }))

    // 237px leftward against 50px rightward.
    expect(panel().dataset.side).toBe('right')
  })
})

/**
 * THE PANEL LEAVES THE TABLE.
 *
 * Reported from production on 2026-09-11: «ROP filter qilsam eng tepadagi ustun
 * tagida boʻlib qolayapti». The panel hung inside the sticky header cell and
 * inside the table's scroll box. The cell is a stacking context, so the header
 * cells after it painted over the panel's top; the box clips, so with the board
 * filtered to one ROP — a one-row table — the fifteen-name list showed two.
 * Both are properties of WHERE the panel sits in the DOM, and that is what
 * these pin.
 */
describe('the panel is drawn outside the table', () => {
  const renderInTable = () =>
    render(
      <div data-testid="scroller" style={{ overflow: 'auto', maxHeight: 60 }}>
        <table>
          <thead>
            <tr>
              <th className="thead-sticky">
                <ColumnFilter label="РОП" active={false}>
                  {() => (
                    <>
                      <input aria-label="Roʻyxatdan qidirish" />
                      <label>
                        <input type="checkbox" /> Azizbek
                      </label>
                    </>
                  )}
                </ColumnFilter>
              </th>
            </tr>
          </thead>
        </table>
      </div>,
    )

  it('is not inside the header cell or the scroll box that clips it', () => {
    renderInTable()
    fireEvent.click(screen.getByRole('button', { name: 'РОП — filtr' }))

    const panel = screen.getByRole('dialog')
    expect(screen.getByTestId('scroller').contains(panel)).toBe(false)
    expect(panel.closest('th')).toBeNull()
    expect(panel.style.position).toBe('fixed')
  })

  it('stays open while it is used, and closes on a press outside', () => {
    renderInTable()
    fireEvent.click(screen.getByRole('button', { name: 'РОП — filtr' }))

    // Inside the panel is inside, even though it is no longer inside the
    // funnel's own box in the DOM.
    fireEvent.mouseDown(screen.getByRole('checkbox'))
    expect(screen.queryByRole('dialog')).not.toBeNull()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('takes focus into the panel and gives it back on Escape', () => {
    renderInTable()
    const trigger = screen.getByRole('button', { name: 'РОП — filtr' })
    fireEvent.click(trigger)

    // Portalled to the end of <body>, the panel is no longer next in the tab
    // order after its button — so focus is carried across by hand.
    expect(document.activeElement).toBe(screen.getByLabelText('Roʻyxatdan qidirish'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
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
