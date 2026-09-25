'use client'

import { useState } from 'react'

import { Card } from '@/components/ui/Card'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { SectionHeader, StatTile } from '@/components/ui/Stat'
import { formatDateTime, formatNumber } from '@/lib/format'
import { PRODUCT_LABEL, PRODUCT_TONE } from '@/features/target/targetTheme'
import {
  type DayRow,
  DayCell,
  type Status,
  SlicePicker,
  TableCard,
  count,
  money,
  muted,
  pct,
} from '@/features/reklama/reklamaUi'

import type {
  DmDayDto,
  DmPageDto,
  FormDayDto,
  FormOwnerDto,
  LeadChannel,
  LeadOutcomeDto,
  LeadSourcesOverviewDto,
  SourceRowDto,
} from './leadSourcesApi'

/**
 * «Lid manbalari» — every lead Bitrix24 registered, by where it came from.
 *
 * Three questions, one request (`/leads/overview`), so every table sums to
 * the tiles above it:
 *
 *   Targetologlar — each targetolog's lead forms: what Meta counted, what
 *     reached Регистрация, and what that became. «Yetib keldi» low means the
 *     form is not linked to the portal, not that the ads are bad — the week
 *     this was built on had whole campaigns at 0%.
 *   DM sahifalar — people writing to a page («ИИ обработка») against the
 *     page's Регистрация leads.
 *   Barcha manbalar — Регистрация whole, ad or not, so nothing is missing
 *     from the total without the reader being told where it went.
 */

const CHANNEL_LABEL: Readonly<Record<LeadChannel, string>> = {
  form: 'Lid-forma',
  page: 'Reklama sahifasi',
  inbound: 'Kiruvchi qoʻngʻiroq',
  outbound: 'Chiquvchi qoʻngʻiroq',
  manual: 'Ген лид (qoʻlda)',
  other: 'Boshqa',
}

export function LeadSourcesSection({ data, status }: { data: LeadSourcesOverviewDto | undefined; status: Status }) {
  return (
    <>
      <Tiles data={data} status={status} />
      <FormsBlock data={data} status={status} />
      <DmBlock data={data} status={status} />
      <SourcesBlock data={data} status={status} />
    </>
  )
}

// --- tiles ------------------------------------------------------------------

function Tiles({ data, status }: { data: LeadSourcesOverviewDto | undefined; status: Status }) {
  const t = data?.totals
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          status={status}
          label="Регистрация lidlari"
          value={t?.registration.leads ?? null}
          unit="count"
          hint={t ? `barcha manbalar · ${formatNumber(t.registration.success)} kval` : undefined}
        />
        <StatTile
          status={status}
          label="Reklama lidlari"
          value={t?.ads.leads ?? null}
          unit="count"
          hint={t ? `lid-forma + reklama sahifalari · ${formatNumber(t.ads.success)} kval` : undefined}
        />
        <StatTile
          status={status}
          label="Reklama lid → kval"
          value={t?.ads.successPercent ?? null}
          unit="percent"
          hint="«Сделка успешна» ÷ reklama lidlari"
        />
        <StatTile
          status={status}
          label="DM murojaat"
          value={t?.conversations ?? null}
          unit="count"
          hint="«ИИ обработка» — Instagramga yozgan har bir odam"
        />
        <StatTile
          status={status}
          label="Formadan yetib kelgan"
          value={t?.formReachPercent ?? null}
          unit="percent"
          tone={t?.formReachPercent != null && t.formReachPercent < 60 ? 'warning' : 'neutral'}
          hint={
            t ? `Meta ${formatNumber(t.metaFormLeads)} liddan Bitrix24 ga ${formatNumber(t.formLeads)} tasi tushgan` : undefined
          }
        />
      </div>
      {data?.importedAt && (
        <p className="text-[11px]" style={muted}>
          Lidlar Bitrix24 dan, Meta lidlari Ads Manager’dan har soatda. Meta oxirgi yangilanishi:{' '}
          {formatDateTime(data.importedAt)}.
        </p>
      )}
    </section>
  )
}

// --- forms ------------------------------------------------------------------

