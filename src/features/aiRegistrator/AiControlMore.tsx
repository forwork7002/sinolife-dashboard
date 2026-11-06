'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { StatusChip } from '@/components/ui/Stat'
import { AiConfirmDialog } from '@/features/aiRegistrator/AiConfirmDialog'
import { ProductPill, StatePill, inked } from '@/features/aiRegistrator/AiNowPanel'
import {
  type Ack,
  type Press,
  clockChoice,
  lineControlRows,
  lineToggleProblem,
  linesAck,
  pauseBody,
  pauseChoices,
  pauseState,
  pressText,
  totalAttempts,
  tuningAck,
  tuningStart,
  tlsResetState,
} from '@/features/aiRegistrator/aiControlMoreLogic'
import { type LineForm, PRODUCT_LABEL, lineAddState, lineFormProblems, sealLinePassword, zextraNote } from '@/features/aiRegistrator/aiLineAddLogic'
import type { AiStatus } from '@/features/aiRegistrator/aiLiveLogic'
import {
  type AiTuning,
  LINE_PRODUCTS,
  LINE_TRANSPORTS,
  type LineProduct,
  type LineTransport,
  TRANSFER_ORDERS,
  TRANSFER_ORDER_LABEL,
  TUNING_NUMBERS,
  type TuningNumberKey,
  WHY_US_LABEL,
  WHY_US_MODES,
  secondsText,
  tuningDiff,
  tuningProblems,
} from '@/lib/aiControlRules'
import { WEEKDAYS, type WorkHours } from '@/lib/aiWorkHours'
import { apiWrite } from '@/lib/api'
import { formatDateTime } from '@/lib/format'

/**
 * «AI registrator → Boshqaruv», the rest of the panel (2026-11-04, T144, the
 * owner: «hamma narsani boshqara olsin. Hozirgi soatlarni to'xtatib qo'yish
 * funksiyalari, SIP bilan ishlash va boshqa ko'proq boshqaruv imkoniyatlarini
 * qo'sh»). Each control its own write, the next version with only its field
 * changed — never part of «Saqlash» — and each beside the agent's answer:
 * saved against applied (`aiControlMoreLogic.ts`). The agent refuses a whole
 * config over one bad field, so every rule is checked here before the button
 * is offered, with the server's own copy (`lib/aiControlRules.ts`).
 */

const CONTROL = '/leads/ai-registrator/control'
type Who = {
  readonly version: number
  readonly savedAt: string
  readonly savedBy: string
} | null

/** One write and a fresh read of the page after it. */
function useControlWrite<T>(body: (value: T) => Record<string, unknown>, onDone?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (value: T) => apiWrite<unknown>('POST', CONTROL, body(value)),
    onSuccess: () => {
      onDone?.()
      void queryClient.invalidateQueries({
        queryKey: ['ai-registrator-control'],
      })
    },
  })
}

const errorOf = (e: unknown) => (e instanceof Error ? e.message : null)

/** «AI qoʻlladi ✓» / «qoʻllanmoqda…» / «AI rad etdi» — with its reason in a title. */
function AckChip({ ack }: { readonly ack: Ack | null }) {
  if (!ack) return null
  return (
    <span aria-live="polite" title={ack.reason ?? undefined}>
      <StatusChip tone={ack.tone}>{ack.text}</StatusChip>
    </span>
  )
}

function AckReason({ ack }: { readonly ack: Ack | null }) {
  if (!ack || !ack.reason || ack.kind === 'applied') return null
  return (
    <p
      className="text-[13px]"
      style={{
        color: ack.tone === 'critical' ? inked('var(--status-critical)') : 'var(--ink-secondary)',
      }}
    >
      {ack.reason}
    </p>
  )
}

function Problem({ children }: { readonly children: ReactNode }) {
  return (
    <p role="alert" className="text-[13px]" style={{ color: 'var(--status-critical)' }}>
      {children}
    </p>
  )
}

/* ── «Vaqtincha toʻxtatish» ─────────────────────────────────────────────── */

