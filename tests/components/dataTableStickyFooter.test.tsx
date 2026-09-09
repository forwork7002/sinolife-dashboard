// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DataTable, type Column } from '@/components/ui/DataTable'

/**
 * `stickyLastRow` — the summary row pinned to the bottom of the scroll box.
 *
 * A SHARED COMPONENT WITH TWELVE CALL SITES, and nothing else in the suite
 * would name a regression in it. The Статистика panel's ЖАМИ row is the only
 * caller today: production carries fifteen (ROP) groups and a maximised 1080p
 * window fits about eleven rows, so the one figure the client asked for by
 * name would otherwise be the one below the fold.
 *
 * The class is asserted rather than the rendered position because jsdom has no
 * layout — `position: sticky` resolves to nothing measurable here. What CAN be
 * proved is the contract the CSS hangs off: which cells carry `.tfoot-sticky`,
 * and — the half that protects the other eleven tables — that no cell carries
 * it when the prop is absent.
 *
 * ON THE CELLS, NOT THE ROW. Sticky rendering on a `<tr>` is still uneven
 * across engines, which is why `.thead-sticky` sits on the header's cells too;
 * a test that accepted the class on either would let that regress silently.
 */

interface Row {
  readonly name: string
  readonly n: number
}

const COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'NOMI', rowHeader: true, render: (row) => row.name },
  { key: 'n', header: 'SONI', align: 'right', numeric: true, render: (row) => String(row.n) },
]

const ROWS: Row[] = [
  { name: 'birinchi', n: 1 },
  { name: 'ikkinchi', n: 2 },
  { name: 'jami', n: 3 },
]

/** Every cell of the row whose row-header reads `name`, `<th>` included. */
function cellsOf(name: string): Element[] {
  const row = screen.getByRole('row', { name: new RegExp(name) })
  return Array.from(row.querySelectorAll('th, td'))
}

const sticky = (cells: Element[]) => cells.filter((c) => c.classList.contains('tfoot-sticky'))

describe('DataTable pins a summary row to the bottom', () => {
  it('puts tfoot-sticky on every cell of the last row and on no other', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.name}
        status="ready"
        stickyLastRow
      />,
    )

    // Both cells, so the pinned backgrounds are contiguous and read as a band.
    expect(sticky(cellsOf('jami'))).toHaveLength(2)
    expect(sticky(cellsOf('birinchi'))).toHaveLength(0)
    expect(sticky(cellsOf('ikkinchi'))).toHaveLength(0)

    // The header keeps its own class and does not borrow the footer's.
    const header = screen.getByRole('row', { name: /NOMI/ })
    expect(sticky(Array.from(header.querySelectorAll('th')))).toHaveLength(0)
  })

  it('leaves every table that did not ask for it byte-identical', () => {
    const { container } = render(
      <DataTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.name} status="ready" />,
    )

    /*
      THIS IS THE ASSERTION THAT PROTECTS THE OTHER ELEVEN CALL SITES. The prop
      is optional and read as `=== true`, so an undefined must reach exactly the
      markup that shipped before it existed.
    */
    expect(container.querySelectorAll('.tfoot-sticky')).toHaveLength(0)
  })

  it('pins nothing while initialRows has the table capped', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.name}
        status="ready"
        stickyLastRow
        initialRows={2}
      />,
    )

    /*
      `slice(0, initialRows)` takes from the FRONT, so under a cap the last
      VISIBLE row is an ordinary data row — «ikkinchi» here. Pinning it would
      put a lie exactly where the reader has been taught to find the total.
    */
    expect(screen.queryByText('jami')).toBeNull()
    expect(sticky(cellsOf('ikkinchi'))).toHaveLength(0)
  })
})
