'use client'

import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'

import { Card } from '@/components/ui/Card'
import { ArrowUpRightGlyph } from '@/components/ui/Icons'
import {
  type AiReport,
  type AiStatus,
  type LineRow,
  type Product,
  type Tone,
  elapsedText,
  feedNoAnswer,
  feedRows,
  flagReasons,
  isFresh,
  laneOf,
  learnProducts,
  limitShort,
  limitsMismatch,
  lineCount,
  lineRows,
  liveHeadline,
  nowRow,
  recentRows,
  sellerChips,
} from '@/features/aiRegistrator/aiLiveLogic'
import { bitrixDealUrl } from '@/features/target/targetApi'
import { PRODUCT_TONE } from '@/features/target/targetTheme'
import type { WorkHours } from '@/lib/aiWorkHours'
import { formatClock, formatNumber } from '@/lib/format'

/**
 * «AI registrator → Hozir · jonli» (2026-11-02, the owner's design canvas,
 * «AI registrator — jonli monitoring variantlari» → «Hisobot»: «koʻrinishi
 * menga yoqdi … funksiyalarini hammasini ishlaydigan qilib ber»). It heads the
 * report: one lane per AI line — the client, the AI, the seller it reaches,
 * the wires between them painted by what the line does (`laneOf`,
 * `.ai-lane` in globals.css) — the sellers as one row of chips, the last
 * put-throughs. Everything is the agent's own last report; nothing simulated,
 * and a part the agent does not send is not drawn.
 *
 * RED IS A PROBLEM, NOTHING ELSE (the owner, 31.10): a line the ATS does not
 * know, an AI silent within the day.
 */

export const TONE_COLOR: Readonly<Record<Tone, string>> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  neutral: 'var(--ink-secondary)',
  active: 'var(--series-7)',
  caution: 'var(--series-2)',
}

/** A colour lifted towards the ink, so a coloured word on a tinted ground keeps its contrast in both themes. */
export const inked = (color: string) => `color-mix(in oklab, ${color} 78%, var(--ink-primary))`

function Pill({ color, children }: { readonly color: string; readonly children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase"
      style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color: inked(color) }}
    >
      {children}
    </span>
  )
}

/** Collagen and Zextra in their own colours — the same two the whole dashboard paints them in (`targetTheme.ts`). */
export function ProductPill({ product }: { readonly product: Product }) {
  return <Pill color={PRODUCT_TONE[product]}>{product}</Pill>
}

/** A state word in its colour. */
export function StatePill({ tone, dot = true, children }: { readonly tone: Tone; readonly dot?: boolean; readonly children: ReactNode }) {
  const color = TONE_COLOR[tone]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[13px] font-medium whitespace-nowrap"
      style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color: tone === 'neutral' ? 'var(--ink-secondary)' : inked(color) }}
    >
      {dot && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </span>
  )
}

/** «#123 ↗» — the deal's own page in Bitrix24. */
export function DealLink({ deal }: { readonly deal: number | string }) {
  return (
    <a
      href={bitrixDealUrl(String(deal))}
      target="_blank"
      rel="noreferrer"
      aria-label={`Sdelka ${deal} — Bitrix24`}
      className="focusable inline-flex items-center gap-0.5 font-medium underline decoration-1 underline-offset-2"
      style={{ color: 'var(--accent-ink)' }}
    >
      #{deal}
      <ArrowUpRightGlyph size={12} />
    </a>
  )
}

/* ── Which product each line serves, remembered ─────────────────────────── */

/*
  Zextra's lines are the agent's own setting and never sent; a line's product
  shows only while it carries a call. Remembered here — one store for the page,
  kept in this browser — so an idle Zextra line keeps its tag between calls.
  Browser storage is a convenience: when it is not there the lanes still stand.
*/
const STORE_KEY = 'ai-control:line-products'
const NO_PRODUCTS: ReadonlyMap<string, Product> = new Map()
let productMemory: ReadonlyMap<string, Product> | null = null
const productListeners = new Set<() => void>()

