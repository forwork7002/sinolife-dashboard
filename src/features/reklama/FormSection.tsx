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

  // No targetolog spent anything: the empty state, not a «Jami» row of dashes.
  const ownerRows: OwnerRow[] = form && owners.length > 0
    ? [
        ...owners.map((o) => ({
          key: o.key,
          owner: o,
          cells: o.total,
          qualified: o.qualified,
          formLeads: o.formLeads,
          dmSpend: o.dmSpendUsd,
          dmConversations: o.dmConversations,
          dmLeads: o.dmLeads,
          dmQualified: o.dmQualified,
          dmShared: o.dmShared,
        })),
        {
          key: 'total',
          owner: null,
          cells: form.total,
          qualified: form.qualified,
          formLeads: form.formLeads,
          dmSpend: owners.reduce((n, o) => n + o.dmSpendUsd, 0),
          dmConversations: owners.reduce((n, o) => n + o.dmConversations, 0),
          dmLeads: owners.reduce((n, o) => n + o.dmLeads, 0),
          dmQualified: owners.reduce((n, o) => n + o.dmQualified, 0),
          dmShared: false,
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
        hint="Lid-forma: Kval narxi = sarf ÷ kval, Kval % = kval ÷ Bitrix24 lid. DM: sarf va murojat — targetologning DM kampaniyalari (Meta), lid va kval — DM pul ketgan sahifaning Регистрация lidlari (Bitrix24)."
        footer="Kval — targetologning CRM-formalari ochgan Регистрация lidlaridan «Сделка успешна» boʻlgani; Bitrix24 lid — shu formalarning Bitrix24 ga tushgan har bir toʻldirilishi, Facebook sanaganidek; ikkalasi «Lidlar» boʻlimidagi bilan bir xil, «Jami»ga targetologi aniqlanmagan formalar ham kiradi. DM lidda reklama yoki kampaniya izi yoʻq, shuning uchun bir nechta targetolog DM qiladigan sahifa (sinolifeuz) lidlari har kuni ularning Meta murojatlari ulushiga koʻra boʻlinadi — bunday raqam «≈» bilan; yolgʻiz targetologning sahifasi (zextrauzb, collagen.sinolife) aniq."
      >
        <DataTable<OwnerRow>
          columns={ownerColumns}
          rows={ownerRows}
          rowKey={(r) => r.key}
          status={status}
          emptyTitle="Bu davrda lid-forma sarfi yoʻq"
          minWidth={1900}
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
  { key: 'spend', header: 'Sarf', align: 'right', numeric: true, render: (r) => <Spend value={pick(r).spendUsd} /> },
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

/** A spend figure — the sheet's money columns, bold and in the accent ink (the user, 2026-10-10). */
function Spend({ value }: { value: number }) {
  return value === 0 ? (
    <span style={muted}>—</span>
  ) : (
    <span className="font-semibold" style={{ color: 'var(--accent)' }}>
      {money(value)}
    </span>
  )
}

interface OwnerRow {
  key: string
  owner: FormOwnerDto | null
  cells: FormCellsDto
  qualified: number | null
  formLeads: number | null
  dmSpend: number
  dmConversations: number
  dmLeads: number
  dmQualified: number
  dmShared: boolean
}

/** A ratio over a read count — null while either side is unread or the divisor is 0. */
const ratio = (numerator: number | null, denominator: number | null): number | null =>
  numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator

/** A DM lid / kval count; split off a shared page it is marked «≈» (see the table's footer). */
function DmCount({ value, shared }: { value: number; shared: boolean }) {
  if (value === 0) return <span style={muted}>—</span>
  return shared ? (
    <span title="Umumiy sahifa — Meta murojatlari ulushiga koʻra boʻlingan">≈ {formatNumber(value)}</span>
  ) : (
    <>{formatNumber(value)}</>
  )
}

/** «Отчёт Т»'s figures with the targetolog's kval, its price and its share of the Bitrix24 leads. */
const ownerFigures: Column<OwnerRow>[] = (() => {
  const figures = formColumns<OwnerRow>((r) => r.cells)
  const leadsAt = figures.findIndex((c) => c.key === 'leads') + 1
  const cplAt = figures.findIndex((c) => c.key === 'cpl') + 1
  return [
    ...figures.slice(0, leadsAt),
    {
      key: 'qualified',
      header: 'Kval',
      align: 'right',
      numeric: true,
      // Unread (the scan failed) is a dash; a read 0 is a measurement and prints.
      render: (r) =>
        r.qualified === null ? <span style={muted}>—</span> : <span className="font-semibold">{formatNumber(r.qualified)}</span>,
    },
    ...figures.slice(leadsAt, cplAt),
    {
      key: 'cpq',
      header: 'Kval narxi',
      align: 'right',
      numeric: true,
      render: (r) => <span className="font-medium">{money(ratio(r.cells.spendUsd, r.qualified))}</span>,
    },
    {
      key: 'qualifiedPercent',
      header: 'Kval %',
      align: 'right',
      numeric: true,
      render: (r) => {
        const share = ratio(r.qualified, r.formLeads)
        return (
          <span title={r.formLeads === null ? undefined : `${formatNumber(r.qualified ?? 0)} kval ÷ ${formatNumber(r.formLeads)} Bitrix24 lid`}>
            {pct(share === null ? null : share * 100)}
          </span>
        )
      },
    },
    ...figures.slice(cplAt),
  ]
})()

const ownerColumns: readonly Column<OwnerRow>[] = [
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
  ...ownerFigures,
  // DM, in the client's order: sarf · murojat · lid · kval · lid narxi · kval narxi · kval %.
  { key: 'dmSpend', header: 'DM sarfi', align: 'right', numeric: true, render: (r) => <Spend value={r.dmSpend} /> },
  { key: 'dmConversations', header: 'DM murojat', align: 'right', numeric: true, render: (r) => count(r.dmConversations) },
  {
    key: 'dmLeads',
    header: 'DM lid',
    align: 'right',
    numeric: true,
    render: (r) => <DmCount value={r.dmLeads} shared={r.dmShared} />,
  },
  {
    key: 'dmQualified',
    header: 'DM kval',
    align: 'right',
    numeric: true,
    render: (r) => (
      <span className="font-semibold">
        <DmCount value={r.dmQualified} shared={r.dmShared} />
      </span>
    ),
  },
  {
    key: 'dmCpl',
    header: 'DM lid narxi',
    align: 'right',
    numeric: true,
    render: (r) => money(ratio(r.dmSpend, r.dmLeads)),
  },
  {
    key: 'dmCpq',
    header: 'DM kval narxi',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{money(ratio(r.dmSpend, r.dmQualified))}</span>,
  },
  {
    key: 'dmQualifiedPercent',
    header: 'DM kval %',
    align: 'right',
    numeric: true,
    render: (r) => {
      const share = ratio(r.dmQualified, r.dmLeads)
      return pct(share === null ? null : share * 100)
    },
  },
]

const dayColumns: readonly Column<DayRow<FormCellsDto>>[] = [
  { key: 'date', header: 'Kun', rowHeader: true, render: (r) => <DayCell date={r.date} /> },
  ...formColumns<DayRow<FormCellsDto>>((r) => r.cells),
]
