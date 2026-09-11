// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataTable, type Column } from '@/components/ui/DataTable'

/**
 * `dragScroll` — grab the rows with the mouse and drag them sideways.
 *
 * Asked for on the confirmation queue on 2026-09-11 («mishka bilan oʻng
 * tomonga sursa oʻsha yerga qarab surilishi kerak»). What has to hold: the
 * rows follow the hand, a plain click and a mostly-vertical sweep do not move
 * anything, a press on a control is the control's, touch is left to the
 * browser, and the click that ends a drag does not open the row under it.
 *
 * jsdom lays nothing out, so the box's geometry is stubbed: 400px showing of
 * a 1 200px-wide table.
 */

interface Row {
  readonly id: string
}

const columns: Column<Row>[] = [
  { key: 'id', header: 'ID', render: (row) => row.id },
  { key: 'eye', header: 'KO‘Z', render: () => <button type="button">koʻrsatish</button> },
]

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1200)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
  // jsdom has no pointer capture at all.
  HTMLElement.prototype.setPointerCapture = () => {}
})

afterEach(() => vi.restoreAllMocks())

function table(onRowClick?: (row: Row) => void, dragScroll = true) {
  const view = render(
    <DataTable
      columns={columns}
      rows={[{ id: 'A1' }]}
      rowKey={(row) => row.id}
      status="ready"
      onRowClick={onRowClick}
      dragScroll={dragScroll}
    />,
  )
  const box = view.container.querySelector('table')!.parentElement as HTMLDivElement
  box.scrollLeft = 300
  return { ...view, box }
}

const mouse = { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1 }

function drag(target: Element, box: HTMLElement, dx: number, dy = 0) {
  fireEvent.pointerDown(target, { ...mouse, clientX: 200, clientY: 100 })
  fireEvent.pointerMove(box, { ...mouse, clientX: 200 + dx / 2, clientY: 100 + dy / 2 })
  fireEvent.pointerMove(box, { ...mouse, clientX: 200 + dx, clientY: 100 + dy })
  fireEvent.pointerUp(box, { ...mouse, buttons: 0, clientX: 200 + dx, clientY: 100 + dy })
}

describe('dragScroll', () => {
  it('moves the rows with the hand — right shows what is left, left shows what is right', () => {
    const { box, getByText } = table()
    drag(getByText('A1'), box, 120)
    expect(box.scrollLeft).toBe(180)
    drag(getByText('A1'), box, -250)
    expect(box.scrollLeft).toBe(430)
  })

  it('offers the grab cursor only when there is somewhere to drag to', () => {
    expect(table().box.style.cursor).toBe('grab')
  })

  it('leaves a mostly-vertical sweep and a small wobble alone', () => {
    const { box, getByText } = table()
    drag(getByText('A1'), box, 20, 60)
    drag(getByText('A1'), box, 3)
    expect(box.scrollLeft).toBe(300)
  })

  it('does not start from a control inside a cell', () => {
    const { box, getByText } = table()
    drag(getByText('koʻrsatish'), box, 120)
    expect(box.scrollLeft).toBe(300)
  })

  it('leaves touch to the browser', () => {
    const { box, getByText } = table()
    const touch = { ...mouse, pointerType: 'touch' }
    fireEvent.pointerDown(getByText('A1'), { ...touch, clientX: 200, clientY: 100 })
    fireEvent.pointerMove(box, { ...touch, clientX: 320, clientY: 100 })
    expect(box.scrollLeft).toBe(300)
  })

  it('swallows the click that ends a drag, and only that one', () => {
    vi.useFakeTimers()
    try {
      const open = vi.fn()
      const { box, getByText } = table(open)
      drag(getByText('A1'), box, 120)
      fireEvent.click(getByText('A1'))
      expect(open).not.toHaveBeenCalled()

      act(() => vi.runAllTimers())
      fireEvent.click(getByText('A1'))
      expect(open).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is off unless asked for', () => {
    const { box, getByText } = table(undefined, false)
    drag(getByText('A1'), box, 120)
    expect(box.scrollLeft).toBe(300)
    expect(box.style.cursor).toBe('')
  })
})
