'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { Callout } from '@/components/ui/Callout'
import { ChartCard } from '@/components/ui/Card'
import { StatTile, StatusChip } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { ApiClientError, apiGet, apiWrite } from '@/lib/api'
import { formatClock, formatDateTime, formatNumber } from '@/lib/format'

/* Mirrors `AiControlDto` in `src/server/services/aiRegistratorControlService.ts` — nothing checks the mirror. */
interface AiControlDto {
  readonly config: {
    readonly version: number
    readonly sellers: readonly string[]
    readonly parked: readonly string[]
    readonly maxCalls: number
    readonly maxNew: number
    readonly maxRetry: number
    readonly saleHandoff: string
    readonly updatedAt: string
    readonly updatedBy: string
  } | null
  readonly status: {
    readonly receivedAt: string
    readonly stale: boolean
    readonly report: {
      readonly at: string
      readonly appliedVersion: number | null
      readonly applyError: string | null
      readonly limits: {
        readonly calls?: number | null
        readonly maxNew?: number | null
        readonly maxRetry?: number | null
        readonly saleHandoff?: string | null
        readonly maxSipLegs?: number | null
        readonly fused?: boolean | null
      }
      readonly lines: Readonly<Record<string, string>>
      readonly sellers: readonly {
        readonly ext: string
        readonly name: string | null
        readonly state: string
        readonly inList: boolean
        readonly transfersToday: number
      }[]
      readonly today: {
        readonly calls: number
        readonly answered: number
        readonly transferred: number
        readonly transferFailed: number
        readonly atsRejected: number
      }
    }
  } | null
  readonly names: Readonly<Record<string, string>>
  readonly rules: {
    readonly aiLines: readonly string[]
    readonly maxCalls: number
    readonly maxSellers: number
    readonly staleAfterSec: number
  }
  readonly history: readonly {
    readonly version: number
    readonly savedAt: string
    readonly savedBy: string
    readonly lines: readonly string[]
  }[]
}

type Handoff = 'refer' | 'bridge'

interface Draft {
  readonly sellers: readonly string[]
  readonly parked: readonly string[]
  readonly maxCalls: number
  readonly maxNew: number
  readonly maxRetry: number
  readonly saleHandoff: Handoff
}

type Tone = 'good' | 'warning' | 'critical' | 'neutral'

const SELLER_STATE: Readonly<Record<string, { readonly label: string; readonly tone: Tone }>> = {
  free: { label: 'Boʻsh', tone: 'good' },
  busy: { label: 'Band', tone: 'warning' },
  offline: { label: 'Liniyada yoʻq', tone: 'critical' },
  unknown: { label: 'Nomaʼlum', tone: 'neutral' },
}

const LINE_STATE: Readonly<Record<string, { readonly label: string; readonly tone: Tone }>> = {
  free: { label: 'Boʻsh', tone: 'good' },
  call: { label: 'Qoʻngʻiroqda', tone: 'warning' },
  seller_talk: { label: 'Sotuvchi bilan', tone: 'warning' },
  not_registered: { label: 'Roʻyxatdan oʻtmagan', tone: 'critical' },
}

const EXTENSION = /^\d{2,6}$/

const draftOf = (config: NonNullable<AiControlDto['config']>): Draft => ({
  sellers: config.sellers,
  parked: config.parked,
  maxCalls: config.maxCalls,
  maxNew: config.maxNew,
  maxRetry: config.maxRetry,
  saleHandoff: config.saleHandoff === 'bridge' ? 'bridge' : 'refer',
})

const sameDraft = (a: Draft, b: Draft) =>
  a.sellers.join(',') === b.sellers.join(',') &&
  a.parked.join(',') === b.parked.join(',') &&
  a.maxCalls === b.maxCalls &&
  a.maxNew === b.maxNew &&
  a.maxRetry === b.maxRetry &&
  a.saleHandoff === b.saleHandoff

