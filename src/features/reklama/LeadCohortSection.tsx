'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'

import { ErrorState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { MultiSelect, SegmentedControl } from '@/components/ui/Controls'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { SectionHeader, StatTile } from '@/components/ui/Stat'
import { apiGet } from '@/lib/api'
import { formatDate, formatNumber, formatPercent } from '@/lib/format'

import {
  LAG_BUCKETS,
  LEAD_PIPELINE_OPTIONS,
  type LeadCohortOverviewDto,
  type LeadCohortRowDto,
  type LeadRopDto,
} from './leadCohortApi'
import { type Status, SlicePicker, TableCard, count, muted } from './reklamaUi'

/**
 * «Lid kogortasi» — a lead's arrival day against the day it was handed to a
 * seller, from the portal's «Лид тушган сана» / «Лид таркатилган сана».
 *
 * READING ORDER: the tiles (how many came, how many were handed out today,
 * what is still waiting), then the cohort — a row per arrival day, a column
 * per day of waiting — for new leads or repeat leads, and last which ROP the
 * window's leads went to. Clicking a ROP narrows the tiles and the cohort to
 * them; the ROP table itself is never narrowed, it is what the filter picks
 * from.
 *
 * ITS OWN WINDOW, the last fourteen days by default — a cohort is whole days,
 * and the dashboard's «Bugun» would be a table of one row.
 */

type Kind = 'new' | 'repeat'
type Reading = 'count' | 'percent'

const ALL_PIPELINES = LEAD_PIPELINE_OPTIONS.map((p) => p.id)

export function LeadCohortSection() {
  const [from, setFrom] = useState<string | undefined>(undefined)
  const [to, setTo] = useState<string | undefined>(undefined)
  const [pipelines, setPipelines] = useState<string[]>(ALL_PIPELINES)
  const [rop, setRop] = useState<string | undefined>(undefined)
  const [kind, setKind] = useState<Kind>('new')
  const [reading, setReading] = useState<Reading>('count')

  const params = useMemo(() => {
    const out: Record<string, string> = {}
    if (from) out.from = from
    if (to) out.to = to
    if (pipelines.length > 0 && pipelines.length < ALL_PIPELINES.length) out.pipelines = [...pipelines].sort().join(',')
    if (rop) out.rop = rop
    return out
  }, [from, to, pipelines, rop])

  const overview = useQuery({
    queryKey: ['lead-cohort', params],
    queryFn: ({ signal }) => apiGet<LeadCohortOverviewDto>('/lead-cohort/overview', params, signal),
    placeholderData: keepPreviousData,
  })

  const status: Status = overview.isPending ? 'loading' : overview.isError ? 'error' : 'ready'
  const data = overview.data?.data

  if (status === 'error') {
    return (
      <Card className="p-5">
        <ErrorState
          message={overview.error instanceof Error ? overview.error.message : undefined}
          onRetry={() => void overview.refetch()}
        />
      </Card>
    )
  }

  const ropName = rop ? (data?.ropOptions.find((o) => o.employeeId === rop)?.name ?? 'Tanlangan ROP') : null
  const table = data?.cohorts[kind]

  return (
    <div className="flex min-w-0 flex-col gap-6" style={{ opacity: overview.isPlaceholderData ? 0.7 : 1 }}>
      <Filters
        from={from ?? data?.from ?? ''}
        to={to ?? data?.to ?? ''}
        today={data?.today}
        onFrom={setFrom}
        onTo={setTo}
        pipelines={pipelines}
        onPipelines={(ids) => setPipelines(ids.length === 0 ? ALL_PIPELINES : ids)}
        rop={rop}
        ropOptions={data?.ropOptions ?? []}
        onRop={setRop}
      />

      <Tiles data={data} status={status} ropName={ropName} />

      <section className="flex min-w-0 flex-col gap-3">
        <SectionHeader
          title="Lid kogortasi"
          hint="Qator — lid tushgan kun (Toshkent vaqti). Ustun — tushgandan necha kun keyin tarqatilgan: D+0 oʻsha kuni, D+1 ertasi … D+7+ bir hafta va undan keyin. Foiz — shu kuni tushganlarga nisbatan. Bitta mijoz Первичка → Тасдиклаш → Доставка da uch marta boʻlsa ham bir marta sanaladi."
        />
        <div className="flex flex-wrap items-center gap-2">
          <SlicePicker<Kind>
            ariaLabel="Lid turi"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'new', label: `Yangi lidlar${data ? ` · ${formatNumber(data.cohorts.new.total.arrived)}` : ''}` },
              { value: 'repeat', label: `Takror lidlar${data ? ` · ${formatNumber(data.cohorts.repeat.total.arrived)}` : ''}` },
            ]}
          />
          <SegmentedControl<Reading>
            ariaLabel="Katakda nima"
            value={reading}
            onChange={setReading}
            options={[
              { value: 'count', label: 'Son' },
              { value: 'percent', label: 'Foiz' },
            ]}
          />
        </div>
        <TableCard
          title={kind === 'new' ? 'Yangi lidlar — tushgan kun × tarqatilgan kun' : 'Takror lidlar — tushgan kun × tarqatilgan kun'}
          hint={data ? cohortHint(data, ropName) : undefined}
          footer={data ? outsideNote(data) : undefined}
        >
          <DataTable<LeadCohortRowDto>
            columns={cohortColumns(reading, data?.today ?? '')}
            rows={table ? [...table.rows].reverse().concat(table.total) : []}
            rowKey={(r) => r.day || 'total'}
            status={status}
            emptyTitle="Bu davrda lid yoʻq"
            minWidth={960}
            maxHeight="none"
            stickyColumns={1}
            stickyLastRow
          />
        </TableCard>
      </section>

      <RopSection data={data} status={status} rop={rop} onRop={setRop} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filters

