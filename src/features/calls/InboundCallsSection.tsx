'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { ChartCard } from '@/components/ui/Card'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { StatTile } from '@/components/ui/Stat'
import { apiGet } from '@/lib/api'
import { NO_VALUE, formatDateTime, formatNumber, formatPercent } from '@/lib/format'

import { UnansweredCallsCard } from './UnansweredCallsCard'

/**
 * «Kiruvchi qoʻngʻiroqlar» — the client's inbound-call report, 2026-10-05.
 * Mirrors `InboundCallsDto` in `server/services/inboundCallsService.ts`;
 * nothing checks the mirror, edit both.
 */
const GROUPS = ['fresh', 'notReached', 'talkedNoBuy', 'buyer', 'noDeal'] as const
type Group = (typeof GROUPS)[number]
type GroupCounts = Record<Group, number>

interface InboundDayDto {
  readonly day: string
  readonly calls: number
  readonly numbers: number
  readonly talked: number
  readonly talkedPercent: number | null
  readonly outbound: number
  readonly groups: GroupCounts
  readonly unfinished: boolean
}

export interface InboundCallsDto {
  readonly days: readonly InboundDayDto[]
  readonly total: {
    readonly calls: number
    readonly numbers: number
    readonly talked: number
    readonly talkedPercent: number | null
    readonly outbound: number
    readonly groups: GroupCounts
    readonly unreached: GroupCounts
  }
  readonly lastCallAt: string | null
  readonly undatedContacts: number
  readonly floorApplied: boolean
}

const GROUP_LABEL: Record<Group, string> = {
  fresh: 'Соф янги',
  notReached: 'Бор, гаплашилмаган',
  talkedNoBuy: 'Гаплашилган, олмаган',
  buyer: 'Эски харидор',
  noDeal: 'Сделкасиз',
}

const GROUP_RULE: Record<Group, string> = {
  fresh: 'Qoʻngʻiroq paytida raqam Bitrix24da yoʻq edi — kontakt birinchi qoʻngʻiroqdan 5 daqiqa oldin yoki undan keyin yaratilgan.',
  notReached: 'Kontakt avval bor, sdelkalari hanuz Регистрацияda — sotuv boʻlimiga hech qachon oʻtmagan.',
  talkedNoBuy: 'Первичка yoki Тасдиклашga oʻtgan sdelkasi bor (yoki Регистрацияda «Сделка успешна»), lekin xarid yoʻq.',
  buyer: 'Доставка yoki База voronkasida sdelkasi bor.',
  noDeal: 'Kontakt bor, lekin qoʻngʻiroqdan oldin birorta sdelkasi yoʻq.',
}

const muted = { color: 'var(--ink-muted)' } as const