function productSnapshot(): ReadonlyMap<string, Product> {
  if (productMemory === null) {
    try {
      const stored = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '[]') as unknown
      productMemory = new Map(
        (Array.isArray(stored) ? stored : []).filter(
          (e): e is [string, Product] => Array.isArray(e) && typeof e[0] === 'string' && (e[1] === 'Collagen' || e[1] === 'Zextra'),
        ),
      )
    } catch {
      productMemory = new Map()
    }
  }
  return productMemory
}

function subscribeProducts(listener: () => void): () => void {
  productListeners.add(listener)
  return () => productListeners.delete(listener)
}

function rememberProducts(report: AiReport): void {
  const known = productSnapshot()
  const next = learnProducts(report, known)
  if (next.size === known.size && [...next].every(([line, p]) => known.get(line) === p)) return
  productMemory = next
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify([...next]))
  } catch {
    // A private window: remembered for this visit only.
  }
  for (const listener of productListeners) listener()
}

/** Each AI line's product as far as this browser has seen it — for the lanes and «Boshqaruv»'s line cards. */
export function useLineProducts(report: AiReport | null): ReadonlyMap<string, Product> {
  const products = useSyncExternalStore(subscribeProducts, productSnapshot, () => NO_PRODUCTS)
  useEffect(() => {
    if (report) rememberProducts(report)
  }, [report])
  return products
}

/* ── The panel ──────────────────────────────────────────────────────────── */

export interface NowPanelProps {
  readonly status: AiStatus | null
  /**
   * The saved form's limits, when the reader may see them — «Saqlangan: 4/4/0» under the header when the agent applies other ones.
   * Its `hours` («Ish vaqti») date the day when the agent's report names none.
   */
  readonly saved: { readonly maxCalls: number; readonly maxNew: number; readonly maxRetry: number; readonly hours?: WorkHours | null } | null
  readonly staleAfterSec: number
  readonly now: Date
  readonly updatedAt: string | null
  readonly updateFailed: boolean
  readonly nameOf: (ext: string) => string | null
}

