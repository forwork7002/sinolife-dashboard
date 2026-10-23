'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/Controls'
import { MultiplyGlyph } from '@/components/ui/Icons'
import { bitrixDealUrl } from '@/features/target/targetApi'
import { ApiClientError, apiGet } from '@/lib/api'
import { formatCompactUzs, formatDateTime, formatNumber, formatUzs } from '@/lib/format'

/* Mirrors `AiCallsDto` / `AiCallRowDto` in `src/server/services/aiRegistratorService.ts` — nothing checks the mirror. */
type Verdict = 'sold' | 'ordered' | 'with_seller' | 'lost' | 'no_deal' | 'not_transferred' | 'not_synced'

interface CallRow {
  readonly callId: string
  readonly dealId: string
  readonly title: string | null
  readonly phone: string
  readonly at: string
  readonly answeredAt: string | null
  readonly durationSec: number
  readonly attempt: number | null
  readonly outcome: string
  readonly transferredTo: string | null
  readonly seller: string | null
  readonly attempts: readonly { readonly ext: string; readonly name: string | null; readonly result: string; readonly at: string | null }[]
  readonly notes: readonly { readonly key: string; readonly value: string }[]
  readonly lead: { readonly pipeline: string | null; readonly stage: string | null; readonly status: string } | null
  readonly verdict: Verdict | null
  readonly sales: readonly {
    readonly dealId: string
    readonly pipeline: string | null
    readonly stage: string | null
    readonly status: 'OPEN' | 'WON' | 'LOST'
    readonly amount: { readonly amount: number }
    readonly createdAt: string
  }[]
  readonly soldBy: string | null
}

interface CallsDto {
  readonly total: number
  readonly rows: readonly CallRow[]
}

/** Which number was opened — `selectCalls`' filter, as the route takes it. */
export interface AiDrill {
  readonly title: string
  readonly kind: 'all' | 'unique' | 'answered' | 'outcome' | 'ext' | 'seller' | 'ordered'
  readonly outcome?: string
  readonly ext?: string
  readonly seller?: string
}

/** The agent's outcomes in the words its own Bitrix24 comment uses (`deal_sync.py` OUTCOME_LABELS). */
export const OUTCOME_LABEL: Readonly<Record<string, string>> = {
  interested_transferred: 'Qiziqdi, sotuvchiga ulandi',
  transfer_failed: 'Qiziqdi, sotuvchi javob bermadi',
  interested_callback: 'Qiziqdi, qayta qoʻngʻiroq kelishildi',
  not_interested: 'Qiziqmadi',
  no_answer: 'Koʻtarmadi',
  busy: 'Band',
  unreachable: 'Aloqa yoʻq / oʻchiq',
  wrong_number: 'Notoʻgʻri raqam',
  voicemail: 'Avtojavobchi',
  hung_up_early: 'Gaplashmay qoʻydi',
  error: 'Texnik xato',
}

/** How each outcome is coloured: put through green, a failed hand-off red, a promise amber, the rest quiet. */
const OUTCOME_TONE: Readonly<Record<string, string>> = {
  interested_transferred: 'var(--status-good)',
  transfer_failed: 'var(--status-critical)',
  interested_callback: 'var(--status-warning)',
  error: 'var(--status-critical)',
}

const ATTEMPT: Readonly<Record<string, { readonly label: string; readonly color: string }>> = {
  answered: { label: 'javob berdi', color: 'var(--status-good)' },
  busy: { label: 'band', color: 'var(--status-warning)' },
  no_answer: { label: 'javob bermadi', color: 'var(--status-critical)' },
  failed: { label: 'xato', color: 'var(--status-critical)' },
}

const VERDICT: Readonly<Record<Verdict, { readonly label: string; readonly color?: string }>> = {
  sold: { label: 'Sotildi (yetkazildi)', color: 'var(--status-good)' },
  ordered: { label: 'Buyurtma bor', color: 'var(--status-good)' },
  with_seller: { label: 'Sotuvchida, buyurtma yoʻq', color: 'var(--status-warning)' },
  lost: { label: 'Yoʻqotildi', color: 'var(--status-critical)' },
  no_deal: { label: 'Bitim ochilmagan', color: 'var(--status-critical)' },
  not_transferred: { label: 'Ulanmadi — sotuvchi javob bermadi', color: 'var(--status-critical)' },
  not_synced: { label: 'Bitrix24dan hali oʻqilmagan' },
}