/**
 * The timed pause, under «Toʻxtatish» (T144): 15 daq · 30 daq · 1 soat ·
 * 2 soat · Bugungacha (to the next working day's start) · «… gacha» a clock
 * time today or tomorrow. While one runs: how long is left and «Davom
 * ettirish». Its own write, `{ baseVersion, pauseUntil }`; the AI picks up
 * by itself when the time is up — unlike «Toʻxtatish», which waits for «Yoqish».
 */
export function PauseControls({
  config,
  hours,
  status,
  now,
  staleAfterSec,
  pauseSet,
}: {
  readonly config: {
    readonly version: number
    readonly pauseUntil: string | null
  }
  readonly hours: WorkHours
  readonly status: AiStatus | null
  readonly now: Date
  readonly staleAfterSec: number
  readonly pauseSet: Who
}) {
  const [clock, setClock] = useState<string | null>(null)
  const write = useControlWrite<string | null>(
    (until) => ({ baseVersion: config.version, pauseUntil: pauseBody(until) }),
    () => setClock(null),
  )
  const state = pauseState(config, status, now, staleAfterSec)
  const error = errorOf(write.error)
  const choices = pauseChoices(now, hours)
  const custom = clock ? clockChoice(clock, now) : null
  const who = pauseSet ? `${pauseSet.savedBy} · ${formatDateTime(pauseSet.savedAt)}` : null
  const go = (until: string | null) => {
    write.reset()
    write.mutate(until)
  }

  return (
    <div role="group" aria-label="Vaqtincha toʻxtatish" className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--grid)' }}>
      <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--ink-primary)' }}>
        Vaqtincha toʻxtatish
        {state.title && <StatusChip tone="warning">{state.title}</StatusChip>}
        <AckChip ack={state.ack} />
      </p>
      {state.until ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="mr-auto text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            Yangi lidlarga qoʻngʻiroq qilmaydi, hozirgi suhbatlar tugaydi. Vaqti tugagach AI oʻzi davom etadi.
          </span>
          <Button variant="primary" disabled={write.isPending} onClick={() => go(null)}>
            {write.isPending ? 'Saqlanmoqda…' : 'Davom ettirish'}
          </Button>
        </div>
      ) : (
        <>
          <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            Qisqa tanaffus uchun — vaqti tugagach AI oʻzi davom etadi («Toʻxtatish» esa «Yoqish»gacha turadi). Pauza 7 kundan uzoq boʻlmaydi.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            {choices.map((c) => (
              <Button key={c.key} variant="secondary" size="sm" disabled={write.isPending} onClick={() => go(c.until)}>
                {c.label}
              </Button>
            ))}
            <span className="inline-flex items-center gap-1">
              <Select
                aria-label="Pauza qaysi soatgacha"
                value={clock ?? ''}
                disabled={write.isPending}
                onChange={(e) => {
                  write.reset()
                  setClock(e.target.value || null)
                }}
              >
                <option value="">… gacha</option>
                {HALF_HOURS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              {custom && (
                <Button variant="secondary" size="sm" disabled={write.isPending} onClick={() => go(custom.until)}>
                  {`${custom.label} gacha`}
                </Button>
              )}
            </span>
          </div>
        </>
      )}
      <AckReason ack={state.ack} />
      {who && (
        <p className="text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
          Pauza: {who}
        </p>
      )}
      {error && <Problem>{error}</Problem>}
    </div>
  )
}