/**
 * «AI registrator → Boshqaruv» (the owner, 2026-10-30: «boshqaruv paneli
 * orqali men kimlarga berishi kerakligini hal qilaman … faqatgina adminjonga
 * koʻrinadi»). Which sellers' extensions the agent puts an interested caller
 * through to, how many calls it makes at a time, how a sale is handed to the
 * ATS — and, beside the saved version, whether the agent took it.
 *
 * POLLS EVERY 15 s, not on the app's 120 s cadence: the agent reads the
 * settings every 20 s and reports every 30 s, and «AI qabul qildi» is the
 * answer the owner waits for after «Saqlash». Only the accounts the owner named
 * open this page (`auth/aiControl.ts` — adminjon, umida).
 *
 * THE DRAFT IS THE OWNER'S UNTIL SAVED: a poll that brings a new report never
 * overwrites what is being edited — `draft` is null until the first change.
 */
export function AiControlPage() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['ai-registrator-control'],
    queryFn: ({ signal }) => apiGet<AiControlDto>('/leads/ai-registrator/control', {}, signal),
    refetchInterval: 15_000,
    staleTime: 10_000,
  })
  const data = query.data?.data
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saved, setSaved] = useState<number | null>(null)

  const base = data?.config ? draftOf(data.config) : null
  const editing = draft ?? base
  const dirty = draft !== null && (base === null || !sameDraft(draft, base))

  const save = useMutation({
    mutationFn: (d: Draft) =>
      apiWrite<{ version: number }>('POST', '/leads/ai-registrator/control', {
        baseVersion: data?.config?.version ?? 0,
        ...d,
      }),
    onSuccess: (result) => {
      setDraft(null)
      setSaved(result.data.version)
      void queryClient.invalidateQueries({ queryKey: ['ai-registrator-control'] })
    },
  })

  const change = (next: Partial<Draft>) => {
    if (!editing) return
    const merged = { ...editing, ...next }
    // Fewer at a time than the split allows: the split follows it down.
    setDraft({ ...merged, maxNew: Math.min(merged.maxNew, merged.maxCalls), maxRetry: Math.min(merged.maxRetry, merged.maxCalls) })
    setSaved(null)
    save.reset()
  }

  return (
    <PageShell
      title="AI registrator · Boshqaruv"
      description="AI qiziqqan mijozni qaysi sotuvchilarga (ichki SIP raqamlarga) ulaydi, bir vaqtda nechta qoʻngʻiroq qiladi va sotuv ATSga qanday topshiriladi. Saqlangach AI 20 soniya ichida oʻqiydi va qabul qilganini shu yerda koʻrsatadi. Faqat sizning hisobingizga koʻrinadi."
      accent="var(--series-1)"
      period={false}
      actions={
        <Button href="/leads/ai-registrator" variant="ghost" size="sm">
          ← Hisobot
        </Button>
      }
    >
      {query.isError && !data ? (
        <ErrorState
          message={query.error instanceof ApiClientError ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      ) : !data || !editing ? (
        data && !data.config ? (
          <Callout>Sozlama hali saqlanmagan — maʼlumotlar bazasida boshlangʻich yozuv yoʻq.</Callout>
        ) : (
          <LoadingSkeleton rows={6} />
        )
      ) : (
        <div className="flex flex-col gap-6">
          <AckBar data={data} saved={saved} asOf={query.data?.meta.generatedAt ?? null} />
          <SaveBar
            dirty={dirty}
            pending={save.isPending}
            error={save.error instanceof Error ? save.error.message : null}
            onSave={() => editing && save.mutate(editing)}
            onCancel={() => {
              setDraft(null)
              save.reset()
            }}
            problem={editing.sellers.length === 0 ? 'Kamida bitta sotuvchi yoqiq boʻlsin.' : null}
          />
          <Sellers data={data} draft={editing} onChange={change} />
          <Limits data={data} draft={editing} onChange={change} />
          <Live data={data} />
          <History data={data} />
        </div>
      )}
    </PageShell>
  )
}

