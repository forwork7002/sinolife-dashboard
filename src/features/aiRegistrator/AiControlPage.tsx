'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { Callout } from '@/components/ui/Callout'
import { Card } from '@/components/ui/Card'
import { StatusChip } from '@/components/ui/Stat'
import { AiNowPanel, ProductPill, StatePill, TONE_COLOR, inked } from '@/features/aiRegistrator/AiNowPanel'
import { useServerNow } from '@/features/aiRegistrator/aiClock'
import {
  type AiStatus,
  type Product,
  type Tone,
  appliedAck,
  effectiveCalls,
  elapsedText,
  isFresh,
  limitsProblem,
  nowRow,
  productOf,
  sellerLook,
  transferOrderText,
} from '@/features/aiRegistrator/aiLiveLogic'
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
  readonly status: AiStatus | null
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

/* Mirrors `AiLiveDto` — the 5 s read, `?part=live`. */
interface AiLiveDto {
  readonly status: AiStatus | null
  readonly staleAfterSec: number
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
 * LAID OUT BY THE OWNER'S DESIGN CANVAS (2026-11-02, «Boshqaruv»): a status
 * card on top (is Dilnoza working, which version she runs), then numbered
 * sections — 1 the AI lines now (`AiNowPanel`, read-only: the config has no
 * lines, adding a MicroSIP is the agent's own work), 2 the sellers, 3 the
 * limits with the slots they make, 4 the ATS hand-off — the history, and a
 * save bar that stays at the bottom of the screen while anything is unsaved.
 * NOT DRAWN, because the agent has no such control (ai_registrator ca9c52a):
 * a pause button, adding or removing an AI line, the sellers' ORDER — the
 * agent picks by `limits.transferOrder` itself, shown as words only.
 *
 * TWO READS. The last report alone (`?part=live`, one row by its key) every
 * 5 s while the tab is in view — the agent reports every 5 s while a line is
 * busy; the settings, the audit and the roster's names every minute, and at
 * once after «Saqlash». Only the accounts the owner named open this page
 * (`auth/aiControl.ts` — adminjon, umida).
 *
 * THE DRAFT IS THE OWNER'S UNTIL SAVED: a poll that brings a new report never
 * overwrites what is being edited — `draft` is null until the first change.
 */
export function AiControlPage() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['ai-registrator-control'],
    queryFn: ({ signal }) => apiGet<AiControlDto>('/leads/ai-registrator/control', {}, signal),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const liveQuery = useQuery({
    queryKey: ['ai-registrator-control', 'live'],
    queryFn: ({ signal }) => apiGet<AiLiveDto>('/leads/ai-registrator/control', { part: 'live' }, signal),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    staleTime: 4_000,
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
  const cancel = () => {
    setDraft(null)
    save.reset()
  }

  // The 5 s read wins over the minute one: both are the same row, the newer read is the truer picture.
  const live = liveQuery.data
  const status = live ? live.data.status : (data?.status ?? null)
  const staleAfterSec = live?.data.staleAfterSec ?? data?.rules.staleAfterSec ?? 90
  const skew = live ? new Date(live.meta.generatedAt).getTime() - liveQuery.dataUpdatedAt : 0
  // A response without a readable clock moves nothing — a NaN here would stop every timer on the page.
  const skewMs = Number.isFinite(skew) ? skew : 0
  const reported = new Map((status?.report.sellers ?? []).map((s) => [s.ext, s.name]))
  const nameOf = (ext: string): string | null => reported.get(ext)?.trim() || data?.names[ext] || null
  const now = useServerNow(skewMs)
  const fresh = isFresh(status, now, staleAfterSec)
  const problem = !editing ? null : editing.sellers.length === 0 ? 'Kamida bitta sotuvchi yoqiq boʻlsin.' : limitsProblem(editing.maxNew, editing.maxRetry)

  return (
    <PageShell
      title="Boshqaruv"
      description="Dilnoza (AI registrator) kimlarga ulaydi, bir vaqtda nechta qoʻngʻiroq qiladi va sotuvni ATSga qanday topshiradi. Saqlangan sozlamani AI 20 soniya ichida oʻqiydi."
      accent="var(--series-1)"
      period={false}
      actions={
        <Button href="/leads/ai-registrator" variant="ghost" size="sm">
          ← Hisobot va jonli monitoring
        </Button>
      }
    >
      {query.isError && !data ? (
        <ErrorState message={query.error instanceof ApiClientError ? query.error.message : undefined} onRetry={() => void query.refetch()} />
      ) : !data || !editing ? (
        data && !data.config ? (
          <Callout>Sozlama hali saqlanmagan — maʼlumotlar bazasida boshlangʻich yozuv yoʻq.</Callout>
        ) : (
          <LoadingSkeleton rows={6} />
        )
      ) : (
        <div className="flex flex-col gap-5 pb-2">
          <StatusCard data={data} status={status} saved={saved} now={now} staleAfterSec={staleAfterSec} />
          <Step n={1} title="AI liniyalari (SIP)" lead="Har liniya hozir nima qilyapti — AIning oʻz xabaridan. Liniya qoʻshish yoki oʻchirish AI serverining sozlamasida, bu yerda emas.">
            <AiNowPanel
              status={status}
              saved={data.config}
              staleAfterSec={staleAfterSec}
              now={now}
              updatedAt={live?.meta.generatedAt ?? query.data?.meta.generatedAt ?? null}
              updateFailed={liveQuery.isError}
              nameOf={nameOf}
            />
          </Step>
          <Step
            n={2}
            title="Sotuvchilar — AI kimlarga ulaydi"
            lead={
              <>
                Qiziqqan mijozni AI shu roʻyxatdagi boʻsh sotuvchiga ulaydi
                {transferOrderText(status?.report.limits.transferOrder) ? ` — ${transferOrderText(status?.report.limits.transferOrder)}` : ''}. «AI ulaydimi»ni
                oʻchirish — vaqtincha, raqam roʻyxatda qoladi; «Olib tashlash» — butunlay.
              </>
            }
          >
            <Sellers data={data} status={fresh ? status : null} draft={editing} onChange={change} now={now} />
          </Step>
          <Step n={3} title="Limitlar" lead="Bir vaqtda nechta qoʻngʻiroq va ulardan nechtasi yangi lidlarga, nechtasi nedozvonga.">
            <Limits data={data} draft={editing} onChange={change} status={status} />
          </Step>
          <Step n={4} title="Sotuvni ATSga topshirish">
            <Handoff draft={editing} onChange={change} />
          </Step>
          <History data={data} />
          <SaveBar
            dirty={dirty}
            pending={save.isPending}
            error={save.error instanceof Error ? save.error.message : null}
            problem={problem}
            onSave={() => editing && save.mutate(editing)}
            onCancel={cancel}
          />
        </div>
      )}
    </PageShell>
  )
}

/** «1 · AI liniyalari (SIP)» — a numbered section heading, one line under it, the body. */
function Step({ n, title, lead, children }: { readonly n: number; readonly title: string; readonly lead?: ReactNode; readonly children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <header>
        <h2 className="flex items-baseline gap-2 text-[18px] font-bold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
          <span className="tabular-nums" style={{ color: inked('var(--series-1)') }}>
            {n} ·
          </span>
          {title}
        </h2>
        {lead && (
          <p className="mt-1 max-w-3xl text-[13px] leading-5" style={{ color: 'var(--ink-secondary)' }}>
            {lead}
          </p>
        )}
      </header>
      {children}
    </section>
  )
}

/** «Dilnoza ishlayapti · Sozlama v12 · saqlandi … · AI qoʻlladi ✓» — the page's first card. */
function StatusCard({
  data,
  status,
  saved,
  now,
  staleAfterSec,
}: {
  readonly data: AiControlDto
  readonly status: AiStatus | null
  readonly saved: number | null
  readonly now: Date
  readonly staleAfterSec: number
}) {
  const config = data.config!
  const head = nowRow(status, now, staleAfterSec)
  const headColor = head.tone === 'neutral' ? 'var(--ink-muted)' : TONE_COLOR[head.tone]

  const applied = appliedAck(status, config.version)
  const ack = {
    tone: applied.tone,
    text: applied.reason ? `${applied.text}: ${applied.reason}` : applied.tone === 'good' && status ? `${applied.text}, ${formatClock(status.receivedAt)}` : applied.text,
  }

  return (
    <Card className="flex flex-wrap items-center gap-x-5 gap-y-3 p-4 sm:p-5">
      <span aria-hidden className="ai-node" style={{ opacity: head.tone === 'good' ? 1 : 0.55 }}>
        <span />
        <span />
        <span />
        <span />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-bold" style={{ color: head.tone === 'neutral' ? 'var(--ink-primary)' : inked(headColor) }}>
          {head.title.startsWith('AI ') ? `Dilnoza ${head.title.slice(3)}` : `Dilnoza · ${head.title}`}
        </p>
        {head.detail && (
          <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            {head.detail}
          </p>
        )}
      </div>
      <section aria-label="Saqlangan sozlama va AI javobi" className="flex flex-col items-start gap-1.5 text-[13px] sm:items-end" style={{ color: 'var(--ink-secondary)' }}>
        <span>
          Sozlama <strong style={{ color: 'var(--ink-primary)' }}>v{config.version}</strong> · {formatDateTime(config.updatedAt)} · {config.updatedBy}
        </span>
        <span aria-live="polite">
          <StatusChip tone={ack.tone}>{ack.text}</StatusChip>
        </span>
        {saved !== null && saved === config.version && ack.tone !== 'good' && (
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            v{saved} saqlandi — AI 20 soniya ichida oʻqiydi
          </span>
        )}
      </section>
    </Card>
  )
}

/** Stays at the bottom of the screen: what is unsaved, «Bekor qilish», «Saqlash». */
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
    <div
      role="region"
      aria-label="Saqlash"
      className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border px-4 py-3"
      style={{
        background: 'var(--surface-raised)',
        borderColor: dirty ? 'color-mix(in oklab, var(--status-warning) 45%, var(--border))' : 'var(--border)',
        boxShadow: '0 8px 28px rgb(0 0 0 / 0.18)',
      }}
    >
      <span className="mr-auto text-[13px] font-medium" style={{ color: problem || error ? 'var(--status-critical)' : dirty ? inked('var(--status-warning)') : 'var(--ink-muted)' }} role={error ? 'alert' : undefined}>
        {error ?? problem ?? (dirty ? 'Oʻzgarishlar saqlanmagan' : 'Oʻzgarish yoʻq')}
      </span>
      {dirty && (
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Bekor qilish
        </Button>
      )}
      <Button variant="primary" onClick={onSave} disabled={!dirty || pending || problem !== null}>
        {pending ? 'Saqlanmoqda…' : 'Saqlash'}
      </Button>
    </div>
  )
}

interface SellerRow {
  readonly ext: string
  readonly on: boolean
  readonly name: string
  readonly look: { readonly tone: Tone; readonly label: string } | null
  readonly since: string | null
  readonly product: Product | null
  readonly transfersToday: number | null
}

/** The design's 44×26 switch — `.ai-switch` in globals.css. */
function Switch({ on, label, onToggle }: { readonly on: boolean; readonly label: string; readonly onToggle: () => void }) {
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle} className="focusable ai-switch" />
      <span className="text-[13px]" style={{ color: on ? 'var(--ink-primary)' : 'var(--ink-muted)' }}>
        {on ? 'Ha' : 'Oʻchiq'}
      </span>
    </span>
  )
}