const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`)

/* ── Ish kunlari ────────────────────────────────────────────────────────── */

/** Du Se Ch Pa Ju Sh Ya — each a toggle; none pressed is refused by the rule beside it. */
export function DaysPicker({ days, onChange }: { readonly days: readonly number[]; readonly onChange: (days: number[]) => void }) {
  return (
    <div role="group" aria-label="Ish kunlari" className="flex flex-col gap-1">
      <span className="text-[12.5px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        Ish kunlari
      </span>
      <span className="inline-flex flex-wrap gap-1">
        {WEEKDAYS.map((d) => {
          const on = days.includes(d.n)
          return (
            <Button
              key={d.n}
              variant={on ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={on}
              aria-label={d.long}
              onClick={() => onChange(on ? days.filter((x) => x !== d.n) : [...days, d.n].sort((a, b) => a - b))}
            >
              {d.short}
            </Button>
          )
        })}
      </span>
    </div>
  )
}

/* ── AI liniyalari (SIP) ────────────────────────────────────────────────── */

/**
 * Each AI line the agent reports (T144, `aiLines`): product, UDP/TLS, its ATS
 * registration, what it does now, the panel's switch (`linesOff`) and «Qayta
 * ulash» — offered only for a line that is not registered. «TLSʼni yangilash»
 * when every TLS line is down. Presses are rows the agent does once; its
 * answer stands beside each button. Adding a line (a SIP with a password) is
 * not done here (T123).
 */
export function AiLinesControl({
  config,
  status,
  presses,
  now,
  staleAfterSec,
  canManageLines = false,
}: {
  readonly config: {
    readonly version: number
    readonly linesOff: readonly string[]
    /** The sellers and the parked — never a new AI line (T123). */
    readonly sellers?: readonly string[]
  }
  readonly status: AiStatus | null
  readonly presses: readonly Press[]
  readonly now: Date
  readonly staleAfterSec: number
  /** «AI liniya qoʻshish» / «Olib tashlash» (T123) — the administrator only. */
  readonly canManageLines?: boolean
}) {
  const lines = status?.report.aiLines
  const [asking, setAsking] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const remove = useControlWrite<string>(
    (line) => ({ action: { kind: 'remove_line', line } }),
    () => setRemoving(null),
  )
  const toggle = useControlWrite<string[]>((linesOff) => ({
    baseVersion: config.version,
    linesOff,
  }))
  const press = useControlWrite<{ kind: 'reregister'; line: string } | { kind: 'tls_reset' }>(
    (action) => ({ action }),
    () => setAsking(false),
  )
  const [toggleProblem, setToggleProblem] = useState<string | null>(null)

  if (!lines || lines.length === 0) {
    return (
      <Card className="p-4 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        AI serveri liniyalar roʻyxatini hali yubormayapti — liniyani yoqish/oʻchirish va qayta ulash u yangilangach shu yerda chiqadi.
      </Card>
    )
  }

  const fresh = status !== null && now.getTime() - new Date(status.receivedAt).getTime() <= staleAfterSec * 1000
  const rows = lineControlRows(lines, config.linesOff, presses, now)
  const tls = tlsResetState(lines, presses, now)
  const ack = config.linesOff.length > 0 || lines.some((l) => !l.enabled) ? linesAck(config, status, now, staleAfterSec) : null
  const busy = toggle.isPending || press.isPending || remove.isPending

  const flip = (ext: string) => {
    toggle.reset()
    const problem = lineToggleProblem(lines, config.linesOff, ext)
    setToggleProblem(problem)
    if (problem) return
    toggle.mutate(config.linesOff.includes(ext) ? config.linesOff.filter((l) => l !== ext) : [...config.linesOff, ext])
  }

  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
        <span className="mr-auto">Liniyani oʻchirsangiz, AI undan qoʻngʻiroq qilmaydi (hozirgi suhbat tugaydi). Kamida bitta Collagen liniyasi yoqiq qoladi.</span>
        <AckChip ack={ack} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="text-left text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              <th className="py-1.5 pr-3 font-semibold">Liniya</th>
              <th className="py-1.5 pr-3 font-semibold">Mahsulot</th>
              <th className="py-1.5 pr-3 font-semibold">Ulanish</th>
              <th className="py-1.5 pr-3 font-semibold">ATS holati</th>
              <th className="py-1.5 pr-3 font-semibold">Hozir</th>
              <th className="py-1.5 pr-3 font-semibold">Yoqiq</th>
              <th className="py-1.5 font-semibold">Amal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const answer = r.press ? pressText(r.press, now) : null
              return (
                <tr key={r.ext} className="border-t align-middle" style={{ borderColor: 'var(--grid)' }}>
                  <td className="py-2 pr-3" style={{ color: 'var(--ink-primary)' }}>
                    <div className="flex flex-col items-start gap-1">
                      <span className="font-extrabold tabular-nums">{r.ext}</span>
                      {r.stage && <StatePill tone={r.stage.tone}>{r.stage.label}</StatePill>}
                      {r.note && (
                        <span className="max-w-56 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                          {r.note}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <ProductPill product={r.product} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                    {r.transport}
                  </td>
                  <td className="py-2 pr-3">
                    {fresh ? <StatePill tone={r.registration.tone}>{r.registration.label}</StatePill> : <span style={{ color: 'var(--ink-muted)' }}>—</span>}
                  </td>
                  <td className="py-2 pr-3">{fresh ? <StatePill tone={r.now.tone}>{r.now.label}</StatePill> : <span style={{ color: 'var(--ink-muted)' }}>—</span>}</td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.on}
                        aria-label={`${r.ext} liniyasi yoqiq`}
                        disabled={busy}
                        onClick={() => flip(r.ext)}
                        className="focusable ai-switch"
                      />
                      <span
                        className="text-[12px]"
                        style={{
                          color: r.on ? 'var(--ink-primary)' : 'var(--ink-muted)',
                        }}
                      >
                        {r.on ? 'Ha' : 'Oʻchiq'}
                        {fresh && r.on !== r.appliedOn ? ' · qoʻllanmoqda…' : ''}
                      </span>
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-col items-start gap-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`${r.ext} liniyasini qayta ulash`}
                        disabled={!fresh || !r.canReregister || busy}
                        onClick={() => {
                          press.reset()
                          press.mutate({ kind: 'reregister', line: r.ext })
                        }}
                      >
                        Qayta ulash
                      </Button>
                      {canManageLines && r.removable && (
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label={`${r.ext} liniyasini olib tashlash`}
                          disabled={!fresh || busy}
                          onClick={() => {
                            remove.reset()
                            setRemoving(r.ext)
                          }}
                        >
                          Olib tashlash
                        </Button>
                      )}
                      {r.removePress && (
                        <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                          Olib tashlash: {pressText(r.removePress, now).text}
                        </span>
                      )}
                      {answer && (
                        <span
                          className="text-[12px]"
                          style={{
                            color: answer.tone === 'critical' ? inked('var(--status-critical)') : answer.tone === 'good' ? inked('var(--status-good)') : 'var(--ink-muted)',
                          }}
                        >
                          {answer.text}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {tls.shown && (
        <div className="flex flex-wrap items-center gap-3 border-t pt-3" style={{ borderColor: 'var(--grid)' }}>
          <div className="mr-auto flex min-w-0 basis-72 flex-col gap-0.5">
            <span className="text-[13px] font-bold" style={{ color: 'var(--ink-primary)' }}>
              TLS ulanishi
            </span>
            <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              {fresh ? tls.why : 'AIdan yangi xabar yoʻq — TLS holatini bilib boʻlmaydi.'}
            </span>
            {tls.press && (
              <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                Oxirgi soʻrov: {pressText(tls.press, now).text}
              </span>
            )}
          </div>
          <Button
            variant="danger"
            disabled={!fresh || !tls.enabled || busy}
            onClick={() => {
              press.reset()
              setAsking(true)
            }}
          >
            TLSʼni yangilash
          </Button>
        </div>
      )}
      {canManageLines ? (
        <LineAddForm status={status} fresh={fresh} presses={presses} now={now} sellers={config.sellers ?? []} />
      ) : (
        <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          Yangi AI liniyani administrator (egasi) qoʻshadi.
        </p>
      )}
      {removing && (
        <AiConfirmDialog
          title={`${removing} liniyasini olib tashlash`}
          question={`${removing} AI liniyalaridan olib tashlanadi va paroli AI serveridan oʻchiriladi. Liniyada qoʻngʻiroq boʻlsa — u tugagach. Olib tashlansinmi?`}
          confirmLabel="Ha, olib tashlash"
          pendingLabel="Yuborilmoqda…"
          pending={remove.isPending}
          error={errorOf(remove.error)}
          note={null}
          onConfirm={() => remove.mutate(removing)}
          onCancel={() => {
            setRemoving(null)
            remove.reset()
          }}
        />
      )}
      {(toggleProblem || errorOf(toggle.error)) && <Problem>{toggleProblem ?? errorOf(toggle.error)}</Problem>}
      {errorOf(press.error) && !asking && <Problem>{errorOf(press.error)}</Problem>}
      {asking && (
        <AiConfirmDialog
          title="TLS ulanishini yangilash"
          question="AI TLS ulanishini yopib, qayta ochadi va TLS liniyalarini ATSda qayta roʻyxatdan oʻtkazadi. Bu vaqtda TLS liniyalaridan qoʻngʻiroq boʻlmaydi. Yangilansinmi?"
          confirmLabel="Ha, yangilash"
          pendingLabel="Yuborilmoqda…"
          pending={press.isPending}
          error={errorOf(press.error)}
          note={null}
          onConfirm={() => press.mutate({ kind: 'tls_reset' })}
          onCancel={() => {
            setAsking(false)
            press.reset()
          }}
        />
      )}
    </Card>
  )
}

/* ── «AI liniya qoʻshish» (T123) ───────────────────────────────────────── */

const FIELD = 'focusable rounded-[var(--radius-panel-sm)] border px-3 py-2 text-[14px]'
const FIELD_STYLE = { background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink-primary)' } as const

/**
 * The owner's form (T123): number, password, product, transport. The password
 * is sealed here with the AI server's key and only the sealed text is sent;
 * the field is emptied the moment it is — sent or not. One line at a time, and
 * a refusal is not retried: the shared ATS bans an IP over failed logins.
 */
function LineAddForm({
  status,
  fresh,
  presses,
  now,
  sellers,
}: {
  readonly status: AiStatus | null
  readonly fresh: boolean
  readonly presses: readonly Press[]
  readonly now: Date
  readonly sellers: readonly string[]
}) {
  const [line, setLine] = useState('')
  const [password, setPassword] = useState('')
  const [product, setProduct] = useState<LineProduct>('Kollagen')
  const [transport, setTransport] = useState<LineTransport>('udp')
  const [problems, setProblems] = useState<string[]>([])
  const [confirming, setConfirming] = useState<LineForm | null>(null)
  const [sealing, setSealing] = useState(false)
  const report = status?.report ?? null
  const state = lineAddState(report, fresh, presses, now)
  const add = useControlWrite<{ line: string; product: LineProduct; transport: LineTransport; secret: string }>(
    (value) => ({ action: { kind: 'add_line', ...value } }),
    () => {
      setConfirming(null)
      setLine('')
    },
  )
  const last = presses.find((p) => p.kind === 'add_line') ?? null
  const lastAnswer = last ? pressText(last, now) : null
  const zextra = product === 'Zekstra' ? zextraNote(report) : null

  const check = () => {
    add.reset()
    const form = { line: line.trim(), password, product, transport }
    const found = lineFormProblems(form, report?.aiLines ?? [], sellers)
    setProblems(found)
    if (found.length === 0) setConfirming(form)
  }

  const send = async (form: LineForm) => {
    if (!state.key) return
    setSealing(true)
    try {
      const secret = await sealLinePassword(state.key, form.line, form.password)
      // the dialog closes either way — it holds the typed password; a refusal shows under the form
      add.mutate({ line: form.line, product: form.product, transport: form.transport, secret }, { onSettled: () => setConfirming(null) })
    } catch {
      setProblems(['Parolni shifrlab boʻlmadi — sahifani yangilab, qayta urinib koʻring.'])
      setConfirming(null)
    } finally {
      // the password never outlives the press, sent or not
      setPassword('')
      setSealing(false)
    }
  }

  return (
    <section aria-label="AI liniya qoʻshish" className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: 'var(--grid)' }}>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-bold" style={{ color: 'var(--ink-primary)' }}>
          AI liniya qoʻshish
        </span>
        <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          MicroSIP ichki raqami va paroli. Parol shu brauzerda shifrlanadi va faqat AI serveriga yetadi — ISHda saqlanmaydi. AI ATSga bir marta ulanadi: parol notoʻgʻri boʻlsa, qayta urinmaydi.
        </span>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          check()
        }}
      >
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          Ichki raqam
          <input
            value={line}
            inputMode="numeric"
            maxLength={6}
            placeholder="masalan 298"
            autoComplete="off"
            disabled={!state.allowed}
            onChange={(e) => {
              setLine(e.target.value.replace(/\D/g, ''))
              setProblems([])
            }}
            className={`${FIELD} w-32 tabular-nums`}
            style={FIELD_STYLE}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          Parol
          <input
            type="password"
            value={password}
            maxLength={64}
            autoComplete="new-password"
            spellCheck={false}
            disabled={!state.allowed}
            onChange={(e) => {
              setPassword(e.target.value)
              setProblems([])
            }}
            className={`${FIELD} w-48`}
            style={FIELD_STYLE}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          Mahsulot
          <Select aria-label="Mahsulot" value={product} disabled={!state.allowed} onChange={(e) => setProduct(e.target.value as LineProduct)}>
            {LINE_PRODUCTS.map((p) => (
              <option key={p} value={p}>
                {PRODUCT_LABEL[p]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          Ulanish
          <Select aria-label="Ulanish" value={transport} disabled={!state.allowed} onChange={(e) => setTransport(e.target.value as LineTransport)}>
            {LINE_TRANSPORTS.map((t) => (
              <option key={t} value={t}>
                {t.toUpperCase()}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="secondary" disabled={!state.allowed || line === '' || password === '' || add.isPending || sealing}>
          + Qoʻshish
        </Button>
      </form>
      {state.why && (
        <p className="text-[13px]" style={{ color: inked('var(--status-warning)') }}>
          {state.why}
        </p>
      )}
      {zextra && (
        <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          {zextra}
        </p>
      )}
      {lastAnswer && last && (
        <p
          className="text-[13px]"
          aria-live="polite"
          style={{
            color: lastAnswer.tone === 'critical' ? inked('var(--status-critical)') : lastAnswer.tone === 'good' ? inked('var(--status-good)') : 'var(--ink-secondary)',
          }}
        >
          Oxirgi qoʻshish ({last.line}): {lastAnswer.text}
        </p>
      )}
      {problems.length > 0 && <Problem>{problems.join(' ')}</Problem>}
      {errorOf(add.error) && !confirming && <Problem>{errorOf(add.error)}</Problem>}
      {confirming && (
        <AiConfirmDialog
          title={`${confirming.line} liniyasini qoʻshish`}
          question={`${confirming.line} (${PRODUCT_LABEL[confirming.product]}, ${confirming.transport.toUpperCase()}) AI liniyasi boʻladi. AI ATSga bir marta ulanadi — parol notoʻgʻri boʻlsa, liniya rad etiladi, qayta urinilmaydi va 15 daqiqa yangi liniya qoʻshilmaydi. Qoʻshilsinmi?`}
          confirmLabel="Ha, qoʻshish"
          pendingLabel="Yuborilmoqda…"
          pending={add.isPending || sealing}
          error={errorOf(add.error)}
          note={null}
          onConfirm={() => void send(confirming)}
          onCancel={() => {
            setConfirming(null)
            add.reset()
          }}
        />
      )}
    </section>
  )
}

/* ── «Qoʻshimcha sozlamalar» ───────────────────────────────────────────── */

/** A step's numbers — minutes shown for the long ones, saved in seconds. */
const TUNING_STEP: Readonly<Record<TuningNumberKey, { readonly step: number; readonly unit: string; readonly hint: string }>> = {
  attemptsPerDay: {
    step: 1,
    unit: 'marta',
    hint: 'Koʻtarmagan mijozga kuniga necha marta qayta qoʻngʻiroq',
  },
  retryDays: {
    step: 1,
    unit: 'kun',
    hint: 'Necha kun davomida qayta qoʻngʻiroq qilinadi',
  },
  ringSec: {
    step: 5,
    unit: 's',
    hint: 'Sotuvchi telefoni necha soniya jiringlaydi, keyin keyingisi',
  },
  missedSec: {
    step: 60,
    unit: '',
    hint: 'Koʻtarmagan yoki rad etgan sotuvchi shuncha vaqt navbat oxirida turadi',
  },
  firstCallDelaySec: {
    step: 30,
    unit: '',
    hint: 'Bitrix24da yangi lid tushgandan birinchi qoʻngʻiroqqacha',
  },
}

function TuningNumber({
  k,
  value,
  runs,
  onChange,
}: {
  readonly k: TuningNumberKey
  readonly value: number
  readonly runs: number | undefined
  readonly onChange: (v: number) => void
}) {
  const { label, min, max } = TUNING_NUMBERS[k]
  const { step, unit, hint } = TUNING_STEP[k]
  const shown = unit === '' ? secondsText(value) : `${value} ${unit}`
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  return (
    <Card className="flex min-w-0 flex-1 basis-56 flex-col gap-2 p-4">
      <span className="text-[13px] font-bold" style={{ color: 'var(--ink-primary)' }}>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" aria-label={`${label} — kamaytirish`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
          −
        </Button>
        <span className="min-w-20 text-center text-[22px] leading-none font-extrabold tabular-nums" aria-live="polite" style={{ color: 'var(--ink-primary)' }}>
          {shown}
        </span>
        <Button variant="secondary" size="sm" aria-label={`${label} — oshirish`} onClick={() => onChange(clamp(value + step))} disabled={value >= max}>
          +
        </Button>
      </div>
      <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        {hint} ({unit === '' ? `${secondsText(min)}–${secondsText(max)}` : `${min}–${max}`})
        {runs !== undefined && runs !== value ? ` · AIda hozir: ${unit === '' ? secondsText(runs) : `${runs} ${unit}`}` : ''}
      </span>
    </Card>
  )
}

/**
 * «Qoʻshimcha sozlamalar» (T144): the call tuning the agent ran from its own
 * .env — again-calls, the seller ring, the queue, the first call's delay,
 * the put-through order and the «two reasons». All seven saved together,
 * `{ baseVersion, tuning }`; the agent applies the ones that changed. Nothing
 * saved: the form starts from what the agent says it runs.
 */
export function TuningStep({
  config,
  status,
  now,
  staleAfterSec,
  tuningSet,
}: {
  readonly config: {
    readonly version: number
    readonly tuning: AiTuning | null
  }
  readonly status: AiStatus | null
  readonly now: Date
  readonly staleAfterSec: number
  readonly tuningSet: Who
}) {
  const base = tuningStart(config.tuning, status?.report)
  const [form, setForm] = useState<AiTuning | null>(null)
  const editing = form ?? base
  const write = useControlWrite<AiTuning>(
    (tuning) => ({ baseVersion: config.version, tuning }),
    () => setForm(null),
  )
  const problems = tuningProblems(editing)
  const dirty = form !== null && tuningDiff(form, base).length > 0
  const canSave = (dirty || config.tuning === null) && problems.length === 0 && !write.isPending
  const ack = tuningAck(config, status, now, staleAfterSec)
  const runs = status?.report.tuning ?? null
  const error = errorOf(write.error)
  const change = (next: Partial<AiTuning>) => {
    setForm({ ...editing, ...next })
    write.reset()
  }
  const who = tuningSet ? `Oʻzgartirdi: ${tuningSet.savedBy} · ${formatDateTime(tuningSet.savedAt)}` : null

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          {config.tuning === null ? 'Hali saqlanmagan — AI serverining oʻz qiymatlari ishlayapti (formada shular).' : 'Saqlangan qiymatlar AIga 20 soniya ichida oʻtadi.'}
        </span>
        <AckChip ack={ack} />
      </div>
      <div className="flex flex-wrap gap-3">
        <TuningNumber k="attemptsPerDay" value={editing.attemptsPerDay} runs={runs?.attemptsPerDay} onChange={(v) => change({ attemptsPerDay: v })} />
        <TuningNumber k="retryDays" value={editing.retryDays} runs={runs?.retryDays} onChange={(v) => change({ retryDays: v })} />
        <Card className="flex min-w-0 flex-1 basis-56 flex-col justify-center gap-1 p-4">
          <span className="text-[13px] font-bold" style={{ color: 'var(--ink-primary)' }}>
            Nedozvon jami
          </span>
          <span className="text-[22px] leading-none font-extrabold tabular-nums" style={{ color: inked('var(--series-1)') }}>
            jami {totalAttempts(editing)} marta
          </span>
          <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {editing.attemptsPerDay} marta × {editing.retryDays} kun
            {runs?.maxAttempts !== undefined ? ` · AIda hozir: ${runs.maxAttempts} marta` : ''}
          </span>
        </Card>
      </div>
      <div className="flex flex-wrap gap-3">
        <TuningNumber k="ringSec" value={editing.ringSec} runs={runs?.ringSec} onChange={(v) => change({ ringSec: v })} />
        <TuningNumber k="missedSec" value={editing.missedSec} runs={runs?.missedSec} onChange={(v) => change({ missedSec: v })} />
        <TuningNumber k="firstCallDelaySec" value={editing.firstCallDelaySec} runs={runs?.firstCallDelaySec} onChange={(v) => change({ firstCallDelaySec: v })} />
      </div>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
            Ulash tartibi
          </span>
          <Select
            height="touch"
            aria-label="Ulash tartibi"
            value={editing.transferOrder}
            onChange={(e) =>
              change({
                transferOrder: e.target.value as AiTuning['transferOrder'],
              })
            }
          >
            {TRANSFER_ORDERS.map((o) => (
              <option key={o} value={o}>
                {TRANSFER_ORDER_LABEL[o]}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex min-w-0 basis-80 flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
              Ikki sabab (WHY_US) — ulashdan oldin
            </span>
            <Select height="touch" aria-label="Ikki sabab (WHY_US)" value={editing.whyUs} onChange={(e) => change({ whyUs: e.target.value as AiTuning['whyUs'] })}>
              {WHY_US_MODES.map((m) => (
                <option key={m} value={m}>
                  {WHY_US_LABEL[m]}
                </option>
              ))}
            </Select>
          </label>
          <p className="text-[12px]" style={{ color: inked('var(--status-warning)') }}>
            «Oʻrta Osiyoda eng yuqori» va «dietologlar tavsiya qiladi» mahsulot faktlarida tasdiqlanmagan; «Hammaga» — egasining qarori.
          </p>
        </div>
      </div>
      <AckReason ack={ack} />
      {who && (
        <p className="text-xs tabular-nums" style={{ color: 'var(--ink-muted)' }}>
          {who}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="mr-auto text-[13px] font-medium"
          role={problems.length > 0 || error ? 'alert' : undefined}
          style={{
            color: problems.length > 0 || error ? 'var(--status-critical)' : dirty ? inked('var(--status-warning)') : 'var(--ink-muted)',
          }}
        >
          {error ?? (problems.length > 0 ? problems.join(' ') : dirty ? 'Qoʻshimcha sozlamalar saqlanmagan' : config.tuning === null ? 'Hali saqlanmagan' : 'Oʻzgarish yoʻq')}
        </span>
        {dirty && (
          <Button
            variant="ghost"
            disabled={write.isPending}
            onClick={() => {
              setForm(null)
              write.reset()
            }}
          >
            Bekor qilish
          </Button>
        )}
        <Button variant="primary" disabled={!canSave} onClick={() => write.mutate(editing)}>
          {write.isPending ? 'Saqlanmoqda…' : 'Qoʻshimcha sozlamalarni saqlash'}
        </Button>
      </div>
    </Card>
  )
}
