'use client'

import { useState } from 'react'

import { type Column, DataTable } from '@/components/ui/DataTable'
import { SectionHeader } from '@/components/ui/Stat'
import { formatNumber } from '@/lib/format'

import type { LeadBucket, QualityBlockDto, QualityCellsDto } from './reklamaApi'
import { type DayRow, DayCell, type Status, TableCard, SlicePicker, count, dayRows, muted, pct } from './reklamaUi'

/**
 * Lead sifati — what each day's Регистрация leads became, the client's sheet
 * of недозвон / некачественный / успешный / дубль.
 *
 * Read live, so a recent day still has leads being worked; they are their own
 * column («Jarayonda») rather than being forced into one of the four, and the
 * sheet's % is успешный over ALL the day's leads, as the sheet divides it.
 * Under the table, every stage met and the column it was counted in — the
 * rule, shown, so a stage the client adds tomorrow is visible the day it
 * appears.
 */
export const BUCKET_LABEL: Readonly<Record<LeadBucket, string>> = {
  noAnswer: 'Недозвон',
  lowQuality: 'Sifatsiz',
  success: 'Kval (успешный)',
  duplicate: 'Dubl',
  open: 'Jarayonda',
}

export function QualitySection({ quality, status }: { quality: QualityBlockDto | undefined; status: Status }) {
  const [slice, setSlice] = useState<string>('total')

  const pages = quality?.pages ?? []
  const chosen = pages.find((p) => p.key === slice)
  const days = chosen ? chosen.days : quality?.days
  const total = chosen ? chosen.total : quality?.total

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="Lid sifati"
        hint="Target sahifalaridan Регистрация ga tushgan leadlar hozir qaysi bosqichda turgani — yaratilgan kuni boʻyicha."
      />

      <TableCard
        title={`Kunlik — ${chosen ? chosen.name : 'barcha sahifalar'}`}
        hint="Kval % — kval ÷ shu kunning barcha leadlari, jadvaldagidek."
        action={
          <SlicePicker
            ariaLabel="Qaysi sahifa"
            value={chosen ? slice : 'total'}
            onChange={setSlice}
            options={[{ value: 'total', label: 'Barcha sahifalar' }, ...pages.map((p) => ({ value: p.key, label: p.name }))]}
          />
        }
        footer={
          quality && quality.stages.length > 0 ? (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              <span>Bosqich → ustun:</span>
              {quality.stages.map((s) => (
                <span key={s.stage} className="whitespace-nowrap">
                  {s.stage} → {BUCKET_LABEL[s.bucket]} ({formatNumber(s.leads)})
                </span>
              ))}
            </span>
          ) : undefined
        }
      >
        <DataTable<DayRow<QualityCellsDto>>
          columns={columns}
          rows={dayRows(days, total)}
          rowKey={(r) => r.key}
          status={status}
          emptyTitle="Bu davrda lid yoʻq"
          minWidth={760}
          maxHeight="60dvh"
          stickyColumns={1}
          stickyLastRow
        />
      </TableCard>
    </section>
  )
}

const bucketColumn = (bucket: LeadBucket): Column<DayRow<QualityCellsDto>> => ({
  key: bucket,
  header: BUCKET_LABEL[bucket],
  align: 'right',
  numeric: true,
  render: (r) => count(r.cells[bucket]),
})

const columns: readonly Column<DayRow<QualityCellsDto>>[] = [
  { key: 'date', header: 'Kun', rowHeader: true, render: (r) => <DayCell date={r.date} /> },
  bucketColumn('noAnswer'),
  bucketColumn('lowQuality'),
  { ...bucketColumn('success'), render: (r) => <span className="font-medium">{count(r.cells.success)}</span> },
  bucketColumn('duplicate'),
  {
    ...bucketColumn('open'),
    render: (r) => (r.cells.open === 0 ? <span style={muted}>—</span> : <span style={muted}>{formatNumber(r.cells.open)}</span>),
  },
  { key: 'leads', header: 'Jami lid', align: 'right', numeric: true, render: (r) => count(r.cells.leads) },
  {
    key: 'successPercent',
    header: 'Kval %',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{pct(r.cells.successPercent)}</span>,
  },
]