const inputStyle = { background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }

function Filters(props: {
  from: string
  to: string
  today: string | undefined
  onFrom: (v: string | undefined) => void
  onTo: (v: string | undefined) => void
  pipelines: string[]
  onPipelines: (ids: string[]) => void
  rop: string | undefined
  ropOptions: readonly { employeeId: string; name: string }[]
  onRop: (v: string | undefined) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs" style={muted}>
        Tushgan sana, dan
        <input
          type="date"
          value={props.from}
          max={props.to || props.today}
          onChange={(e) => props.onFrom(e.target.value || undefined)}
          className="focusable rounded-[var(--radius-panel-sm)] border px-2 py-1 text-xs"
          style={inputStyle}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs" style={muted}>
        gacha
        <input
          type="date"
          value={props.to}
          min={props.from || undefined}
          max={props.today}
          onChange={(e) => props.onTo(e.target.value || undefined)}
          className="focusable rounded-[var(--radius-panel-sm)] border px-2 py-1 text-xs"
          style={inputStyle}
        />
      </label>
      <MultiSelect
        label="Voronka"
        options={LEAD_PIPELINE_OPTIONS}
        selected={props.pipelines}
        onChange={props.onPipelines}
      />
      <label className="flex flex-col gap-1 text-xs" style={muted}>
        ROP
        <select
          value={props.rop ?? ''}
          onChange={(e) => props.onRop(e.target.value || undefined)}
          className="focusable rounded-[var(--radius-panel-sm)] border px-2 py-1 text-xs"
          style={inputStyle}
        >
          <option value="">Hammasi</option>
          {props.ropOptions.map((o) => (
            <option key={o.employeeId} value={o.employeeId}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tiles

function share(part: number, whole: number): string | undefined {
  return whole > 0 ? formatPercent((part / whole) * 100) : undefined
}

function Tiles({ data, status, ropName }: { data: LeadCohortOverviewDto | undefined; status: Status; ropName: string | null }) {
  const k = data?.kpi
  const of = ropName ? ` · ${ropName}` : ''
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <StatTile
        status={status}
        label="Jami tushgan lidlar"
        value={k?.arrived ?? null}
        unit="count"
        hint={k && data ? `${shortDay(data.cohortFrom)} – ${shortDay(data.to)} · bugun ${formatNumber(k.arrivedToday)}${of}` : undefined}
      />
      <StatTile
        status={status}
        label="Bugun tarqatilgan"
        value={k?.distributedToday ?? null}
        unit="count"
        hint={`bugun sotuvchilarga berilgan, qachon tushganidan qatʼi nazar${of}`}
      />
      <StatTile
        status={status}
        label="AI kval qilgan"
        value={k?.aiQualified ?? null}
        unit="count"
        hint={k ? `tushganlarning ${share(k.aiQualified, k.arrived) ?? '—'} — «ИИ квал сана» toʻldirilgan` : undefined}
      />
      <StatTile
        status={status}
        label="Tarqatilmagan qoldiq"
        value={k?.undistributed ?? null}
        unit="count"
        tone={k && k.undistributed > 0 ? 'warning' : 'neutral'}
        hint={k ? `tushgan, lekin «Лид таркатилган сана» boʻsh · ${share(k.undistributed, k.arrived) ?? '—'}` : undefined}
      />
      <StatTile
        status={status}
        label="Takror lidlar"
        value={k?.repeat.total ?? null}
        unit="count"
        hint={
          k
            ? `harid qilgan ${formatNumber(k.repeat.bought)} · obrabotka ${formatNumber(k.repeat.processing)}${
                k.repeat.other > 0 ? ` · boshqa ${formatNumber(k.repeat.other)}` : ''
              }`
            : undefined
        }
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// The cohort

const LAG_LABELS = Array.from({ length: LAG_BUCKETS }, (_, i) => (i === LAG_BUCKETS - 1 ? `D+${i}+` : `D+${i}`))

/** `YYYY-MM-DD` + n days. */
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

const shortDay = (day: string) => formatDate(`${day}T12:00:00Z`)

/**
 * The heat behind a cell: the share of the row's arrivals, on the sequential
 * blue ramp mixed into the surface so the figure on it stays readable in
 * both themes. Zero is no colour at all.
 */
function heat(percent: number): string | undefined {
  if (percent <= 0) return undefined
  const strength = Math.round(8 + Math.min(percent, 100) * 0.47)
  return `color-mix(in oklab, var(--seq-450) ${strength}%, transparent)`
}

function HeatCell({ n, of, reading }: { n: number; of: number; reading: Reading }) {
  const percent = of > 0 ? (n / of) * 100 : 0
  const main = reading === 'count' ? (n === 0 ? '—' : formatNumber(n)) : of > 0 && n > 0 ? formatPercent(percent, 0) : '—'
  const sub = reading === 'count' ? (of > 0 && n > 0 ? formatPercent(percent, 0) : null) : n > 0 ? formatNumber(n) : null
  return (
    <div
      className="flex flex-col items-end rounded-[4px] px-1.5 py-1 leading-tight"
      style={{ background: heat(percent) }}
      aria-label={`${formatNumber(n)} ta, ${formatPercent(percent)}`}
    >
      <span style={n === 0 ? muted : { color: 'var(--ink-primary)' }}>{main}</span>
      {sub && (
        <span className="text-[10px]" style={muted}>
          {sub}
        </span>
      )}
    </div>
  )
}

/** A column the row is too young to have reached — D+3 of yesterday. */
function NotYet() {
  return (
    <span className="text-[11px]" style={muted} title="Bu kun hali kelmagan">
      ·
    </span>
  )
}

function cohortColumns(reading: Reading, today: string): Column<LeadCohortRowDto>[] {
  const reached = (r: LeadCohortRowDto, lag: number) => r.day === '' || addDays(r.day, lag) <= today
  return [
    {
      key: 'day',
      header: 'Tushgan kun',
      rowHeader: true,
      render: (r) => (r.day === '' ? <span className="eyebrow">Jami</span> : <span className="whitespace-nowrap">{shortDay(r.day)}</span>),
    },
    {
      key: 'arrived',
      header: 'Tushdi',
      align: 'right',
      numeric: true,
      render: (r) => <span className="font-semibold">{count(r.arrived)}</span>,
    },
    ...LAG_LABELS.map((label, lag) => ({
      key: `d${lag}`,
      header: label,
      align: 'right' as const,
      numeric: true,
      render: (r: LeadCohortRowDto) =>
        reached(r, lag) ? <HeatCell n={r.byLag[lag] ?? 0} of={r.arrived} reading={reading} /> : <NotYet />,
    })),
    {
      key: 'distributed',
      header: 'Jami oʻtdi',
      align: 'right',
      numeric: true,
      render: (r) => (
        <span className="whitespace-nowrap font-medium" style={{ color: 'var(--ink-primary)' }}>
          {count(r.distributed)}
          {r.arrived > 0 && (
            <span className="ml-1 text-[11px] font-normal" style={muted}>
              {formatPercent((r.distributed / r.arrived) * 100, 0)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'undistributed',
      header: 'Hali tarqatilmagan',
      align: 'right',
      numeric: true,
      render: (r) =>
        r.undistributed === 0 ? (
          count(0)
        ) : (
          <span className="whitespace-nowrap" style={{ color: 'var(--status-warning)' }}>
            {formatNumber(r.undistributed)}
            {r.arrived > 0 && (
              <span className="ml-1 text-[11px]">{formatPercent((r.undistributed / r.arrived) * 100, 0)}</span>
            )}
          </span>
        ),
    },
  ]
}

function cohortHint(data: LeadCohortOverviewDto, ropName: string | null): string {
  const start =
    data.from < data.cohortStart
      ? ` «Лид тушган сана» ${shortDay(data.cohortStart)} dan beri toʻldirilyapti — jadval shu kundan boshlanadi.`
      : ''
  return `${shortDay(data.cohortFrom)} – ${shortDay(data.to)}${ropName ? ` · ${ropName}` : ''}. «·» — bu kun hali kelmagan.${start}`
}

function outsideNote(data: LeadCohortOverviewDto): ReactNode {
  const k = data.kpi
  const parts: string[] = []
  if (k.missingArrival > 0) parts.push(`${formatNumber(k.missingArrival)} ta sdelkada «Лид тушган сана» yoʻq (shu davrda ochilgan)`)
  if (k.arrivedBeforeStart > 0)
    parts.push(`${formatNumber(k.arrivedBeforeStart)} ta lid shu davrda tarqatilgan, lekin ${shortDay(data.cohortStart)} dan oldin tushgan`)
  if (k.distributedBeforeArrival > 0)
    parts.push(`${formatNumber(k.distributedBeforeArrival)} ta lidda tarqatilgan sana tushgan sanadan oldin — D+0 da sanaldi`)
  if (parts.length === 0) return undefined
  return `Kogortaga kirmaydi: ${parts.join('; ')}.`
}

// ---------------------------------------------------------------------------
// By ROP

function RopSection({
  data,
  status,
  rop,
  onRop,
}: {
  data: LeadCohortOverviewDto | undefined
  status: Status
  rop: string | undefined
  onRop: (v: string | undefined) => void
}) {
  const rows = data?.rops ?? []
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0)
  const columns: Column<LeadRopDto>[] = [
    {
      key: 'name',
      header: 'ROP',
      rowHeader: true,
      render: (r) => (
        <span className="whitespace-nowrap" style={r.employeeId !== null && r.employeeId === rop ? { color: 'var(--seq-550)' } : undefined}>
          {r.name ?? <span style={muted}>ROP koʻrsatilmagan</span>}
        </span>
      ),
    },
    {
      key: 'bar',
      header: 'Tarqatilgan lidlar',
      width: '40%',
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
            <div className="flex h-full">
              <div style={{ width: `${max > 0 ? (r.new / max) * 100 : 0}%`, background: 'var(--seq-450)' }} />
              <div style={{ width: `${max > 0 ? (r.repeat / max) * 100 : 0}%`, background: 'var(--series-4)' }} />
            </div>
          </div>
          <span className="tabular w-10 text-right font-medium" style={{ color: 'var(--ink-primary)' }}>
            {formatNumber(r.total)}
          </span>
        </div>
      ),
    },
    { key: 'new', header: 'Yangi', align: 'right', numeric: true, render: (r) => count(r.new) },
    { key: 'repeat', header: 'Takror', align: 'right', numeric: true, render: (r) => count(r.repeat) },
    {
      key: 'same',
      header: 'Oʻsha kuni',
      align: 'right',
      numeric: true,
      render: (r) => (r.total > 0 ? formatPercent((r.sameDay / r.total) * 100, 0) : <span style={muted}>—</span>),
    },
  ]

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        title="ROP boʻyicha taqsimot"
        hint="Tanlangan davrda har bir ROP ga nechta lid tarqatilgan («Лид таркатилган сана» shu davrda, «РОП (Первичка)» boʻyicha) — qachon tushganidan qatʼi nazar. Qatorni bosing — yuqoridagi kartochkalar va kogorta shu ROP ga toraytiriladi."
      />
      <TableCard
        title="ROP lar"
        hint={
          <span className="inline-flex flex-wrap items-center gap-3">
            <Legend color="var(--seq-450)" label="Yangi" />
            <Legend color="var(--series-4)" label="Takror" />
            {rop && (
              <button type="button" className="focusable underline" onClick={() => onRop(undefined)}>
                ROP filtrini olib tashlash
              </button>
            )}
          </span>
        }
      >
        <DataTable<LeadRopDto>
          columns={columns}
          rows={rows}
          rowKey={(r) => r.employeeId ?? 'none'}
          status={status}
          emptyTitle="Bu davrda tarqatilgan lid yoʻq"
          onRowClick={(r) => r.employeeId !== null && onRop(r.employeeId === rop ? undefined : r.employeeId)}
          minWidth={640}
          maxHeight="none"
        />
      </TableCard>
    </section>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}