/** `status` is the agent's last report while it is fresh, else null — an old picture shows no state. */
function Sellers({
  data,
  status,
  draft,
  onChange,
  now,
}: {
  readonly data: AiControlDto
  readonly status: AiStatus | null
  readonly draft: Draft
  readonly onChange: (next: Partial<Draft>) => void
  readonly now: Date
}) {
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const reported = new Map((status?.report.sellers ?? data.status?.report.sellers ?? []).map((s) => [s.ext, s]))

  const row = (ext: string, on: boolean): SellerRow => {
    const r = reported.get(ext)
    return {
      ext,
      on,
      name: r?.name?.trim() || data.names[ext] || '—',
      look: status && r ? sellerLook(r) : null,
      since: status && r?.since ? r.since : null,
      product: productOf(r?.product),
      transfersToday: r ? r.transfersToday : null,
    }
  }
  const active = draft.sellers.map((ext) => row(ext, true))
  const parked = draft.parked.map((ext) => row(ext, false))

  const add = () => {
    const ext = input.trim()
    if (!EXTENSION.test(ext)) return setInputError('Ichki raqam 2–6 ta raqam boʻlsin.')
    if (data.rules.aiLines.includes(ext)) return setInputError(`${ext} — AI liniyasi, sotuvchi boʻla olmaydi.`)
    if (draft.sellers.includes(ext)) return setInputError(`${ext} allaqachon roʻyxatda.`)
    if (draft.parked.includes(ext)) return setInputError(`${ext} roʻyxatda bor, lekin oʻchiq — «Oʻchirib qoʻyilganlar»da yoqing.`)
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

  const line = (r: SellerRow) => (
    <tr key={r.ext} className="border-t" style={{ borderColor: 'var(--grid)', opacity: r.on ? 1 : 0.65 }}>
      <th scope="row" className="px-2 py-2.5 text-left text-[14px] font-extrabold tabular-nums" style={{ color: 'var(--ink-primary)' }}>
        {r.ext}
      </th>
      <td className="px-2 py-2.5 font-semibold" style={{ color: 'var(--ink-primary)' }}>
        {r.name}
      </td>
      <td className="px-2 py-2.5">
        {r.look ? (
          <span className="inline-flex items-center gap-1.5">
            <StatePill tone={r.look.tone}>{r.look.label}</StatePill>
            {r.since && <span className="text-[12px] tabular-nums" style={{ color: 'var(--ink-muted)' }}>{elapsedText(r.since, now)}</span>}
          </span>
        ) : (
          <span style={{ color: 'var(--ink-muted)' }}>—</span>
        )}
      </td>
      <td className="px-2 py-2.5">{r.product ? <ProductPill product={r.product} /> : <span style={{ color: 'var(--ink-muted)' }}>—</span>}</td>
      <td className="px-2 py-2.5 text-right font-bold tabular-nums">{r.transfersToday === null ? '—' : formatNumber(r.transfersToday)}</td>
      <td className="px-2 py-2.5">
        <Switch on={r.on} label={`${r.ext} — AI ulashi`} onToggle={() => toggle(r.ext, r.on)} />
      </td>
      <td className="px-2 py-2.5 text-right">
        <Button variant="ghost" size="sm" aria-label={`${r.ext} — butunlay olib tashlash`} onClick={() => remove(r.ext)}>
          Olib tashlash
        </Button>
      </td>
    </tr>
  )

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <label className="flex flex-col gap-1 text-[12.5px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          Yangi sotuvchi (ichki raqam)
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
            className="focusable w-44 rounded-[var(--radius-panel-sm)] border px-3 py-2 text-[14px] tabular-nums"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink-primary)' }}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={input === ''}>
          + Qoʻshish
        </Button>
        <span className="ml-auto text-[13px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          {draft.sellers.length} ta yoqiq · {draft.parked.length} ta oʻchiq
        </span>
        {inputError && (
          <p role="alert" className="w-full text-[12.5px]" style={{ color: 'var(--status-critical)' }}>
            {inputError}
          </p>
        )}
      </form>

      <div className="overflow-x-auto">
        <table aria-label="Sotuvchilar" className="w-full min-w-[760px] text-[13.5px] tabular-nums">
          <thead>
            <tr className="text-[11.5px] font-bold tracking-wide uppercase" style={{ color: 'var(--ink-secondary)' }}>
              <th className="px-2 py-2 text-left">Ichki raqam</th>
              <th className="px-2 py-2 text-left">Ism</th>
              <th className="px-2 py-2 text-left">Hozir</th>
              <th className="px-2 py-2 text-left">Mahsulot</th>
              <th className="px-2 py-2 text-right">Bugun ulandi</th>
              <th className="px-2 py-2 text-left">AI ulaydimi</th>
              <th className="px-2 py-2 text-right">
                <span className="sr-only">Amal</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {active.map(line)}
            {parked.length > 0 && (
              <tr>
                <th colSpan={7} scope="rowgroup" className="px-2 pt-4 pb-1 text-left text-[12px] font-bold tracking-wide uppercase" style={{ color: 'var(--ink-muted)' }}>
                  Oʻchirib qoʻyilganlar · {parked.length}
                </th>
              </tr>
            )}
            {parked.map(line)}
          </tbody>
        </table>
      </div>
      <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        AI liniyalari ({data.rules.aiLines.join(', ')}) sotuvchi sifatida qoʻshilmaydi.
      </p>
    </Card>
  )
}

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  color,
  onChange,
}: {
  readonly label: string
  readonly hint: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly color?: string
  readonly onChange: (value: number) => void
}) {
  return (
    <Card className="flex min-w-0 flex-1 basis-52 flex-col gap-2 p-4">
      <span className="flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--ink-primary)' }}>
        {color && <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />}
        {label}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" aria-label={`${label} — kamaytirish`} onClick={() => onChange(value - 1)} disabled={value <= min}>
          −
        </Button>
        <span className="w-12 text-center text-[30px] leading-none font-extrabold tabular-nums" aria-live="polite" style={{ color: 'var(--ink-primary)' }}>
          {value}
        </span>
        <Button variant="secondary" size="sm" aria-label={`${label} — oshirish`} onClick={() => onChange(value + 1)} disabled={value >= max}>
          +
        </Button>
      </div>
      <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        {hint}
      </span>
    </Card>
  )
}