/** The agent's field names, in the floor's words; a field it adds tomorrow prints under its own name. */
const NOTE_LABEL: Readonly<Record<string, string>> = {
  for_whom: 'Kim uchun',
  problem: 'Muammo',
  region: 'Hudud',
  summary: 'Xulosa',
  name: 'Ismi',
  age: 'Yoshi',
  product: 'Mahsulot',
  interest: 'Qiziqish',
  reason: 'Sabab',
  callback_at: 'Qayta qoʻngʻiroq',
  callback_time: 'Qayta qoʻngʻiroq',
  language: 'Til',
  gender: 'Jinsi',
}

const PAGE = 100
const FOCUSABLE = 'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'

/**
 * The calls behind one number on «AI registrator» (the owner, 2026-10-23:
 * «AI qoʻngʻiroq degan joylarda ustiga bossa qaysi nomerlar … kim ulaganini,
 * kim nima qilgani koʻrilib turilishi kerak»): each call with its phone and
 * deal, what the agent did and how long, every extension it rang and whose
 * that is and how each ended, what the agent wrote down, where the lead is in
 * Bitrix24 now, and — for a lead the page follows — what came of it.
 *
 * Picked on the server by the rule that counted the number (`selectCalls`),
 * so the drawer's count is the tile's. A search narrows by phone or deal id;
 * the list grows a hundred at a time. The modal discipline is
 * `LeadWatchDrawer`'s: focus held inside, Escape and the scrim close it.
 */
