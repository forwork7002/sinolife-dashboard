'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { StatusChip } from '@/components/ui/Stat'
import { apiGet, apiWrite } from '@/lib/api'
import { apportion } from '@/lib/apportion'
import { APP_TIME_ZONE, formatDate, formatDateShort, formatDateTime, formatNumber, formatPercent } from '@/lib/format'

import { type LeadSplitDto, type LeadSplitRopDto, type SaveSplitBody, SHARE_TOTAL_BP, type SplitShare } from './leadSplitApi'
import { ROP_COLORS } from './ropColors'

/**
 * How one day's handed-out leads are shared among the ROPs — the cards that
 * were «Registratsiya» until 2026-10-02, when the client folded that section
 * into «Lidlar» («registratsiya boʻlimi toʻliqligicha oʻchiramiz, ichidagi
 * maʼlumotlarni boshqa joyga oʻtkazamiz»).
 *
 * Asked for on 2026-10-01 from the client's Excel («Jami / yangi / dubl» and
 * a ROP → % → лид сони table). One company-wide split, set every day by an
 * administrator in percent or in leads, against what each ROP actually got
 * (the portal's «Лид таркатилган сана» + «РОП (Первичка)» filter, as
 * «РОП олган лид» on /rnp). The definitions are in
 * `server/domain/registration/leadSplit.ts`.
 *
 * ONE DAY, NOT THE PAGE'S PERIOD. The split is set per day, so these cards and
 * «ROP otchet» share their own day (`DayPicker`, held by `LeadsPage`); the
 * rest of «Lid manbalari» stays on the dashboard period. Both cards read one
 * query (`useLeadSplit`), so they cannot disagree.
 */

const UNASSIGNED_COLOR = 'var(--ink-muted)'
const muted = { color: 'var(--ink-muted)' } as const

type Unit = 'pct' | 'count'

interface Row extends LeadSplitRopDto {
  readonly color: string
}

const TASHKENT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

