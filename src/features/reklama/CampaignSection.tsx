'use client'

import { useMemo, useState } from 'react'

import { type Column, DataTable } from '@/components/ui/DataTable'
import { SectionHeader } from '@/components/ui/Stat'
import { formatDate, formatNumber } from '@/lib/format'
import { PRODUCT_LABEL, PRODUCT_TONE } from '@/features/target/targetTheme'

import type { CampaignChannel, CampaignDto } from './reklamaApi'
import { type Status, TableCard, SlicePicker, count, money, muted, pct } from './reklamaUi'

/**
 * Kampaniyalar — where the money under all three sheets actually went.
 *
 * The sheets stop at the targetolog; the first question after «whose cost per
 * lead went up» is «on which campaign». One row per Meta campaign that spent
 * in the window, priced by ITS OWN channel's result — Meta leads on a
 * lead-form campaign, conversations on a DM one — because a DM campaign's
 * cost per lead is a division by zero, not a bad campaign.
 *
 * Sorted in the browser: the whole window's list is already here (a month is
 * a few hundred rows), so a sort is not a request.
 */
const CHANNEL_LABEL: Readonly<Record<CampaignChannel, string>> = {
  form: 'Lid-forma',
  dm: 'DM',
  hiring: 'Vakansiya',
  other: 'Boshqa',
}

type Filter = 'all' | CampaignChannel
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

/** Null where the figure does not exist — no result to price, no impression to click through. */
const SORTERS: Readonly<Record<SortKey, (c: CampaignDto) => number | string | null>> = {
  spend: (c) => c.spendUsd,
  results: (c) => c.results,
  cpr: (c) => c.costPerResultUsd,
  crmLeads: (c) => c.crm?.matched ?? null,
  qual: (c) => c.crm?.qualified ?? null,
  noAnswer: (c) => c.crm?.noAnswer ?? null,
  lowQuality: (c) => c.crm?.lowQuality ?? null,
  duplicate: (c) => c.crm?.duplicate ?? null,
  open: (c) => c.crm?.open ?? null,
  qualPct: (c) => c.crm?.qualifiedPercent ?? null,
  cpq: (c) => c.crm?.costPerQualifiedUsd ?? null,
  ctr: (c) => c.ctrPercent,
  last: (c) => c.lastActive,
}

export function CampaignSection({
  campaigns,
  status,
}: {
  campaigns: readonly CampaignDto[] | undefined
  status: Status
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<SortKey>('spend')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')

  const all = campaigns ?? []
  const present = new Set(all.map((c) => c.channel))
  const rows = useMemo(() => {
    const pick = SORTERS[sort]
    const sign = order === 'asc' ? 1 : -1
    // filter() copies, so the sort never touches the query's cached array.
    return (campaigns ?? [])
      .filter((c) => filter === 'all' || c.channel === filter)
      .sort((a, b) => {
        const x = pick(a)
        const y = pick(b)
        /*
          A missing figure sinks to the bottom whichever way the reader sorts,
          so it is placed before the direction applies: as +Infinity a traffic
          campaign's absent price rose to the top of «Natija narxi» descending
          and pushed the dearest lead forms past the rows shown.
        */
        if (x === null || y === null) return x === y ? b.spendUsd - a.spendUsd : x === null ? 1 : -1
        return (x < y ? -1 : x > y ? 1 : 0) * sign || b.spendUsd - a.spendUsd
      })
  }, [campaigns, filter, sort, order])

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
        title="Kampaniyalar · Meta"
        hint="Davrda pul sarflagan har bir kampaniya: kimniki, qaysi kanal, natija va bitta natija narxi. Natija — lid-formada Meta lidi (narxi — CPL), DMda murojaat. Lid va undan keyingi ustunlar — kampaniyaning Meta lidi telefon boʻyicha Bitrix24 bitimiga ulangani: Kval — «Сделка успешна», qolganlari — bitim hozir turgan bosqich («Barcha manbalar»dagidek); kval narxi = sarf ÷ kval."
      />
      <TableCard
        title={`Kampaniyalar — ${formatNumber(rows.length)} ta`}
        hint="Ustun sarlavhasini bosib saralang."
        action={
          <SlicePicker<Filter>
            ariaLabel="Qaysi kanal"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Hammasi' },
              ...(['form', 'dm', 'hiring', 'other'] as const)
                .filter((c) => present.has(c))
                .map((c) => ({ value: c, label: CHANNEL_LABEL[c] })),
            ]}
          />
        }
      >
        <DataTable<CampaignDto>
          columns={columns}
          rows={rows}
          rowKey={(c) => c.id}
          status={status}
          emptyTitle="Bu davrda kampaniya sarfi yoʻq"
          minWidth={1900}
          maxHeight="70dvh"
          stickyColumns={1}
          sort={sort}
          order={order}
          onSort={onSort}
          initialRows={30}
          moreLabel={(hidden) => `Yana ${formatNumber(hidden)} ta kampaniya`}
        />
      </TableCard>
    </section>
  )
}

