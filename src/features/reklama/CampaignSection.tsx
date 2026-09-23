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
type SortKey = 'spend' | 'results' | 'cpr' | 'ctr' | 'last'

const SORTERS: Readonly<Record<SortKey, (c: CampaignDto) => number | string>> = {
  spend: (c) => c.spendUsd,
  results: (c) => c.results,
  // Unpriced sinks to the bottom whichever way the reader sorts.
  cpr: (c) => c.costPerResultUsd ?? Number.POSITIVE_INFINITY,
  ctr: (c) => c.ctrPercent ?? -1,
  last: (c) => c.lastActive ?? '',
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
        return (x < y ? -1 : x > y ? 1 : 0) * sign || b.spendUsd - a.spendUsd
      })
  }, [campaigns, filter, sort, order])

  const onSort = (key: string) => {
    const next = key as SortKey
    if (next === sort) setOrder(order === 'asc' ? 'desc' : 'asc')
    else {
      setSort(next)
      // A price is best low, everything else is best high.
      setOrder(next === 'cpr' ? 'asc' : 'desc')
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="Kampaniyalar · Meta"
        hint="Davrda pul sarflagan har bir kampaniya: kimniki, qaysi kanal, natija va bitta natija narxi. Natija — lid-formada Meta lidi, DMda murojaat."
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
          minWidth={1120}
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
