// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { DataTable, type Column } from '@/components/ui/DataTable'

/**
 * SCROLLING MARKS THE BOX AND REDRAWS NO ROW.
 *
 * The header's floating shadow and the pinned column's divider follow the
 * scroll position. Held in React state, the first wheel tick, the first
 * sideways drag and every return to an edge re-ran every row's and every
 * cell's `render` — thousands of cells on Roistat's «Продавец» or Sverka's
 * 200 rows, a hitch exactly as the scroll began. They are attributes on the
 * scroll box now (`[data-scrolled]`, `[data-scrolled-x]`), read by globals.css,
 * as the «RNP» sheet's `markScrolledX` already did.
 */

beforeAll(() => {
  // The pinned columns measure their offsets with one; jsdom has none.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(cleanup)

interface Row {
  readonly name: string
}

function table(stickyColumns = 0) {
  let renders = 0
  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'NOMI',
      rowHeader: true,
      render: (row) => {
        renders += 1
        return row.name
      },
    },
    { key: 'more', header: 'YANA', render: (row) => row.name.length },
  ]
  const rows = ['birinchi', 'ikkinchi', 'uchinchi'].map((name) => ({ name }))
  const { container } = render(
    <DataTable columns={columns} rows={rows} rowKey={(row) => row.name} status="ready" stickyColumns={stickyColumns} />,
  )
  const box = container.querySelector('table')!.parentElement!
  return { box, renders: () => renders }
}

/** Where the box has been scrolled to — jsdom lays nothing out, so it is set by hand. */
function scrollTo(box: HTMLElement, top: number, left = 0) {
  Object.defineProperty(box, 'scrollTop', { configurable: true, get: () => top })
  Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => left })
  fireEvent.scroll(box)
}

describe('DataTable while scrolling', () => {
  it('marks the box when the rows move under the header, and clears it back at the top, with no re-render', () => {
    const { box, renders } = table()
    const before = renders()

    scrollTo(box, 40)
    expect(box.hasAttribute('data-scrolled')).toBe(true)

    scrollTo(box, 0)
    expect(box.hasAttribute('data-scrolled')).toBe(false)

    expect(renders()).toBe(before)
  })

  it('marks the sideways scroll only where a column is pinned', () => {
    const pinned = table(1)
    scrollTo(pinned.box, 0, 30)
    expect(pinned.box.hasAttribute('data-scrolled-x')).toBe(true)
    scrollTo(pinned.box, 0, 0)
    expect(pinned.box.hasAttribute('data-scrolled-x')).toBe(false)
    cleanup()

    const plain = table()
    scrollTo(plain.box, 0, 30)
    expect(plain.box.hasAttribute('data-scrolled-x')).toBe(false)
  })
})
