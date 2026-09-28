'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TrashGlyph } from '@/components/ui/Icons'
import { apiWrite } from '@/lib/api'
import { formatFullUzs } from '@/lib/format'

import {
  type RnpOverviewDto,
  type RnpUnit,
  SETTING_LEAD_VALUE,
  SETTING_USD_RATE,
  type SaveRnpPlansBody,
} from './rnpApi'
import { muted } from '@/features/reklama/reklamaUi'

/**
 * «Rejalar» — the month's plans and the two settings the sheet computes with,
 * typed in here because nothing in Bitrix24 holds them.
 *
 * EVERY FIGURE IN ITS ROW'S OWN UNIT — soʻm, dollars, percent or a count —
 * the way the sheet prints it, so nobody converts in their head. An emptied
 * field removes the plan: «no plan» is no row, never a plan of zero.
 *
 * ONE PLAN, MANY ROWS. The «Свод» repeats each team's FAKT 1 and FAKT 2, so
 * the same plan key is drawn in two blocks; both inputs edit one value, and
 * the save sends it once.
 *
 * A TEAM'S FAKT 1 / FAKT 2 GO TO `fakt`, not `rows`: the server keeps them in
 * the plan «Sotuv · ROP» reads, so the two screens cannot disagree.
 */
export function RnpPlanEditor({ data }: { data: RnpOverviewDto }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Rejalar
      </Button>
      {open && <PlanDialog data={data} onClose={() => setOpen(false)} />}
    </>
  )
}

// ---------------------------------------------------------------------------

interface PlanField {
  readonly id: string
  readonly team: string
  readonly metric: string
  readonly unit: RnpUnit
  /** Block and row of the first place the plan is drawn — for the error line. */
  readonly label: string
  /** What the form opened with, as text — the baseline «changed» is read against. */
  readonly initial: string
}

interface PlanGroup {
  readonly id: string
  readonly title: string
  readonly rows: readonly { key: string; label: string; field: PlanField }[]
}

interface LeadRow {
  readonly id: number
  readonly fromDay: string
  readonly value: string
}

function fieldsOf(data: RnpOverviewDto): { groups: PlanGroup[]; fields: Map<string, PlanField> } {
  const fields = new Map<string, PlanField>()
  const groups: PlanGroup[] = []
  for (const block of data.blocks) {
    const rows: PlanGroup['rows'][number][] = []
    for (const row of block.rows) {
      if (row.planKey === null) continue
      const id = `${row.planKey.team}|${row.planKey.metric}`
      let field = fields.get(id)
      if (!field) {
        field = {
          id,
          team: row.planKey.team,
          metric: row.planKey.metric,
          unit: row.unit,
          label: `${block.title} · ${row.label}`,
          initial: toText(row.plan, row.unit),
        }
        fields.set(id, field)
      }
      rows.push({ key: row.key, label: row.label, field })
    }
    if (rows.length > 0) groups.push({ id: block.id, title: block.title, rows })
  }
  return { groups, fields }
}

