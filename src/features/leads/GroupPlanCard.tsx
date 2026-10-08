'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type MoneyDto, apiGet } from '@/lib/api'
import { formatDate, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import { DayPicker } from './LeadSplitCards'
import type { GroupPlanCellsDto, GroupPlanDto, GroupPlanGroupDto } from './leadSplitApi'

/**
 * «Guruhlar» — the client's seller sheet (2026-10-03), from the first of the
 * chosen day's month to that day: every ROP team seller by seller, the team's
 * «Jami» under it and the company's at the foot. The sheet's columns, in its
 * order; Qarz green above zero («ortiqcha»), red below. The definitions are
 * in `server/domain/registration/groupPlan.ts`.
 */

const muted = { color: 'var(--ink-muted)' } as const

const COLUMNS = ['Usp soni', 'Reja (Avto)', 'Buyurtma summasi', 'Bajarilish %', 'Qarz', 'Dostup'] as const

const th = 'eyebrow border-b px-3 py-2.5 text-right font-[550] whitespace-nowrap'
const td = 'tabular border-b px-3 py-2 text-right whitespace-nowrap'
/** The pinned name column: opaque, so the figures scroll under it on a phone. */
const pin = 'sticky left-0 z-[1] text-left'

const GOOD = 'var(--status-good)'
const BAD = 'var(--status-critical)'

export function GroupPlanCard({ day, onDay }: { day: string; onDay: (day: string) => void }) {
  const { apiParams } = useDashboardFilters()
  const params = apiParams.brand !== undefined ? { day, brand: apiParams.brand } : { day }
  const report = useQuery({
    queryKey: ['registration-groups', params],
    queryFn: ({ signal }) => apiGet<GroupPlanDto>('/registration/groups', params, signal),
    placeholderData: keepPreviousData,
  })
  const data = report.data?.data

  return (
    <Card className="reveal">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            Guruhlar{data ? ` · ${formatDate(data.from)} – ${formatDate(data.to)}` : ''}
          </h2>
          <p className="mt-0.5 max-w-3xl text-xs" style={muted}>
            Oy boshidan tanlangan kungacha. Usp soni — sotuvchining kval lidlari (Регистрация «Сделка успешна», «Сотувчи (Первичка)»;
            maydon 16.09.2026 dan toʻldirilgan). Reja (Avto) = 500 000 × Usp soni. Buyurtma summasi — Факт-1 (ROP otchetdagi kabi). Bajarilish %
            = Buyurtma ÷ Reja. Qarz = Buyurtma − Reja: yashil — rejadan ortiq, qizil — qarz. Dostup — qarz chegarasi hali belgilanmagan, hammaga
            ruxsat.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DayPicker day={day} onChange={onDay} />
        </div>
      </header>
      <div className="px-5 pb-5">
        {report.isError && !data ? (
          <ErrorState message={report.error instanceof Error ? report.error.message : undefined} onRetry={() => void report.refetch()} />
        ) : !data ? (
          <LoadingSkeleton rows={8} />
        ) : data.groups.length === 0 ? (
          <p
            className="rounded-[var(--radius-panel-sm)] border border-dashed px-3 py-3 text-xs"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-secondary)' }}
          >
            Bu oyda hali kval lid ham, buyurtma ham yoʻq.
          </p>
        ) : (
          <PlanTable data={data} />
        )}
      </div>
    </Card>
  )
}