const NEW_COLOR = 'var(--series-1)'
const RETRY_COLOR = 'var(--status-warning)'

/**
 * The slots the limits make, one box per call at a time: the new-lead share
 * first, then the retry share. The two shares are caps, not reservations —
 * together they may reach past the total, and then the AI splits by its queue.
 * When together they fall SHORT of it, the rest are grey and idle: the agent
 * never fills them, so 4 / 0 / 2 is «amalda 2 ta» (the owner, 2026-11-02).
 */
function Slots({ draft }: { readonly draft: Draft }) {
  const used = effectiveCalls(draft.maxCalls, draft.maxNew, draft.maxRetry)
  const fresh = Math.min(draft.maxNew, draft.maxCalls)
  const retry = Math.min(draft.maxRetry, draft.maxCalls - fresh)
  const slots = Array.from({ length: draft.maxCalls }, (_, i) => (i < fresh ? 'new' : i < fresh + retry ? 'retry' : 'idle'))
  const overlap = draft.maxNew + draft.maxRetry > draft.maxCalls
  const bothZero = limitsProblem(draft.maxNew, draft.maxRetry) !== null
  const split = `yangi lidlarga koʻpi bilan ${draft.maxNew} ta, nedozvonga koʻpi bilan ${draft.maxRetry} ta`
  const text = bothZero
    ? 'Yangi lid va nedozvon ikkalasi 0 — AI bu sozlamani rad etadi.'
    : used < draft.maxCalls
      ? `Amalda bir vaqtda ${used} ta qoʻngʻiroq (${draft.maxCalls} ta qoʻyilgan): ${split} — qolgan ${draft.maxCalls - used} ta oʻrin ishlatilmaydi.`
      : `Bir vaqtda ${draft.maxCalls} ta qoʻngʻiroq: ${split}` + (overlap ? ' — ikkalasi birga umumiydan koʻp, AI navbatga qarab boʻladi.' : '.')
  const tone = bothZero ? 'var(--status-critical)' : overlap || used < draft.maxCalls ? 'var(--status-warning)' : null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="img" aria-label={text} className="flex flex-wrap gap-1.5">
          {slots.map((k, i) => (
            <span
              key={i}
              data-slot={k}
              className={`h-7 w-10 rounded-[6px] border ${k === 'idle' ? 'border-dashed' : ''}`}
              style={{
                background: k === 'new' ? `color-mix(in oklab, ${NEW_COLOR} 35%, transparent)` : k === 'retry' ? `color-mix(in oklab, ${RETRY_COLOR} 35%, transparent)` : 'var(--surface-sunken)',
                borderColor: k === 'new' ? NEW_COLOR : k === 'retry' ? RETRY_COLOR : 'var(--border)',
                opacity: k === 'idle' ? 0.6 : 1,
              }}
            />
          ))}
        </div>
        <span className="text-[15px] font-bold tabular-nums" style={{ color: bothZero ? inked('var(--status-critical)') : 'var(--ink-primary)' }}>
          amalda {used} ta
        </span>
      </div>
      <p className="text-[13px]" style={{ color: tone ? inked(tone) : 'var(--ink-secondary)' }}>
        {text}
      </p>
    </div>
  )
}

