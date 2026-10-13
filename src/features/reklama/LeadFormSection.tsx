'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'

import { type Column, DataTable } from '@/components/ui/DataTable'
import { formatDate, formatNumber } from '@/lib/format'
import { PRODUCT_LABEL, PRODUCT_TONE } from '@/features/target/targetTheme'

import type { LeadFormDto } from './reklamaApi'
import { type Status, count, money, muted, pct } from './reklamaUi'

/**
 * Formalar — every Meta LEAD FORM, one row each, as Facebook lists it.
 *
 * Asked for on 2026-10-10 («har bitta formani alohida»); since 2026-10-13
 * it is the «Formalar · Meta» tab of «Lid sifati» (`QualitySection`) and
 * took «Kampaniyalar»' place («shuni formalarga oʻzgartirish … facebookdagi
 * formalardan olinishi kerak»): the portal's deal names its form, never its
 * campaign, so the form is the row a registrar and a targetolog both
 * recognise. The first columns are SinoTarget's «Formalar» — page, form,
 * status, created, Meta's all-time leads — read from the pages' own form
 * lists (`meta_lead_form`), so a quiet form is listed too. The rest is the
 * window: the form's ads' money, Meta's leads and the portal's outcome.
 *
 * A form's money is its ads' — an ad is filed under the form its own leads
 * came through — so lead-form money no read lead names a form for stands on
 * its own row, «Forma aniqlanmagan», rather than being spread over the rest.
 */
type SortKey =
  | 'status'
  | 'created'
  | 'total'
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

/** Null where the figure does not exist — no lead to price, no impression to click through, no list to read. */
const SORTERS: Readonly<Record<SortKey, (f: LeadFormDto) => number | string | null>> = {
  // SinoTarget's «Tartib: Holati»: Faol, then Faol emas, then Qoralama; newest first inside each (`statusThenNewest`).
  status: (f) => (f.status === null ? null : (STATUS_RANK[f.status] ?? 3)),
  created: (f) => f.createdTime,
  total: (f) => f.totalLeads,
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

/** Meta's statuses as SinoTarget and Meta Business Suite name them; a deleted form never reaches the page. */
const STATUS_LABEL: Readonly<Record<string, string>> = { ACTIVE: 'Faol', ARCHIVED: 'Faol emas', DRAFT: 'Qoralama' }

const STATUS_RANK: Readonly<Record<string, number>> = { ACTIVE: 0, ARCHIVED: 1, DRAFT: 2 }

type Filter = 'all' | 'ACTIVE' | 'ARCHIVED' | 'DRAFT'
const FILTERS: readonly Exclude<Filter, 'all'>[] = ['ACTIVE', 'ARCHIVED', 'DRAFT']

/** «Tartib», as SinoTarget offers it, plus the window's money. */
const ORDERS: readonly { key: SortKey; label: string }[] = [
  { key: 'status', label: 'Holati' },
  { key: 'created', label: 'Yaratilgan sana' },
  { key: 'total', label: 'Jami lidlar' },
  { key: 'spend', label: 'Sarf' },
]

const selectStyle = { background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }

/*
  Two identity columns are pinned from a tablet up — page and form, as
  SinoTarget reads — and none on a phone, where the pair alone would be
  the whole screen.
*/
const WIDE = '(min-width: 768px)'
function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const useWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  )

