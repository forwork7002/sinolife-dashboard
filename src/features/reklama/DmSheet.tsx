'use client'

import { EmptyState } from '@/components/states/States'
import { formatUsd, rnpNumber, rnpPercent } from '@/features/rnp/rnpFigures'
import { PRODUCT_TONE } from '@/features/target/targetTheme'

import type { DmBlockDto, DmCellsDto } from './reklamaApi'
import { type Status, muted } from './reklamaUi'

/**
 * The «DM» sheet's day grid, as the client keeps it: a date column, then
 * «Итог» and every page side by side, each «Кол лид · Кол квал · Квал % ·
 * Реклама · Цена за квал», the period's total above the days, the blocks
 * parted by a thick bar (the sheet's orange column).
 *
 * Every figure is the server's — the page totals and «Итог» are never the
 * days re-added here, so this grid and the page table above it agree.
 */

const COLUMNS = ['Кол лид', 'Кол квал', 'Квал %', 'Реклама', 'Цена за квал'] as const

const COLUMN_HINT: Record<(typeof COLUMNS)[number], string> = {
  'Кол лид': 'Sahifaning Bitrix24 dagi Регистрация leadlari',
  'Кол квал': 'Ulardan «Сделка успешна» boʻlgani',
  'Квал %': 'Кол квал ÷ Кол лид',
  Реклама: 'Meta DM kampaniyalari sarfi, vakansiyasiz',
  'Цена за квал': 'Реклама ÷ Кол квал',
}

/** The sheet's orange divider, in a token that reads in both themes. */
const DIVIDER = '4px solid var(--status-warning)'
const HEAD_TINT = 'color-mix(in oklab, var(--accent) 10%, var(--surface-raised))'
const TOTAL_TINT = 'color-mix(in oklab, var(--status-warning) 16%, var(--surface-raised))'
const DATE_TINT = 'color-mix(in oklab, var(--accent) 6%, var(--surface-raised))'

interface Block {
  readonly key: string
  readonly name: string
  readonly tone: string | null
  readonly total: DmCellsDto
  readonly byDate: ReadonlyMap<string, DmCellsDto>
}

export function DmSheet({ dm, status }: { dm: DmBlockDto | undefined; status: Status }) {
  if (status === 'loading' || !dm) {
    return (
      <div className="px-5 pb-5">
        <div className="skeleton h-[28rem] rounded" />
      </div>
    )
  }
  if (dm.days.length === 0) {
    return (
      <div className="px-5 pb-5">
        <EmptyState title="Bu davrda maʼlumot yoʻq" />
      </div>
    )
  }

  const blocks: Block[] = [
    { key: 'total', name: 'Итог', tone: null, total: dm.total, byDate: new Map(dm.days.map((d) => [d.date, d])) },
    ...dm.pages.map((p) => ({
      key: p.key,
      name: p.name,
      tone: PRODUCT_TONE[p.product],
      total: p.total,
      byDate: new Map(p.days.map((d) => [d.date, d])),
    })),
  ]

  return (
    /* A year's window is ~365 rows: the days scroll under the pinned headings, the date column stays put sideways. */
    <div className="max-h-[70dvh] overflow-auto border-t border-[var(--border)]">
      <table aria-label="DM — kunlik, sahifalar yonma-yon" className="border-separate border-spacing-0 text-[12.5px] tabular">
        <thead className="sticky top-0 z-[2]" style={{ background: 'var(--surface-raised)' }}>
          <tr>
            <th scope="col" rowSpan={2} className="sticky left-0 z-[3] px-2 py-1 text-left text-[11px] font-medium" style={{ ...muted, background: HEAD_TINT }}>
              Sana
            </th>
            {blocks.map((b) => (
              <th
                key={b.key}
                scope="colgroup"
                colSpan={COLUMNS.length}
                className="px-2 py-1.5 text-center text-xs font-semibold whitespace-nowrap"
                style={{
                  borderLeft: DIVIDER,
                  color: 'var(--ink-primary)',
                  background: b.tone ? `color-mix(in oklab, ${b.tone} 28%, var(--surface-raised))` : HEAD_TINT,
                }}
              >
                {b.name}
              </th>
            ))}
          </tr>
          <tr style={{ background: HEAD_TINT }}>
            {blocks.map((b) =>
              COLUMNS.map((c, i) => (
                <th
                  key={`${b.key}-${c}`}
                  scope="col"
                  title={COLUMN_HINT[c]}
                  className="px-2 py-1 text-right text-[11px] font-medium whitespace-nowrap"
                  style={{ ...muted, borderLeft: i === 0 ? DIVIDER : undefined }}
                >
                  {c}
                </th>
              )),
            )}
          </tr>
          {/* Under the column names, so a screen reader names each total's column; still above the days, as in the sheet. */}
          <tr style={{ background: TOTAL_TINT }}>
            <th scope="row" className="sticky left-0 z-[3] px-2 py-1.5 text-left font-semibold" style={{ background: TOTAL_TINT }}>
              Jami
            </th>
            {blocks.map((b) => (
              <Figures key={b.key} cells={b.total} strong />
            ))}
          </tr>
        </thead>
        <tbody>
          {dm.days.map((day) => (
            <tr key={day.date}>
              <th
                scope="row"
                className="sticky left-0 z-[1] border-t border-[var(--border)] px-2 py-1 text-left font-normal whitespace-nowrap"
                style={{ background: DATE_TINT }}
              >
                {dayLabel(day.date)}
              </th>
              {blocks.map((b) => (
                <Figures key={b.key} cells={b.byDate.get(day.date)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A block's five cells; a day the page has no row for is all dashes. */
function Figures({ cells, strong = false }: { cells: DmCellsDto | undefined; strong?: boolean }) {
  const values = cells
    ? [
        cells.leads > 0 ? rnpNumber(cells.leads) : null,
        cells.qualified > 0 ? rnpNumber(cells.qualified) : null,
        cells.qualifiedPercent !== null ? rnpPercent(cells.qualifiedPercent) : null,
        cells.spendUsd > 0 ? formatUsd(cells.spendUsd) : null,
        // No DM money on the page is no price, not «$0».
        cells.costPerQualifiedUsd ? formatUsd(cells.costPerQualifiedUsd) : null,
      ]
    : COLUMNS.map(() => null)
  return (
    <>
      {values.map((v, i) => (
        <td
          key={COLUMNS[i]}
          className={`px-2 py-1 text-right whitespace-nowrap ${strong ? 'font-semibold' : 'border-t border-[var(--border)]'}`}
          style={{ borderLeft: i === 0 ? DIVIDER : undefined, ...(v === null ? muted : null) }}
        >
          {v ?? '—'}
        </td>
      ))}
    </>
  )
}

/** «02.09» — the sheet's date, without the year every row repeats. */
function dayLabel(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`
}