/**
 * Did the agent take the saved limits: «AI qoʻlladi ✓» with what it now runs,
 * the refusal in red with the agent's own reason, or still waiting. About the
 * SAVED version — an unsaved draft is not the agent's yet.
 */
function LimitsAck({ status, version }: { readonly status: AiStatus | null; readonly version: number }) {
  const ack = appliedAck(status, version)
  const l = status?.report.limits
  const running = ack.tone === 'good' && l?.calls != null ? `Hozir AIda: bir vaqtda ${l.calls}, yangi ${l.maxNew ?? '—'}, nedozvon ${l.maxRetry ?? '—'}` : null
  return (
    <p aria-live="polite" className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
      <StatusChip tone={ack.tone}>{ack.text}</StatusChip>
      {ack.reason ? (
        <span role="alert" style={{ color: inked('var(--status-critical)') }}>
          Sabab: {ack.reason}
        </span>
      ) : (
        running && <span>{running}</span>
      )}
    </p>
  )
}

function Limits({
  data,
  draft,
  status,
  onChange,
}: {
  readonly data: AiControlDto
  readonly draft: Draft
  readonly status: AiStatus | null
  readonly onChange: (next: Partial<Draft>) => void
}) {
  // Neither share may reach 0 while the other is 0: together they would read as «stop» and mean «any lead».
  const newMin = draft.maxRetry === 0 ? 1 : 0
  const retryMin = draft.maxNew === 0 ? 1 : 0
  const bothZero = limitsProblem(draft.maxNew, draft.maxRetry)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Stepper label="Bir vaqtda" hint={`1 dan ${data.rules.maxCalls} gacha`} value={draft.maxCalls} min={1} max={data.rules.maxCalls} onChange={(v) => onChange({ maxCalls: v })} />
        <Stepper label="Shundan yangi lidlarga" hint={`${newMin} dan ${draft.maxCalls} gacha`} value={draft.maxNew} min={newMin} max={draft.maxCalls} color={NEW_COLOR} onChange={(v) => onChange({ maxNew: v })} />
        <Stepper label="Shundan nedozvonga" hint={`${retryMin} dan ${draft.maxCalls} gacha`} value={draft.maxRetry} min={retryMin} max={draft.maxCalls} color={RETRY_COLOR} onChange={(v) => onChange({ maxRetry: v })} />
      </div>
      {(bothZero || newMin === 1 || retryMin === 1) && (
        <p className="max-w-3xl text-[13px]" role={bothZero ? 'alert' : undefined} style={{ color: bothZero ? inked('var(--status-critical)') : 'var(--ink-muted)' }}>
          {bothZero ?? 'Yangi lid va nedozvon ikkalasi birga 0 boʻlmaydi — bu AIni toʻxtatmaydi, aksincha istalgan lidga teradi. Shuning uchun biri 0 boʻlsa, ikkinchisi kamida 1.'}
        </p>
      )}
      <Slots draft={draft} />
      {data.config && <LimitsAck status={status} version={data.config.version} />}
    </div>
  )
}