/** A portal figure of a campaign: «—» with no lead read (`crm` null) and for a zero, as `count` draws every zero here. */
const crmCount = (value: number | undefined) => (value === undefined ? <span style={muted}>—</span> : count(value))

const columns: readonly Column<CampaignDto>[] = [
  {
    key: 'name',
    header: 'Kampaniya',
    rowHeader: true,
    render: (c) => (
      <span className="flex flex-col leading-tight">
        <span className="max-w-[300px] truncate" title={c.name}>
          {c.name}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-normal" style={muted}>
          <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: PRODUCT_TONE[c.product] }} />
          {c.targetolog} · {PRODUCT_LABEL[c.product]} · {c.account}
        </span>
      </span>
    ),
  },
  {
    key: 'channel',
    header: 'Kanal',
    render: (c) => <span className="whitespace-nowrap">{CHANNEL_LABEL[c.channel]}</span>,
  },
  { key: 'spend', sortKey: 'spend', header: 'Sarf', align: 'right', numeric: true, render: (c) => money(c.spendUsd) },
  { key: 'results', sortKey: 'results', header: 'Natija', align: 'right', numeric: true, render: (c) => count(c.results) },
  {
    key: 'cpr',
    sortKey: 'cpr',
    header: 'Natija narxi',
    align: 'right',
    numeric: true,
    render: (c) => <span className="font-medium">{money(c.costPerResultUsd)}</span>,
  },
  {
    key: 'crmLeads',
    sortKey: 'crmLeads',
    header: 'Lid',
    align: 'right',
    numeric: true,
    render: (c) =>
      c.crm ? (
        <span className="flex flex-col items-end leading-tight">
          <span className="font-medium">{formatNumber(c.crm.matched)}</span>
          {/* How much of Meta's count the kval was looked for in — a short read is said, not hidden. */}
          <span
            className="whitespace-nowrap text-[11px] font-normal"
            style={muted}
            title={`Meta sanagan ${formatNumber(c.metaLeads)} liddan ${formatNumber(c.crm.leadsRead)} tasi oʻqildi, ${formatNumber(c.crm.matched)} tasi Bitrix24 bitimiga ulandi`}
          >
            Meta {formatNumber(c.metaLeads)} tadan
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
    render: (c) => <span className="font-medium">{crmCount(c.crm?.qualified)}</span>,
  },
  {
    key: 'qualPct',
    sortKey: 'qualPct',
    header: 'Kval %',
    align: 'right',
    numeric: true,
    render: (c) => pct(c.crm?.qualifiedPercent ?? null),
  },
  {
    key: 'cpq',
    sortKey: 'cpq',
    header: 'Kval narxi',
    align: 'right',
    numeric: true,
    render: (c) => <span className="font-medium">{money(c.crm?.costPerQualifiedUsd ?? null)}</span>,
  },
  { key: 'noAnswer', sortKey: 'noAnswer', header: 'Недозвон', align: 'right', numeric: true, render: (c) => crmCount(c.crm?.noAnswer) },
  { key: 'lowQuality', sortKey: 'lowQuality', header: 'Sifatsiz', align: 'right', numeric: true, render: (c) => crmCount(c.crm?.lowQuality) },
  { key: 'duplicate', sortKey: 'duplicate', header: 'Dubl', align: 'right', numeric: true, render: (c) => crmCount(c.crm?.duplicate) },
  { key: 'open', sortKey: 'open', header: 'Jarayonda', align: 'right', numeric: true, render: (c) => crmCount(c.crm?.open) },
  { key: 'clicks', header: 'Klik', align: 'right', numeric: true, render: (c) => count(c.clicks) },
  { key: 'ctr', sortKey: 'ctr', header: 'CTR', align: 'right', numeric: true, render: (c) => pct(c.ctrPercent) },
  { key: 'days', header: 'Faol kun', align: 'right', numeric: true, render: (c) => count(c.activeDays) },
  {
    key: 'last',
    sortKey: 'last',
    header: 'Oxirgi sarf',
    align: 'right',
    render: (c) =>
      c.lastActive ? (
        <span className="whitespace-nowrap">{formatDate(`${c.lastActive}T12:00:00Z`)}</span>
      ) : (
        <span style={muted}>—</span>
      ),
  },
]
