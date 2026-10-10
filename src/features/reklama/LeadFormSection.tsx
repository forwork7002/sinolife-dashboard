'use client'

import { useMemo, useState } from 'react'

import { type Column, DataTable } from '@/components/ui/DataTable'
import { SectionHeader } from '@/components/ui/Stat'
import { formatDate, formatNumber } from '@/lib/format'
import { PRODUCT_LABEL, PRODUCT_TONE } from '@/features/target/targetTheme'

import type { LeadFormDto } from './reklamaApi'
import { type Status, TableCard, count, money, muted, pct } from './reklamaUi'

/**
 * Formalar — «Kampaniyalar»'s table with a Meta LEAD FORM on each row.
 *
 * Asked for on 2026-10-10 («har bitta formani alohida, xuddi shu jadvaldek»):
 * the portal's deal names its form, never its campaign, so the form is the
 * row a registrar and a targetolog both recognise. The same columns as the
 * campaigns below, so a form reads against its campaigns without relearning.
 *
 * A form's money is its ads' — an ad is filed under the form its own leads
 * came through — so lead-form money no read lead names a form for stands on
 * its own row, «Forma aniqlanmagan», rather than being spread over the rest.
 */
type SortKey =
  | 'spend'
  | 'results'
  | 'cpr'
  | 'crmLeads'
  | 'qual'
  | 'qualPct'
  | 'cpq'
  | 'noAnswer'
  | 'lowQuality'
  | 'duplicate'
  | 'open'
  | 'ctr'
  | 'last'

/** Null where the figure does not exist — no lead to price, no impression to click through. */
const SORTERS: Readonly<Record<SortKey, (f: LeadFormDto) => number | string | null>> = {
  spend: (f) => f.spendUsd,
  results: (f) => f.metaLeads,
  cpr: (f) => f.costPerLeadUsd,
  crmLeads: (f) => f.crm?.matched ?? null,
  qual: (f) => f.crm?.qualified ?? null,
  noAnswer: (f) => f.crm?.noAnswer ?? null,
  lowQuality: (f) => f.crm?.lowQuality ?? null,
  duplicate: (f) => f.crm?.duplicate ?? null,
  open: (f) => f.crm?.open ?? null,
  qualPct: (f) => f.crm?.qualifiedPercent ?? null,
  cpq: (f) => f.crm?.costPerQualifiedUsd ?? null,
  ctr: (f) => f.ctrPercent,
  last: (f) => f.lastActive,
}