function Handoff({ draft, onChange }: { readonly draft: Draft; readonly onChange: (next: Partial<Draft>) => void }) {
  const refer = draft.saleHandoff === 'refer'
  return (
    <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 p-4 sm:p-5">
      <span className="inline-flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={refer}
          aria-label="Sotuvni ATSga topshirish"
          onClick={() => onChange({ saleHandoff: refer ? 'bridge' : 'refer' })}
          className="focusable ai-switch"
        />
        <span className="text-[15px] font-bold" style={{ color: 'var(--ink-primary)' }}>
          {refer ? 'Yoqiq (refer)' : 'Oʻchiq (bridge)'}
        </span>
      </span>
      <span className="min-w-0 flex-1 basis-80 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
        Hozir:{' '}
        {refer
          ? 'sotuvchi koʻtargach suhbat ATSning oʻzida ulanadi — ovoz AI serveri orqali oʻtmaydi, AI liniyasi boʻshaydi.'
          : 'mijoz va sotuvchi AI serveri orqali ulanib turadi (ikkala oyoq ham AIda) — liniya band qoladi.'}
      </span>
    </Card>
  )
}

function History({ data }: { readonly data: AiControlDto }) {
  return (
    <section aria-label="Oʻzgarishlar tarixi" className="flex flex-col gap-3">
      <h2 className="text-[18px] font-bold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
        Oʻzgarishlar tarixi
      </h2>
      <Card className="p-4 sm:p-5">
        {data.history.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Hali oʻzgarish yoʻq
          </p>
        ) : (
          <ul className="flex flex-col text-[13px]">
            {data.history.map((h, i) => (
              <li key={h.version} className={`flex flex-wrap gap-x-3 gap-y-0.5 py-2 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: 'var(--grid)' }}>
                <span className="font-extrabold tabular-nums" style={{ color: 'var(--ink-primary)' }}>
                  v{h.version}
                </span>
                <span className="tabular-nums" style={{ color: 'var(--ink-muted)' }}>
                  {formatDateTime(h.savedAt)} · {h.savedBy}
                </span>
                {h.lines.length > 0 && (
                  <span className="w-full" style={{ color: 'var(--ink-secondary)' }}>
                    {h.lines.join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  )
}
