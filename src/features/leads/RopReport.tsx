'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type MoneyDto, apiGet } from '@/lib/api'
import { formatDate, formatDuration, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import { DayPicker } from './LeadSplitCards'
import { ROP_COLORS } from './ropColors'
import type { RopReportCellsDto, RopReportDto, RopReportGroupDto } from './leadSplitApi'

/**
 * «ROP otchet» — the client's group sheet for the chosen day (on «Lidlar»
 * since 2026-10-02, its own tab there; its day is shared with the split
 * cards on «Lid manbalari»): every ROP team,
 * seller by seller, with the team's «Umumiy» under it and the company's at the
 * foot. Asked for on 2026-10-01 in place of the split table, «Лид руч» left
 * out. The definitions are in `server/domain/registration/ropReport.ts`.
 *
 * «План» is 500 000 soʻm per lead, computed on the server (it was typed per
 * seller until 2026-10-02). «Отклонение» is План − Факт-1 as the client
 * writes it, marked ✅ when Факт-1 reached the plan and 🔴 when it fell short.
 */

const NOBODY = '∅'
const muted = { color: 'var(--ink-muted)' } as const

const th = 'eyebrow px-3 py-2.5 text-right font-[550] whitespace-nowrap'
const td = 'tabular px-3 py-2 text-right whitespace-nowrap'
/** The pinned name column: opaque, so the figures scroll under it on a phone. */
const pin = 'sticky left-0 z-[1] text-left'

const COLUMNS = ['Лид сони', 'План', 'Факт-1 ПР', 'Отклонение', 'Транз-1', 'Конверсия', 'Факт-2 ПР', 'Транз-2', 'Дозвон', 'Длительность'] as const

/** The split's colour for a team it has; a team it lacks takes the next unused slot, the no-team group grey. */
function groupColor(rop: string | null, index: number, colors: ReadonlyMap<string, string>): string {
  if (rop === null) return 'var(--ink-muted)'
  return colors.get(rop) ?? ROP_COLORS[(colors.size + index) % ROP_COLORS.length]!
}

const som = (m: MoneyDto) => formatFullUzs(m.amount)

export function RopReport({ day, onDay, colors }: { day: string; onDay: (day: string) => void; colors: ReadonlyMap<string, string> }) {
  const { apiParams } = useDashboardFilters()
  const params = apiParams.brand !== undefined ? { day, brand: apiParams.brand } : { day }
  const report = useQuery({
    queryKey: ['registration-report', params],
    queryFn: ({ signal }) => apiGet<RopReportDto>('/registration/report', params, signal),
    placeholderData: keepPreviousData,
  })
  const data = report.data?.data

  return (
    <Card className="reveal">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            ROP otchet{data ? ` · ${formatDate(data.day)}` : ''}
          </h2>
          <p className="mt-0.5 max-w-3xl text-xs" style={muted}>
            Лид сони — shu kuni tarqatilgan lidlar («Лид таркатилган сана»), bitim kimda boʻlsa oʻsha sotuvchiga. Факт-1 / Факт-2 — Sotuvchilar
            reytingidagi hisob (tasdiqlash navbatiga kelgan kun). План = 500 000 × Лид сони. Отклонение = План − Факт-1: ✅ Факт-1 rejaga yetdi,
            🔴 kam. Конверсия = Транз-1 ÷ Лид сони. Дозвон — shu kuni ulangan qoʻngʻiroqlar, Длительность — ularning suhbat vaqti («Qoʻngʻiroqlar»
            bilan bir xil).
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
            Bu kunda ROP jamoalarida hech kim yoʻq — lid ham, buyurtma ham.
          </p>
        ) : (
          <ReportTable data={data} colors={colors} />
        )}
      </div>
    </Card>
  )
}