const ownerLabel = (o: FormOwnerDto) =>
  o.product === 'Boshqa' ? o.targetolog : `${o.targetolog} · ${PRODUCT_LABEL[o.product]}`

function FormsBlock({ data, status }: { data: LeadSourcesOverviewDto | undefined; status: Status }) {
  const [slice, setSlice] = useState<string>('total')
  const owners = data?.forms.owners ?? []
  const chosen = owners.find((o) => o.key === slice)

  type OwnerRow = { key: string; owner: FormOwnerDto | null; cells: FormTotals }
  const rows: OwnerRow[] =
    data && owners.length > 0
      ? [
          ...owners.map((o) => ({ key: o.key, owner: o, cells: ownerTotals(o) })),
          {
            key: 'total',
            owner: null,
            cells: {
              spendUsd: data.forms.spendUsd,
              metaLeads: data.forms.metaLeads,
              outcome: data.forms.outcome,
              reachPercent: data.totals.formReachPercent,
              costPerLeadUsd: data.forms.outcome.leads > 0 ? data.forms.spendUsd / data.forms.outcome.leads : null,
              costPerSuccessUsd:
                data.forms.outcome.success > 0 ? data.forms.spendUsd / data.forms.outcome.success : null,
            },
          },
        ]
      : []

  const days = chosen ? chosen.days : data?.forms.days
  const dayTotal: FormDayDto | undefined = chosen
    ? { date: '', metaLeads: chosen.metaLeads, leads: chosen.outcome.leads, success: chosen.outcome.success }
    : data
      ? { date: '', metaLeads: data.forms.metaLeads, leads: data.forms.outcome.leads, success: data.forms.outcome.success }
      : undefined

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="Targetologlar · lid-forma"
        hint="Meta hisoblagan lidlar va shu targetologning CRM-formasi Bitrix24 Регистрация ga ochgan bitimlar — keyin ular nima boʻlgani. Targetolog forma nomidan olinadi («Sinolife (UMAR) 777», «… Eldor»)."
      />
      <TableCard
        title="Targetologlar — davr boʻyicha"
        hint="«Yetib keldi» — Bitrix24 lid ÷ Meta lid. Past boʻlsa, Meta formasi Bitrix24 ga ulanmagan boʻlishi mumkin."
        footer="Lid va kval narxi — lid-forma sarfi ÷ Bitrix24 dagi lid (yoki kval). Meta lid narxi «Reklama samarasi» boʻlimida."
      >
        <DataTable<OwnerRow>
          columns={ownerColumns}
          rows={rows}
          rowKey={(r) => r.key}
          status={status}
          emptyTitle="Bu davrda lid-forma lidi yoʻq"
          minWidth={1260}
          maxHeight="none"
          stickyColumns={1}
          stickyLastRow
        />
      </TableCard>
      <TableCard
        title={`Kunlik — ${chosen ? ownerLabel(chosen) : 'barcha targetologlar'}`}
        hint="Har kun alohida qator, oxirida davr jami. Meta kuni — akkauntning hisobot kuni."
        action={
          <SlicePicker
            ariaLabel="Qaysi targetolog"
            value={chosen ? slice : 'total'}
            onChange={setSlice}
            options={[{ value: 'total', label: 'Jami' }, ...owners.map((o) => ({ value: o.key, label: ownerLabel(o) }))]}
          />
        }
      >
        <DataTable<DayRow<FormDayDto>>
          columns={formDayColumns}
          rows={owners.length > 0 ? dayRowsOf(days, dayTotal) : []}
          rowKey={(r) => r.key}
          status={status}
          emptyTitle="Bu davrda lid-forma lidi yoʻq"
          minWidth={620}
          maxHeight="60dvh"
          stickyColumns={1}
          stickyLastRow
        />
      </TableCard>
    </section>
  )
}

interface FormTotals {
  spendUsd: number
  metaLeads: number
  outcome: LeadOutcomeDto
  reachPercent: number | null
  costPerLeadUsd: number | null
  costPerSuccessUsd: number | null
}

const ownerTotals = (o: FormOwnerDto): FormTotals => ({
  spendUsd: o.spendUsd,
  metaLeads: o.metaLeads,
  outcome: o.outcome,
  reachPercent: o.reachPercent,
  costPerLeadUsd: o.costPerLeadUsd,
  costPerSuccessUsd: o.costPerSuccessUsd,
})