function PlanTable({ data }: { data: GroupPlanDto }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-panel-sm)] border" style={{ borderColor: 'var(--border)' }}>
      <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr style={{ background: 'var(--surface-sunken)' }}>
            <th
              className={`eyebrow ${pin} min-w-[200px] border-b px-3 py-2.5 font-[550] whitespace-nowrap`}
              style={{ background: 'var(--surface-sunken)', borderColor: 'var(--border)' }}
            >
              Mutahasis
            </th>
            {COLUMNS.map((c) => (
              <th key={c} className={th} style={{ borderColor: 'var(--border)' }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        {data.groups.map((g) => (
          <Group key={g.rop ?? '∅'} group={g} />
        ))}
        <tfoot>
          <TotalRow label="Jami · barcha guruhlar" cells={data.total} strong />
        </tfoot>
      </table>
    </div>
  )
}

function Group({ group }: { group: GroupPlanGroupDto }) {
  return (
    <tbody>
      <tr>
        <th
          colSpan={COLUMNS.length + 1}
          scope="rowgroup"
          className="border-b px-3 pt-4 pb-2 text-left"
          style={{ borderColor: 'var(--border)', background: 'color-mix(in oklab, var(--accent) 12%, var(--surface-raised))' }}
        >
          <span className="sticky left-3 inline-flex items-center gap-2">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
              {group.rop ? `${group.rop} guruhi` : 'Jamoasiz'}
            </span>
            <span className="text-xs font-normal" style={muted}>
              {group.rop
                ? `${formatNumber(group.sellers.filter((s) => s.mayTakeLeads !== null).length)} kishi`
                : 'ROP jamoasiga tegishli boʻlmagan kval lid va buyurtmalar'}
            </span>
          </span>
        </th>
      </tr>
      {group.sellers.map((s) => (
        <tr key={s.employeeId}>
          <th
            scope="row"
            className={`${pin} border-b px-3 py-2 font-medium whitespace-nowrap`}
            style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)', color: 'var(--ink-primary)' }}
          >
            <span className="block max-w-[240px] truncate" title={s.fullName}>
              {s.fullName}
            </span>
          </th>
          <Cells cells={s} />
          <td className={td} style={{ borderColor: 'var(--border)' }}>
            <Access allowed={s.mayTakeLeads} />
          </td>
        </tr>
      ))}
      <TotalRow label="Jami" cells={group.total} />
    </tbody>
  )
}

function TotalRow({ label, cells, strong = false }: { label: string; cells: GroupPlanCellsDto; strong?: boolean }) {
  const background = `color-mix(in oklab, var(--accent) ${strong ? 18 : 8}%, var(--surface-raised))`
  return (
    <tr className="font-semibold" style={{ background }}>
      <th
        scope="row"
        className={`${pin} border-b px-3 py-2.5 whitespace-nowrap ${strong ? 'text-[13px]' : ''}`}
        style={{ borderColor: 'var(--border-strong)', background, color: 'var(--ink-primary)' }}
      >
        {label}
      </th>
      <Cells cells={cells} total />
      <td className={td} style={{ borderColor: 'var(--border-strong)' }} />
    </tr>
  )
}

const som = (m: MoneyDto) => (m.amountMinor === '0' ? <span style={muted}>0</span> : formatFullUzs(m.amount))

function Cells({ cells, total = false }: { cells: GroupPlanCellsDto; total?: boolean }) {
  const border = { borderColor: total ? 'var(--border-strong)' : 'var(--border)' }
  return (
    <>
      <td className={td} style={border}>
        {cells.leads === 0 ? <span style={muted}>0</span> : formatNumber(cells.leads)}
      </td>
      <td className={td} style={border}>
        {som(cells.plan)}
      </td>
      <td className={td} style={{ ...border, color: 'var(--ink-primary)' }}>
        {som(cells.orders)}
      </td>
      <td className={td} style={border}>
        {cells.percent === null ? <span style={muted}>—</span> : formatPercent(cells.percent, 1)}
      </td>
      <td className={td} style={border}>
        <Debt debt={cells.debt} />
      </td>
    </>
  )
}

/** Buyurtma − Reja, the sheet's way: «+5 600 000 ortiqcha» on green, «−300 000» on red, a muted 0 when even. */
function Debt({ debt }: { debt: MoneyDto }) {
  const v = BigInt(debt.amountMinor)
  if (v === 0n) return <span style={muted}>0</span>
  const ahead = v > 0n
  const tone = ahead ? GOOD : BAD
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5"
      style={{ background: `color-mix(in oklab, ${tone} 18%, transparent)`, color: `color-mix(in oklab, ${tone} 75%, var(--ink-primary))` }}
    >
      {ahead ? '+' : '−'}
      {formatFullUzs(Math.abs(debt.amount))}
      {ahead ? ' ortiqcha' : ''}
    </span>
  )
}

function Access({ allowed }: { allowed: boolean | null }) {
  if (allowed === null) return <span style={muted}>—</span>
  const tone = allowed ? GOOD : BAD
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ background: `color-mix(in oklab, ${tone} 18%, transparent)`, color: `color-mix(in oklab, ${tone} 75%, var(--ink-primary))` }}
    >
      {allowed ? 'Ruxsat' : 'Ruxsat yoʻq'}
    </span>
  )
}
