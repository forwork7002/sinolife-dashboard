'use client'

import { useState } from 'react'

import { type Column, DataTable } from '@/components/ui/DataTable'
import { SectionHeader } from '@/components/ui/Stat'
import { PRODUCT_TONE, usd } from '@/features/target/targetTheme'

import type { DmBlockDto, DmCellsDto, DmPageDto } from './reklamaApi'
import { type DayRow, DayCell, type Status, TableCard, SlicePicker, count, dayRows, money, muted, pct } from './reklamaUi'

/**
 * «DM» — the client's sheet of Instagram-message advertising, per page.
 *
 * The sheet puts every page side by side, five columns each; seven pages of
 * that is thirty-five columns nobody can read on a laptop. So the pages are
 * one table of totals, and the days are one page at a time — «Jami» first,
 * which is the sheet's «Итог» block.
 *
 * Murojat and Reklama come from Meta's DM campaigns; Lid and Kval from the
 * page's Регистрация leads in Bitrix24. The two meet on the day and the page
 * and nowhere else, which the column headers say.
 */
export function DmSection({ dm, status }: { dm: DmBlockDto | undefined; status: Status }) {
  const [slice, setSlice] = useState<string>('total')

  const pages = dm?.pages ?? []
  const chosen: DmPageDto | undefined = pages.find((p) => p.key === slice)
  const days = chosen ? chosen.days : dm?.days
  const total = chosen ? chosen.total : dm?.total

  type PageRow = { key: string; name: string; page: DmPageDto | null; cells: DmCellsDto }
  const pageRows: PageRow[] = dm
    ? [
        ...pages.map((p) => ({ key: p.key, name: p.name, page: p, cells: p.total })),
        { key: 'total', name: 'Jami', page: null, cells: dm.total },
      ]
    : []

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="DM · sahifalar boʻyicha"
        hint="Instagram direktga yozdiradigan reklama: murojaat va sarf Meta DM kampaniyalaridan, lid va kval shu sahifaning Bitrix24 dagi Регистрация leadlaridan."
      />

      <TableCard
        title="Sahifalar — davr boʻyicha"
        hint="Kval — «Сделка успешна». Kval narxi — DM sarfi ÷ kval."
        footer={
          dm && dm.unattributed.spendUsd > 0
            ? `Mahsulotga biriktirilmagan akkauntlardagi DM sarfi (${usd(dm.unattributed.spendUsd)}, ${dm.unattributed.conversations} murojaat) hech bir sahifaga qoʻshilmagan.`
            : undefined
        }
      >
        <DataTable<PageRow>
          columns={pageColumns}
          rows={pageRows}
          rowKey={(r) => r.key}
          status={status}
          emptyTitle="Bu davrda maʼlumot yoʻq"
          minWidth={960}
          maxHeight="none"
          stickyColumns={1}
          stickyLastRow
        />
      </TableCard>

      <TableCard
        title={`Kunlik — ${chosen ? chosen.name : 'barcha sahifalar'}`}
        hint="Har kun alohida qator, oxirida davr jami — jadvaldagidek."
        action={
          <SlicePicker
            ariaLabel="Qaysi sahifa"
            value={chosen ? slice : 'total'}
            onChange={setSlice}
            options={[{ value: 'total', label: 'Jami' }, ...pages.map((p) => ({ value: p.key, label: p.name }))]}
          />
        }
      >
        <DataTable<DayRow<DmCellsDto>>
          columns={dayColumns}
          rows={dayRows(days, total)}
          rowKey={(r) => r.key}
          status={status}
          emptyTitle="Bu davrda maʼlumot yoʻq"
          minWidth={860}
          maxHeight="60dvh"
          stickyColumns={1}
          stickyLastRow
        />
      </TableCard>
    </section>
  )
}

const cellColumns = <R,>(pick: (row: R) => DmCellsDto): Column<R>[] => [
  {
    key: 'conversations',
    header: 'Murojat · Meta',
    align: 'right',
    numeric: true,
    render: (r) => count(pick(r).conversations),
  },
  { key: 'leads', header: 'Lid', align: 'right', numeric: true, render: (r) => count(pick(r).leads) },
  { key: 'qualified', header: 'Kval', align: 'right', numeric: true, render: (r) => count(pick(r).qualified) },
  {
    key: 'qualifiedPercent',
    header: 'Lid → kval',
    align: 'right',
    numeric: true,
    render: (r) => pct(pick(r).qualifiedPercent),
  },
  {
    key: 'conversationToQualified',
    header: 'Murojat → kval',
    align: 'right',
    numeric: true,
    render: (r) => pct(pick(r).conversationToQualifiedPercent),
  },
  { key: 'spend', header: 'Reklama', align: 'right', numeric: true, render: (r) => money(pick(r).spendUsd) },
  {
    key: 'cpc',
    header: 'Murojat narxi',
    align: 'right',
    numeric: true,
    render: (r) => money(pick(r).costPerConversationUsd),
  },
  {
    key: 'cpq',
    header: 'Kval narxi',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{money(pick(r).costPerQualifiedUsd)}</span>,
  },
]

const pageColumns: readonly Column<{ key: string; name: string; page: DmPageDto | null; cells: DmCellsDto }>[] = [
  {
    key: 'page',
    header: 'Sahifa',
    rowHeader: true,
    render: (r) =>
      r.page === null ? (
        <span className="eyebrow">Jami</span>
      ) : (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: PRODUCT_TONE[r.page.product] }} />
          {r.name}
          {r.page.carriesDmSpend && (
            <span className="text-[11px] font-normal" style={muted} title="Mahsulotning DM reklamasi shu sahifaga yoziladi">
              · DM
            </span>
          )}
        </span>
      ),
  },
  ...cellColumns<{ cells: DmCellsDto }>((r) => r.cells),
]

const dayColumns: readonly Column<DayRow<DmCellsDto>>[] = [
  { key: 'date', header: 'Kun', rowHeader: true, render: (r) => <DayCell date={r.date} /> },
  ...cellColumns<DayRow<DmCellsDto>>((r) => r.cells),
]
