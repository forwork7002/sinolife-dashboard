'use client'

import { useState } from 'react'

import { type Column, DataTable } from '@/components/ui/DataTable'
import { SectionHeader } from '@/components/ui/Stat'
import { formatNumber } from '@/lib/format'
import { PRODUCT_LABEL, PRODUCT_TONE } from '@/features/target/targetTheme'

import type { FormBlockDto, FormCellsDto, FormOwnerDto } from './reklamaApi'
import { type DayRow, DayCell, type Status, TableCard, SlicePicker, count, dayRows, money, muted, pct } from './reklamaUi'

/**
 * «Отчёт Т» — the targetologs' lead-form advertising, per person per product.
 *
 * The sheet's $ column is these campaigns' spend to the dime (Umar,
 * 02.09.2026: 93.1 $ + 96.0 $ against the sheet's 189.0 $). Its «лид» is not
 * Meta's lead count, so the table says «Meta lid». The per-targetolog
 * Bitrix24 лид / кв лид the sheet also carries were found on 2026-09-25 —
 * the CRM form's NAME carries the targetolog — and live on «Lidlar» →
 * «Lid manbalari»; the note under the table points there.
 */
export function FormSection({ form, status }: { form: FormBlockDto | undefined; status: Status }) {
  const [slice, setSlice] = useState<string>('total')

  const owners = form?.owners ?? []
  const chosen = owners.find((o) => o.key === slice)
  const days = chosen ? chosen.days : form?.days
  const total = chosen ? chosen.total : form?.total

  type OwnerRow = { key: string; owner: FormOwnerDto | null; cells: FormCellsDto; dmSpend: number; dmConversations: number }
  // No targetolog spent anything: the empty state, not a «Jami» row of dashes.
  const ownerRows: OwnerRow[] = form && owners.length > 0
    ? [
        ...owners.map((o) => ({
          key: o.key,
          owner: o,
          cells: o.total,
          dmSpend: o.dmSpendUsd,
          dmConversations: o.dmConversations,
        })),
        {
          key: 'total',
          owner: null,
          cells: form.total,
          dmSpend: owners.reduce((n, o) => n + o.dmSpendUsd, 0),
          dmConversations: owners.reduce((n, o) => n + o.dmConversations, 0),
        },
      ]
    : []

  const label = (o: FormOwnerDto) => `${o.targetolog} · ${PRODUCT_LABEL[o.product]}`

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="Targetologlar · lid-forma («Отчёт Т»)"
        hint="Har targetologning lid-forma kampaniyalari (Meta, OUTCOME_LEADS): sarf, Meta hisoblagan lidlar, lid narxi, klik, CTR, klik narxi va 1 000 koʻrsatish narxi (CPM)."
      />

      <TableCard
        title="Targetologlar — davr boʻyicha"
        hint="DM ustunlari — shu targetologning DM kampaniyalari; ular yuqoridagi DM jadvaliga ham kiradi."
        footer="Targetolog boʻyicha Bitrix24 lid va kval — «Lidlar» boʻlimining «Lid manbalari» jadvalida: ular targetologning CRM-formasi nomidan olinadi."
      >
        <DataTable<OwnerRow>
          columns={ownerColumns}
          rows={ownerRows}
          rowKey={(r) => r.key}
          status={status}
          emptyTitle="Bu davrda lid-forma sarfi yoʻq"
          minWidth={1180}
          maxHeight="none"
          stickyColumns={1}
          stickyLastRow
        />
      </TableCard>

      <TableCard
        title={`Kunlik — ${chosen ? label(chosen) : 'barcha targetologlar'}`}
        hint="Har kun alohida qator, oxirida davr jami."
        action={
          <SlicePicker
            ariaLabel="Qaysi targetolog"
            value={chosen ? slice : 'total'}
            onChange={setSlice}
            options={[{ value: 'total', label: 'Jami' }, ...owners.map((o) => ({ value: o.key, label: label(o) }))]}
          />
        }
      >
        <DataTable<DayRow<FormCellsDto>>
          columns={dayColumns}
          rows={owners.length > 0 ? dayRows(days, total) : []}
          rowKey={(r) => r.key}
          status={status}
          emptyTitle="Bu davrda lid-forma sarfi yoʻq"
          minWidth={820}
          maxHeight="60dvh"
          stickyColumns={1}
          stickyLastRow
        />
      </TableCard>
    </section>
  )
}

const formColumns = <R,>(pick: (row: R) => FormCellsDto): Column<R>[] => [
  { key: 'spend', header: 'Sarf', align: 'right', numeric: true, render: (r) => money(pick(r).spendUsd) },
  { key: 'leads', header: 'Meta lid', align: 'right', numeric: true, render: (r) => count(pick(r).metaLeads) },
  {
    key: 'cpl',
    header: 'Lid narxi',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{money(pick(r).costPerLeadUsd)}</span>,
  },
  { key: 'clicks', header: 'Klik', align: 'right', numeric: true, render: (r) => count(pick(r).clicks) },
  { key: 'ctr', header: 'CTR', align: 'right', numeric: true, render: (r) => pct(pick(r).ctrPercent) },
  { key: 'cpcUsd', header: 'Klik narxi', align: 'right', numeric: true, render: (r) => money(pick(r).cpcUsd) },
  { key: 'cpm', header: 'CPM', align: 'right', numeric: true, render: (r) => money(pick(r).cpmUsd) },
]

const ownerColumns: readonly Column<{
  key: string
  owner: FormOwnerDto | null
  cells: FormCellsDto
  dmSpend: number
  dmConversations: number
}>[] = [
  {
    key: 'who',
    header: 'Targetolog',
    rowHeader: true,
    render: (r) =>
      r.owner === null ? (
        <span className="eyebrow">Jami</span>
      ) : (
        <span className="flex flex-col leading-tight">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: PRODUCT_TONE[r.owner.product] }} />
            {r.owner.targetolog}
            <span className="text-[11px] font-normal" style={muted}>
              · {PRODUCT_LABEL[r.owner.product]}
            </span>
          </span>
          <span
            className="max-w-[280px] truncate text-[11px] font-normal"
            style={muted}
            title={r.owner.accounts.join(', ')}
          >
            {r.owner.accounts.join(', ')}
          </span>
        </span>
      ),
  },
  ...formColumns<{ cells: FormCellsDto }>((r) => r.cells),
  { key: 'dmSpend', header: 'DM sarfi', align: 'right', numeric: true, render: (r) => money(r.dmSpend) },
  {
    key: 'dmConversations',
    header: 'DM murojat',
    align: 'right',
    numeric: true,
    render: (r) => (r.dmConversations === 0 ? <span style={muted}>—</span> : formatNumber(r.dmConversations)),
  },
]

const dayColumns: readonly Column<DayRow<FormCellsDto>>[] = [
  { key: 'date', header: 'Kun', rowHeader: true, render: (r) => <DayCell date={r.date} /> },
  ...formColumns<DayRow<FormCellsDto>>((r) => r.cells),
]