export function AiCallsDrawer({
  drill,
  windowParams,
  windowText,
  onClose,
}: {
  drill: AiDrill
  windowParams: Readonly<Record<string, string | number>>
  /** The window in words, for the subtitle. */
  windowText: string
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)

  // A search waits for the typing to pause, and starts the list from its top.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search.trim())
      setLimit(PAGE)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const params = useMemo(() => {
    const out: Record<string, string | number> = { ...windowParams, kind: drill.kind, limit }
    if (drill.outcome) out.outcome = drill.outcome
    if (drill.ext) out.ext = drill.ext
    if (drill.seller) out.seller = drill.seller
    if (q) out.q = q
    return out
  }, [windowParams, drill, limit, q])

  const query = useQuery({
    queryKey: ['ai-registrator-calls', params],
    queryFn: ({ signal }) => apiGet<CallsDto>('/leads/ai-registrator/calls', params, signal),
    placeholderData: keepPreviousData,
  })
  const data = query.data?.data

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = before
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const stops = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (!first || !last) return
    const at = document.activeElement
    if (event.shiftKey && (at === first || at === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && at === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="backdrop-dim drawer-backdrop-enter fixed inset-0 z-50 flex justify-end"
      // mousedown, not click: a drag that starts inside and ends on the scrim must not close it.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="watch-drawer watch-drawer-enter flex h-dvh w-full flex-col outline-none sm:w-[860px] sm:max-w-[94vw]"
      >
        <header className="shrink-0 border-b px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-5 sm:pt-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 id={titleId} className="text-base font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
                  {drill.title}
                </h2>
                {data && (
                  <span
                    className="tabular inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold"
                    style={{ background: 'color-mix(in oklab, var(--accent) 14%, transparent)', color: 'var(--ink-primary)' }}
                  >
                    {formatNumber(data.total)} ta
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                {windowText} · har bir qoʻngʻiroq: raqam, AI nima qildi, kimga ulandi, keyin nima boʻldi
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Yopish"
              className="focusable -mt-1 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-panel-sm)] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--glass-hover)] hover:text-[var(--ink-primary)] sm:-mr-1.5 sm:h-9 sm:w-9"
            >
              <MultiplyGlyph size={16} />
            </button>
          </div>
          <div className="mt-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Telefon raqami yoki bitim ID…" />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
          {query.isError && !data ? (
            <ErrorState message={query.error instanceof ApiClientError ? query.error.message : undefined} onRetry={() => void query.refetch()} />
          ) : !data ? (
            <LoadingSkeleton rows={6} />
          ) : data.rows.length === 0 ? (
            <p className="px-2 py-12 text-center text-sm" style={{ color: 'var(--ink-secondary)' }}>
              {q ? `«${q}» boʻyicha qoʻngʻiroq topilmadi.` : 'Bu roʻyxat boʻsh.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5" aria-label={drill.title}>
              {data.rows.map((row) => (
                <CallCard key={row.callId} row={row} />
              ))}
            </ul>
          )}
          {data && data.total > data.rows.length && (
            <div className="pt-3">
              <Button variant="secondary" className="h-11 w-full sm:h-9" onClick={() => setLimit((n) => Math.min(500, n + PAGE))} disabled={limit >= 500}>
                {limit >= 500
                  ? `Birinchi 500 tasi koʻrsatildi — qidiruv bilan toraytiring (${formatNumber(data.total)} ta)`
                  : `Yana ${formatNumber(Math.min(PAGE, data.total - data.rows.length))} ta`}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** One call as a card: who was rung and when, what the agent did, whom it rang, and where the lead went. */
function CallCard({ row }: { row: CallRow }) {
  const tone = OUTCOME_TONE[row.outcome] ?? 'var(--ink-muted)'
  const verdict = row.verdict ? VERDICT[row.verdict] : null
  const muted = { color: 'var(--ink-muted)' }
  return (
    <li
      className="rounded-[var(--radius-panel-sm)] border p-3 text-xs"
      style={{ borderColor: 'var(--border)', background: `linear-gradient(90deg, color-mix(in oklab, ${tone} 7%, var(--surface-raised)), var(--surface-raised) 40%)` }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="tabular font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {formatDateTime(row.at)}
        </span>
        <span className="tabular text-[13px] font-bold tracking-wide select-all" style={{ color: 'var(--ink-primary)' }}>
          {phoneText(row.phone)}
        </span>
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: `color-mix(in oklab, ${tone} 16%, transparent)`, color: tone === 'var(--ink-muted)' ? 'var(--ink-secondary)' : tone }}
        >
          {OUTCOME_LABEL[row.outcome] ?? row.outcome}
        </span>
        <span className="tabular" style={muted}>
          {row.answeredAt ? `gaplashdi ${duration(row.durationSec)}` : 'koʻtarilmadi'}
          {row.attempt !== null ? ` · ${row.attempt}-urinish` : ''}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span style={muted}>Lid:</span>
        <a href={bitrixDealUrl(row.dealId)} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2" style={{ color: 'var(--ink-primary)' }}>
          {row.title ?? 'Bitim'} #{row.dealId}
        </a>
        {row.lead && (
          <span style={muted}>
            · hozir: {[row.lead.pipeline, row.lead.stage].filter(Boolean).join(' · ') || '—'}
          </span>
        )}
      </div>

      {row.attempts.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span style={muted}>Ulash:</span>
          {row.attempts.map((a, i) => {
            const step = ATTEMPT[a.result] ?? { label: a.result, color: 'var(--ink-muted)' }
            return (
              <span key={`${a.ext}-${i}`} className="inline-flex items-center gap-1.5">
                {i > 0 && <span style={muted}>→</span>}
                <span
                  className="inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-px"
                  style={{ borderColor: `color-mix(in oklab, ${step.color} 40%, var(--border))`, background: `color-mix(in oklab, ${step.color} 9%, transparent)` }}
                  title={a.at ? formatDateTime(a.at) : undefined}
                >
                  <span className="tabular font-semibold" style={{ color: 'var(--ink-primary)' }}>
                    {a.ext}
                  </span>
                  {a.name && <span style={{ color: 'var(--ink-secondary)' }}>{a.name}</span>}
                  <span className="font-semibold" style={{ color: step.color }}>
                    — {step.label}
                  </span>
                </span>
              </span>
            )
          })}
        </div>
      )}

      {row.notes.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-[var(--radius-panel-sm)] px-2 py-1.5" style={{ background: 'var(--surface-sunken)' }}>
          {row.notes.map((n) => (
            <div key={n.key} className="contents">
              <dt className="whitespace-nowrap" style={muted}>
                {NOTE_LABEL[n.key] ?? n.key}:
              </dt>
              <dd style={{ color: 'var(--ink-primary)' }}>
                {/^https?:\/\//.test(n.value) ? (
                  <a href={n.value} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    ochish
                  </a>
                ) : (
                  n.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {(verdict || row.sales.length > 0 || row.soldBy) && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {verdict && (
            <span className="font-semibold" style={{ color: verdict.color ?? 'var(--ink-secondary)' }}>
              Natija: {verdict.label}
            </span>
          )}
          {row.soldBy && <span style={{ color: 'var(--status-warning)' }}>Bitimni yozgan: {row.soldBy}</span>}
          {row.sales.map((s) => (
            <a key={s.dealId} href={bitrixDealUrl(s.dealId)} target="_blank" rel="noreferrer" className="underline underline-offset-2" style={{ color: 'var(--ink-secondary)' }}>
              {[s.pipeline, s.stage].filter(Boolean).join(' · ') || `#${s.dealId}`}
              {s.amount.amount > 0 ? <span title={formatUzs(s.amount.amount)}> · {formatCompactUzs(s.amount.amount)}</span> : null}
            </a>
          ))}
        </div>
      )}
    </li>
  )
}

/** «+998 90 470 01 43» for a twelve-digit Uzbek number; anything else as it came. */
export function phoneText(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('998')) return `+998 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`
  if (d.length === 9) return `+998 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7)}`
  return phone || '—'
}

/** «1:24» — a call's length in minutes and seconds. */
function duration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