/** `2026-10-05` → `05.10`. */
const dayLabel = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`

type Row = InboundDayDto & { readonly isTotal?: boolean }

const count = (n: number) => formatNumber(n)

const COLUMNS: readonly Column<Row>[] = [
  {
    key: 'day',
    header: 'Kun',
    rowHeader: true,
    render: (r) =>
      r.isTotal ? (
        'Davr jami'
      ) : (
        <span>
          {dayLabel(r.day)}
          {r.unfinished && (
            <span className="ml-1.5 text-[11px] font-normal" style={muted} title="Bugun — kun hali tugamagan, raqamlar oʻsadi">
              · tugamagan
            </span>
          )}
        </span>
      ),
  },
  { key: 'calls', header: 'Kiruvchi', align: 'right', numeric: true, render: (r) => count(r.calls) },
  { key: 'numbers', header: 'Xil raqam', align: 'right', numeric: true, render: (r) => count(r.numbers) },
  { key: 'talked', header: 'Gaplashilgan', align: 'right', numeric: true, render: (r) => count(r.talked) },
  {
    key: 'talkedPercent',
    header: '%',
    align: 'right',
    numeric: true,
    render: (r) => (r.talkedPercent === null ? NO_VALUE : formatPercent(r.talkedPercent)),
  },
  { key: 'outbound', header: 'Chiquvchi', align: 'right', numeric: true, render: (r) => count(r.outbound) },
  ...GROUPS.map(
    (g): Column<Row> => ({
      key: g,
      header: GROUP_LABEL[g],
      align: 'right',
      numeric: true,
      render: (r) => count(r.groups[g]),
    }),
  ),
]

/**
 * Its own request on its own key: the operators' report above it is one
 * statement and stays one, and this one is ~three times heavier (a month is
 * every inbound call plus every deal its callers hold).
 */
export function InboundCallsSection({ windowParams }: { windowParams: Record<string, string | number> }) {
  const query = useQuery({
    queryKey: ['insights-calls-inbound', windowParams],
    queryFn: ({ signal }) => apiGet<InboundCallsDto>('/insights/calls/inbound', windowParams, signal),
  })
  const status = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'
  return (
    <InboundCalls
      data={query.data?.data}
      status={status}
      errorMessage={query.error instanceof Error ? query.error.message : undefined}
      onRetry={() => void query.refetch()}
      unanswered={<UnansweredCallsCard windowParams={windowParams} groupLabel={GROUP_LABEL} />}
    />
  )
}

export function InboundCalls({
  data,
  status,
  errorMessage,
  onRetry,
  unanswered,
}: {
  data: InboundCallsDto | undefined
  status: 'loading' | 'error' | 'ready'
  errorMessage?: string
  onRetry?: () => void
  /** «Javobsiz qolgan raqamlar», under the tiles it opens up. */
  unanswered?: ReactNode
}) {
  const total = data?.total
  const rows: Row[] = data
    ? [
        ...data.days,
        {
          day: 'total',
          calls: data.total.calls,
          numbers: data.total.numbers,
          talked: data.total.talked,
          talkedPercent: data.total.talkedPercent,
          outbound: data.total.outbound,
          groups: data.total.groups,
          unfinished: false,
          isTotal: true,
        },
      ]
    : []

  return (
    <section className="flex flex-col gap-3" aria-labelledby="inbound-calls-title" data-testid="inbound-calls">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="inbound-calls-title" className="eyebrow">
          Kiruvchi qoʻngʻiroqlar
        </h2>
        {data && (
          <p className="text-[11px]" style={muted}>
            {data.lastCallAt ? `Oxirgi kiruvchi qoʻngʻiroq: ${formatDateTime(data.lastCallAt)}` : 'Bu davrda kiruvchi qoʻngʻiroq yoʻq'}
            {' · raqam oxirgi 9 raqami boʻyicha'}
          </p>
        )}
      </div>

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile status={status} label="Kiruvchi qoʻngʻiroq" value={total?.calls ?? null} unit="count" />
        <StatTile
          status={status}
          label="Xil raqam"
          value={total?.numbers ?? null}
          unit="count"
          hint="davrda bir raqam bir marta"
        />
        <StatTile
          status={status}
          label="Gaplashilgan raqam"
          value={total?.talked ?? null}
          unit="count"
          hint={total ? `${formatPercent(total.talkedPercent)} · kamida bitta suhbat` : undefined}
        />
        <StatTile status={status} label="Chiquvchi qoʻngʻiroq" value={total?.outbound ?? null} unit="count" />
      </div>

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="inbound-groups">
        {GROUPS.map((g) => (
          <StatTile
            key={g}
            compact
            status={status}
            label={GROUP_LABEL[g]}
            value={total?.groups[g] ?? null}
            unit="count"
            fill={g === 'fresh' ? 'good' : undefined}
            hint={total ? `${formatNumber(total.unreached[g])} tasi javobsiz qoldi` : undefined}
            context={
              <p className="text-[11px] leading-snug" style={muted}>
                {GROUP_RULE[g]}
              </p>
            }
          />
        ))}
      </div>
      <p className="text-[11px] leading-snug" style={muted}>
        «Javobsiz qoldi» — guruhdagi raqamlardan davr ichida bironta ham qoʻngʻirogʻi ulanmaganlari (suhbat 0 soniya):
        hech kim koʻtarmagan yoki mijoz ulanmasdan qoʻyib qoʻygan. Bularga qayta qoʻngʻiroq qilish kerak — roʻyxati
        quyida.
      </p>
      {unanswered}

      {data && data.undatedContacts > 0 && (
        <p className="text-xs" style={{ color: 'var(--status-warning)' }} data-testid="inbound-undated">
          {formatNumber(data.undatedContacts)} ta kontaktning Bitrix24da yaratilgan vaqti hali olinmagan — ular
          «Соф янги» boʻla olmaydi. Tungi yangilanishdan keyin toʻgʻrilanadi.
        </p>
      )}

      <ChartCard
        title="Kunlar boʻyicha"
        hint="Har kuni raqam bir marta, oʻsha kundagi birinchi qoʻngʻirogʻi boʻyicha guruhlanadi. «Davr jami»da raqam butun davrda bir marta — shuning uchun kunlar yigʻindisidan kam. Guruhlar CRMning bugungi holati boʻyicha (qoʻngʻiroqdan oldin ochilgan sdelkalar)."
      >
        <DataTable
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => r.day}
          status={status}
          errorMessage={errorMessage}
          onRetry={onRetry}
          stickyLastRow
          stickyColumns={1}
          minWidth={1080}
          emptyTitle="Kiruvchi qoʻngʻiroq yoʻq"
        />
      </ChartCard>
    </section>
  )
}