/** Days then the total — `dayRows` in reklamaUi wants the total's own type. */
function dayRowsOf<T extends { date: string }>(days: readonly T[] | undefined, total: T | undefined): DayRow<T>[] {
  if (!days || !total || days.length === 0) return []
  return [...days.map((d) => ({ key: d.date, date: d.date, cells: d })), { key: 'total', date: null, cells: total }]
}

const outcomeColumns = <R,>(pick: (row: R) => LeadOutcomeDto): Column<R>[] => [
  {
    key: 'success',
    header: 'Kval',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{count(pick(r).success)}</span>,
  },
  {
    key: 'successPercent',
    header: 'Kval %',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{pct(pick(r).successPercent)}</span>,
  },
  { key: 'noAnswer', header: 'Недозвон', align: 'right', numeric: true, render: (r) => count(pick(r).noAnswer) },
  { key: 'lowQuality', header: 'Sifatsiz', align: 'right', numeric: true, render: (r) => count(pick(r).lowQuality) },
  { key: 'duplicate', header: 'Dubl', align: 'right', numeric: true, render: (r) => count(pick(r).duplicate) },
  {
    key: 'open',
    header: 'Jarayonda',
    align: 'right',
    numeric: true,
    render: (r) => (pick(r).open === 0 ? <span style={muted}>—</span> : <span style={muted}>{formatNumber(pick(r).open)}</span>),
  },
]

const ownerColumns: readonly Column<{ key: string; owner: FormOwnerDto | null; cells: FormTotals }>[] = [
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
            {r.owner.product !== 'Boshqa' && (
              <span className="text-[11px] font-normal" style={muted}>
                · {PRODUCT_LABEL[r.owner.product]}
              </span>
            )}
          </span>
          <OwnerSources owner={r.owner} />
        </span>
      ),
  },
  { key: 'spend', header: 'Sarf', align: 'right', numeric: true, render: (r) => money(r.cells.spendUsd) },
  { key: 'meta', header: 'Meta lid', align: 'right', numeric: true, render: (r) => count(r.cells.metaLeads) },
  {
    key: 'leads',
    header: 'Bitrix24 lid',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{count(r.cells.outcome.leads)}</span>,
  },
  {
    key: 'reach',
    header: 'Yetib keldi',
    align: 'right',
    numeric: true,
    render: (r) => <Reach value={r.cells.reachPercent} meta={r.cells.metaLeads} />,
  },
  ...outcomeColumns<{ cells: FormTotals }>((r) => r.cells.outcome),
  { key: 'cpl', header: 'Lid narxi', align: 'right', numeric: true, render: (r) => money(r.cells.costPerLeadUsd) },
  {
    key: 'cps',
    header: 'Kval narxi',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{money(r.cells.costPerSuccessUsd)}</span>,
  },
]

/** Forms the portal saw, then the Meta accounts — or which half is missing. */
function OwnerSources({ owner }: { owner: FormOwnerDto }) {
  const forms = owner.forms.length > 0 ? `Forma: ${owner.forms.join(', ')}` : 'Bitrix24 da formasi yoʻq'
  const accounts = owner.accounts.length > 0 ? `Meta: ${owner.accounts.join(', ')}` : 'Meta akkaunti bogʻlanmagan'
  return (
    <>
      <span className="max-w-[300px] truncate text-[11px] font-normal" style={muted} title={forms}>
        {forms}
      </span>
      <span className="max-w-[300px] truncate text-[11px] font-normal" style={muted} title={accounts}>
        {accounts}
      </span>
    </>
  )
}

/** A reach under 60% is the finding this table exists for — it is coloured. */
function Reach({ value, meta }: { value: number | null; meta: number }) {
  if (value === null) return <span style={muted}>{meta === 0 ? '—' : '0%'}</span>
  const low = value < 60
  return (
    <span className="font-medium" style={low ? { color: 'var(--status-warning)' } : undefined}>
      {pct(value)}
    </span>
  )
}