function PlanDialog({ data, onClose }: { data: RnpOverviewDto; onClose: () => void }) {
  const queryClient = useQueryClient()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [{ groups, fields }] = useState(() => fieldsOf(data))
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries([...fields.values()].map((f) => [f.id, f.initial])),
  )
  const [usdRate, setUsdRate] = useState(() => toText(data.settings.usdRate, 'usd'))
  const initialLeadDays = data.settings.leadValues.filter((v) => v.team === '').map((v) => v.fromDay)
  const [leadRows, setLeadRows] = useState<LeadRow[]>(() =>
    data.settings.leadValues
      .filter((v) => v.team === '')
      .map((v, i) => ({ id: i, fromDay: String(v.fromDay), value: toText(v.value, 'uzs') })),
  )
  const monthDays = data.days.length

  const save = useMutation({
    mutationFn: (body: SaveRnpPlansBody) => apiWrite<{ saved: boolean }>('POST', '/rnp/plans', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rnp-overview'] })
      onClose()
    },
  })

  // The dialog takes focus once, on open.
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  // Escape closes, as every modal here does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !save.isPending) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, save.isPending])

  // --- what the form holds, checked ---------------------------------------
  const problems: string[] = []
  for (const f of fields.values()) {
    if (Number.isNaN(parse(values[f.id] ?? '', f.unit))) problems.push(`«${f.label}» — son notoʻgʻri`)
  }
  if (Number.isNaN(parse(usdRate, 'usd'))) problems.push('Dollar kursi — son notoʻgʻri')
  const seenDays = new Set<number>()
  for (const r of leadRows) {
    const day = Number(r.fromDay)
    if (!Number.isInteger(day) || day < 1 || day > monthDays) problems.push(`Lid qiymati — kun 1 dan ${monthDays} gacha boʻlsin`)
    else if (seenDays.has(day)) problems.push(`Lid qiymati — ${day}-kun ikki marta yozilgan`)
    seenDays.add(day)
    if (Number.isNaN(parse(r.value, 'uzs'))) problems.push('Lid qiymati — son notoʻgʻri')
  }

  const submit = () => {
    if (problems.length > 0) return
    save.mutate(bodyOf(data.month, fields, values, usdRate, leadRows, initialLeadDays))
  }

  return (
    // A modal, like «+ Yangi hisob»: a plan should not be half-typed while the
    // sheet behind it changes under a refetch.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-2 sm:p-8"
      style={{ background: 'color-mix(in oklab, black 55%, transparent)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Rejalar — ${data.month}`}
      ref={dialogRef}
      tabIndex={-1}
      onClick={(event) => {
        if (event.target === event.currentTarget && !save.isPending) onClose()
      }}
    >
      <Card className="w-full max-w-3xl">
        <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>
              Rejalar — {data.month}
            </h2>
            <p className="mt-0.5 text-xs" style={muted}>
              Har bir reja qatorning oʻz birligida. Boʻsh qoldirilgan maydon rejani olib tashlaydi.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={save.isPending}>
            Yopish
          </Button>
        </header>

        <div className="flex flex-col gap-6 px-5 pb-4">
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="eyebrow mb-2">Sozlamalar</legend>
            <NumberField label="Dollar kursi" unit="usd" suffix="soʻm / $" value={usdRate} onChange={setUsdRate} />
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Bitta lid qiymati
              </span>
              {leadRows.length === 0 && (
                <p className="text-xs" style={muted}>
                  Kiritilmagan — «План бажарилиши» hisoblanmaydi.
                </p>
              )}
              {leadRows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-xs">
                  <label className="flex shrink-0 items-center gap-1.5" style={muted}>
                    kundan
                    <input
                      inputMode="numeric"
                      value={r.fromDay}
                      onChange={(e) =>
                        setLeadRows((rows) =>
                          rows.map((x) => (x.id === r.id ? { ...x, fromDay: e.target.value.replace(/\D/g, '').slice(0, 2) } : x)),
                        )
                      }
                      aria-label="Qaysi kundan"
                      className={`${INPUT} w-12`}
                      style={INPUT_STYLE}
                    />
                  </label>
                  <input
                    inputMode="numeric"
                    value={r.value === '' ? '' : formatFullUzs(Number(r.value))}
                    onChange={(e) =>
                      setLeadRows((rows) =>
                        rows.map((x) => (x.id === r.id ? { ...x, value: e.target.value.replace(/\D/g, '').slice(0, 13) } : x)),
                      )
                    }
                    placeholder="—"
                    aria-label={`${r.fromDay}-kundan bitta lid qiymati`}
                    className={`${INPUT} w-28 min-w-0`}
                    style={INPUT_STYLE}
                  />
                  <span className="text-[11px]" style={muted}>
                    soʻm
                  </span>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<TrashGlyph size={12} />}
                    aria-label={`${r.fromDay}-kundan qiymatni oʻchirish`}
                    onClick={() => setLeadRows((rows) => rows.filter((x) => x.id !== r.id))}
                  >
                    <span className="hidden sm:inline">Oʻchirish</span>
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  onClick={() =>
                    setLeadRows((rows) => [
                      ...rows,
                      {
                        id: Math.max(-1, ...rows.map((x) => x.id)) + 1,
                        fromDay: String(nextFreeDay(rows, monthDays)),
                        value: '',
                      },
                    ])
                  }
                >
                  + Qator qoʻshish
                </Button>
              </div>
            </div>
          </fieldset>

          <fieldset className="flex min-w-0 flex-col gap-4">
            <legend className="eyebrow mb-2">Oylik rejalar</legend>
            {groups.length === 0 ? (
              <p className="text-xs" style={muted}>
                Bu oyda rejasi bor qator yoʻq.
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.id} className="flex min-w-0 flex-col gap-2">
                  <h3 className="text-xs font-semibold" style={{ color: 'var(--ink-primary)' }}>
                    {g.title}
                  </h3>
                  <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
                    {g.rows.map((r) => (
                      <NumberField
                        key={r.key}
                        label={r.label}
                        ariaLabel={`${g.title} · ${r.label}`}
                        unit={r.field.unit}
                        suffix={SUFFIX[r.field.unit]}
                        value={values[r.field.id] ?? ''}
                        onChange={(v) => setValues((s) => ({ ...s, [r.field.id]: v }))}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </fieldset>
        </div>

        <footer
          className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded-b-[var(--radius-panel)] border-t px-5 py-3 text-[11px]"
          style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)' }}
        >
          <Button variant="primary" size="sm" onClick={submit} disabled={save.isPending || problems.length > 0}>
            {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </Button>
          <Button size="sm" onClick={onClose} disabled={save.isPending}>
            Bekor qilish
          </Button>
          {problems.length > 0 && (
            <span role="alert" style={{ color: 'var(--status-critical)' }}>
              {problems[0]}
            </span>
          )}
          {save.isError && (
            <span role="alert" style={{ color: 'var(--status-critical)' }}>
              {save.error instanceof Error ? save.error.message : 'Saqlab boʻlmadi'}
            </span>
          )}
        </footer>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------

const INPUT = 'focusable tabular h-9 shrink-0 rounded-[var(--radius-panel-sm)] border px-2 text-right text-xs sm:h-8'
const INPUT_STYLE = { background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }

const SUFFIX: Record<RnpUnit, string> = { uzs: 'soʻm', usd: '$', percent: '%', count: 'ta' }

function NumberField({
  label,
  ariaLabel,
  unit,
  suffix,
  value,
  onChange,
}: {
  label: string
  ariaLabel?: string
  unit: RnpUnit
  suffix: string
  value: string
  onChange: (v: string) => void
}) {
  // Soʻm is grouped as it is typed, so 5000000 cannot be misread as 500000.
  const shown = unit === 'uzs' && value !== '' ? formatFullUzs(Number(value)) : value
  return (
    <label className="flex min-w-0 items-center justify-between gap-3 text-xs">
      <span className="min-w-0 truncate" style={{ color: 'var(--ink-secondary)' }} title={label}>
        {label}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <input
          inputMode={unit === 'uzs' ? 'numeric' : 'decimal'}
          value={shown}
          aria-label={ariaLabel}
          onChange={(e) =>
            onChange(unit === 'uzs' ? e.target.value.replace(/\D/g, '').slice(0, 13) : e.target.value.replace(/[^\d.,]/g, '').slice(0, 16))
          }
          placeholder="—"
          className={`${INPUT} w-32`}
          style={INPUT_STYLE}
        />
        <span className="w-12 text-[11px]" style={muted}>
          {suffix}
        </span>
      </span>
    </label>
  )
}

/** A figure as the field opens with it: whole soʻm, anything else to two decimals. */
function toText(value: number | null, unit: RnpUnit): string {
  if (value === null) return ''
  return unit === 'uzs' ? String(Math.round(value)) : String(Math.round(value * 100) / 100)
}

/** Empty is null (remove); NaN is a typo the form refuses to send. */
function parse(text: string, unit: RnpUnit): number | null {
  const clean = text.trim().replace(',', '.')
  if (clean === '') return null
  if (unit === 'uzs') return /^\d+$/.test(clean) ? Number(clean) : Number.NaN
  return /^\d+(\.\d{0,2})?$/.test(clean) ? Number(clean) : Number.NaN
}

function nextFreeDay(rows: readonly LeadRow[], monthDays: number): number {
  const taken = new Set(rows.map((r) => Number(r.fromDay)))
  for (let d = 1; d <= monthDays; d++) if (!taken.has(d)) return d
  return monthDays
}

/**
 * Only what changed, plus every setting. A team's FAKT 1 / FAKT 2 travel as
 * one `fakt` entry carrying BOTH figures — the server replaces the pair, so
 * sending one alone would erase the other.
 */
export function bodyOf(
  month: string,
  fields: ReadonlyMap<string, PlanField>,
  values: Readonly<Record<string, string>>,
  usdRate: string,
  leadRows: readonly LeadRow[],
  initialLeadDays: readonly number[],
): SaveRnpPlansBody {
  const rows = new Map<string, SaveRnpPlansBody['rows'][number]>()
  const put = (team: string, metric: string, fromDay: number, value: number | null) =>
    rows.set(`${team}|${metric}|${fromDay}`, { team, metric, fromDay, value })

  const fakt = new Map<string, { fakt1: number | null; fakt2: number | null }>()
  const faktChanged = new Set<string>()

  for (const f of fields.values()) {
    const value = parse(values[f.id] ?? '', f.unit)
    const changed = value !== parse(f.initial, f.unit)
    if ((f.metric === 'fakt1' || f.metric === 'fakt2') && f.team !== '') {
      const entry = fakt.get(f.team) ?? { fakt1: null, fakt2: null }
      entry[f.metric] = value === null ? null : Math.round(value)
      fakt.set(f.team, entry)
      if (changed) faktChanged.add(f.team)
    } else if (changed) {
      put(f.team, f.metric, 1, value)
    }
  }

  put('', SETTING_USD_RATE, 1, parse(usdRate, 'usd'))
  const kept = new Set<number>()
  for (const r of leadRows) {
    const day = Number(r.fromDay)
    kept.add(day)
    put('', SETTING_LEAD_VALUE, day, parse(r.value, 'uzs'))
  }
  // A starting day removed or moved: its old row goes.
  for (const day of initialLeadDays) if (!kept.has(day)) put('', SETTING_LEAD_VALUE, day, null)

  return {
    month,
    rows: [...rows.values()],
    fakt: [...faktChanged].map((rop) => ({ rop, ...(fakt.get(rop) ?? { fakt1: null, fakt2: null }) })),
  }
}