export function today(): string {
  return TASHKENT_DAY.format(new Date())
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

const pctOfBp = (bp: number) => bp / 100
/** The API's first day; the arrows and the picker stop there rather than earn a 400. */
const FIRST_DAY = '2025-01-01'

/** ‹ day › and «Bugun» — the one control the day cards and «ROP otchet» share. */
export function DayPicker({ day, onChange }: { day: string; onChange: (day: string) => void }) {
  const goTo = (next: string) => {
    if (next >= FIRST_DAY) onChange(next)
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="ghost" aria-label="Oldingi kun" onClick={() => goTo(shiftDay(day, -1))}>
        ‹
      </Button>
      <label className="flex items-center gap-2 text-xs" style={muted}>
        Kun
        <input
          type="date"
          value={day}
          min={FIRST_DAY}
          max={shiftDay(today(), 7)}
          onChange={(e) => {
            if (e.target.value) goTo(e.target.value)
          }}
          className="focusable rounded-[var(--radius-panel-sm)] border px-2 py-1 text-xs"
          style={{ backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
        />
      </label>
      <Button size="sm" variant="ghost" aria-label="Keyingi kun" onClick={() => goTo(shiftDay(day, 1))}>
        ›
      </Button>
      {day !== today() && (
        <Button size="sm" variant="ghost" onClick={() => goTo(today())}>
          Bugun
        </Button>
      )}
    </div>
  )
}

/** The day's split and handed-out leads, each team with its colour. */
export function useLeadSplit(day: string, enabled = true) {
  const overview = useQuery({
    queryKey: ['registration-overview', day],
    enabled,
    queryFn: ({ signal }) => apiGet<LeadSplitDto>('/registration/overview', { day }, signal),
    placeholderData: keepPreviousData,
  })
  const data = overview.data?.data
  const rows: Row[] = (data?.rops ?? []).map((r, i) => ({ ...r, color: ROP_COLORS[i % ROP_COLORS.length]! }))
  return { overview, data, rows, colors: new Map(rows.map((r) => [r.rop, r.color])) }
}

function SplitError({ overview }: { overview: ReturnType<typeof useLeadSplit>['overview'] }) {
  return <ErrorState message={overview.error instanceof Error ? overview.error.message : undefined} onRetry={() => void overview.refetch()} />
}

/** «Lidlar qanday boʻlinadi» — plan and actual as bars, with the administrator's form. */
export function LeadSplitCard({ day, onDay }: { day: string; onDay: (day: string) => void }) {
  const { overview, data, rows } = useLeadSplit(day)
  // The day the form was opened for: another day closes it.
  const [editingDay, setEditingDay] = useState<string | null>(null)
  if (editingDay !== null && editingDay !== day) setEditingDay(null)
  const editing = editingDay === day

  return (
    <ChartCard
      title={`Lidlar qanday boʻlinadi${data ? ` · ${formatDate(data.day)}` : ''}`}
      hint="Bir kunlik: yuqorida — administrator belgilagan reja (yangi lidlardan), pastda — ROPʼlar haqiqatda olgani (jami tarqatilgandan). «Olgan lid» — Bitrix24: «Лид таркатилган сана» shu kun va «РОП (Первичка)» shu ROP. Kun «ROP otchet» bilan umumiy."
    >
      {/* Under the title rather than beside it: a phone keeps the title on one line. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <DayPicker day={day} onChange={onDay} />
        <div className="flex flex-wrap items-center gap-2">
          {data?.split && !editing && <StatusChip tone="good">Belgilangan · {formatDateTime(data.split.updatedAt)}</StatusChip>}
          {data && !data.split && !editing && <StatusChip tone="warning">Bu kunga taqsimot belgilanmagan</StatusChip>}
          {data?.canEdit && !editing && !overview.isPlaceholderData && data.day === day && (
            <Button size="sm" variant="primary" onClick={() => setEditingDay(day)}>
              {data.split ? 'Taqsimotni oʻzgartirish' : 'Taqsimotni belgilash'}
            </Button>
          )}
        </div>
      </div>
      {overview.isError && !data ? (
        <SplitError overview={overview} />
      ) : !data ? (
        <LoadingSkeleton rows={2} />
      ) : editing ? (
        <PlanEditor key={data.day} data={data} rows={rows} onDone={() => setEditingDay(null)} />
      ) : (
        <SplitBars data={data} rows={rows} />
      )}
    </ChartCard>
  )
}

type WeekView = 'kval' | 'bezkval'

/**
 * «Kimga qancha lid kelayapti» — the month up to the chosen day, in two
 * readings of one response: «Квал», the leads handed to each ROP («РОП
 * (Первичка)»), and «Безквал» (the client, 2026-10-05), the Регистрация deals
 * the desk made each ROP «Ответственный» of, by the day they were created.
 */
export function LeadWeekCard({ day }: { day: string }) {
  const { overview, data, rows, colors } = useLeadSplit(day)
  const [view, setView] = useState<WeekView>('kval')
  const hint =
    view === 'kval'
      ? `Har bir ROP ${formatDate(day)} gacha bir oyda olgan lidlar soni (Bitrix24, «РОП (Первичка)»). Rang qanchalik toʻq boʻlsa — shuncha koʻp. Oldingi kunlar — chapga suring.`
      : `Безквал: Регистрация voronkasida «Ответственный» shu ROP boʻlgan bitimlar, yaratilgan kuni boʻyicha (${formatDate(day)} gacha bir oy, barcha bosqichlar). Oldingi kunlar — chapga suring.`
  let grid: ReactNode = null
  if (data) {
    grid =
      view === 'kval' ? (
        <WeekGrid key="kval" days={data.week.days} rows={rows} unassigned={data.week.unassigned} unassignedLabel="Berilmagan" resetKey={data.day} />
      ) : (
        <WeekGrid
          key="bezkval"
          days={data.week.days}
          rows={data.bezkval.rops.map((r, i) => ({ ...r, color: colors.get(r.rop) ?? ROP_COLORS[(rows.length + i) % ROP_COLORS.length]! }))}
          unassigned={data.bezkval.unassigned}
          unassignedLabel="ROP belgilanmagan"
          resetKey={data.day}
        />
      )
  }
  return (
    <ChartCard
      title="Kimga qancha lid kelayapti"
      hint={hint}
      action={
        <SegmentedControl<WeekView>
          ariaLabel="Lid turi"
          value={view}
          onChange={setView}
          options={[
            { value: 'kval', label: 'Квал' },
            { value: 'bezkval', label: 'Безквал' },
          ]}
        />
      }
    >
      {overview.isError && !data ? <SplitError overview={overview} /> : (grid ?? <LoadingSkeleton rows={6} />)}
    </ChartCard>
  )
}

interface Part {
  readonly key: string
  readonly label: string
  readonly value: number
  readonly color: string
  readonly note: string
}

function Bar({ label, whole, parts }: { label: string; whole: number; parts: readonly Part[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      <div className="flex h-11 w-full overflow-hidden rounded-[var(--radius-panel-sm)]" style={{ background: 'var(--grid)' }}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => {
            const pct = (p.value / whole) * 100
            return (
              <div
                key={p.key}
                title={`${p.label}: ${p.note}`}
                className="flex min-w-0 flex-col justify-center overflow-hidden border-r px-2 text-white last:border-r-0"
                style={{ width: `${pct}%`, background: p.color, borderColor: 'var(--surface-raised)' }}
              >
                {pct >= 6 && (
                  <span className="hidden min-w-0 flex-col sm:flex">
                    <span className="truncate text-[11px] leading-tight font-medium">{p.label}</span>
                    <span className="tabular truncate text-[11px] leading-tight opacity-90">{p.note}</span>
                  </span>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

/** Plan and actual as two stacked bars, each over its own whole. */
function SplitBars({ data, rows }: { data: LeadSplitDto; rows: readonly Row[] }) {
  return (
    <div className="flex flex-col gap-4">
      {data.split && data.fresh > 0 ? (
        <Bar
          label={`Reja · ${formatNumber(data.fresh)} ta yangi lid`}
          whole={data.fresh}
          parts={rows.map((r) => ({
            key: r.rop,
            label: r.rop,
            value: r.planLeads ?? 0,
            color: r.color,
            note: `${shareText(r.shareBp ?? 0)} · ${formatNumber(r.planLeads ?? 0)}`,
          }))}
        />
      ) : (
        <p
          className="rounded-[var(--radius-panel-sm)] border border-dashed px-3 py-3 text-xs"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-secondary)' }}
        >
          {data.split ? 'Bu kunda hali yangi lid yoʻq — reja lid soni lidlar kelgach chiqadi.' : 'Bu kunga reja belgilanmagan.'}
        </p>
      )}
      {data.total > 0 ? (
        <Bar
          label={`Haqiqatda olgan · ${formatNumber(data.total)} ta tarqatilgan`}
          whole={data.total}
          parts={[
            ...rows.map((r) => ({
              key: r.rop,
              label: r.rop,
              value: r.received,
              color: r.color,
              note: `${formatPercent((r.received / data.total) * 100, 0)} · ${formatNumber(r.received)}`,
            })),
            { key: '∅', label: 'Berilmagan', value: data.unassigned, color: UNASSIGNED_COLOR, note: formatNumber(data.unassigned) },
          ]}
        />
      ) : (
        <p className="text-xs" style={muted}>
          Bu kunda hali birorta lid tarqatilmagan.
        </p>
      )}
      {/* On a phone the segments are too narrow to carry names: the key goes under the bars. */}
      <ul className="grid grid-cols-1 gap-y-1.5 text-xs sm:hidden">
        {rows.map((r) => (
          <li key={r.rop} className="flex items-center gap-1.5">
            <Dot color={r.color} />
            <span className="truncate" style={{ color: 'var(--ink-primary)' }}>
              {r.rop}
            </span>
            <span className="tabular ml-auto" style={muted}>
              {r.shareBp === null ? '—' : shareText(r.shareBp)} → {formatNumber(r.received)} ta
            </span>
          </li>
        ))}
      </ul>
      {data.unassigned > 0 && (
        <p className="text-xs" style={muted}>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: UNASSIGNED_COLOR }} aria-hidden />
          {formatNumber(data.unassigned)} ta lid hech bir ROP jamoasiga berilmagan («РОП (Первичка)» boʻsh yoki ROP boʻlmagan xodim).
        </p>
      )}
    </div>
  )
}

function shareText(bp: number): string {
  return formatPercent(pctOfBp(bp), bp % 100 === 0 ? 0 : bp % 10 === 0 ? 1 : 2)
}

function Dot({ color }: { color: string }) {
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
}

const th = 'eyebrow px-3 py-2 text-left font-[550] whitespace-nowrap'
const thR = `${th} text-right`
const td = 'px-3 py-2.5 whitespace-nowrap'
const tdR = `${td} tabular text-right`
/** The month grid's ROP column and its total, held while the days scroll beneath. */
const pinL = 'tcol-sticky is-edge left-0'
const pinR = 'tcol-sticky right-0'

function RopCell({ row, className = '' }: { row: { readonly rop: string; readonly color: string }; className?: string }) {
  return (
    <th scope="row" className={`${td} ${className} text-left font-medium`} style={{ color: 'var(--ink-primary)' }}>
      <span className="inline-flex items-center gap-2">
        <Dot color={row.color} />
        {row.rop}
      </span>
    </th>
  )
}

/** Typed text → a non-negative number, or NaN. Empty is 0, so a team can be left out of the day. */
function parseShareInput(text: string | undefined): number {
  const trimmed = (text ?? '').trim().replace(',', '.')
  if (trimmed === '') return 0
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN
}

/**
 * The administrator's form: each ROP's share of the day's new leads, typed in
 * percent (one decimal) or in leads. It saves only at exactly 100 % — or, in
 * leads, exactly the day's new leads — and sends basis points, so nothing is
 * lost to rounding: leads become shares through `apportion`.
 */
function PlanEditor({ data, rows, onDone }: { data: LeadSplitDto; rows: readonly Row[]; onDone: () => void }) {
  const queryClient = useQueryClient()
  // Frozen when the form opens: today's count grows under a minute's refetch, and a balanced form must stay balanced.
  const [fresh] = useState(data.fresh)
  const canCount = fresh > 0
  const [unit, setUnit] = useState<Unit>('pct')

  const fromShares = (shares: ReadonlyMap<string, number>): Record<string, string> =>
    Object.fromEntries(rows.map((r) => [r.rop, shares.has(r.rop) ? String(pctOfBp(shares.get(r.rop)!)) : '']))
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    fromShares(new Map(rows.flatMap((r) => (r.shareBp ? [[r.rop, r.shareBp] as const] : [])))),
  )

  const values = rows.map((r) => parseShareInput(draft[r.rop]))
  const badNumber = values.some((v) => Number.isNaN(v))
  // Percent to two decimals (one basis point), leads whole: anything finer cannot be stored exactly.
  const badPrecision = !badNumber && values.some((v) => (unit === 'pct' ? Math.abs(v * 100 - Math.round(v * 100)) > 1e-6 : !Number.isInteger(v)))
  const invalid = badNumber || badPrecision
  const sum = values.reduce((a, v) => a + (Number.isNaN(v) ? 0 : v), 0)
  const target = unit === 'pct' ? 100 : fresh
  const balanced = !invalid && Math.abs(sum - target) < 1e-6
  const left = target - sum
  const amount = (n: number) => (unit === 'pct' ? formatPercent(n) : `${formatNumber(n)} ta`)

  const shares = (): SplitShare[] => {
    const bp = unit === 'pct' ? values.map((v) => Math.round(v * 100)) : apportion(SHARE_TOTAL_BP, values)
    return rows.map((r, i) => ({ rop: r.rop, shareBp: bp[i]! })).filter((s) => s.shareBp > 0)
  }

  const save = useMutation({
    mutationFn: (body: SaveSplitBody) => apiWrite<{ saved: boolean }>('POST', '/registration/split', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['registration-overview'] })
      onDone()
    },
  })

  const switchUnit = (next: Unit) => {
    if (next === unit) return
    if (!invalid && sum > 0) {
      const converted = next === 'count' ? apportion(fresh, values) : apportion(SHARE_TOTAL_BP, values).map(pctOfBp)
      setDraft(Object.fromEntries(rows.map((r, i) => [r.rop, values[i] ? String(converted[i]) : ''])))
    }
    setUnit(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {canCount ? (
            <SegmentedControl<Unit>
              ariaLabel="Qanday kiritiladi"
              value={unit}
              onChange={switchUnit}
              options={[
                { value: 'pct', label: 'Foizda' },
                { value: 'count', label: 'Sonda' },
              ]}
            />
          ) : (
            <span className="text-xs" style={muted}>
              Bu kunda hali yangi lid yoʻq — faqat foizda kiritiladi.
            </span>
          )}
          {data.previous && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setUnit('pct')
                setDraft(fromShares(new Map(data.previous!.rows.map((s) => [s.rop, s.shareBp]))))
              }}
            >
              {data.previous.day === shiftDay(data.day, -1) ? 'Kechagi taqsimotni olish' : `${formatDateShort(data.previous.day)} taqsimotini olish`}
            </Button>
          )}
        </div>
        {invalid ? (
          <StatusChip tone="critical">{badNumber ? 'Notoʻgʻri son bor' : unit === 'pct' ? 'Foiz koʻpi bilan ikki kasr bilan' : 'Lid soni butun boʻlishi kerak'}</StatusChip>
        ) : balanced ? (
          <StatusChip tone="good">Jami {unit === 'pct' ? '100%' : `${formatNumber(fresh)} ta lid`}</StatusChip>
        ) : (
          <StatusChip tone="warning">
            Jami {amount(sum)} — {left > 0 ? `yana ${amount(left)} taqsimlang` : `${amount(-left)} ortiqcha`}
          </StatusChip>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r, i) => {
          const v = values[i]!
          const id = `share-${r.rop}`
          const hint =
            Number.isNaN(v) || !canCount
              ? ''
              : unit === 'pct'
                ? `≈ ${formatNumber(Math.round((v / 100) * fresh))} ta`
                : formatPercent((v / fresh) * 100)
          return (
            <div
              key={r.rop}
              className="flex items-center gap-3 rounded-[var(--radius-panel-sm)] border px-3 py-2"
              style={{ borderColor: Number.isNaN(v) ? 'var(--status-critical)' : 'var(--border)' }}
            >
              <Dot color={r.color} />
              <label htmlFor={id} className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>
                {r.rop}
              </label>
              <div className="flex items-center gap-1">
                <input
                  id={id}
                  inputMode="decimal"
                  placeholder="0"
                  value={draft[r.rop] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.rop]: e.target.value }))}
                  className="focusable tabular w-20 rounded-[var(--radius-panel-sm)] border px-2 py-1.5 text-right text-sm"
                  style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
                />
                <span className="w-6 text-xs" style={muted}>
                  {unit === 'pct' ? '%' : 'ta'}
                </span>
              </div>
              <span className="tabular w-16 text-right text-xs" style={muted}>
                {hint}
              </span>
            </div>
          )
        })}
      </div>

      {save.isError && (
        <p className="text-xs" role="alert" style={{ color: 'var(--status-critical)' }}>
          {save.error instanceof Error ? save.error.message : 'Saqlab boʻlmadi.'}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Bekor qilish
        </Button>
        <Button size="sm" variant="primary" disabled={!balanced || save.isPending} onClick={() => save.mutate({ day: data.day, rows: shares() })}>
          {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
        </Button>
      </div>
    </div>
  )
}

/**
 * ROP × the month up to the day, each cell tinted by its share of the grid's
 * busiest cell. It opens on the latest days; the ROP column and the total stay
 * put while the days scroll left.
 */
function WeekGrid({
  days,
  rows,
  unassigned,
  unassignedLabel,
  resetKey,
}: {
  days: readonly string[]
  rows: readonly { readonly rop: string; readonly color: string; readonly week: readonly number[] }[]
  unassigned: readonly number[]
  unassignedLabel: string
  /** The day: a new one scrolls the grid back to its latest days. */
  resetKey: string
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.week))
  const dayTotals = days.map((_, i) => rows.reduce((sum, r) => sum + (r.week[i] ?? 0), 0) + (unassigned[i] ?? 0))
  const anyUnassigned = unassigned.some((v) => v > 0)
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [resetKey])
  const cell = (v: number, color: string, key: string) => (
    <td
      key={key}
      className="tabular min-w-[3.25rem] rounded-md px-2 py-2 text-center"
      style={{
        background: v > 0 ? `color-mix(in oklab, ${color} ${Math.round(10 + (Math.min(v, max) / max) * 45)}%, transparent)` : 'transparent',
        color: v > 0 ? 'var(--ink-primary)' : 'var(--ink-muted)',
      }}
    >
      {formatNumber(v)}
    </td>
  )
  return (
    <div ref={scroller} className="overflow-x-auto">
      <table className="w-full min-w-max border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className={`${th} ${pinL}`}>ROP</th>
            {days.map((d) => (
              <th key={d} className={`${th} text-center`}>
                {formatDateShort(d)}
              </th>
            ))}
            <th className={`${thR} ${pinR}`}>{days.length} kun</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rop}>
              <RopCell row={r} className={pinL} />
              {r.week.map((v, i) => cell(v, r.color, days[i]!))}
              <td className={`${tdR} ${pinR} font-semibold`} style={{ color: 'var(--ink-primary)' }}>
                {formatNumber(r.week.reduce((a, b) => a + b, 0))}
              </td>
            </tr>
          ))}
          {anyUnassigned && (
            <tr>
              <th scope="row" className={`${td} ${pinL} text-left font-normal`} style={muted}>
                <span className="inline-flex items-center gap-2">
                  <Dot color={UNASSIGNED_COLOR} />
                  {unassignedLabel}
                </span>
              </th>
              {unassigned.map((v, i) => cell(v, UNASSIGNED_COLOR, days[i]!))}
              <td className={`${tdR} ${pinR}`} style={muted}>
                {formatNumber(unassigned.reduce((a, b) => a + b, 0))}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={`${td} ${pinL} text-left font-semibold`} style={{ color: 'var(--ink-primary)' }}>
              Jami
            </th>
            {dayTotals.map((v, i) => (
              <td key={days[i]} className="tabular px-2 py-2 text-center font-semibold" style={{ color: 'var(--ink-primary)' }}>
                {formatNumber(v)}
              </td>
            ))}
            <td className={`${tdR} ${pinR} font-semibold`} style={{ color: 'var(--ink-primary)' }}>
              {formatNumber(dayTotals.reduce((a, b) => a + b, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
