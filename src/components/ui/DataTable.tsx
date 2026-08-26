'use client'

import { useState, type ReactNode } from 'react'

import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states/States'

/**
 * Generic data table.
 *
 * Deliberately not a grid library. What these pages need is sortable headers,
 * alignment and a scroll container — a full grid would add a large dependency
 * and take over sorting and pagination, both of which happen server-side here
 * because the result sets are larger than the page.
 *
 * Wide tables scroll inside their own container so the page body never scrolls
 * horizontally on a laptop.
 */

export interface Column<T> {
  readonly key: string
  readonly header: string
  /** Column this maps to in the API's sort allowlist. Omit to disable sorting. */
  readonly sortKey?: string
  readonly align?: 'left' | 'right'
  /** Numbers that must line up vertically get tabular figures. */
  readonly numeric?: boolean
  readonly width?: string
  readonly render: (row: T) => ReactNode
}

interface DataTableProps<T> {
  readonly columns: readonly Column<T>[]
  readonly rows: readonly T[]
  readonly rowKey: (row: T) => string
  readonly status: 'loading' | 'error' | 'ready'
  readonly errorMessage?: string
  readonly onRetry?: () => void
  readonly onRowClick?: (row: T) => void
  readonly sort?: string
  readonly order?: 'asc' | 'desc'
  readonly onSort?: (sortKey: string) => void
  readonly emptyTitle?: string
  readonly emptyBody?: string
  readonly minWidth?: number
  /**
   * Rows shown before the rest go behind a disclosure.
   *
   * A table with no cap is a table that trusts its data source to be small.
   * The leaderboard's was not: 288 employees produced a 17,400-pixel page —
   * seventeen metres of scroll on a ranking screen — and 162 of those rows
   * were all zeros. The employee list was 16,605px for the same reason.
   *
   * Undefined means no cap, which is right for a table whose length is bounded
   * by something real (twenty regions, nine pipelines).
   */
  readonly initialRows?: number
  /** Label for the disclosure, given the number of rows it hides. */
  readonly moreLabel?: (hidden: number) => string
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  status,
  errorMessage,
  onRetry,
  onRowClick,
  sort,
  order,
  onSort,
  emptyTitle,
  emptyBody,
  minWidth = 720,
  initialRows,
  moreLabel = (hidden) => `Yana ${hidden} ta qatorni koʻrsatish`,
}: DataTableProps<T>) {
  const [expanded, setExpanded] = useState(false)

  if (status === 'error') {
    return <ErrorState message={errorMessage} onRetry={onRetry} />
  }

  if (status === 'loading') {
    return (
      <div className="px-1 py-2">
        <LoadingSkeleton rows={6} />
      </div>
    )
  }

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} body={emptyBody} />
  }

  const capped = initialRows !== undefined && !expanded && rows.length > initialRows
  const visible = capped ? rows.slice(0, initialRows) : rows
  const hidden = rows.length - visible.length

  return (
    <>
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead>
          {/* Sunken, so a long table's header stays distinct from its rows
              without a heavier rule under it. */}
          <tr style={{ color: 'var(--ink-muted)', background: 'var(--surface-sunken)' }}>
            {columns.map((column) => {
              const sortable = Boolean(column.sortKey && onSort)
              const active = column.sortKey && sort === column.sortKey

              return (
                <th
                  key={column.key}
                  scope="col"
                  style={{ width: column.width }}
                  // aria-sort belongs on the header cell, not on the button
                  // inside it — the column is what is sorted, not the control.
                  aria-sort={
                    sortable
                      ? active
                        ? order === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                      : undefined
                  }
                  className={`px-2 pb-2 text-[11px] font-medium tracking-wide uppercase ${
                    column.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort!(column.sortKey!)}
                      className="inline-flex items-center gap-1 transition-colors hover:opacity-80"
                      style={{ color: active ? 'var(--ink-primary)' : 'inherit' }}
                    >
                      {column.header}
                      {/* The caret is only rendered for the active column;
                          showing one on every header is visual noise. */}
                      {active && (
                        <span aria-hidden="true">{order === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {visible.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter') onRowClick(row)
                    }
                  : undefined
              }
              className={`border-t transition-colors ${
                onRowClick ? 'cursor-pointer hover:bg-[var(--grid)]' : ''
              }`}
              style={{ borderColor: 'var(--border)' }}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-2 py-2.5 ${column.align === 'right' ? 'text-right' : ''} ${
                    column.numeric ? 'tabular' : ''
                  }`}
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {hidden > 0 && (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="focusable mt-2 w-full rounded-[var(--radius-panel-sm)] border py-2 text-xs font-medium transition-colors"
        style={{
          borderColor: 'var(--border)',
          color: 'var(--ink-secondary)',
          background: 'var(--surface-sunken)',
        }}
      >
        {moreLabel(hidden)}
      </button>
    )}
    </>
  )
}