/** Saved vN — and whether the agent took it, in green, amber or red. */
function AckBar({ data, saved, asOf }: { readonly data: AiControlDto; readonly saved: number | null; readonly asOf: string | null }) {
  const config = data.config!
  const status = data.status
  const report = status?.report
  const minutes = status && asOf ? Math.max(0, Math.round((new Date(asOf).getTime() - new Date(status.receivedAt).getTime()) / 60_000)) : 0

  let ack: { tone: Tone; text: string }
  if (!status || !report) ack = { tone: 'warning', text: 'AIʼdan hali xabar kelmagan' }
  else if (report.applyError && report.appliedVersion !== config.version) ack = { tone: 'critical', text: `AI rad etdi v${config.version}: ${report.applyError}` }
  else if (report.appliedVersion === config.version) ack = { tone: 'good', text: `AI qabul qildi: v${config.version}, ${formatClock(status.receivedAt)}` }
  else ack = { tone: 'warning', text: `AI hali qabul qilmadi — hozir ${report.appliedVersion === null ? 'oʻz sozlamasi' : `v${report.appliedVersion}`} ishlayapti` }

  return (
    <section aria-label="Saqlangan sozlama va AI javobi" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" style={{ color: 'var(--ink-secondary)' }}>
        <span>
          Saqlangan: <strong style={{ color: 'var(--ink-primary)' }}>v{config.version}</strong> · {formatDateTime(config.updatedAt)} · {config.updatedBy}
        </span>
        <span aria-live="polite">
          <StatusChip tone={ack.tone}>{ack.text}</StatusChip>
        </span>
        {saved !== null && saved === config.version && ack.tone !== 'good' && (
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            v{saved} saqlandi — AI 20 soniya ichida oʻqiydi
          </span>
        )}
      </div>
      {status?.stale && (
        <Callout>
          <strong>AIʼdan xabar yoʻq</strong> — oxirgi xabar {formatClock(status.receivedAt)} da ({formatNumber(minutes)} daqiqa oldin). AI server toʻxtagan yoki ISHga ulana olmayapti; quyidagi holat eskirgan.
        </Callout>
      )}
    </section>
  )
}

function SaveBar({
  dirty,
  pending,
  error,
  problem,
  onSave,
  onCancel,
}: {
  readonly dirty: boolean
  readonly pending: boolean
  readonly error: string | null
  readonly problem: string | null
  readonly onSave: () => void
  readonly onCancel: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" onClick={onSave} disabled={!dirty || pending || problem !== null}>
        {pending ? 'Saqlanmoqda…' : 'Saqlash'}
      </Button>
      {dirty && (
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Bekor qilish
        </Button>
      )}
      <span className="text-xs" style={{ color: problem || error ? 'var(--status-critical)' : 'var(--ink-muted)' }} role={error ? 'alert' : undefined}>
        {error ?? problem ?? (dirty ? 'Oʻzgarishlar saqlanmagan' : 'Oʻzgarish yoʻq')}
      </span>
    </div>
  )
}

interface SellerRow {
  readonly ext: string
  readonly on: boolean
  readonly order: number | null
  readonly name: string
  readonly state: string | null
  readonly transfersToday: number | null
}

