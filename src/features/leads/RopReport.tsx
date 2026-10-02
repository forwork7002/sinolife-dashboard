'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { type MoneyDto, apiGet, apiWrite } from '@/lib/api'
import { formatDate, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import { DayPicker } from './LeadSplitCards'
import { ROP_COLORS } from './ropColors'
import type { RopReportCellsDto, RopReportDto, RopReportGroupDto, RopReportSellerDto, SaveSellerPlansBody } from './leadSplitApi'

/**
 * «ROP otchet» — the client's group sheet for the chosen day (on «Lidlar»
 * since 2026-10-02, below «Targetologlar»; its day is shared with the split
 * cards above): every ROP team,
 * seller by seller, with the team's «Umumiy» under it and the company's at the
 * foot. Asked for on 2026-10-01 in place of the split table, «Лид руч» left
 * out. The definitions are in `server/domain/registration/ropReport.ts`.
 *
 * «План» is typed here, per seller, once for a month: the same day plan for
 * every day of it. An emptied field removes the plan — «no plan» prints a
 * dash, never a zero, which would read as «missed it entirely».
 */

const NOBODY = '∅'
const muted = { color: 'var(--ink-muted)' } as const

const th = 'eyebrow px-3 py-2.5 text-right font-[550] whitespace-nowrap'
const td = 'tabular px-3 py-2 text-right whitespace-nowrap'
/** The pinned name column: opaque, so the figures scroll under it on a phone. */
const pin = 'sticky left-0 z-[1] text-left'

const COLUMNS = ['Лид сони', 'План', 'Факт-1 ПР', 'Отклонение', 'Транз-1', 'Конверсия', 'Факт-2 ПР', 'Транз-2'] as const

/** The split's colour for a team it has; a team it lacks takes the next unused slot, the no-team group grey. */
function groupColor(rop: string | null, index: number, colors: ReadonlyMap<string, string>): string {
  if (rop === null) return 'var(--ink-muted)'
  return colors.get(rop) ?? ROP_COLORS[(colors.size + index) % ROP_COLORS.length]!
}

const minor = (m: MoneyDto | null) => (m ? BigInt(m.amountMinor) : null)
const som = (m: MoneyDto) => formatFullUzs(m.amount)

export function RopReport({ day, onDay, colors }: { day: string; onDay: (day: string) => void; colors: ReadonlyMap<string, string> }) {
  // The day the form was opened for: another day closes it, so a draft never outlives the figures beside it.
  const [editingDay, setEditingDay] = useState<string | null>(null)
  if (editingDay !== null && editingDay !== day) setEditingDay(null)
  const editing = editingDay === day
  const setEditing = (on: boolean) => setEditingDay(on ? day : null)
  const report = useQuery({
    queryKey: ['registration-report', day],
    queryFn: ({ signal }) => apiGet<RopReportDto>('/registration/report', { day }, signal),
    placeholderData: keepPreviousData,
  })
  const data = report.data?.data
  const fresh = data !== undefined && data.day === day && !report.isPlaceholderData

  return (
    <Card className="reveal">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            ROP otchet{data ? ` · ${formatDate(data.day)}` : ''}
          </h2>
          <p className="mt-0.5 max-w-3xl text-xs" style={muted}>
            Лид сони — shu kuni tarqatilgan lidlar («Лид таркатилган сана»), bitim kimda boʻlsa oʻsha sotuvchiga. Факт-1 / Факт-2 — Sotuvchilar
            reytingidagi hisob (tasdiqlash navbatiga kelgan kun). Конверсия = Транз-1 ÷ Лид сони. Отклонение = Факт-1 − План; план — sotuvchining
            kunlik rejasi, oy boʻyi bir xil.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DayPicker day={day} onChange={onDay} />
          {data?.canEdit && !editing && fresh && data.groups.length > 0 && (
            <Button size="sm" variant="primary" onClick={() => setEditing(true)}>
              Rejani kiritish
            </Button>
          )}
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
          // A fresh form each time it opens, so the draft starts from the saved plans.
          <ReportTable key={editing ? `edit-${data.day}` : 'view'} data={data} colors={colors} editing={editing && fresh} onDone={() => setEditing(false)} />
        )}
      </div>
    </Card>
  )
}

