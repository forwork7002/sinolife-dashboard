'use client'

import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'

import { Card } from '@/components/ui/Card'
import { ArrowUpRightGlyph, BellGlyph, ChatGlyph, CheckCircleGlyph, ChevronGlyph, ClockGlyph, HourglassGlyph, PhoneXGlyph } from '@/components/ui/Icons'
import { InfoTip } from '@/components/ui/Tooltip'
import {
  type AiReport,
  type AiStatus,
  type LineRow,
  type Product,
  type Tone,
  elapsedText,
  isFresh,
  learnProducts,
  limitShort,
  limitsMismatch,
  lineCount,
  lineRows,
  nowRow,
  percent,
  recentRows,
  sellerGroups,
} from '@/features/aiRegistrator/aiLiveLogic'
import { bitrixDealUrl } from '@/features/target/targetApi'
import { PRODUCT_TONE } from '@/features/target/targetTheme'
import { formatClock, formatNumber } from '@/lib/format'

/**
 * «AI registrator → Boshqaruv», the live half. The owner, 31.10 12:28, after
 * the second cut: «eng kerakli narsa shuki hozir AI qaysi SIP'larda … qaysi
 * SIP'dan qaysi SIP'ga ulab berdi, qaysi mijozni — real vaqtda … juda ko'p
 * narsalar juda tartibsiz». So the first screen is one status line and then
 * every AI line, one row each, in an order that stands still: the line, the
 * client, what it is doing, the seller it reaches, how long. The last
 * put-throughs under it. The day, the sellers and the settings come after,
 * compact; how the page works is the last line.
 *
 * RED IS A PROBLEM, NOTHING ELSE: a line the ATS does not know, an AI that
 * stopped answering in the day. Rows are 15 px, labels 13 px.
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
const inked = (color: string) => `color-mix(in oklab, ${color} 78%, var(--ink-primary))`

/* ── Glyphs the shared set does not draw ─────────────────────────────────── */

