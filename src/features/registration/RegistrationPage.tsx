'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { Card, ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { StatTile, StatusChip } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { apiGet, apiWrite } from '@/lib/api'
import { apportion } from '@/lib/apportion'
import { APP_TIME_ZONE, formatDate, formatDateShort, formatDateTime, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

import { type LeadSplitDto, type LeadSplitRopDto, type SaveSplitBody, SHARE_TOTAL_BP, type SplitShare } from './registrationApi'
import { ROP_COLORS } from './ropColors'
import { RopReport } from './RopReport'

/**
 * «Registratsiya» — how one day's handed-out leads are shared among the ROPs.
 *
 * Asked for on 2026-10-01 from the client's Excel («Jami / yangi / dubl» and
 * a ROP → % → лид сони table). One company-wide split, set every day by an
 * administrator in percent or in leads, against what each ROP actually got
 * (the portal's «Лид таркатилган сана» + «РОП (Первичка)» filter, as
 * «РОП олган лид» on /rnp). The definitions are in
 * `server/domain/registration/leadSplit.ts`.
 *
 * Under the split, «ROP otchet» (`RopReport`): the same day seller by seller.
 * It took the split table's place on 2026-10-01 at the client's request; the
 * split's form moved onto the bars card.
 */

const UNASSIGNED_COLOR = 'var(--ink-muted)'
const muted = { color: 'var(--ink-muted)' } as const

type Unit = 'pct' | 'count'

interface Row extends LeadSplitRopDto {
  readonly color: string
}

const TASHKENT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

function today(): string {
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

export function RegistrationPage() {
  const [day, setDay] = useState(today)
  const [editing, setEditing] = useState(false)
  const goTo = (next: string) => {
    if (next < FIRST_DAY) return
    setDay(next)
    setEditing(false)
  }

  const overview = useQuery({
    queryKey: ['registration-overview', day],
    queryFn: ({ signal }) => apiGet<LeadSplitDto>('/registration/overview', { day }, signal),
    placeholderData: keepPreviousData,
  })
  const data = overview.data?.data
  const status = overview.isPending ? 'loading' : overview.isError ? 'error' : 'ready'

  const rows: Row[] = (data?.rops ?? []).map((r, i) => ({ ...r, color: ROP_COLORS[i % ROP_COLORS.length]! }))
  const assigned = data ? data.total - data.unassigned : null

  return (
    <PageShell
      title={t.modules.registration.title}
      description={t.modules.registration.lead}
      accent="var(--series-3)"
      period={false}
      stale={overview.isPlaceholderData}
      toolbar={
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
              style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
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
      }
    >
      <div className="flex min-w-0 flex-col gap-6">
        {status === 'error' && !data ? (
          <Card className="p-5">
            <ErrorState
              message={overview.error instanceof Error ? overview.error.message : undefined}
              onRetry={() => void overview.refetch()}
            />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label="Jami tarqatilgan lid"
                value={data?.total ?? null}
                unit="count"
                status={status}
                context={data ? formatDate(data.day) : undefined}
              />
              <StatTile
                label="Yangi lid"
                value={data?.fresh ?? null}
                unit="count"
                tone="good"
                status={status}
                context={data && data.total > 0 ? `${formatPercent((data.fresh / data.total) * 100)} — taqsimlanadi` : 'taqsimlanadi'}
              />
              <StatTile
                label="Dublikat"
                value={data?.duplicates ?? null}
                unit="count"
                tone={data && data.duplicates > 0 ? 'warning' : 'neutral'}
                status={status}
                context="bir kontakt shu kuni ikkinchi marta"
              />
              <StatTile
                label="ROPʼlarga berildi"
                value={assigned}
                unit="count"
                status={status}
                context={
                  data
                    ? data.unassigned > 0
                      ? `${formatNumber(data.unassigned)} tasi hech kimga berilmagan`
                      : 'hammasi ROPʼlarga berilgan'
                    : undefined
                }
              />
            </div>

            <ChartCard
              title="Lidlar qanday boʻlinadi"
              hint="Yuqorida — administrator belgilagan reja (yangi lidlardan), pastda — ROPʼlar haqiqatda olgani (jami tarqatilgandan). «Olgan lid» — Bitrix24: «Лид таркатилган сана» shu kun va «РОП (Первичка)» shu ROP."
              action={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {data?.split && !editing && <StatusChip tone="good">Belgilangan · {formatDateTime(data.split.updatedAt)}</StatusChip>}
                  {data && !data.split && !editing && <StatusChip tone="warning">Bu kunga taqsimot belgilanmagan</StatusChip>}
                  {data?.canEdit && !editing && !overview.isPlaceholderData && data.day === day && (
                    <Button size="sm" variant="primary" onClick={() => setEditing(true)}>
                      {data.split ? 'Taqsimotni oʻzgartirish' : 'Taqsimotni belgilash'}
                    </Button>
                  )}
                </div>
              }
            >
              {!data ? (
                <LoadingSkeleton rows={2} />
              ) : editing ? (
                <PlanEditor key={data.day} data={data} rows={rows} onDone={() => setEditing(false)} />
              ) : (
                <SplitBars data={data} rows={rows} />
              )}
            </ChartCard>

            <RopReport day={day} colors={new Map(rows.map((r) => [r.rop, r.color]))} />

            <ChartCard
              title="Kimga qancha lid kelayapti"
              hint="Har bir ROP oxirgi 7 kunda olgan lidlar soni (Bitrix24, «РОП (Первичка)»). Rang qanchalik toʻq boʻlsa — shuncha koʻp."
            >
              {data ? <WeekGrid data={data} rows={rows} /> : <LoadingSkeleton rows={6} />}
            </ChartCard>
          </>
        )}
      </div>
    </PageShell>
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

function RopCell({ row }: { row: Row }) {
  return (
    <th scope="row" className={`${td} text-left font-medium`} style={{ color: 'var(--ink-primary)' }}>
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

/** ROP × the last seven days, each cell tinted by its share of the grid's busiest cell. */
function WeekGrid({ data, rows }: { data: LeadSplitDto; rows: readonly Row[] }) {
  const days = data.week.days
  const max = Math.max(1, ...rows.flatMap((r) => r.week))
  const dayTotals = days.map((_, i) => rows.reduce((sum, r) => sum + (r.week[i] ?? 0), 0) + (data.week.unassigned[i] ?? 0))
  const anyUnassigned = data.week.unassigned.some((v) => v > 0)
  const cell = (v: number, color: string, key: string) => (
    <td
      key={key}
      className="tabular rounded-md px-2 py-2 text-center"
      style={{
        background: v > 0 ? `color-mix(in oklab, ${color} ${Math.round(10 + (Math.min(v, max) / max) * 45)}%, transparent)` : 'transparent',
        color: v > 0 ? 'var(--ink-primary)' : 'var(--ink-muted)',
      }}
    >
      {formatNumber(v)}
    </td>
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className={th}>ROP</th>
            {days.map((d) => (
              <th key={d} className={`${th} text-center`}>
                {formatDateShort(d)}
              </th>
            ))}
            <th className={thR}>7 kun</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rop}>
              <RopCell row={r} />
              {r.week.map((v, i) => cell(v, r.color, days[i]!))}
              <td className={`${tdR} font-semibold`} style={{ color: 'var(--ink-primary)' }}>
                {formatNumber(r.week.reduce((a, b) => a + b, 0))}
              </td>
            </tr>
          ))}
          {anyUnassigned && (
            <tr>
              <th scope="row" className={`${td} text-left font-normal`} style={muted}>
                <span className="inline-flex items-center gap-2">
                  <Dot color={UNASSIGNED_COLOR} />
                  Berilmagan
                </span>
              </th>
              {data.week.unassigned.map((v, i) => cell(v, UNASSIGNED_COLOR, days[i]!))}
              <td className={tdR} style={muted}>
                {formatNumber(data.week.unassigned.reduce((a, b) => a + b, 0))}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={`${td} text-left font-semibold`} style={{ color: 'var(--ink-primary)' }}>
              Jami
            </th>
            {dayTotals.map((v, i) => (
              <td key={days[i]} className="tabular px-2 py-2 text-center font-semibold" style={{ color: 'var(--ink-primary)' }}>
                {formatNumber(v)}
              </td>
            ))}
            <td className={`${tdR} font-semibold`} style={{ color: 'var(--ink-primary)' }}>
              {formatNumber(dayTotals.reduce((a, b) => a + b, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