function ReportTable({ data, colors }: { data: RopReportDto; colors: ReadonlyMap<string, string> }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-[var(--radius-panel-sm)] border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr style={{ background: 'var(--surface-sunken)' }}>
              <th className={`eyebrow ${pin} min-w-[200px] border-b px-3 py-2.5 font-[550] whitespace-nowrap`} style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
                Sotuvchi
              </th>
              {COLUMNS.map((c) => (
                <th key={c} className={`${th} border-b`} style={{ borderColor: 'var(--border)' }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          {data.groups.map((g, i) => (
            <Group key={g.rop ?? NOBODY} group={g} color={groupColor(g.rop, i, colors)} />
          ))}
          <tfoot>
            <TotalRow label="Jami · barcha guruhlar" cells={data.total} tint="var(--accent)" strong />
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function Group({ group, color }: { group: RopReportGroupDto; color: string }) {
  return (
    <tbody>
      <tr>
        <th
          colSpan={COLUMNS.length + 1}
          scope="rowgroup"
          className="border-b px-3 pt-4 pb-2 text-left"
          style={{ borderColor: 'var(--border)', background: `color-mix(in oklab, ${color} 7%, var(--surface-raised))` }}
        >
          <span className="sticky left-3 inline-flex items-center gap-2">
            <span className="h-3 w-1 rounded-full" style={{ background: color }} aria-hidden />
            <span className="text-xs font-semibold tracking-[0.06em] uppercase" style={{ color: 'var(--ink-primary)' }}>
              {group.rop ? `${group.rop} guruhi` : 'Jamoasiz'}
            </span>
            <span className="text-xs font-normal" style={muted}>
              {group.rop ? `${formatNumber(group.sellers.length)} kishi` : 'ROP jamoasi koʻrsatilmagan lid va buyurtmalar'}
            </span>
          </span>
        </th>
      </tr>
      {group.sellers.map((s) => (
        <tr key={s.employeeId} className="group/row">
          <th
            scope="row"
            className={`${pin} border-b px-3 py-2 font-medium whitespace-nowrap`}
            style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)', color: 'var(--ink-primary)' }}
          >
            <span className="inline-flex items-center gap-2">
              <span className="max-w-[220px] truncate" title={s.fullName}>
                {s.fullName}
              </span>
              {s.isHead && (
                <span
                  className="rounded px-1.5 py-px text-[10px] font-semibold tracking-wide"
                  style={{ background: `color-mix(in oklab, ${color} 22%, transparent)`, color: 'var(--ink-primary)' }}
                >
                  ROP
                </span>
              )}
              {!s.onRoster && group.rop !== null && (
                <span className="text-[10px] font-normal" style={muted} title="Bu jamoa roʻyxatida yoʻq — lid yoki buyurtma shu jamoa nomidan">
                  boshqa boʻlimdan
                </span>
              )}
            </span>
          </th>
          <Cells cells={s} />
        </tr>
      ))}
      <TotalRow label="Umumiy" cells={group.total} tint={color} />
    </tbody>
  )
}

function TotalRow({ label, cells, tint, strong = false }: { label: string; cells: RopReportCellsDto; tint: string; strong?: boolean }) {
  const background = `color-mix(in oklab, ${tint} ${strong ? 18 : 11}%, var(--surface-raised))`
  return (
    <tr className="font-semibold" style={{ background }}>
      <th
        scope="row"
        className={`${pin} border-b px-3 py-2.5 whitespace-nowrap ${strong ? 'text-[13px] tracking-[0.04em] uppercase' : ''}`}
        style={{ borderColor: 'var(--border-strong)', background, color: 'var(--ink-primary)' }}
      >
        {label}
      </th>
      <Cells cells={cells} total />
    </tr>
  )
}

function Cells({ cells, total = false }: { cells: RopReportCellsDto; total?: boolean }) {
  const border = { borderColor: total ? 'var(--border-strong)' : 'var(--border)' }
  const count = (n: number) => (n === 0 ? <span style={muted}>0</span> : formatNumber(n))
  const money = (m: MoneyDto) => (m.amountMinor === '0' ? <span style={muted}>0</span> : som(m))
  return (
    <>
      <td className={`${td} border-b`} style={border}>
        {count(cells.leads)}
      </td>
      <td className={`${td} border-b`} style={border}>
        {money(cells.plan)}
      </td>
      <td className={`${td} border-b`} style={{ ...border, color: 'var(--ink-primary)' }}>
        {money(cells.fakt1)}
      </td>
      <td className={`${td} border-b`} style={border}>
        <Deviation cells={cells} />
      </td>
      <td className={`${td} border-b`} style={border}>
        {count(cells.fakt1Orders)}
      </td>
      <td className={`${td} border-b`} style={border}>
        <Conversion value={cells.conversionPercent} />
      </td>
      <td className={`${td} border-b`} style={border}>
        {money(cells.fakt2)}
      </td>
      <td className={`${td} border-b`} style={border}>
        {count(cells.fakt2Orders)}
      </td>
      <td className={`${td} border-b`} style={border}>
        {cells.connectedCalls === null ? <span style={muted}>—</span> : count(cells.connectedCalls)}
      </td>
      <td className={`${td} border-b`} style={border}>
        {cells.talkSec === null ? <span style={muted}>—</span> : cells.talkSec === 0 ? <span style={muted}>0</span> : formatDuration(cells.talkSec)}
      </td>
    </>
  )
}

/**
 * План − Факт-1, the client's sign: a shortfall is positive. ✅ green when
 * Факт-1 reached the plan, 🔴 red when it did not; a row with neither plan
 * nor fact is a muted zero, not a pass.
 */
function Deviation({ cells }: { cells: RopReportCellsDto }) {
  const v = BigInt(cells.deviation.amountMinor)
  if (cells.plan.amountMinor === '0' && cells.fakt1.amountMinor === '0') return <span style={muted}>0</span>
  const met = v <= 0n
  const tone = met ? 'var(--status-good)' : 'var(--status-critical)'
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5"
      style={{ background: `color-mix(in oklab, ${tone} 16%, transparent)`, color: `color-mix(in oklab, ${tone} 75%, var(--ink-primary))` }}
      title={met ? 'Факт-1 rejaga yetdi' : 'Факт-1 rejadan kam'}
    >
      <span aria-hidden>{met ? '✅' : '🔴'}</span>
      <span className="sr-only">{met ? 'rejaga yetdi:' : 'rejadan kam:'}</span>
      {v < 0n ? '−' : ''}
      {formatFullUzs(Math.abs(cells.deviation.amount))}
    </span>
  )
}

function Conversion({ value }: { value: number | null }) {
  if (value === null) return <span style={muted}>—</span>
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {/* The sequential magnitude hue, never the page accent — on Lidlar that
          is series-7, which is also a ROP team's colour. */}
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full sm:inline-block" style={{ background: 'var(--track)' }} aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: 'var(--seq-450)' }} />
      </span>
      <span className="w-11">{formatPercent(value, 0)}</span>
    </span>
  )
}
