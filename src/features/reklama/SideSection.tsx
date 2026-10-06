'use client'

import { EmptyState } from '@/components/states/States'
import { type Column, DataTable } from '@/components/ui/DataTable'
import type { DashboardBrand } from '@/features/shared/useDashboardFilters'

import type { SideColumnDto } from './reklamaApi'
import { DayCell, type Status, TableCard, money } from './reklamaUi'

/**
 * The client's narrow side table — «Сентябрь 269,0$ / Навой HR», one row a
 * day — asked for on 2026-09-28 for Eldor's HR and Kosmetika accounts. The
 * period's total heads the table, the way the sheet reads, not at its foot.
 *
 * HR is every hiring campaign on any account (the «vakansiya» DM campaign on
 * Sinolife family Eldor, Collagen Eldor's «Vacancy» ones, and HR Eldor
 * itself); Kosmetika is Kosmetika Eldor's other campaigns. Neither is in the
 * DM sheet; Kosmetika's lead forms are also in «Отчёт Т» under «Boshqa».
 *
 * Neither belongs to Collagen or Zextra: the table is «Brendsiz»'s, drawn
 * under «Hammasi» and «Brendsiz», and under one brand it says so instead of
 * printing that brand's (empty) rows.
 */
export function SideSection({
  side,
  status,
  brand,
}: {
  side: readonly SideColumnDto[] | undefined
  status: Status
  brand: DashboardBrand
}) {
  if (brand === 'Collagen' || brand === 'Zextra') {
    return (
      <TableCard title="HR · Kosmetika" hint="Meta sarfi, kunma-kun. HR — barcha vakansiya kampaniyalari va HR Eldor akkaunti.">
        <EmptyState title="Brend boʻyicha ajratilmaydi" body="HR va Kosmetika na Collagen, na Zextra — «Brendsiz» va «Hammasi» da koʻrinadi." />
      </TableCard>
    )
  }

  const columns = side ?? []

  type Row = { key: string; date: string | null; spend: readonly number[] }
  const rows: Row[] =
    columns.length > 0 && columns[0]!.days.length > 0
      ? [
          { key: 'total', date: null, spend: columns.map((c) => c.totalUsd) },
          ...columns[0]!.days.map((d, i) => ({
            key: d.date,
            date: d.date,
            spend: columns.map((c) => c.days[i]?.spendUsd ?? 0),
          })),
        ]
      : []

  const tableColumns: Column<Row>[] = [
    { key: 'date', header: 'Kun', rowHeader: true, render: (r) => <DayCell date={r.date} /> },
    ...columns.map(
      (c, i): Column<Row> => ({
        key: c.key,
        header: c.name,
        align: 'right',
        numeric: true,
        render: (r) => (r.date === null ? <span className="font-semibold">{money(r.spend[i]!)}</span> : money(r.spend[i]!)),
      }),
    ),
  ]

  return (
    <TableCard title="HR · Kosmetika" hint="Meta sarfi, kunma-kun. HR — barcha vakansiya kampaniyalari va HR Eldor akkaunti.">
      <DataTable<Row>
        columns={tableColumns}
        rows={rows}
        rowKey={(r) => r.key}
        status={status}
        emptyTitle="Bu davrda maʼlumot yoʻq"
        minWidth={0}
        maxHeight="70dvh"
        stickyColumns={1}
      />
    </TableCard>
  )
}