const stroke = { stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke' } as const
const HANDSET =
  'M20.5 16.6v2.6a1.8 1.8 0 0 1-2 1.8 17.6 17.6 0 0 1-7.7-2.7 17.3 17.3 0 0 1-5.3-5.3A17.6 17.6 0 0 1 2.8 5.2 1.8 1.8 0 0 1 4.6 3.3h2.6a1.8 1.8 0 0 1 1.8 1.5c.1.9.3 1.7.6 2.5a1.8 1.8 0 0 1-.4 1.9l-1.1 1.1a14 14 0 0 0 5.3 5.3l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.8.3 1.6.5 2.5.6a1.8 1.8 0 0 1 1.6 1.9z'

function Svg({ size, children }: { readonly size: number; readonly children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" className="shrink-0">
      {children}
    </svg>
  )
}

/** A call going out — the AI dialing the client. */
function PhoneOutGlyph({ size = 18 }: { readonly size?: number }) {
  return (
    <Svg size={size}>
      <path d={HANDSET} {...stroke} />
      <path d="M15 3h6v6M14.5 9.5 21 3" {...stroke} />
    </Svg>
  )
}

function PhoneGlyph({ size = 18 }: { readonly size?: number }) {
  return (
    <Svg size={size}>
      <path d={HANDSET} {...stroke} />
    </Svg>
  )
}

/** «→ 122 Dilshoda» — the caller put through to a seller. */
function ArrowRightGlyph({ size = 18 }: { readonly size?: number }) {
  return (
    <Svg size={size}>
      <path d="M4.5 12h15M13.5 6l6 6-6 6" {...stroke} />
    </Svg>
  )
}

function StateGlyph({ state, size }: { readonly state: string; readonly size: number }) {
  switch (state) {
    case 'dialing':
      return <PhoneOutGlyph size={size} />
    case 'talking':
    case 'seller_talk':
      return <ChatGlyph size={size} />
    case 'transfer':
      return <HourglassGlyph size={size} />
    case 'ringing_seller':
      return <BellGlyph size={size} />
    case 'with_seller':
      return <CheckCircleGlyph size={size} />
    case 'call':
      return <PhoneGlyph size={size} />
    case 'not_registered':
      return <PhoneXGlyph size={size} />
    default:
      return <ClockGlyph size={size} />
  }
}

/* ── Small parts ─────────────────────────────────────────────────────────── */

function Pill({ color, children }: { readonly color: string; readonly children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold tracking-wide uppercase"
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

/** A state word in its colour, for the management table. */
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
function DealLink({ deal }: { readonly deal: number }) {
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

/** A section's title — one line, no subtitle under it (31.10: «ortiqcha matnni kamaytir»). */
function Section({ title, aside, children }: { readonly title: string; readonly aside?: ReactNode; readonly children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-[17px] font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </Card>
  )
}

/* ── Which product each line serves, remembered ─────────────────────────── */

/*
  Zextra's lines are the agent's own setting and never sent; a line's product
  shows only while it carries a call. Remembered here — one store for the page,
  kept in this browser — so an idle Zextra line stays in its group instead of
  jumping to Collagen's between calls. Browser storage is a convenience: when
  it is not there the rows still stand, by number.
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

/* ── The board ───────────────────────────────────────────────────────────── */

export interface LiveBoardProps {
  readonly status: AiStatus | null
  /** The saved form's limits — «Saqlangan: 4/4/0» under the status line when the agent applies other ones. */
  readonly saved: { readonly maxCalls: number; readonly maxNew: number; readonly maxRetry: number } | null
  readonly staleAfterSec: number
  readonly now: Date
  readonly updatedAt: string | null
  readonly updateFailed: boolean
  readonly nameOf: (ext: string) => string | null
}

/** The live part of the page, top to bottom: the status line, the lines, the last put-throughs, the day, the sellers. */
export function LiveBoard(props: LiveBoardProps) {
  const { status, staleAfterSec, now, nameOf } = props
  const fresh = isFresh(status, now, staleAfterSec)
  const report = status?.report ?? null
  const products = useSyncExternalStore(subscribeProducts, productSnapshot, () => NO_PRODUCTS)
  useEffect(() => {
    if (report) rememberProducts(report)
  }, [report])
  return (
    <div className="flex flex-col gap-4">
      <StatusLine {...props} fresh={fresh} />
      {status && report && (
        <>
          <LinesTable rows={lineRows(report, nameOf, products)} fresh={fresh} receivedAt={status.receivedAt} now={now} />
          <RecentList report={report} nameOf={nameOf} />
          <DayStrip report={report} fresh={fresh} receivedAt={status.receivedAt} />
          <SellerChips report={report} fresh={fresh} />
        </>
      )}
    </div>
  )
}

/** «● AI ishlayapti · 2/8 band · limit 5 (4 yangi + 1 nedozvon) · yangilandi 12:28:02» — and the saved limits when they differ. */
function StatusLine({ status, saved, staleAfterSec, now, updatedAt, updateFailed, fresh }: LiveBoardProps & { readonly fresh: boolean }) {
  const row = nowRow(status, now, staleAfterSec)
  const report = status?.report ?? null
  const color = row.tone === 'neutral' ? 'var(--ink-muted)' : TONE_COLOR[row.tone]
  const count = report && fresh ? lineCount(report) : null
  const limit = report ? limitShort(report.limits) : null
  const mismatch = report ? limitsMismatch(saved, report) : null
  return (
    <Card className="overflow-hidden">
      <div
        className="flex flex-col gap-1 px-4 py-3 sm:px-5"
        style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${color} 16%, transparent), transparent 70%)` }}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
            <span aria-hidden className="relative inline-flex h-3 w-3 shrink-0">
              {row.tone === 'good' && <span className="absolute inset-0 animate-ping rounded-full opacity-50 motion-reduce:hidden" style={{ background: color }} />}
              <span className="relative inline-block h-3 w-3 rounded-full" style={{ background: color }} />
            </span>
            <strong className="text-[18px] font-semibold" style={{ color: row.tone === 'neutral' ? 'var(--ink-primary)' : inked(color) }}>
              {row.title}
            </strong>
          </span>
          {row.detail && <span>· {row.detail}</span>}
          {count && count.total > 0 && (
            <span>
              · <strong className="tabular-nums" style={{ color: 'var(--ink-primary)' }}>{count.busy}/{count.total}</strong> band
            </span>
          )}
          {limit && <span>· {limit}</span>}
          <span className="tabular-nums" style={{ color: updateFailed ? inked(TONE_COLOR.critical) : undefined }}>
            · {updateFailed ? 'yangilanmadi' : 'yangilandi'}
            {updatedAt ? ` ${formatClock(updatedAt)}` : ''}
          </span>
        </div>
        {(mismatch || report?.limits.fused) && (
          <div className="flex flex-col text-[13px]" style={{ color: inked(TONE_COLOR.warning) }}>
            {mismatch && <span>{mismatch}</span>}
            {report?.limits.fused && <span>Ehtiyot rejimi: ovoz yoʻqolgani uchun AI bittadan qoʻngʻiroq qilyapti</span>}
          </div>
        )}
      </div>
    </Card>
  )
}

/*
  One grid for the header and every row, so the columns stand straight:
  Liniya | Mijoz | Holat | → Sotuvchi | Vaqt from `sm`. On a phone a row is
  two lines — the line, its state and the time; then the client and the seller.
*/
const ROW_GRID =
  'grid items-center gap-x-3 gap-y-0.5 grid-cols-[3.25rem_minmax(0,1fr)_auto] [grid-template-areas:"line_state_time"_"._who_who"] sm:grid-cols-[4.5rem_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_4.5rem] sm:[grid-template-areas:"line_who_state_seller_time"]'

function LineRowView({ row, at }: { readonly row: LineRow; readonly at: Date }) {
  const busy = row.kind === 'busy'
  const stripe = row.product ? PRODUCT_TONE[row.product] : 'var(--border-strong)'
  const stateColor = row.tone === 'neutral' ? (busy ? 'var(--ink-primary)' : 'var(--ink-secondary)') : inked(TONE_COLOR[row.tone])
  return (
    <li
      aria-label={`Liniya ${row.line}`}
      className={`${ROW_GRID} relative rounded-[var(--radius-panel-sm)] py-2 pr-3 pl-4 text-[15px]`}
      style={{
        background: busy ? `linear-gradient(90deg, color-mix(in oklab, ${stripe} 14%, transparent), transparent 75%), var(--surface-raised)` : 'transparent',
        opacity: busy || row.kind === 'unregistered' ? 1 : 0.62,
      }}
    >
      <span aria-hidden className="absolute inset-y-1 left-0 w-1 rounded-full" style={{ background: busy ? stripe : 'transparent' }} />
      <span className="text-[17px] font-semibold tabular-nums [grid-area:line]" style={{ color: 'var(--ink-primary)' }}>
        {row.line}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 [grid-area:state]" style={{ color: stateColor, fontWeight: busy ? 600 : 400 }}>
        {(busy || row.kind === 'unregistered') && <StateGlyph state={row.state} size={16} />}
        <span className="min-w-0 sm:truncate">{row.label}</span>
      </span>
      <span className="text-right text-[17px] font-semibold tabular-nums [grid-area:time]" style={{ color: 'var(--ink-primary)' }}>
        {row.since ? elapsedText(row.since, at) : ''}
      </span>
      {/* On a phone the client and the seller share the second line; from `sm` each is its own column. */}
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 [grid-area:who] sm:contents">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 sm:[grid-area:who]">
          {row.client && (
            <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
              {row.client}
            </span>
          )}
          {busy && (row.product || row.deal !== null) && (
            <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              {row.product && <span style={{ color: inked(PRODUCT_TONE[row.product]) }}>{row.product}</span>}
              {row.deal !== null && <DealLink deal={row.deal} />}
            </span>
          )}
          {row.test && <Pill color={TONE_COLOR.warning}>Sinov</Pill>}
        </span>
        <span className="sm:[grid-area:seller]">
          {row.seller && (
            <span
              className="inline-flex items-center gap-1 font-semibold tabular-nums"
              style={{ color: inked(row.state === 'with_seller' ? TONE_COLOR.good : TONE_COLOR.warning) }}
            >
              <ArrowRightGlyph size={15} />
              {row.seller.label}
            </span>
          )}
        </span>
      </span>
    </li>
  )
}

/** Every AI line, one row each — the first thing under the status line. */
function LinesTable({ rows, fresh, receivedAt, now }: { readonly rows: readonly LineRow[]; readonly fresh: boolean; readonly receivedAt: string; readonly now: Date }) {
  // A stale picture keeps the moment it was taken: its timers stop there.
  const at = fresh ? now : new Date(receivedAt)
  const zextraFrom = rows.findIndex((r) => r.product === 'Zextra')
  const grouped = zextraFrom > 0
  return (
    <Section
      title="Liniyalar (SIP)"
      aside={
        !fresh ? (
          <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            {formatClock(receivedAt)} dagi holat
          </span>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          AI liniyalar haqida xabar bermagan.
        </p>
      ) : (
        <div className="flex flex-col gap-1" style={{ opacity: fresh ? 1 : 0.6 }}>
          <div aria-hidden className={`${ROW_GRID} hidden pr-3 pl-4 text-[13px] font-medium sm:grid`} style={{ color: 'var(--ink-secondary)' }}>
            <span className="[grid-area:line]">Liniya</span>
            <span className="[grid-area:who]">Mijoz</span>
            <span className="[grid-area:state]">Holat</span>
            <span className="[grid-area:seller]">→ Sotuvchi</span>
            <span className="text-right [grid-area:time]">Vaqt</span>
          </div>
          <ul className="flex flex-col gap-1">
            {rows.map((row, i) => (
              <LineGroupRow key={row.line} row={row} at={at} heading={grouped && (i === 0 || i === zextraFrom) ? (i === 0 ? 'Collagen' : 'Zextra') : null} />
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

function LineGroupRow({ row, at, heading }: { readonly row: LineRow; readonly at: Date; readonly heading: Product | null }) {
  return (
    <>
      {heading && (
        <li aria-hidden className="pt-1 pl-4 text-[12px] font-semibold tracking-wide uppercase" style={{ color: inked(PRODUCT_TONE[heading]) }}>
          {heading}
        </li>
      )}
      <LineRowView row={row} at={at} />
    </>
  )
}

const RECENT_SHOWN = 10

/** «12:41 · 291 → 120 Marjona · Aziz · Collagen · #123 ↗ — ✓ Ulandi», newest first; ten, then «yana N». */
function RecentList({ report, nameOf }: { readonly report: AiReport; readonly nameOf: (ext: string) => string | null }) {
  const [all, setAll] = useState(false)
  const rows = recentRows(report, nameOf)
  const shown = all ? rows : rows.slice(0, RECENT_SHOWN)
  const today = formatNumber(report.today.transferred)
  return (
    <Section title="Soʻnggi ulanishlar">
      {rows.length === 0 ? (
        <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          {report.live ? 'Hali yoʻq' : 'AI serveri bu roʻyxatni hali yubormayapti'} — bugun jami {today} ta ulandi.
        </p>
      ) : (
        <>
          <ul className="flex flex-col">
            {shown.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t py-1.5 text-[15px] first:border-t-0" style={{ borderColor: 'var(--grid)' }}>
                <span className="tabular-nums" style={{ color: 'var(--ink-secondary)' }}>
                  {r.time}
                </span>
                <span className="font-semibold tabular-nums" style={{ color: 'var(--ink-primary)' }}>
                  {r.line}
                </span>
                {r.seller && (
                  <span className="inline-flex items-center gap-1 font-semibold tabular-nums" style={{ color: 'var(--ink-primary)' }}>
                    <ArrowRightGlyph size={14} />
                    {r.seller}
                  </span>
                )}
                {r.client && <span style={{ color: 'var(--ink-primary)' }}>· {r.client}</span>}
                {r.product && <span style={{ color: inked(PRODUCT_TONE[r.product]) }}>· {r.product}</span>}
                {r.deal !== null && (
                  <span>
                    · <DealLink deal={r.deal} />
                  </span>
                )}
                {r.test && <Pill color={TONE_COLOR.warning}>Sinov</Pill>}
                <span className="ml-auto">
                  {r.ok ? (
                    <StatePill tone="good" dot={false}>
                      <CheckCircleGlyph size={13} /> {r.result}
                    </StatePill>
                  ) : (
                    <StatePill tone="neutral" dot={false}>
                      {r.result}
                    </StatePill>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {rows.length > RECENT_SHOWN && (
            <button type="button" onClick={() => setAll(!all)} className="focusable w-fit text-[13px] font-medium underline underline-offset-2" style={{ color: 'var(--accent-ink)' }}>
              {all ? 'Kamroq' : `yana ${rows.length - RECENT_SHOWN} ta`}
            </button>
          )}
        </>
      )}
    </Section>
  )
}

function Figure({ label, value, color, children }: { readonly label: string; readonly value: number; readonly color?: string; readonly children?: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span>{label}</span>
      <strong className="text-[19px] font-semibold tabular-nums" style={{ color: color ? inked(color) : 'var(--ink-primary)' }}>
        {formatNumber(value)}
      </strong>
      {children}
    </span>
  )
}

/** «Qoʻngʻiroq 562 → Koʻtardi 178 (32%) → Ulandi 50 (28%) · Ulanmadi 61 · ATS rad etdi 212 ⓘ» — one line. */
function DayStrip({ report, fresh, receivedAt }: { readonly report: AiReport; readonly fresh: boolean; readonly receivedAt: string }) {
  const t = report.today
  const arrow = (
    <span aria-hidden style={{ color: 'var(--ink-muted)' }}>
      <ChevronGlyph direction="right" size={12} />
    </span>
  )
  return (
    <Section
      title="Bugun"
      aside={
        !fresh ? (
          <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            AIning {formatClock(receivedAt)} dagi xabaridan
          </span>
        ) : undefined
      }
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
        <Figure label="Qoʻngʻiroq" value={t.calls} />
        {arrow}
        <Figure label="Koʻtardi" value={t.answered}>
          <span>({percent(t.answered, t.calls)})</span>
        </Figure>
        {arrow}
        <Figure label="Ulandi" value={t.transferred} color={TONE_COLOR.good}>
          <span>({percent(t.transferred, t.answered)})</span>
        </Figure>
        <span aria-hidden>·</span>
        <Figure label="Ulanmadi" value={t.transferFailed} color={t.transferFailed > 0 ? TONE_COLOR.caution : undefined}>
          <InfoTip label="Ulanmadi — izoh" content="Mijoz qiziqdi, lekin sotuvchi koʻtarmadi." />
        </Figure>
        <span aria-hidden>·</span>
        <Figure label="ATS rad etdi" value={t.atsRejected}>
          <InfoTip label="ATS rad etdi — izoh" content="ATS qoʻngʻiroqni boshlamadi (503) — mijozga yetib bormagan urinish, AI keyinroq qayta uradi." />
        </Figure>
      </p>
    </Section>
  )
}

/** The sellers in four compact groups by what they do now — the AI ringing one first. */
function SellerChips({ report, fresh }: { readonly report: AiReport; readonly fresh: boolean }) {
  const groups = sellerGroups(report.sellers, fresh)
  if (groups.every((g) => g.sellers.length === 0)) return null
  return (
    <Section title="Sotuvchilar">
      <div className="flex flex-col gap-2.5">
        {groups.map((g) => {
          const color = g.tone === 'neutral' ? 'var(--ink-muted)' : TONE_COLOR[g.tone]
          const lit = g.key === 'ringing' && g.sellers.length > 0
          return (
            <section
              key={g.key}
              aria-label={`${g.label} · ${g.sellers.length}`}
              className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3"
            >
              <h3 className="inline-flex shrink-0 items-center gap-2 text-[15px] font-semibold sm:w-52 sm:pt-1" style={{ color: 'var(--ink-primary)' }}>
                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                {g.label}
                <span className="tabular-nums" style={{ color: g.sellers.length > 0 && g.tone !== 'neutral' ? inked(color) : 'var(--ink-secondary)' }}>
                  · {g.sellers.length}
                </span>
              </h3>
              {g.sellers.length === 0 ? (
                <span className="text-[13px] sm:pt-1.5" style={{ color: 'var(--ink-secondary)' }}>
                  yoʻq
                </span>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {g.sellers.map((s) => (
                    <li
                      key={s.ext}
                      aria-label={`Sotuvchi ${s.ext}`}
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[15px]"
                      style={{
                        borderColor: lit ? `color-mix(in oklab, ${color} 60%, transparent)` : 'var(--border)',
                        background: lit ? `color-mix(in oklab, ${color} 16%, transparent)` : 'var(--surface-raised)',
                        color: 'var(--ink-primary)',
                      }}
                    >
                      {s.product && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: PRODUCT_TONE[s.product] }} title={s.product} />}
                      <strong className="tabular-nums">{s.ext}</strong>
                      {s.first && <span>{s.first}</span>}
                      <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }} title="bugun ulandi">
                        · {formatNumber(s.transfersToday)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </Section>
  )
}

/** The last line of the page: how it works, folded. */
export function HowItWorks() {
  return (
    <details className="group text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
      <summary className="focusable inline-flex cursor-pointer list-none items-center gap-1.5 font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronGlyph direction="right" size={12} className="transition-transform group-open:rotate-0" />
        Bu sahifa qanday ishlaydi?
      </summary>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
        <li>AI oʻz holatini band liniya boʻlsa har 5 soniyada, aks holda har 30 soniyada yuboradi; sahifa har 5 soniyada oʻzi yangilanadi.</li>
        <li>Ish vaqti 09:00–18:30, tushlik 12:30–13:30 (Toshkent). Ish vaqtida AI 90 soniyadan koʻp jim qolsa — qizil.</li>
        <li>«Liniyalar»: har AI liniyasi bitta qatorda — mijoz, holat, qaysi sotuvchiga ulanyapti, qancha vaqtdan beri; «#…» bosilsa Bitrix24 dagi sdelka ochiladi. Collagen liniyalari tepada, Zextra pastda.</li>
        <li>«Sotuvchilar»: har sotuvchi yonidagi son — bugun AI unga nechta mijoz uladi; nuqta rangi — mahsulot.</li>
        <li>«Sozlamalar»: AI qaysi sotuvchilarga ulaydi va bir vaqtda nechta qoʻngʻiroq qiladi; saqlangach AI 20 soniya ichida oʻqiydi.</li>
      </ul>
    </details>
  )
}