export function AiNowPanel(props: NowPanelProps) {
  const { status, saved, staleAfterSec, now, updatedAt, updateFailed, nameOf } = props
  const report = status?.report ?? null
  const fresh = isFresh(status, now, staleAfterSec)
  const products = useLineProducts(report)
  const head = nowRow(status, now, staleAfterSec, saved?.hours)
  const rows = report ? lineRows(report, nameOf, products) : []
  const lanes = rows.map(laneOf)
  const count = report && fresh ? lineCount(report) : null
  const limit = report ? limitShort(report.limits) : null
  const mismatch = report ? limitsMismatch(saved, report) : null
  // Why it is not dialling, in the agent's words — only while the report is fresh; the fuse is said once, below.
  const reasons = report && fresh ? flagReasons(report.flags).filter((r) => !(report.limits.fused && r.startsWith('Ehtiyot'))) : []
  // A stale picture keeps the moment it was taken: its timers stop there.
  const at = fresh || !status ? now : new Date(status.receivedAt)
  const headColor = head.tone === 'neutral' ? 'var(--ink-muted)' : TONE_COLOR[head.tone]

  return (
    <Card className="relative flex flex-col gap-3 overflow-hidden p-4 sm:p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-36 rounded-t-[inherit]"
        style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${fresh ? 'var(--accent)' : headColor} 10%, transparent), transparent)` }}
      />
      <header className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-[18px] font-bold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            Hozir · jonli
          </h2>
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[12.5px] font-bold"
            style={{
              borderColor: `color-mix(in oklab, ${headColor} 40%, transparent)`,
              background: `color-mix(in oklab, ${headColor} 12%, transparent)`,
              color: head.tone === 'neutral' ? 'var(--ink-secondary)' : inked(headColor),
            }}
          >
            {fresh ? <span aria-hidden className="ai-live-dot" /> : <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: headColor }} />}
            {fresh ? 'LIVE' : head.title}
          </span>
          {fresh && (
            <span className="text-[14px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
              {liveHeadline(lanes)}
            </span>
          )}
          {!fresh && head.detail && (
            <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              {head.detail}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
          {count && count.total > 0 && <Chip>{count.busy} / {count.total} liniya band</Chip>}
          {limit && <Chip>{limit}</Chip>}
          <Chip tone={updateFailed ? 'critical' : undefined}>
            {updateFailed ? 'yangilanmadi' : 'yangilandi'}
            {updatedAt ? ` ${formatClock(updatedAt)}` : ''}
          </Chip>
        </div>
      </header>

      {(mismatch || report?.limits.fused || reasons.length > 0) && (
        <div role="note" aria-label="Nega termayapti" className="relative flex flex-col text-[13px]" style={{ color: inked(TONE_COLOR.warning) }}>
          {mismatch && <span>{mismatch}</span>}
          {report?.limits.fused && <span>Ehtiyot rejimi: ovoz yoʻqolgani uchun AI bittadan qoʻngʻiroq qilyapti</span>}
          {reasons.map((r) => (
            <span key={r}>{r}</span>
          ))}
        </div>
      )}

      {!status || !report ? (
        <p className="relative text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          AIʼdan hali xabar kelmagan.
        </p>
      ) : rows.length === 0 ? (
        <p className="relative text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          AI liniyalar haqida xabar bermagan.
        </p>
      ) : (
        <ul aria-label="AI liniyalari" className="relative grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,540px),1fr))]" style={{ opacity: fresh ? 1 : 0.6 }}>
          {rows.map((row, i) => (
            <LaneView key={row.line} row={row} lane={lanes[i]!} at={at} />
          ))}
        </ul>
      )}

      {report && <SellerRow report={report} fresh={fresh} at={at} />}
      {report && <FeedStrip report={report} nameOf={nameOf} />}
      {report && <RecentStrip report={report} nameOf={nameOf} />}
    </Card>
  )
}

function Chip({ tone, children }: { readonly tone?: Tone; readonly children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface-sunken)',
        color: tone ? inked(TONE_COLOR[tone]) : 'var(--ink-secondary)',
      }}
    >
      {children}
    </span>
  )
}

/*
  One grid per lane. From `sm`: Liniya | Mijoz | wire | AI | wire | Sotuvchi |
  Vaqt, then the state pill and its sentence under the client. On a phone the
  wires go and the AI node sits between the two people.
*/
const LANE_GRID =
  'grid items-center gap-x-2.5 gap-y-1.5 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem_minmax(0,1fr)_3rem] sm:grid-cols-[2.75rem_minmax(7.5rem,1.3fr)_minmax(1.25rem,0.6fr)_2.5rem_minmax(1.25rem,0.6fr)_minmax(6.5rem,1fr)_3.25rem]'

const initial = (s: string | null | undefined) => (s ? s.trim().charAt(0).toUpperCase() : '·')

function LaneView({ row, lane, at }: { readonly row: LineRow; readonly lane: ReturnType<typeof laneOf>; readonly at: Date }) {
  const seller = row.seller
  const sellerFirst = seller ? seller.label.split(' ').slice(1).join(' ') : null
  return (
    <li aria-label={`Liniya ${row.line}`} data-phase={lane.phase} className={`ai-lane ${LANE_GRID} rounded-[var(--radius-panel-sm)] px-3 py-2.5`}>
      <span className="text-[16px] font-extrabold tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
        {row.line}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {row.client ? (
          <>
            <span aria-hidden className="ai-av ai-av-client">
              <span className="ai-ripple" />
              <span className="ai-ripple" />
              {initial(row.client)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-bold" style={{ color: 'var(--ink-primary)' }}>
                {row.client}
              </span>
              <span className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
                {row.product && <span style={{ color: inked(PRODUCT_TONE[row.product]) }}>{row.product}</span>}
                {row.deal !== null && <DealLink deal={row.deal} />}
              </span>
            </span>
          </>
        ) : (
          <>
            <span aria-hidden className="ai-av ai-av-empty">
              ·
            </span>
            <span className="min-w-0 truncate text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
              {row.product ? <span style={{ color: inked(PRODUCT_TONE[row.product]) }}>{row.product} · </span> : null}
              {row.kind === 'busy' ? 'mijoz' : 'Lid kutilmoqda'}
            </span>
          </>
        )}
      </span>
      <span aria-hidden className="ai-wire ai-wire-a hidden sm:block" />
      <span role="img" aria-label="AI" className="ai-node">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span aria-hidden className="ai-wire ai-wire-b hidden sm:block" />
      <span className="flex min-w-0 items-center gap-2">
        {seller ? (
          <>
            <span aria-hidden className="ai-av ai-av-seller">
              <span className="ai-ripple" />
              <span className="ai-ripple" />
              {initial(sellerFirst ?? seller.ext)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-bold" style={{ color: 'var(--ink-primary)' }}>
                {sellerFirst || seller.ext}
              </span>
              <span className="block text-[12px] tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                {seller.ext}
              </span>
            </span>
          </>
        ) : (
          <>
            <span aria-hidden className="ai-av ai-av-empty">
              ?
            </span>
            <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              sotuvchi
            </span>
          </>
        )}
      </span>
      <span className="text-right text-[14px] font-extrabold tabular-nums" style={{ color: 'var(--ink-primary)' }}>
        {row.started || row.since ? elapsedText((row.started ?? row.since)!, at) : ''}
      </span>
      <span className="col-span-full flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:col-start-2">
        <span className="ai-pill">
          <i aria-hidden />
          {lane.label}
        </span>
        {lane.sentence && (
          <span className="min-w-0 text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
            {lane.sentence}
          </span>
        )}
        {row.test && <Pill color={TONE_COLOR.warning}>Sinov</Pill>}
      </span>
    </li>
  )
}

/** «Sotuvchilar: (D) 122 Dilshoda boʻsh · 2 …» — the agent's list, the AI-ringing one first. */
function SellerRow({ report, fresh, at }: { readonly report: AiReport; readonly fresh: boolean; readonly at: Date }) {
  const chips = sellerChips(report.sellers, fresh, report.live)
  if (chips.length === 0) return null
  return (
    <section aria-label="Sotuvchilar hozir" className="relative flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--grid)' }}>
      <h3 className="mr-1 text-[12.5px] font-bold" style={{ color: 'var(--ink-secondary)' }}>
        Sotuvchilar:
      </h3>
      <ul className="contents">
        {chips.map((s) => (
          <li key={s.ext} aria-label={`Sotuvchi ${s.ext}`} data-state={s.state} className="ai-chip">
            <span aria-hidden className="ai-chip-av">
              {initial(s.first ?? s.ext)}
            </span>
            <span className="tabular-nums">{s.ext}</span>
            {s.first && <span>{s.first}</span>}
            <span className="font-medium" style={{ color: 'var(--ink-secondary)' }}>
              {s.note}
              {s.since && s.state !== 'offline' ? <span className="tabular-nums"> {elapsedText(s.since, at)}</span> : null}
            </span>
            {s.transfersToday > 0 && (
              <span className="font-medium tabular-nums" style={{ color: inked(TONE_COLOR.good) }} title="bugun AI ulagan mijozlar">
                · {formatNumber(s.transfersToday)}
              </span>
            )}
            {s.product && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: PRODUCT_TONE[s.product] }} title={s.product} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

const RECENT_SHOWN = 6

/** «12:41 · 291 → 120 Marjona · Aziz · #123 ↗ — Ulandi», newest first. */
function RecentStrip({ report, nameOf }: { readonly report: AiReport; readonly nameOf: (ext: string) => string | null }) {
  const [all, setAll] = useState(false)
  if (!report.live) return null
  const rows = recentRows(report, nameOf)
  const shown = all ? rows : rows.slice(0, RECENT_SHOWN)
  return (
    <section aria-label="Soʻnggi ulanishlar" className="relative flex flex-col gap-1 border-t pt-3" style={{ borderColor: 'var(--grid)' }}>
      <h3 className="text-[12.5px] font-bold" style={{ color: 'var(--ink-secondary)' }}>
        Soʻnggi ulanishlar · bugun jami {formatNumber(report.today.transferred)} ta ulandi
      </h3>
      {rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Hali yoʻq
        </p>
      ) : (
        <ul className="grid gap-x-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
          {shown.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-[13.5px]" style={{ color: 'var(--ink-primary)' }}>
              <span className="tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                {r.time}
              </span>
              <span className="font-semibold tabular-nums">{r.line}</span>
              {r.seller && <span className="font-semibold tabular-nums">→ {r.seller}</span>}
              {r.client && <span>· {r.client}</span>}
              {r.deal !== null && (
                <span>
                  · <DealLink deal={r.deal} />
                </span>
              )}
              {r.test && <Pill color={TONE_COLOR.warning}>Sinov</Pill>}
              <span className="ml-auto">
                <StatePill tone={r.ok ? 'good' : 'neutral'} dot={r.ok}>
                  {r.waitedSec !== null ? `${formatNumber(r.waitedSec)} s da ulandi` : r.result}
                </StatePill>
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > RECENT_SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="focusable w-fit text-[13px] font-medium underline underline-offset-2" style={{ color: 'var(--accent-ink)' }}>
          {all ? 'Kamroq' : `yana ${rows.length - RECENT_SHOWN} ta`}
        </button>
      )}
    </section>
  )
}

const FEED_SHOWN = 8

/**
 * «Jonli lenta» — every step of every call, newest first (`live.events`,
 * 2026-11-02): «12:41:05 · 290 · Aziz — Koʻtarmadi». Drawn only when the agent
 * sends it; the count of «Koʻtarmadi» is over the events it still keeps.
 */
function FeedStrip({ report, nameOf }: { readonly report: AiReport; readonly nameOf: (ext: string) => string | null }) {
  const [all, setAll] = useState(false)
  const rows = feedRows(report, nameOf)
  if (rows.length === 0) return null
  const noAnswer = feedNoAnswer(report)
  const shown = all ? rows : rows.slice(0, FEED_SHOWN)
  return (
    <section aria-label="Jonli lenta" className="relative flex flex-col gap-1 border-t pt-3" style={{ borderColor: 'var(--grid)' }}>
      <h3 className="text-[12.5px] font-bold" style={{ color: 'var(--ink-secondary)' }}>
        Jonli lenta · soʻnggi {formatNumber(rows.length)} ta voqea{noAnswer > 0 ? ` · ${formatNumber(noAnswer)} tasi koʻtarmadi` : ''}
      </h3>
      <ul className="grid gap-x-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        {shown.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-[13.5px]" style={{ color: 'var(--ink-primary)' }}>
            <span className="tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
              {r.time}
            </span>
            <span className="font-semibold tabular-nums">{r.line}</span>
            {r.client && <span>· {r.client}</span>}
            {r.seller && <span className="font-semibold tabular-nums">→ {r.seller}</span>}
            {r.deal !== null && (
              <span>
                · <DealLink deal={r.deal} />
              </span>
            )}
            {r.test && <Pill color={TONE_COLOR.warning}>Sinov</Pill>}
            <span className="ml-auto">
              <StatePill tone={r.tone} dot={r.tone === 'good'}>
                {r.label}
              </StatePill>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > FEED_SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="focusable w-fit text-[13px] font-medium underline underline-offset-2" style={{ color: 'var(--accent-ink)' }}>
          {all ? 'Kamroq' : `yana ${rows.length - FEED_SHOWN} ta`}
        </button>
      )}
    </section>
  )
}