const formDayColumns: readonly Column<DayRow<FormDayDto>>[] = [
  { key: 'date', header: 'Kun', rowHeader: true, render: (r) => <DayCell date={r.date} /> },
  { key: 'meta', header: 'Meta lid', align: 'right', numeric: true, render: (r) => count(r.cells.metaLeads) },
  {
    key: 'leads',
    header: 'Bitrix24 lid',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{count(r.cells.leads)}</span>,
  },
  {
    key: 'reach',
    header: 'Yetib keldi',
    align: 'right',
    numeric: true,
    render: (r) => (
      <Reach value={r.cells.metaLeads > 0 ? (r.cells.leads / r.cells.metaLeads) * 100 : null} meta={r.cells.metaLeads} />
    ),
  },
  { key: 'success', header: 'Kval', align: 'right', numeric: true, render: (r) => count(r.cells.success) },
  {
    key: 'successPercent',
    header: 'Kval %',
    align: 'right',
    numeric: true,
    render: (r) => pct(r.cells.leads > 0 ? (r.cells.success / r.cells.leads) * 100 : null),
  },
]

// --- DM ---------------------------------------------------------------------

function DmBlock({ data, status }: { data: LeadSourcesOverviewDto | undefined; status: Status }) {
  const [slice, setSlice] = useState<string>('total')
  const pages = data?.dm.pages ?? []
  const chosen = pages.find((p) => p.key === slice)

  type PageRow = { key: string; page: DmPageDto | null; conversations: number; outcome: LeadOutcomeDto }
  const rows: PageRow[] =
    data && pages.length > 0
      ? [
          ...pages.map((p) => ({ key: p.key, page: p, conversations: p.conversations, outcome: p.outcome })),
          { key: 'total', page: null, conversations: data.dm.conversations, outcome: data.dm.outcome },
        ]
      : []

  const days = chosen ? chosen.days : data?.dm.days
  const dayTotal: DmDayDto | undefined = chosen
    ? { date: '', conversations: chosen.conversations, leads: chosen.outcome.leads, success: chosen.outcome.success }
    : data
      ? { date: '', conversations: data.dm.conversations, leads: data.dm.outcome.leads, success: data.dm.outcome.success }
      : undefined

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="DM sahifalar"
        hint="Murojaat — sahifaga Instagram’da yozgan har bir odam (Bitrix24 «ИИ обработка» voronkasi). Lid — shu sahifadan Регистрация ga tushgan bitimlar."
      />
      <TableCard title="Sahifalar — davr boʻyicha" hint="Murojaat → lid % — yozganlarning qanchasi Регистрация ga lid boʻlib tushgani.">
        <DataTable<PageRow>
          columns={pageColumns}
          rows={rows}
          rowKey={(r) => r.key}
          status={status}
          emptyTitle="Bu davrda murojaat ham, sahifa lidi ham yoʻq"
          minWidth={1080}
          maxHeight="none"
          stickyColumns={1}
          stickyLastRow
        />
      </TableCard>
      <TableCard
        title={`Kunlik — ${chosen ? chosen.name : 'barcha sahifalar'}`}
        action={
          <SlicePicker
            ariaLabel="Qaysi sahifa"
            value={chosen ? slice : 'total'}
            onChange={setSlice}
            options={[{ value: 'total', label: 'Jami' }, ...pages.map((p) => ({ value: p.key, label: p.name }))]}
          />
        }
      >
        <DataTable<DayRow<DmDayDto>>
          columns={dmDayColumns}
          rows={pages.length > 0 ? dayRowsOf(days, dayTotal) : []}
          rowKey={(r) => r.key}
          status={status}
          emptyTitle="Bu davrda murojaat yoʻq"
          minWidth={620}
          maxHeight="60dvh"
          stickyColumns={1}
          stickyLastRow
        />
      </TableCard>
    </section>
  )
}