function Sellers({ data, draft, onChange }: { readonly data: AiControlDto; readonly draft: Draft; readonly onChange: (next: Partial<Draft>) => void }) {
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const reported = new Map((data.status?.report.sellers ?? []).map((s) => [s.ext, s]))
  const live = data.status !== null && !data.status.stale

  const row = (ext: string, on: boolean, order: number | null): SellerRow => {
    const r = reported.get(ext)
    return {
      ext,
      on,
      order,
      name: r?.name?.trim() || data.names[ext] || '—',
      state: live && r ? r.state : null,
      transfersToday: r ? r.transfersToday : null,
    }
  }
  const rows = [
    ...draft.sellers.map((ext, i) => row(ext, true, i + 1)),
    ...draft.parked.map((ext) => row(ext, false, null)),
  ]

  const add = () => {
    const ext = input.trim()
    if (!EXTENSION.test(ext)) return setInputError('Ichki raqam 2–6 ta raqam boʻlsin.')
    if (data.rules.aiLines.includes(ext)) return setInputError(`${ext} — AI liniyasi, sotuvchi boʻla olmaydi.`)
    if (draft.sellers.includes(ext)) return setInputError(`${ext} allaqachon roʻyxatda.`)
    if (draft.parked.includes(ext)) return setInputError(`${ext} roʻyxatda bor, lekin oʻchiq — jadvalda «Yoqish» ni bosing.`)
    if (draft.sellers.length >= data.rules.maxSellers) return setInputError(`Sotuvchi ${data.rules.maxSellers} tadan koʻp boʻlmaydi.`)
    onChange({ sellers: [...draft.sellers, ext] })
    setInput('')
    setInputError(null)
  }
  const toggle = (ext: string, on: boolean) =>
    on
      ? onChange({ sellers: draft.sellers.filter((s) => s !== ext), parked: [...draft.parked, ext] })
      : onChange({ sellers: [...draft.sellers, ext], parked: draft.parked.filter((s) => s !== ext) })
  const remove = (ext: string) => onChange({ sellers: draft.sellers.filter((s) => s !== ext), parked: draft.parked.filter((s) => s !== ext) })
  const move = (ext: string, by: -1 | 1) => {
    const i = draft.sellers.indexOf(ext)
    const j = i + by
    if (i < 0 || j < 0 || j >= draft.sellers.length) return
    const next = [...draft.sellers]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange({ sellers: next })
  }

  return (
    <ChartCard
      title={`Sotuvchilar — AI ulaydigan ichki raqamlar (${draft.sellers.length} ta yoqiq)`}
      hint="AI roʻyxatni shu tartibda chaqiradi va birinchi boʻsh sotuvchiga ulaydi · «Oʻchirish» — vaqtincha, raqam jadvalda qoladi · «×» — butunlay olib tashlash · holat — AIning oxirgi xabaridan"
    >
      <div className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            Yangi SIP (ichki raqam)
            <input
              value={input}
              inputMode="numeric"
              maxLength={6}
              placeholder="masalan 143"
              aria-invalid={inputError !== null}
              onChange={(e) => {
                setInput(e.target.value.replace(/\D/g, ''))
                setInputError(null)
              }}
              className="focusable w-40 rounded-[var(--radius-panel-sm)] border px-2.5 py-1.5 text-sm tabular-nums"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink-primary)' }}
            />
          </label>
          <Button type="submit" variant="secondary" className="mt-5" disabled={input === ''}>
            SIP qoʻshish
          </Button>
          {inputError && (
            <p role="alert" className="mt-6 text-xs" style={{ color: 'var(--status-critical)' }}>
              {inputError}
            </p>
          )}
        </form>

        <div className="overflow-x-auto">
          <table aria-label="Sotuvchilar" className="w-full min-w-[720px] text-xs tabular-nums">
            <thead>
              <tr style={{ color: 'var(--ink-muted)' }}>
                <th className="py-1 pr-3 text-left font-medium">Tartib</th>
                <th className="py-1 pr-3 text-left font-medium">Ichki raqam</th>
                <th className="py-1 pr-3 text-left font-medium">Ism</th>
                <th className="py-1 pr-3 text-left font-medium">Holat</th>
                <th className="py-1 pr-3 text-right font-medium">Bugun ulandi</th>
                <th className="py-1 pr-3 text-left font-medium">AI ulaydimi</th>
                <th className="py-1 text-right font-medium">Amal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const state = r.state ? (SELLER_STATE[r.state] ?? { label: r.state, tone: 'neutral' as const }) : null
                return (
                  <tr key={r.ext} className="border-t" style={{ borderColor: 'var(--grid)', opacity: r.on ? 1 : 0.6 }}>
                    <td className="py-1.5 pr-3">{r.order ?? '—'}</td>
                    <td className="py-1.5 pr-3 font-semibold" style={{ color: 'var(--ink-primary)' }}>
                      {r.ext}
                    </td>
                    <td className="py-1.5 pr-3">{r.name}</td>
                    <td className="py-1.5 pr-3">{state ? <StatusChip tone={state.tone}>{state.label}</StatusChip> : <span style={{ color: 'var(--ink-muted)' }}>—</span>}</td>
                    <td className="py-1.5 pr-3 text-right">{r.transfersToday === null ? '—' : formatNumber(r.transfersToday)}</td>
                    <td className="py-1.5 pr-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.on}
                        aria-label={`${r.ext} — AI ulashi`}
                        onClick={() => toggle(r.ext, r.on)}
                        className="focusable inline-flex items-center gap-2 rounded-full px-1 py-0.5"
                      >
                        <span
                          aria-hidden
                          className="relative inline-block h-4 w-7 rounded-full transition-colors"
                          style={{ background: r.on ? 'var(--status-good)' : 'var(--border-strong)' }}
                        >
                          <span
                            className="absolute top-0.5 h-3 w-3 rounded-full transition-all"
                            style={{ background: 'var(--surface)', left: r.on ? '14px' : '2px' }}
                          />
                        </span>
                        <span style={{ color: r.on ? 'var(--ink-primary)' : 'var(--ink-muted)' }}>{r.on ? 'Ha' : 'Oʻchiq'}</span>
                      </button>
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {r.on && (
                        <>
                          <Button variant="ghost" size="sm" aria-label={`${r.ext} — yuqoriga`} onClick={() => move(r.ext, -1)} disabled={r.order === 1}>
                            ↑
                          </Button>
                          <Button variant="ghost" size="sm" aria-label={`${r.ext} — pastga`} onClick={() => move(r.ext, 1)} disabled={r.order === draft.sellers.length}>
                            ↓
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" size="sm" aria-label={`${r.ext} — butunlay olib tashlash`} onClick={() => remove(r.ext)}>
                        ×
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          AI liniyalari ({data.rules.aiLines.join(', ')}) sotuvchi sifatida qoʻshilmaydi.
        </p>
      </div>
    </ChartCard>
  )
}

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string
  readonly hint: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
        {label}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="sm" aria-label={`${label} — kamaytirish`} onClick={() => onChange(value - 1)} disabled={value <= min}>
          −
        </Button>
        <span className="w-10 text-center text-lg font-semibold tabular-nums" aria-live="polite" style={{ color: 'var(--ink-primary)' }}>
          {value}
        </span>
        <Button variant="secondary" size="sm" aria-label={`${label} — oshirish`} onClick={() => onChange(value + 1)} disabled={value >= max}>
          +
        </Button>
      </div>
      <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {hint}
      </span>
    </div>
  )
}