export function LeadFormTable({ forms, status }: { forms: readonly LeadFormDto[] | undefined; status: Status }) {
  const [page, setPage] = useState('all')
  const [filter, setFilter] = useState<Filter>('all')
  // SinoTarget opens on «Tartib: Holati»: every Faol form first, the newest on top.
  const [sort, setSort] = useState<SortKey>('status')
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')
  const wide = useWide()

  const present = useMemo(() => new Set((forms ?? []).map((f) => f.status)), [forms])
  const pages = useMemo(() => {
    const byId = new Map<string, string>()
    for (const f of forms ?? []) if (f.pageId !== null && f.pageName !== null) byId.set(f.pageId, f.pageName)
    return [...byId.entries()].sort(([, a], [, b]) => a.localeCompare(b, 'ru'))
  }, [forms])
  // A choice the new brand or period no longer has falls back to all, never to an empty table with nothing chosen.
  const shown: Filter = filter === 'all' || present.has(filter) ? filter : 'all'
  const shownPage = page === 'all' || pages.some(([id]) => id === page) ? page : 'all'

  const rows = useMemo(() => {
    const pick = SORTERS[sort]
    const sign = order === 'asc' ? 1 : -1
    // A copy, so the sort never touches the query's cached array.
    return (forms ?? [])
      .filter((f) => (shown === 'all' || f.status === shown) && (shownPage === 'all' || f.pageId === shownPage))
      .sort((a, b) => {
        const x = pick(a)
        const y = pick(b)
        // A missing figure sinks to the bottom whichever way the reader sorts.
        if (x === null || y === null) return x === y ? b.spendUsd - a.spendUsd : x === null ? 1 : -1
        const byKey = (x < y ? -1 : x > y ? 1 : 0) * sign
        // Inside one status, the newest form first — SinoTarget's order.
        if (sort === 'status') return byKey || (b.createdTime ?? '').localeCompare(a.createdTime ?? '')
        return byKey || b.spendUsd - a.spendUsd
      })
  }, [forms, shown, shownPage, sort, order])

  const sortBy = (next: SortKey) => {
    setSort(next)
    // A price and the status order read best first from the top; every count, from the biggest.
    setOrder(next === 'cpr' || next === 'cpq' || next === 'status' ? 'asc' : 'desc')
  }
  const onSort = (key: string) => {
    const next = key as SortKey
    if (next === sort) setOrder(order === 'asc' ? 'desc' : 'asc')
    else sortBy(next)
  }

  // Every row neither listed nor read: the token behind the hourly pass cannot open the forms' pages.
  const unread = status === 'ready' && rows.length > 0 && rows.every((f) => f.crm === null && f.status === null)

  return (
    <>
      {unread && (
        <div
          role="status"
          className="mx-5 mb-3 rounded-[var(--radius-panel-sm)] px-4 py-3 text-xs leading-relaxed"
          style={{
            background: 'color-mix(in oklab, var(--status-warning) 10%, transparent)',
            boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--status-warning) 35%, transparent)',
            color: 'var(--ink-secondary)',
          }}
        >
          <strong className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
            Meta’dan formalar oʻqilmayapti.
          </strong>{' '}
          Serverdagi Meta tokeni lid-forma sahifalarini koʻrmayapti (pages_show_list, pages_manage_ads va
          leads_retrieval ruxsatlari hamda sahifalarga kirish kerak). Token yangilansa, Facebook’dagi har bir forma
          keyingi soatlik yangilanishda shu yerda chiqadi.
        </div>
      )}
      <div className="grid gap-3 px-5 pb-3 sm:grid-cols-3">
        <FilterSelect label="Sahifa" value={shownPage} onChange={setPage}>
          <option value="all">Barcha sahifalar</option>
          {pages.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Holati" value={shown} onChange={(v) => setFilter(v as Filter)}>
          <option value="all">Hammasi</option>
          {FILTERS.filter((s) => present.has(s)).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Tartib" value={sort} onChange={(v) => sortBy(v as SortKey)}>
          {ORDERS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
          {/* A column sorted from its header keeps its name here. */}
          {!ORDERS.some((o) => o.key === sort) && <option value={sort}>Ustun boʻyicha</option>}
        </FilterSelect>
      </div>
      <p className="px-5 pb-2 text-xs" style={muted}>
        <strong className="tabular font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {formatNumber(rows.length)}
        </strong>{' '}
        ta forma
      </p>
      <DataTable<LeadFormDto>
        columns={columns}
        rows={rows}
        rowKey={(f) => f.id || 'unknown'}
        status={status}
        emptyTitle="Lid-forma topilmadi"
        minWidth={2320}
        maxHeight="70dvh"
        stickyColumns={wide ? 2 : 0}
        sort={sort}
        order={order}
        onSort={onSort}
        initialRows={30}
        moreLabel={(hidden) => `Yana ${formatNumber(hidden)} ta forma`}
      />
    </>
  )
}

/** A portal figure of a form: «—» with no lead read (`crm` null) and for a zero, as `count` draws every zero here. */
const crmCount = (value: number | undefined) => (value === undefined ? <span style={muted}>—</span> : count(value))

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium" style={muted}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="focusable h-10 min-w-0 rounded-[var(--radius-panel-sm)] border px-3 text-sm"
        style={selectStyle}
      >
        {children}
      </select>
    </label>
  )
}