const pageColumns: readonly Column<{ key: string; page: DmPageDto | null; conversations: number; outcome: LeadOutcomeDto }>[] = [
  {
    key: 'page',
    header: 'Sahifa',
    rowHeader: true,
    render: (r) =>
      r.page === null ? (
        <span className="eyebrow">Jami</span>
      ) : (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: r.page.product ? PRODUCT_TONE[r.page.product] : 'var(--axis)' }}
          />
          {r.page.name}
          {r.page.product === null && (
            <span className="text-[11px] font-normal" style={muted}>
              · reklama sahifasi emas
            </span>
          )}
        </span>
      ),
  },
  { key: 'conversations', header: 'Murojaat', align: 'right', numeric: true, render: (r) => count(r.conversations) },
  {
    key: 'leads',
    header: 'Lid',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{count(r.outcome.leads)}</span>,
  },
  {
    key: 'leadPercent',
    header: 'Murojaat → lid',
    align: 'right',
    numeric: true,
    render: (r) => pct(r.conversations > 0 ? (r.outcome.leads / r.conversations) * 100 : null),
  },
  ...outcomeColumns<{ outcome: LeadOutcomeDto }>((r) => r.outcome),
  {
    key: 'c2s',
    header: 'Murojaat → kval',
    align: 'right',
    numeric: true,
    render: (r) => pct(r.conversations > 0 ? (r.outcome.success / r.conversations) * 100 : null),
  },
]

const dmDayColumns: readonly Column<DayRow<DmDayDto>>[] = [
  { key: 'date', header: 'Kun', rowHeader: true, render: (r) => <DayCell date={r.date} /> },
  { key: 'conversations', header: 'Murojaat', align: 'right', numeric: true, render: (r) => count(r.cells.conversations) },
  {
    key: 'leads',
    header: 'Lid',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{count(r.cells.leads)}</span>,
  },
  {
    key: 'leadPercent',
    header: 'Murojaat → lid',
    align: 'right',
    numeric: true,
    render: (r) => pct(r.cells.conversations > 0 ? (r.cells.leads / r.cells.conversations) * 100 : null),
  },
  { key: 'success', header: 'Kval', align: 'right', numeric: true, render: (r) => count(r.cells.success) },
  {
    key: 'successPercent',
    header: 'Kval %',
    align: 'right',
    numeric: true,
    render: (r) => pct(r.cells.leads > 0 ? (r.cells.success / r.cells.leads) * 100 : null),
  },
]

// --- every source -----------------------------------------------------------

function SourcesBlock({ data, status }: { data: LeadSourcesOverviewDto | undefined; status: Status }) {
  type Row = { key: string; channel: LeadChannel | null; name: string; outcome: LeadOutcomeDto; subtotal: boolean }
  const rows: Row[] = []
  if (data && data.totals.registration.leads > 0) {
    for (const c of data.channels) {
      if (c.outcome.leads === 0) continue
      rows.push({ key: `channel|${c.channel}`, channel: c.channel, name: CHANNEL_LABEL[c.channel], outcome: c.outcome, subtotal: true })
      for (const s of data.sources.filter((x: SourceRowDto) => x.channel === c.channel)) {
        rows.push({ key: s.key, channel: s.channel, name: s.name, outcome: s.outcome, subtotal: false })
      }
    }
    rows.push({ key: 'total', channel: null, name: 'Jami', outcome: data.totals.registration, subtotal: true })
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="Barcha manbalar · Регистрация"
        hint="Регистрация voronkasiga tushgan har bir bitim — reklamadan boʻlmaganlari ham. Qalin qator — kanal jami, ostida uning manbalari."
      />
      <Card className="min-w-0 p-0">
        <DataTable<Row>
          columns={[
            {
              key: 'name',
              header: 'Manba',
              rowHeader: true,
              render: (r) =>
                r.channel === null ? (
                  <span className="eyebrow">Jami</span>
                ) : r.subtotal ? (
                  <span className="font-semibold">{r.name}</span>
                ) : (
                  <span className="pl-3">{r.name}</span>
                ),
            },
            {
              key: 'leads',
              header: 'Lid',
              align: 'right',
              numeric: true,
              render: (r) => <span className={r.subtotal ? 'font-semibold' : undefined}>{count(r.outcome.leads)}</span>,
            },
            ...outcomeColumns<Row>((r) => r.outcome),
          ]}
          rows={rows}
          rowKey={(r) => r.key}
          status={status}
          emptyTitle="Bu davrda Регистрация ga lid tushmagan"
          minWidth={860}
          maxHeight="70dvh"
          stickyColumns={1}
          stickyLastRow
        />
      </Card>
    </section>
  )
}

