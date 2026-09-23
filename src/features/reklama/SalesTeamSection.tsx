'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { ErrorState } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { SectionHeader } from '@/components/ui/Stat'
import { type MoneyDto, apiGet } from '@/lib/api'
import { formatDate, formatFullUzs, formatPercent } from '@/lib/format'

import { PlanEditor } from './PlanEditor'
import type { SalesDayDto, SalesSellerDto, SalesTeamDto, SalesTeamOverviewDto } from './salesTeamApi'
import { type Status, SlicePicker, TableCard, count, muted, pct } from './reklamaUi'

/**
 * «Sotuv · ROP» — the client's two ROP sheets, from Bitrix24 and the plans
 * typed in beside them.
 *
 * READING ORDER: every team's month against its plan (which team is behind),
 * then the chosen team's month day by day — the «Продажа (первичка)» sheet,
 * metrics down the side and days across, as the client keeps it — and last
 * the group sheet for one day, seller by seller.
 *
 * ITS OWN MONTH AND DAY, not the dashboard preset: both sheets are a calendar
 * month by construction, and the group sheet is one day of it.
 */
export function SalesTeamSection() {
  const [month, setMonth] = useState(() => thisMonth())
  const [day, setDay] = useState<string | undefined>(undefined)
  const [rop, setRop] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)

  const params: Record<string, string> = { month }
  if (day && day.startsWith(month)) params.day = day

  const overview = useQuery({
    queryKey: ['sales-team', params],
    queryFn: ({ signal }) => apiGet<SalesTeamOverviewDto>('/sales-team/overview', params, signal),
    placeholderData: keepPreviousData,
  })

  const status: Status = overview.isPending ? 'loading' : overview.isError ? 'error' : 'ready'
  const data = overview.data?.data
  const teams = data?.teams ?? []
  const team = teams.find((t) => t.rop === rop) ?? teams[0]

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

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="flex min-w-0 flex-col gap-3">
        <SectionHeader
          title="ROP guruhlari · oy"
          hint="FAKT 1 va FAKT 2 — Sotuvchilar reytingidagi bilan bir xil hisob (tasdiqlash navbatiga kelgan kun, operator boʻyicha). Lid — Первичный отдел ga ochilgan bitimlar. Reja — shu yerda kiritiladi."
          action={
            <label className="flex items-center gap-2 text-xs" style={muted}>
              Oy
              <input
                type="month"
                value={month}
                max={thisMonth()}
                onChange={(e) => {
                  if (!e.target.value) return
                  setMonth(e.target.value)
                  setDay(undefined)
                  setEditing(false)
                }}
                className="focusable rounded-[var(--radius-panel-sm)] border px-2 py-1 text-xs"
                style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
              />
            </label>
          }
        />
        <TableCard title="Guruhlar — oy boʻyicha" hint={data ? monthHint(data) : undefined}>
          <DataTable<SalesTeamDto>
            columns={teamColumns}
            rows={teams}
            rowKey={(t) => t.rop}
            status={status}
            emptyTitle="Bu oyda ROP guruhlari boʻyicha maʼlumot yoʻq"
            onRowClick={(t) => {
              setRop(t.rop)
              setEditing(false)
            }}
            minWidth={1180}
            maxHeight="none"
            stickyColumns={1}
          />
        </TableCard>
      </section>

      {team && data && (
        <section className="flex min-w-0 flex-col gap-3">
          <SectionHeader
            title={`${team.rop} · kunlar boʻyicha`}
            hint="«Продажа (первичка)» — har kun alohida ustun, birinchi ustun oy jami."
            action={
              data.canEditPlans && !editing ? (
                <Button size="sm" onClick={() => setEditing(true)}>
                  Rejalarni kiritish
                </Button>
              ) : undefined
            }
          />
          <SlicePicker
            ariaLabel="Qaysi guruh"
            value={team.rop}
            onChange={(next) => {
              setRop(next)
              setEditing(false)
            }}
            options={teams.map((t) => ({ value: t.rop, label: t.rop }))}
          />
          {editing && <PlanEditor key={`${month}|${team.rop}`} month={month} team={team} onClose={() => setEditing(false)} />}
          <MonthSheet team={team} status={status} />
          <DaySheet
            team={team}
            status={status}
            month={month}
            day={data.day}
            onDay={(d) => setDay(d)}
          />
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function thisMonth(): string {
  // The reader's calendar month in Tashkent, where the floor works.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7)
}

function monthHint(data: SalesTeamOverviewDto): string {
  const lived =
    data.elapsedDays < data.daysInMonth
      ? `${data.elapsedDays} / ${data.daysInMonth} kun oʻtdi — prognoz shu sur'at bilan oy oxirigacha.`
      : 'Oy yakunlangan.'
  return `Qatorni bosing — pastda shu guruhning kunlari va sotuvchilari. ${lived}`
}

const som = (m: MoneyDto | null): ReactNode =>
  m === null ? <span style={muted}>—</span> : m.amount === 0 ? <span style={muted}>0</span> : formatFullUzs(m.amount)

function signed(m: MoneyDto | null): ReactNode {
  if (m === null) return <span style={muted}>—</span>
  const negative = m.amount < 0
  return (
    <span style={{ color: negative ? 'var(--status-critical)' : 'var(--status-good)' }}>
      {negative ? `(${formatFullUzs(-m.amount)})` : formatFullUzs(m.amount)}
    </span>
  )
}

function completion(value: number | null): ReactNode {
  if (value === null) return <span style={muted}>—</span>
  const tone = value >= 100 ? 'var(--status-good)' : value >= 80 ? 'var(--status-warning)' : 'var(--status-critical)'
  return (
    <span className="font-medium" style={{ color: tone }}>
      {formatPercent(value)}
    </span>
  )
}

const teamColumns: readonly Column<SalesTeamDto>[] = [
  { key: 'rop', header: 'Guruh', rowHeader: true, render: (t) => <span className="whitespace-nowrap">{t.rop}</span> },
  { key: 'p1', header: 'FAKT 1 reja', align: 'right', numeric: true, render: (t) => som(t.plan.fakt1) },
  { key: 'f1', header: 'FAKT 1', align: 'right', numeric: true, render: (t) => <span className="font-medium">{som(t.month.fakt1)}</span> },
  { key: 'f1p', header: 'Bajarilish', align: 'right', numeric: true, render: (t) => completion(t.month.fakt1Percent) },
  { key: 'fc', header: 'Prognoz', align: 'right', numeric: true, render: (t) => som(t.month.fakt1Forecast) },
  { key: 'fcp', header: 'Prognoz %', align: 'right', numeric: true, render: (t) => completion(t.month.fakt1ForecastPercent) },
  { key: 'p2', header: 'FAKT 2 reja', align: 'right', numeric: true, render: (t) => som(t.plan.fakt2) },
  { key: 'f2', header: 'FAKT 2', align: 'right', numeric: true, render: (t) => som(t.month.fakt2) },
  { key: 'f2p', header: 'Bajarilish', align: 'right', numeric: true, render: (t) => completion(t.month.fakt2Percent) },
  { key: 'leads', header: 'Kval lid', align: 'right', numeric: true, render: (t) => count(t.month.leads + t.month.manualLeads) },
  { key: 'orders', header: 'Buyurtma', align: 'right', numeric: true, render: (t) => count(t.month.orders) },
  { key: 'conv', header: 'Konversiya', align: 'right', numeric: true, render: (t) => pct(t.month.conversionPercent) },
  { key: 'cheque', header: 'Oʻrtacha chek', align: 'right', numeric: true, render: (t) => som(t.month.averageCheque1) },
]

// ---------------------------------------------------------------------------
// The ROP sheet: metrics down the side, the month then each day across.

interface Metric {
  readonly key: string
  readonly label: string
  /** A row that starts a block — FAKT 2 is drawn apart from FAKT 1. */
  readonly group?: 'fakt1' | 'fakt2'
  readonly month: (t: SalesTeamDto) => ReactNode
  readonly day: (d: SalesDayDto) => ReactNode
}

const METRICS: readonly Metric[] = [
  {
    key: 'leads',
    label: 'Kval lid',
    month: (t) => count(t.month.leads + t.month.manualLeads),
    day: (d) => count(d.leads + d.manualLeads),
  },
  { key: 'conv', label: 'Konversiya, kval liddan', month: (t) => pct(t.month.conversionPercent), day: (d) => pct(d.conversionPercent) },
  { key: 'cheque1', label: 'Oʻrtacha chek · FAKT 1', month: (t) => som(t.month.averageCheque1), day: (d) => som(d.averageCheque1) },
  { key: 'orders', label: 'Buyurtma soni', group: 'fakt1', month: (t) => count(t.month.orders), day: (d) => count(d.orders) },
  {
    key: 'fakt1',
    label: 'FAKT 1 summa',
    month: (t) => <span className="font-medium">{som(t.month.fakt1)}</span>,
    day: (d) => <span className="font-medium">{som(d.fakt1)}</span>,
  },
  { key: 'plan', label: 'Reja', month: (t) => som(t.plan.fakt1), day: (d) => som(d.plan) },
  {
    key: 'planPercent',
    label: 'Reja bajarilishi',
    month: (t) => completion(t.month.fakt1Percent),
    day: (d) => completion(d.planPercent),
  },
  { key: 'headcount', label: 'Xodim soni', month: (t) => count(t.month.headcount), day: (d) => count(d.headcount) },
  { key: 'fakt2', label: 'FAKT 2 summa', group: 'fakt2', month: (t) => som(t.month.fakt2), day: (d) => som(d.fakt2) },
  { key: 'orders2', label: 'Tranzaksiya · FAKT 2', month: (t) => count(t.month.fakt2Orders), day: (d) => count(d.fakt2Orders) },
  { key: 'conv2', label: 'Konversiya · FAKT 2', month: (t) => pct(t.month.conversion2Percent), day: (d) => pct(d.conversion2Percent) },
  { key: 'cheque2', label: 'Oʻrtacha chek · FAKT 2', month: (t) => som(t.month.averageCheque2), day: (d) => som(d.averageCheque2) },
]

function MonthSheet({ team, status }: { team: SalesTeamDto; status: Status }) {
  const columns: Column<Metric>[] = [
    {
      key: 'metric',
      header: 'Koʻrsatkich',
      rowHeader: true,
      render: (m) => (
        <span className={`whitespace-nowrap ${m.group ? 'font-semibold' : ''}`}>{m.label}</span>
      ),
    },
    {
      key: 'month',
      header: 'Oy',
      align: 'right',
      numeric: true,
      render: (m) => <span className="whitespace-nowrap">{m.month(team)}</span>,
    },
    ...team.days.map((d) => ({
      key: d.date,
      header: d.date.slice(8, 10) + '.' + d.date.slice(5, 7),
      align: 'right' as const,
      numeric: true,
      render: (m: Metric) => <span className="whitespace-nowrap">{m.day(d)}</span>,
    })),
  ]
  return (
    <TableCard
      title="Oy — kunlar kesimida"
      hint="Kunlik reja — oʻsha kuni ishlagan sotuvchilarning kunlik rejalari yigʻindisi."
    >
      <DataTable<Metric>
        columns={columns}
        rows={METRICS}
        rowKey={(m) => m.key}
        status={status}
        minWidth={260 + 130 + team.days.length * 120}
        maxHeight="none"
        // One pinned column: the table paints only the row header opaque, and
        // a second pinned column let the days scroll visibly through it.
        stickyColumns={1}
        dragScroll
      />
    </TableCard>
  )
}

// ---------------------------------------------------------------------------
// The group sheet: one day, seller by seller.

type SellerRow = SalesSellerDto | { readonly employeeId: 'total'; readonly total: SalesTeamDto['day']['total'] }

function DaySheet({
  team,
  status,
  month,
  day,
  onDay,
}: {
  team: SalesTeamDto
  status: Status
  month: string
  day: string
  onDay: (day: string) => void
}) {
  const rows: SellerRow[] = [...team.day.sellers, { employeeId: 'total', total: team.day.total }]
  const lastDay = team.days[team.days.length - 1]?.date ?? `${month}-28`

  return (
    <TableCard
      title={`Guruh — ${formatDate(`${day}T12:00:00Z`)}`}
      hint="Konversiya — tranzaksiya ÷ lid. Lid ruch — sotuvchi oʻzi ochgan, ortida Регистрация lidi yoʻq bitim."
      action={
        <label className="flex items-center gap-2 text-xs" style={muted}>
          Kun
          <input
            type="date"
            value={day}
            min={`${month}-01`}
            max={lastDay}
            onChange={(e) => e.target.value && onDay(e.target.value)}
            className="focusable rounded-[var(--radius-panel-sm)] border px-2 py-1 text-xs"
            style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
          />
        </label>
      }
      footer={
        <span>
          Guruh rejasi — roʻyxatdagi sotuvchilarning kunlik rejalari yigʻindisi.{' '}
          {team.day.sellers.some((s) => !s.onRoster) && '«boshqa guruhdan» — buyurtmasi shu guruhga yozilgan, lekin roʻyxatda yoʻq xodim.'}
        </span>
      }
    >
      <DataTable<SellerRow>
        columns={sellerColumns}
        rows={rows}
        rowKey={(r) => r.employeeId}
        status={status}
        emptyTitle="Bu kunda maʼlumot yoʻq"
        minWidth={1040}
        maxHeight="60dvh"
        stickyColumns={1}
        stickyLastRow
      />
    </TableCard>
  )
}

const isTotal = (r: SellerRow): r is Extract<SellerRow, { employeeId: 'total' }> => r.employeeId === 'total'

const sellerColumns: readonly Column<SellerRow>[] = [
  {
    key: 'name',
    header: 'Sotuvchi',
    rowHeader: true,
    render: (r) =>
      isTotal(r) ? (
        <span className="eyebrow">Umumiy</span>
      ) : (
        <span className="flex flex-col leading-tight">
          <span className="whitespace-nowrap">{r.fullName}</span>
          {!r.onRoster && (
            <span className="text-[11px] font-normal" style={muted}>
              boshqa guruhdan
            </span>
          )}
        </span>
      ),
  },
  { key: 'leads', header: 'Lid soni', align: 'right', numeric: true, render: (r) => count(isTotal(r) ? r.total.leads : r.leads) },
  {
    key: 'manual',
    header: 'Lid ruch',
    align: 'right',
    numeric: true,
    render: (r) => count(isTotal(r) ? r.total.manualLeads : r.manualLeads),
  },
  { key: 'plan', header: 'Reja', align: 'right', numeric: true, render: (r) => som(isTotal(r) ? r.total.plan : r.plan) },
  {
    key: 'fakt',
    header: 'Fakt · FAKT 1',
    align: 'right',
    numeric: true,
    render: (r) => <span className="font-medium">{som(isTotal(r) ? r.total.fakt1 : r.fakt1)}</span>,
  },
  {
    key: 'deviation',
    header: 'Farq',
    align: 'right',
    numeric: true,
    render: (r) => signed(isTotal(r) ? r.total.deviation : r.deviation),
  },
  { key: 'orders', header: 'Tranz', align: 'right', numeric: true, render: (r) => count(isTotal(r) ? r.total.orders : r.orders) },
  {
    key: 'conv',
    header: 'Konversiya',
    align: 'right',
    numeric: true,
    render: (r) => pct(isTotal(r) ? r.total.conversionPercent : r.conversionPercent),
  },
  {
    key: 'done',
    header: 'Bajarilish',
    align: 'right',
    numeric: true,
    render: (r) => (isTotal(r) ? completion(r.total.planPercent) : <span style={muted} aria-hidden />),
  },
]