function Limits({ data, draft, onChange }: { readonly data: AiControlDto; readonly draft: Draft; readonly onChange: (next: Partial<Draft>) => void }) {
  const refer = draft.saleHandoff === 'refer'
  return (
    <ChartCard title="Limitlar" hint="Bir vaqtdagi qoʻngʻiroqlar va ulardan nechtasi yangi lidlarga / nedozvonga">
      <div className="flex flex-wrap gap-8 px-0">
        <Stepper label="Bir vaqtda" hint={`1 dan ${data.rules.maxCalls} gacha`} value={draft.maxCalls} min={1} max={data.rules.maxCalls} onChange={(v) => onChange({ maxCalls: v })} />
        <Stepper label="Shundan yangi lidlarga" hint={`0 dan ${draft.maxCalls} gacha`} value={draft.maxNew} min={0} max={draft.maxCalls} onChange={(v) => onChange({ maxNew: v })} />
        <Stepper label="Shundan nedozvonga" hint={`0 dan ${draft.maxCalls} gacha`} value={draft.maxRetry} min={0} max={draft.maxCalls} onChange={(v) => onChange({ maxRetry: v })} />
        <div className="flex max-w-sm flex-col gap-1">
          <span className="text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
            Sotuvni ATSga topshirish
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={refer}
            onClick={() => onChange({ saleHandoff: refer ? 'bridge' : 'refer' })}
            className="focusable inline-flex w-fit items-center gap-2 rounded-full px-1 py-1"
          >
            <span aria-hidden className="relative inline-block h-5 w-9 rounded-full transition-colors" style={{ background: refer ? 'var(--status-good)' : 'var(--border-strong)' }}>
              <span className="absolute top-0.5 h-4 w-4 rounded-full transition-all" style={{ background: 'var(--surface)', left: refer ? '18px' : '2px' }} />
            </span>
            <span className="text-sm" style={{ color: 'var(--ink-primary)' }}>
              {refer ? 'Yoqiq (refer)' : 'Oʻchiq (bridge)'}
            </span>
          </button>
          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {refer
              ? 'Sotuvchi koʻtargach suhbat ATSning oʻzida ulanadi — ovoz AI serveri orqali oʻtmaydi, AI liniyasi boʻshaydi.'
              : 'Mijoz va sotuvchi AI serveri orqali ulanib turadi (ikkala oyoq ham AIda) — liniya band qoladi.'}
          </span>
        </div>
      </div>
    </ChartCard>
  )
}

