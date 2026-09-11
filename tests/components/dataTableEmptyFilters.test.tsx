// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DataTable, type Column } from '@/components/ui/DataTable'

/**
 * An empty table keeps its header when its columns carry filters.
 *
 * Seen on the confirmation queue on 2026-09-11: a РЕГИОН filter that matched
 * nothing this month returned zero rows, DataTable returned its bare empty
 * state, and the funnels went with the header — a board saying «clear the
 * filters» with the control that set them no longer on screen. Every table
 * WITHOUT a column filter must keep the bare state, which is the other half.
 */

interface Row {
  readonly name: string
}

const plain: Column<Row> = { key: 'name', header: 'NOMI', render: (row) => row.name }
const filtered: Column<Row> = { ...plain, filter: <button type="button">NOMI — filtr</button> }

describe('an empty table', () => {
  it('keeps the header, and its filter, when a column can be filtered', () => {
    render(
      <DataTable columns={[filtered]} rows={[]} rowKey={(r) => r.name} status="ready" emptyTitle="Topilmadi" />,
    )

    expect(screen.getByRole('columnheader', { name: /NOMI/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'NOMI — filtr' })).toBeTruthy()
    expect(screen.getByText('Topilmadi')).toBeTruthy()
  })

  it('is the bare empty state everywhere else', () => {
    render(
      <DataTable columns={[plain]} rows={[]} rowKey={(r) => r.name} status="ready" emptyTitle="Topilmadi" />,
    )

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('Topilmadi')).toBeTruthy()
  })
})