export function LeadFormSection({ forms, status }: { forms: readonly LeadFormDto[] | undefined; status: Status }) {
  const [sort, setSort] = useState<SortKey>('spend')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')

  const rows = useMemo(() => {
    const pick = SORTERS[sort]
    const sign = order === 'asc' ? 1 : -1
    // A copy, so the sort never touches the query's cached array.
    return [...(forms ?? [])].sort((a, b) => {
      const x = pick(a)
      const y = pick(b)
      // A missing figure sinks to the bottom whichever way the reader sorts, as on «Kampaniyalar».
      if (x === null || y === null) return x === y ? b.spendUsd - a.spendUsd : x === null ? 1 : -1
      return (x < y ? -1 : x > y ? 1 : 0) * sign || b.spendUsd - a.spendUsd
    })
  }, [forms, sort, order])

  const onSort = (key: string) => {
    const next = key as SortKey
    if (next === sort) setOrder(order === 'asc' ? 'desc' : 'asc')
    else {
      setSort(next)
      // A price is best low, everything else is best high.
      setOrder(next === 'cpr' || next === 'cpq' ? 'asc' : 'desc')
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="Formalar · Meta"
        hint="Har bir lid-forma alohida qator: shu forma orqali ishlagan reklamalarning sarfi, Meta lidi va lid narxi (CPL). Lid va undan keyingi ustunlar — formaning Meta lidi telefon boʻyicha Bitrix24 bitimiga ulangani: Kval — «Сделка успешна», qolganlari — bitim hozir turgan bosqich; kval narxi = sarf ÷ kval."
      />
      <TableCard
        title={`Formalar — ${formatNumber(rows.length)} ta`}
        hint="Ustun sarlavhasini bosib saralang."
        footer="Forma Meta’dan olinadi: har bir lid qaysi forma va qaysi reklamadan kelganini Meta oʻzi aytadi, reklamaning sarfi oʻsha formaga yoziladi. «Forma aniqlanmagan» — lid-forma reklamasining sarfi, lekin undan hali birorta lid oʻqilmagan (forma sahifasi ochilmagan yoki reklama lid bermagan)."
      >
        <DataTable<LeadFormDto>
          columns={columns}
          rows={rows}
          rowKey={(f) => f.id || 'unknown'}
          status={status}
          emptyTitle="Bu davrda lid-forma maʼlumoti yoʻq"
          minWidth={1820}
          maxHeight="70dvh"
          stickyColumns={1}
          sort={sort}
          order={order}
          onSort={onSort}
          initialRows={30}
          moreLabel={(hidden) => `Yana ${formatNumber(hidden)} ta forma`}
        />
      </TableCard>
    </section>
  )
}

/** A portal figure of a form: «—» with no lead read (`crm` null) and for a zero, as `count` draws every zero here. */
const crmCount = (value: number | undefined) => (value === undefined ? <span style={muted}>—</span> : count(value))

/** Whose form it is, in one quiet line — or why nobody's. */
function ownerLine(f: LeadFormDto): string {
  if (f.targetolog === null) return 'Bu davrda reklama sarfi yoʻq'
  const campaigns = f.campaigns > 0 ? ` · ${formatNumber(f.campaigns)} ta kampaniya` : ''
  return `${f.targetolog} · ${PRODUCT_LABEL[f.product]} · ${f.accounts.join(', ')}${campaigns}`
}

const columns: readonly Column<LeadFormDto>[] = [
  {
    key: 'name',
    header: 'Forma',
    rowHeader: true,
    render: (f) => (
      <span className="flex flex-col leading-tight">
        <span className="max-w-[300px] truncate" title={f.name || undefined}>
          {f.id === '' ? 'Forma aniqlanmagan' : f.name || f.id}
        </span>
        <span className="inline-flex max-w-[300px] items-center gap-1.5 text-[11px] font-normal" style={muted}>
          {f.targetolog !== null && (
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: PRODUCT_TONE[f.product] }} />
          )}
          <span className="truncate" title={ownerLine(f)}>
            {ownerLine(f)}
          </span>
        </span>
      </span>
    ),
  },
  { key: 'spend', sortKey: 'spend', header: 'Sarf', align: 'right', numeric: true, render: (f) => money(f.spendUsd) },
  { key: 'results', sortKey: 'results', header: 'Meta lid', align: 'right', numeric: true, render: (f) => count(f.metaLeads) },
  {
    key: 'cpr',
    sortKey: 'cpr',
    header: 'Lid narxi',
    align: 'right',
    numeric: true,
    render: (f) => <span className="font-medium">{money(f.costPerLeadUsd)}</span>,
  },
  {
    key: 'crmLeads',
    sortKey: 'crmLeads',
    header: 'Lid',
    align: 'right',
    numeric: true,
    render: (f) =>
      f.crm ? (
        <span className="flex flex-col items-end leading-tight">
          <span className="font-medium">{formatNumber(f.crm.matched)}</span>
          {/* How many of the form's leads the kval was looked for in — said, not hidden. */}
          <span
            className="whitespace-nowrap text-[11px] font-normal"
            style={muted}
            title={`Formadan ${formatNumber(f.crm.leadsRead)} ta lid oʻqildi (Meta reklamada ${formatNumber(f.metaLeads)} ta sanagan), ${formatNumber(f.crm.matched)} tasi Bitrix24 bitimiga ulandi`}
          >
            {formatNumber(f.crm.leadsRead)} tadan
          </span>
        </span>
      ) : (
        <span style={muted}>—</span>
      ),
  },
  {
    key: 'qual',
    sortKey: 'qual',
    header: 'Kval',
    align: 'right',
    numeric: true,
    render: (f) => <span className="font-medium">{crmCount(f.crm?.qualified)}</span>,
  },
  {
    key: 'qualPct',
    sortKey: 'qualPct',
    header: 'Kval %',
    align: 'right',
    numeric: true,
    render: (f) => pct(f.crm?.qualifiedPercent ?? null),
  },
  {
    key: 'cpq',
    sortKey: 'cpq',
    header: 'Kval narxi',
    align: 'right',
    numeric: true,
    render: (f) => <span className="font-medium">{money(f.crm?.costPerQualifiedUsd ?? null)}</span>,
  },
  { key: 'noAnswer', sortKey: 'noAnswer', header: 'Недозвон', align: 'right', numeric: true, render: (f) => crmCount(f.crm?.noAnswer) },
  { key: 'lowQuality', sortKey: 'lowQuality', header: 'Sifatsiz', align: 'right', numeric: true, render: (f) => crmCount(f.crm?.lowQuality) },
  { key: 'duplicate', sortKey: 'duplicate', header: 'Dubl', align: 'right', numeric: true, render: (f) => crmCount(f.crm?.duplicate) },
  { key: 'open', sortKey: 'open', header: 'Jarayonda', align: 'right', numeric: true, render: (f) => crmCount(f.crm?.open) },
  { key: 'clicks', header: 'Klik', align: 'right', numeric: true, render: (f) => count(f.clicks) },
  { key: 'ctr', sortKey: 'ctr', header: 'CTR', align: 'right', numeric: true, render: (f) => pct(f.ctrPercent) },
  { key: 'days', header: 'Faol kun', align: 'right', numeric: true, render: (f) => count(f.activeDays) },
  {
    key: 'last',
    sortKey: 'last',
    header: 'Oxirgi sarf',
    align: 'right',
    render: (f) =>
      f.lastActive ? (
        <span className="whitespace-nowrap">{formatDate(`${f.lastActive}T12:00:00Z`)}</span>
      ) : (
        <span style={muted}>—</span>
      ),
  },
]
