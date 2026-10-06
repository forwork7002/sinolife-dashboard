'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { apiGet } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'

/**
 * «Javobsiz qolgan raqamlar» — the tiles' «N tasi javobsiz qoldi», number by
 * number, so somebody can ring them back (the client, 2026-10-06). Mirrors
 * `UnansweredCallsDto` in `server/services/inboundCallsService.ts`; nothing
 * checks the mirror, edit both.
 */
type Group = 'fresh' | 'notReached' | 'talkedNoBuy' | 'buyer' | 'noDeal'

interface UnansweredCallerDto {
  readonly key: string
  readonly phone: string
  readonly tel: string | null
  readonly group: Group
  readonly contact: { readonly name: string; readonly bitrixId: string | null } | null
  readonly calls: number
  readonly firstCallAt: string
  readonly lastCallAt: string
  readonly operator: string | null
  readonly callback: {
    readonly at: string
    readonly talked: boolean
    readonly operator: string | null
    readonly attempts: number
  } | null
}

interface UnansweredCallsDto {
  readonly rows: readonly UnansweredCallerDto[]
  readonly waiting: number
  readonly calledBack: number
  readonly reached: number
}

type State = 'all' | 'waiting' | 'tried' | 'reached'

const muted = { color: 'var(--ink-muted)' } as const

function stateOf(r: UnansweredCallerDto): Exclude<State, 'all'> {
  return r.callback === null ? 'waiting' : r.callback.talked ? 'reached' : 'tried'
}

/** The portal's own contact card. */
function bitrixContactUrl(bitrixId: string): string {
  return `https://obey.bitrix24.kz/crm/contact/details/${encodeURIComponent(bitrixId)}/`
}

function columns(groupLabel: Record<Group, string>): Column<UnansweredCallerDto>[] {
  return [
    {
      key: 'phone',
      header: 'Raqam',
      rowHeader: true,
      render: (r) =>
        r.tel ? (
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
    { key: 'group', header: 'Guruh', render: (r) => groupLabel[r.group] },
    { key: 'calls', header: 'Qoʻngʻiroq', align: 'right', numeric: true, render: (r) => formatNumber(r.calls) },
    { key: 'lastCallAt', header: 'Oxirgisi', render: (r) => formatDateTime(r.lastCallAt) },
    { key: 'operator', header: 'Kimga tushgan', render: (r) => r.operator ?? <span style={muted}>—</span> },
    {
      key: 'callback',
      header: 'Qayta qoʻngʻiroq',
      render: (r) => {
        const state = stateOf(r)
        if (state === 'waiting' || r.callback === null) {
          return <span style={{ color: 'var(--status-critical)' }}>● Qilinmagan</span>
        }
        const who = r.callback.operator ? ` · ${r.callback.operator}` : ''
        return state === 'reached' ? (
          <span style={{ color: 'var(--status-good)' }}>
            ● Gaplashildi, {formatDateTime(r.callback.at)}
            {who}
          </span>
        ) : (
          <span style={{ color: 'var(--status-warning)' }}>
            ● Ulanmadi ({formatNumber(r.callback.attempts)} urinish), {formatDateTime(r.callback.at)}
            {who}
          </span>
        )
      },
    },
  ]
}

export function UnansweredCallsCard({
  windowParams,
  groupLabel,
}: {
  windowParams: Record<string, string | number>
  groupLabel: Record<Group, string>
}) {
  const query = useQuery({
    queryKey: ['insights-calls-inbound-unanswered', windowParams],
    queryFn: ({ signal }) => apiGet<UnansweredCallsDto>('/insights/calls/inbound/unanswered', windowParams, signal),
  })
  const [state, setState] = useState<State>('waiting')
  const [group, setGroup] = useState<Group | 'all'>('all')

  const data = query.data?.data
  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'
  const rows = (data?.rows ?? []).filter(
    (r) => (state === 'all' || stateOf(r) === state) && (group === 'all' || r.group === group),
  )
  const n = (v: number | undefined) => (data ? ` · ${formatNumber(v ?? 0)}` : '')

  return (
    <ChartCard
      title="Javobsiz qolgan raqamlar"
      hint="Davr ichida qoʻngʻiroq qilib, bironta ham soniya gaplasha olmagan raqamlar. «Qayta qoʻngʻiroq» — oxirgi kiruvchi qoʻngʻiroqdan keyin shu raqamga chiquvchi qoʻngʻiroq qilinganmi (bugungacha). Raqamni bossangiz — telefon, kontaktni bossangiz — Bitrix24 kartasi ochiladi. Raqami aniqlanmagan qoʻngʻiroqlar roʻyxatda yoʻq. Qoʻngʻiroqlar — kiruvchi ham, qayta qoʻngʻiroq ham — Bitrix24 dan har ~3 soatda keladi: hozirgina qilingan qayta qoʻngʻiroq keyingi yuklashgacha «Qilinmagan» boʻlib turishi mumkin."
    >
      <div className="flex flex-col gap-2 px-5 pb-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
          <div className="inline-flex">
            <SegmentedControl<State>
              value={state}
              onChange={setState}
              ariaLabel="Qayta qoʻngʻiroq holati"
              options={[
                { value: 'waiting', label: `Qilinmagan${n(data?.waiting)}` },
                { value: 'tried', label: `Ulanmadi${n(data ? data.calledBack - data.reached : 0)}` },
                { value: 'reached', label: `Gaplashildi${n(data?.reached)}` },
                { value: 'all', label: `Hammasi${n(data?.rows.length)}` },
              ]}
            />
          </div>
        </div>
        <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
          <div className="inline-flex">
            <SegmentedControl<Group | 'all'>
              value={group}
              onChange={setGroup}
              ariaLabel="Guruh"
              options={[
                { value: 'all', label: 'Barcha guruhlar' },
                ...(Object.keys(groupLabel) as Group[]).map((g) => ({ value: g, label: groupLabel[g] })),
              ]}
            />
          </div>
        </div>
      </div>
      <DataTable<UnansweredCallerDto>
        columns={columns(groupLabel)}
        rows={rows}
        rowKey={(r) => r.key}
        status={status}
        errorMessage={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        stickyColumns={1}
        minWidth={980}
        initialRows={50}
        emptyTitle={
          data && data.rows.length === 0
            ? 'Bu davrda javobsiz qolgan raqam yoʻq'
            : state === 'waiting' && group === 'all'
              ? 'Hammasiga qayta qoʻngʻiroq qilingan'
              : 'Bu tanlov boʻyicha raqam yoʻq'
        }
      />
    </ChartCard>
  )
}