function ReportTable({
  data,
  colors,
  editing,
  onDone,
}: {
  data: RopReportDto
  colors: ReadonlyMap<string, string>
  editing: boolean
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const editable = data.groups.flatMap((g) => g.sellers).filter((s) => s.employeeId !== NOBODY)
  // Whole soʻm as typed digits, frozen when the form opens.
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((s) => [s.employeeId, s.plan ? String(BigInt(s.plan.amountMinor) / 100n) : ''])),
  )
  const [initial] = useState(draft)

  const save = useMutation({
    mutationFn: (body: SaveSellerPlansBody) => apiWrite<{ saved: boolean }>('POST', '/registration/plan', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['registration-report'] })
      onDone()
    },
  })

  const submit = () => {
    // Only what changed: a seller listed twice (two teams) is one plan, and an untouched row is not re-stamped.
    const changed = Object.keys(draft).filter((id) => draft[id] !== initial[id])
    if (changed.length === 0) return onDone()
    save.mutate({
      month: data.month,
      sellers: changed.map((id) => {
        const digits = draft[id] ?? ''
        return { employeeId: id, dayPlan: digits === '' || Number(digits) === 0 ? null : Number(digits) }
      }),
    })
  }

  const planInput = (s: RopReportSellerDto) => (
    <input
      inputMode="numeric"
      aria-label={`${s.fullName} — kunlik reja`}
      value={draft[s.employeeId] ? formatFullUzs(Number(draft[s.employeeId])) : ''}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12)
        setDraft((d) => ({ ...d, [s.employeeId]: digits }))
      }}
      placeholder="—"
      className="focusable tabular w-32 rounded-[var(--radius-panel-sm)] border px-2 py-1 text-right text-sm"
      style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
    />
  )

  return (
    <div className="flex flex-col gap-3">
      {editing && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel-sm)] border px-3 py-2"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--accent-soft)' }}
        >
          <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            Kunlik reja, soʻmda — {data.month} oyining har kuni uchun. Boʻsh maydon rejani olib tashlaydi.
          </span>
          <span className="flex items-center gap-2">
            {save.isError && (
              <span className="text-xs" role="alert" style={{ color: 'var(--status-critical)' }}>
                {save.error instanceof Error ? save.error.message : 'Saqlab boʻlmadi.'}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={onDone} disabled={save.isPending}>
              Bekor qilish
            </Button>
            <Button size="sm" variant="primary" onClick={submit} disabled={save.isPending}>
              {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
            </Button>
          </span>
        </div>
      )}
      <div className="overflow-x-auto rounded-[var(--radius-panel-sm)] border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full min-w-[960px] border-separate border-spacing-0 text-sm">
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
            <Group key={g.rop ?? NOBODY} group={g} color={groupColor(g.rop, i, colors)} plan={editing ? planInput : null} />
          ))}
          <tfoot>
            <TotalRow label="Jami · barcha guruhlar" cells={data.total} tint="var(--accent)" strong />
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function Group({
  group,
  color,
  plan,
}: {
  group: RopReportGroupDto
  color: string
  plan: ((s: RopReportSellerDto) => ReactNode) | null
}) {
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
          <Cells cells={s} plan={plan && s.employeeId !== NOBODY ? plan(s) : null} />
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
      <Cells cells={cells} plan={null} total />
    </tr>
  )
}

function Cells({ cells, plan, total = false }: { cells: RopReportCellsDto; plan: ReactNode | null; total?: boolean }) {
  const border = { borderColor: total ? 'var(--border-strong)' : 'var(--border)' }
  const count = (n: number) => (n === 0 ? <span style={muted}>0</span> : formatNumber(n))
  const money = (m: MoneyDto) => (m.amountMinor === '0' ? <span style={muted}>0</span> : som(m))
  return (
    <>
      <td className={`${td} border-b`} style={border}>
        {count(cells.leads)}
      </td>
      <td className={`${td} border-b`} style={border}>
        {plan ?? (cells.plan ? som(cells.plan) : <span style={muted}>—</span>)}
      </td>
      <td className={`${td} border-b`} style={{ ...border, color: 'var(--ink-primary)' }}>
        {money(cells.fakt1)}
      </td>
      <td className={`${td} border-b`} style={border}>
        <Deviation value={cells.deviation} />
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
    </>
  )
}

/** Ahead of plan green, behind it red — the sheet's own two colours, as a pill rather than a filled cell. */
function Deviation({ value }: { value: MoneyDto | null }) {
  const v = minor(value)
  if (v === null || value === null) return <span style={muted}>—</span>
  if (v === 0n) return <span style={muted}>0</span>
  const tone = v > 0n ? 'var(--status-good)' : 'var(--status-critical)'
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5"
      style={{ background: `color-mix(in oklab, ${tone} 16%, transparent)`, color: `color-mix(in oklab, ${tone} 75%, var(--ink-primary))` }}
    >
      {v > 0n ? '+' : '−'}
      {formatFullUzs(Math.abs(value.amount))}
    </span>
  )
}

function Conversion({ value }: { value: number | null }) {
  if (value === null) return <span style={muted}>—</span>
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full sm:inline-block" style={{ background: 'var(--grid)' }} aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: 'var(--accent)' }} />
      </span>
      <span className="w-11">{formatPercent(value, 0)}</span>
    </span>
  )
}
