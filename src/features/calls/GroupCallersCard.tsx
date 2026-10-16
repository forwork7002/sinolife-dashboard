'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { statusOf } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { MultiplyGlyph } from '@/components/ui/Icons'
import { StatusChip } from '@/components/ui/Stat'
import { apiGet } from '@/lib/api'
import { NO_VALUE, formatDateTime, formatDuration, formatNumber, formatTime } from '@/lib/format'

import { bitrixContactUrl } from './UnansweredCallsCard'

/**
 * A group tile opened up — «Соф янги» first (the client, 2026-10-16: «ustiga
 * bossa aniq koʻrinsin qaysi qoʻngʻiroqlar»), laid out as their own sheet:
 * time, number, calls, connected, seconds of talk, callbacks. Mirrors
 * `GroupCallersDto` in `server/services/inboundCallsService.ts`; nothing
 * checks the mirror, edit both.
 */
export type InboundGroup = 'fresh' | 'notReached' | 'talkedNoBuy' | 'buyer' | 'noDeal'

interface GroupCallerDto {
  readonly key: string
  readonly phone: string | null
  readonly tel: string | null
  readonly contact: { readonly name: string; readonly bitrixId: string | null } | null
  readonly calls: number
  readonly talked: boolean
  readonly talkSec: number
  readonly firstCallAt: string
  readonly lastCallAt: string
  readonly callback: {
    readonly at: string
    readonly talked: boolean
    readonly operator: string | null
    readonly attempts: number
  } | null
}

interface GroupCallersDto {
  readonly group: InboundGroup
  readonly rows: readonly GroupCallerDto[]
}

type Row = GroupCallerDto & { readonly n: number }
type Filter = 'all' | 'talked' | 'unreached'

const muted = { color: 'var(--ink-muted)' } as const

function columns(singleDay: boolean): Column<Row>[] {
  return [
    { key: 'n', header: '№', align: 'right', numeric: true, render: (r) => r.n },
    {
      key: 'firstCallAt',
      header: 'Vaqt',
      numeric: true,
      render: (r) => (singleDay ? formatTime(r.firstCallAt) : formatDateTime(r.firstCallAt)),
    },
    {
      key: 'phone',
      header: 'Telefon',
      rowHeader: true,
      render: (r) =>
        r.phone === null ? (
          <span style={muted}>Raqam aniqlanmagan</span>
        ) : r.tel ? (
          <a href={`tel:${r.tel}`} className="font-medium tabular-nums underline-offset-2 hover:underline">
            {r.phone}
          </a>
        ) : (
          <span className="font-medium tabular-nums">{r.phone}</span>
        ),
    },
    {
      key: 'contact',
      header: 'Kontakt',
      render: (r) =>
        r.contact === null ? (
          <span style={muted}>Bitrix24da yoʻq</span>
        ) : r.contact.bitrixId ? (
          <a
            href={bitrixContactUrl(r.contact.bitrixId)}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {r.contact.name || 'Nomsiz'} ↗
          </a>
        ) : (
          r.contact.name || 'Nomsiz'
        ),
    },
    { key: 'calls', header: 'Qoʻngʻiroq soni', align: 'right', numeric: true, render: (r) => formatNumber(r.calls) },
    {
      key: 'talked',
      header: 'Kiruvchida ulangan',
      render: (r) => (r.talked ? <StatusChip tone="good">Ha</StatusChip> : <StatusChip tone="critical">Yoʻq</StatusChip>),
    },
    {
      key: 'talkSec',
      header: 'Suhbat (soniya)',
      align: 'right',
      numeric: true,
      render: (r) => <span title={r.talkSec >= 60 ? formatDuration(r.talkSec) : undefined}>{formatNumber(r.talkSec)}</span>,
    },
    {
      key: 'callback',
      header: 'Qayta qoʻngʻiroq',
      align: 'right',
      numeric: true,
      render: (r) => formatNumber(r.callback?.attempts ?? 0),
    },
    {
      key: 'callbackTalked',
      header: 'Qayta qoʻngʻiroqda ulangan',
      render: (r) =>
        r.callback === null ? (
          <span style={muted}>{NO_VALUE}</span>
        ) : r.callback.talked ? (
          <StatusChip tone="good">
            Ha, {singleDay ? formatTime(r.callback.at) : formatDateTime(r.callback.at)}
            {r.callback.operator ? ` · ${r.callback.operator}` : ''}
          </StatusChip>
        ) : (
          <StatusChip tone="warning">Yoʻq</StatusChip>
        ),
    },
  ]
}