/** What the agent runs now: its lines, the limits it applied, the day's numbers. */
function Live({ data }: { readonly data: AiControlDto }) {
  const report = data.status?.report
  const stale = !data.status || data.status.stale
  const tone = (t: Tone): Tone => (stale ? 'neutral' : t)
  const l = report?.limits
  return (
    <ChartCard
      title="AI hozir"
      hint={data.status ? `AIning oxirgi xabari: ${formatClock(data.status.receivedAt)}${stale ? ' — eskirgan' : ''} · har 30 soniyada yangilanadi` : 'AIdan hali xabar kelmagan'}
    >
      {!report ? (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          AI server hali holat yubormagan.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile label="Bugun qoʻngʻiroq" value={report.today.calls} unit="count" compact />
            <StatTile label="Mijoz koʻtardi" value={report.today.answered} unit="count" compact />
            <StatTile label="Sotuvchiga ulandi" value={report.today.transferred} unit="count" tone="good" compact />
            <StatTile label="Ulanmadi" value={report.today.transferFailed} unit="count" tone={report.today.transferFailed > 0 ? 'critical' : 'neutral'} compact />
            <StatTile label="ATS rad etdi" value={report.today.atsRejected} unit="count" tone={report.today.atsRejected > 0 ? 'warning' : 'neutral'} compact />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow">AI liniyalari</span>
            <div className="flex flex-wrap gap-2">
              {Object.entries(report.lines).length === 0 ? (
                <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  —
                </span>
              ) : (
                Object.entries(report.lines)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([line, state]) => {
                    const s = LINE_STATE[state] ?? { label: state, tone: 'neutral' as const }
                    return (
                      <StatusChip key={line} tone={tone(s.tone)}>
                        {line}: {s.label}
                      </StatusChip>
                    )
                  })
              )}
            </div>
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            AI qoʻllagan limitlar: bir vaqtda <strong>{l?.calls ?? '—'}</strong> · yangi <strong>{l?.maxNew ?? '—'}</strong> · nedozvon{' '}
            <strong>{l?.maxRetry ?? '—'}</strong> · sotuv <strong>{l?.saleHandoff ?? '—'}</strong> · SIP oyoqlari ≤ <strong>{l?.maxSipLegs ?? '—'}</strong>
            {l?.fused && (
              <span style={{ color: 'var(--status-critical)' }}> · ehtiyot rejimi: ovoz yoʻqolgani uchun bittadan qoʻngʻiroq</span>
            )}
          </p>
        </div>
      )}
    </ChartCard>
  )
}

function History({ data }: { readonly data: AiControlDto }) {
  return (
    <ChartCard title="Oʻzgarishlar tarixi" hint="Har saqlash: kim, qachon, nima oʻzgardi">
      {data.history.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          —
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-xs">
          {data.history.map((h) => (
            <li key={h.version} className="border-t pt-2" style={{ borderColor: 'var(--grid)' }}>
              <span className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
                v{h.version}
              </span>{' '}
              <span style={{ color: 'var(--ink-muted)' }}>
                · {formatDateTime(h.savedAt)} · {h.savedBy}
              </span>
              {h.lines.length > 0 && <div style={{ color: 'var(--ink-secondary)' }}>{h.lines.join(' · ')}</div>}
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  )
}