/** Whose form it is, in one quiet line — or why nobody's. */
function ownerLine(f: LeadFormDto): string {
  if (f.targetolog === null) return 'Bu davrda reklama sarfi yoʻq'
  const campaigns = f.campaigns > 0 ? ` · ${formatNumber(f.campaigns)} ta kampaniya` : ''
  return `${f.targetolog} · ${PRODUCT_LABEL[f.product]} · ${f.accounts.join(', ')}${campaigns}`
}

function StatusChip({ status }: { status: string | null }) {
  if (status === null) return <span style={muted}>—</span>
  const active = status === 'ACTIVE'
  const tone = active ? 'var(--status-good)' : 'var(--ink-muted)'
  return (
    <span
      className="inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap"
      style={{ background: `color-mix(in oklab, ${tone} 12%, transparent)`, color: tone }}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

const columns: readonly Column<LeadFormDto>[] = [
  {
    key: 'page',
    header: 'Sahifa',
    render: (f) =>
      f.pageName === null ? (
        <span style={muted}>{f.id === '' ? '—' : 'Sahifa roʻyxatida yoʻq'}</span>
      ) : (
        <span className="flex flex-col leading-tight">
          <span className="max-w-[170px] truncate" title={f.pageName}>
            {f.pageName}
          </span>
          <span className="tabular text-[11px] font-normal" style={muted}>
            {f.pageId}
          </span>
        </span>
      ),
  },
  {
    key: 'name',
    header: 'Forma nomi',
    rowHeader: true,
    render: (f) => (
      <span className="flex flex-col leading-tight">
        <span className="max-w-[260px] truncate font-medium" title={f.name || undefined}>
          {f.id === '' ? 'Forma aniqlanmagan' : f.name || f.id}
        </span>
        <span className="tabular text-[11px] font-normal" style={muted}>
          {f.id === '' ? 'lid oʻqilmagan reklama sarfi' : f.id}
        </span>
      </span>
    ),
  },
  { key: 'status', sortKey: 'status', header: 'Holati', render: (f) => <StatusChip status={f.status} /> },
  {
    key: 'created',
    sortKey: 'created',
    header: 'Yaratilgan sana',
    align: 'right',
    render: (f) =>
      f.createdTime ? <span className="whitespace-nowrap">{formatDate(f.createdTime)}</span> : <span style={muted}>—</span>,
  },
  {
    key: 'total',
    sortKey: 'total',
    header: 'Jami lidlar',
    align: 'right',
    numeric: true,
    render: (f) =>
      f.totalLeads === null ? (
        <span style={muted}>—</span>
      ) : (
        <span className="font-semibold" title="Meta’dagi jami lidlar — forma ochilgandan beri, davrdan qatʼi nazar">
          {formatNumber(f.totalLeads)}
        </span>
      ),
  },
  {
    key: 'owner',
    header: 'Targetolog',
    render: (f) => (
      <span className="inline-flex max-w-[260px] items-center gap-1.5 text-xs" style={f.targetolog === null ? muted : undefined}>
        {f.targetolog !== null && (
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: PRODUCT_TONE[f.product] }} />
        )}
        <span className="truncate" title={ownerLine(f)}>
          {ownerLine(f)}
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