/** The card's id, for the open tile's `aria-controls` — one card at a time. */
export const GROUP_CALLERS_ID = 'inbound-group-callers'

/**
 * Mount it with `key={group}`: the app keeps a query's previous answer on
 * screen while a new key loads (`placeholderData` in `providers.tsx`), so a
 * card that only changed its key would print «Соф янги»'s numbers under
 * «Эски харидор» until the request landed — and keep the filter.
 */
export function GroupCallersCard({
  windowParams,
  group,
  label,
  onClose,
}: {
  windowParams: Record<string, string | number>
  group: InboundGroup
  label: string
  onClose: () => void
}) {
  const query = useQuery({
    queryKey: ['insights-calls-inbound-callers', group, windowParams],
    queryFn: ({ signal }) =>
      apiGet<GroupCallersDto>('/insights/calls/inbound/callers', { ...windowParams, group }, signal),
  })
  const [filter, setFilter] = useState<Filter>('all')
  const ref = useRef<HTMLDivElement>(null)

  // The tiles sit above the card: on a phone the list opens below the fold.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [group])

  const data = query.data?.data
  // The list's OWN window, not the tile's: one day prints the hour alone, as the client's sheet does.
  const singleDay = (query.data?.meta.period?.days ?? 2) <= 1
  const all = data?.rows ?? []
  const talked = all.filter((r) => r.talked).length
  const rows: Row[] = all
    .map((r, i) => ({ ...r, n: i + 1 }))
    .filter((r) => filter === 'all' || (filter === 'talked' ? r.talked : !r.talked))
  const n = (v: number) => (data ? ` · ${formatNumber(v)}` : '')

  return (
    <div ref={ref} id={GROUP_CALLERS_ID} data-testid="inbound-group-callers">
      <ChartCard
        title={`${label} — raqamlar roʻyxati${data ? ` · ${formatNumber(all.length)} ta` : ''}`}
        hint="Tiledagi har bir raqam bir qator, birinchi qoʻngʻirogʻi vaqti boʻyicha. «Qoʻngʻiroq soni» va «Suhbat» — davrdagi kiruvchi qoʻngʻiroqlari. «Qayta qoʻngʻiroq» — oxirgi kiruvchi qoʻngʻiroqdan keyin shu raqamga qilingan chiquvchi qoʻngʻiroqlar (bugungacha), pastdagi roʻyxatdagidek. Qoʻngʻiroqlar Bitrix24 dan har ~3 soatda keladi."
        action={
          <Button variant="ghost" size="sm" icon={<MultiplyGlyph />} onClick={onClose} aria-label="Roʻyxatni yopish">
            Yopish
          </Button>
        }
      >
        <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-3">
          <div className="inline-flex">
            <SegmentedControl<Filter>
              value={filter}
              onChange={setFilter}
              ariaLabel="Kiruvchida ulangan"
              options={[
                { value: 'all', label: `Hammasi${n(all.length)}` },
                { value: 'talked', label: `Ulangan${n(talked)}` },
                { value: 'unreached', label: `Ulanmagan${n(all.length - talked)}` },
              ]}
            />
          </div>
        </div>
        <DataTable<Row>
          columns={columns(singleDay)}
          rows={rows}
          rowKey={(r) => r.key}
          status={statusOf(query)}
          errorMessage={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          minWidth={1040}
          initialRows={100}
          emptyTitle={all.length === 0 ? 'Bu guruhda raqam yoʻq' : 'Bu tanlov boʻyicha raqam yoʻq'}
        />
      </ChartCard>
    </div>
  )
}
