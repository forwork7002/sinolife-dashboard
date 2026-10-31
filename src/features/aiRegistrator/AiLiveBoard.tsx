'use client'

import type { ReactNode } from 'react'

import { Card } from '@/components/ui/Card'
import { ArrowUpRightGlyph, BellGlyph, ChatGlyph, CheckCircleGlyph, ChevronGlyph, ClockGlyph, HourglassGlyph } from '@/components/ui/Icons'
import { InfoTip } from '@/components/ui/Tooltip'
import {
  type AiReport,
  type AiStatus,
  type Board,
  type BusyLine,
  type Product,
  type Tone,
  boardOf,
  elapsedText,
  isFresh,
  limitsMismatch,
  limitsSplit,
  nowRow,
  percent,
  recentRows,
  sellerGroups,
} from '@/features/aiRegistrator/aiLiveLogic'
import { bitrixDealUrl } from '@/features/target/targetApi'
import { PRODUCT_TONE } from '@/features/target/targetTheme'
import { formatClock, formatDateTime, formatNumber } from '@/lib/format'

/**
 * «AI registrator → Boshqaruv», the live half (2026-10-31, the owner, after
 * the first cut: «shu visual menga yoqmadi … visuali yaxshiroq va
 * tushunarliroq»). One question leads the page — «hozir shu yerda shunga
 * ulangan deb bilishim kerak» — so the order is: is the AI there (the hero),
 * the day in three steps, then every busy line as a card big enough to read
 * across the room (who, which seller, how long), the sellers by what they do,
 * the last put-throughs.
 *
 * RED IS A PROBLEM, NOTHING ELSE: a line the ATS does not know, an AI that
 * stopped answering in the day. A seller on a call is the floor working
 * (violet), a failed put-through a warning (orange), an ATS that did not
 * start a call is the AI's own retry (neutral, explained).
 *
 * Text is 15 px and up, labels 13 px, figures 28–36 px; secondary text is
 * `--ink-secondary`, never the muted grey-blue the first cut read in.
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

/** «Sdelka #123 ↗» — the deal's own page in Bitrix24. */
function DealLink({ deal }: { readonly deal: number }) {
  return (
    <a
      href={bitrixDealUrl(String(deal))}
      target="_blank"
      rel="noreferrer"
      className="focusable inline-flex items-center gap-0.5 font-medium underline decoration-1 underline-offset-2"
      style={{ color: 'var(--accent-ink)' }}
    >
      Sdelka #{deal}
      <ArrowUpRightGlyph size={13} />
    </a>
  )
}

function Panel({ title, hint, children }: { readonly title: string; readonly hint?: string; readonly children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-0.5">
        <h2 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
          {title}
        </h2>
        {hint && (
          <p className="text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
            {hint}
          </p>
        )}
      </header>
      {children}
    </Card>
  )
}

/* ── The board ───────────────────────────────────────────────────────────── */

export interface LiveBoardProps {
  readonly status: AiStatus | null
  /** The saved form's limits — «Saqlangan: 4/4/0» beside what the agent applies. */
  readonly saved: { readonly maxCalls: number; readonly maxNew: number; readonly maxRetry: number } | null
  readonly staleAfterSec: number
  readonly now: Date
  readonly updatedAt: string | null
  readonly updateFailed: boolean
  readonly nameOf: (ext: string) => string | null
}

/** The live half of the page: the hero, the day, the busy lines, the sellers, the last put-throughs. */
export function LiveBoard(props: LiveBoardProps) {
  const { status, staleAfterSec, now, nameOf } = props
  const fresh = isFresh(status, now, staleAfterSec)
  const report = status?.report ?? null
  const board = report ? boardOf(report, nameOf) : null
  return (
    <div className="flex flex-col gap-5">
      <Hero {...props} fresh={fresh} board={board} />
      {status && report && board && (
        <>
          <DayNumbers report={report} fresh={fresh} receivedAt={status.receivedAt} />
          <LinesBoard board={board} fresh={fresh} receivedAt={status.receivedAt} now={now} />
          <SellersBoard report={report} fresh={fresh} />
          <Feed report={report} nameOf={nameOf} />
        </>
      )}
    </div>
  )
}

function HeroFigure({ label, value, sub }: { readonly label: string; readonly value: string; readonly sub: string | null }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-[var(--radius-panel-sm)] border px-4 py-3"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
    >
      <span className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      <span className="text-[36px] leading-none font-semibold tabular-nums" style={{ color: 'var(--ink-primary)' }}>
        {value}
      </span>
      {sub && (
        <span className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          {sub}
        </span>
      )}
    </div>
  )
}

/** Is the AI there — green, grey or red — with the busy lines and the limit it applies. */
function Hero({ status, saved, staleAfterSec, now, updatedAt, updateFailed, fresh, board }: LiveBoardProps & { readonly fresh: boolean; readonly board: Board | null }) {
  const row = nowRow(status, now, staleAfterSec)
  const report = status?.report ?? null
  const color = row.tone === 'neutral' ? 'var(--ink-muted)' : TONE_COLOR[row.tone]
  const busy = board ? board.busy.length : 0
  const total = board ? board.busy.length + board.free.length + board.unregistered.length + board.other.length : 0
  const calls = report?.limits.calls ?? null
  const split = report ? limitsSplit(report.limits) : null
  const mismatch = report ? limitsMismatch(saved, report) : null
  return (
    <Card className="overflow-hidden">
      <div
        className="flex flex-col gap-5 p-4 sm:p-6"
        style={{ background: `linear-gradient(120deg, color-mix(in oklab, ${color} 16%, transparent), transparent 65%)` }}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="relative inline-flex h-4 w-4 shrink-0">
              {row.tone === 'good' && <span className="absolute inset-0 animate-ping rounded-full opacity-50 motion-reduce:hidden" style={{ background: color }} />}
              <span className="relative inline-block h-4 w-4 rounded-full" style={{ background: color }} />
            </span>
            <div className="min-w-0">
              <p className="text-[22px] leading-tight font-semibold sm:text-[26px]" style={{ color: row.tone === 'neutral' ? 'var(--ink-primary)' : inked(color) }}>
                {row.title}
              </p>
              {row.detail && (
                <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
                  {row.detail}
                </p>
              )}
            </div>
          </div>
          <p className="text-[13px] tabular-nums" style={{ color: updateFailed ? TONE_COLOR.critical : 'var(--ink-secondary)' }}>
            {updateFailed ? 'Yangilanmadi' : 'Yangilandi'}
            {updatedAt ? ` ${formatClock(updatedAt)}` : ''}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <HeroFigure
            label="Liniya band"
            value={fresh && total > 0 ? `${busy}/${total}` : '—'}
            sub={fresh ? (total > 0 ? `${board!.free.length} tasi boʻsh` : null) : 'AI javob berganda koʻrinadi'}
          />
          <HeroFigure label="Amaldagi limit — bir vaqtda" value={calls === null ? '—' : String(calls)} sub={split ? `= ${split}` : null} />
        </div>

        {(mismatch || report?.limits.fused) && (
          <div className="flex flex-col gap-1 text-[15px]" style={{ color: inked(TONE_COLOR.warning) }}>
            {mismatch && <p>{mismatch}</p>}
            {report?.limits.fused && <p>Ehtiyot rejimi: ovoz yoʻqolgani uchun AI bittadan qoʻngʻiroq qilyapti.</p>}
          </div>
        )}

        <details className="group text-[14px]" style={{ color: 'var(--ink-secondary)' }}>
          <summary className="focusable inline-flex cursor-pointer list-none items-center gap-1.5 font-medium select-none [&::-webkit-details-marker]:hidden">
            <ChevronGlyph direction="right" size={12} className="transition-transform group-open:rotate-0" />
            Bu sahifa qanday ishlaydi?
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            <li>AI oʻz holatini band liniya boʻlsa har 5 soniyada, aks holda har 30 soniyada yuboradi; sahifa har 5 soniyada oʻzi yangilanadi.</li>
            <li>Ish vaqti 09:00–18:30, tushlik 12:30–13:30 (Toshkent). Ish vaqtida AI 90 soniyadan koʻp jim qolsa — qizil ogohlantirish.</li>
            <li>«Jonli ulanish taxtasi» — har band AI liniyasi: mijoz kim, qaysi sotuvchiga ulanyapti, qancha vaqtdan beri; «Sdelka» bosilsa Bitrix24 ochiladi.</li>
            <li>Pastdagi «Boshqaruv» — AI qaysi sotuvchilarga ulaydi va bir vaqtda nechta qoʻngʻiroq qiladi; saqlangach AI 20 soniya ichida oʻqiydi.</li>
          </ul>
        </details>
      </div>
    </Card>
  )
}

function Step({ label, value, sub, color, first = false }: { readonly label: string; readonly value: number; readonly sub?: ReactNode; readonly color?: string; readonly first?: boolean }) {
  return (
    <li
      className="relative flex flex-col gap-1 rounded-[var(--radius-panel-sm)] border px-4 py-3"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
    >
      {!first && (
        <span aria-hidden className="absolute top-1/2 -left-3 hidden w-3 -translate-y-1/2 justify-center sm:flex" style={{ color: 'var(--ink-muted)' }}>
          <ChevronGlyph direction="right" size={12} />
        </span>
      )}
      <span className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      <span className="text-[32px] leading-none font-semibold tabular-nums" style={{ color: color ? inked(color) : 'var(--ink-primary)' }}>
        {formatNumber(value)}
      </span>
      {sub && (
        <span className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          {sub}
        </span>
      )}
    </li>
  )
}

/** The day as a funnel — called, answered, put through — and the two that did not go. */
function DayNumbers({ report, fresh, receivedAt }: { readonly report: AiReport; readonly fresh: boolean; readonly receivedAt: string }) {
  const t = report.today
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-6">
      <h2 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
        Bugun
        {!fresh && (
          <span className="ml-2 text-[14px] font-normal" style={{ color: 'var(--ink-secondary)' }}>
            AIning oxirgi xabaridan — {formatDateTime(receivedAt)}
          </span>
        )}
      </h2>
      <div className="flex flex-col gap-3 lg:flex-row">
        <ol aria-label="Bugungi voronka" className="grid flex-[3] grid-cols-1 gap-3 sm:grid-cols-3">
          <Step first label="Qoʻngʻiroq" value={t.calls} />
          <Step
            label="Mijoz koʻtardi"
            value={t.answered}
            sub={
              <>
                <strong style={{ color: 'var(--ink-primary)' }}>{percent(t.answered, t.calls)}</strong> qoʻngʻiroqlardan
              </>
            }
          />
          <Step
            label="Sotuvchiga ulandi"
            value={t.transferred}
            color={TONE_COLOR.good}
            sub={
              <>
                koʻtarganlarning <strong style={{ color: 'var(--ink-primary)' }}>{percent(t.transferred, t.answered)}</strong>
              </>
            }
          />
        </ol>
        <ul className="grid flex-[2] grid-cols-2 gap-3">
          <li
            className="flex flex-col gap-1 rounded-[var(--radius-panel-sm)] border px-4 py-3"
            style={{ borderColor: t.transferFailed > 0 ? `color-mix(in oklab, ${TONE_COLOR.caution} 45%, transparent)` : 'var(--border)' }}
          >
            <span className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Ulanmadi
            </span>
            <span className="text-[32px] leading-none font-semibold tabular-nums" style={{ color: t.transferFailed > 0 ? inked(TONE_COLOR.caution) : 'var(--ink-primary)' }}>
              {formatNumber(t.transferFailed)}
            </span>
            <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              qiziqdi, sotuvchi koʻtarmadi
            </span>
          </li>
          <li className="flex flex-col gap-1 rounded-[var(--radius-panel-sm)] border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <span className="inline-flex items-center gap-1 text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              ATS rad etdi
              <InfoTip label="ATS rad etdi — izoh" content="ATS qoʻngʻiroqni boshlamadi (503) — mijozga yetib bormagan urinish, AI keyinroq qayta uradi." />
            </span>
            <span className="text-[32px] leading-none font-semibold tabular-nums" style={{ color: 'var(--ink-primary)' }}>
              {formatNumber(t.atsRejected)}
            </span>
            <span className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
              mijozga yetmagan, qayta uriladi
            </span>
          </li>
        </ul>
      </div>
    </Card>
  )
}

/** One busy AI line: its number, the product, the state with its timer, the client, the seller it reaches. */
function LineCard({ line, at }: { readonly line: BusyLine; readonly at: Date }) {
  const product = line.product ? PRODUCT_TONE[line.product] : 'var(--border-strong)'
  const color = line.tone === 'neutral' ? 'var(--ink-primary)' : inked(TONE_COLOR[line.tone])
  return (
    <li
      aria-label={`Liniya ${line.line}`}
      className="relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-[var(--radius-panel)] border py-4 pr-4 pl-5"
      style={{
        borderColor: `color-mix(in oklab, ${product} 35%, var(--border))`,
        background: `linear-gradient(100deg, color-mix(in oklab, ${product} 12%, transparent), transparent 60%), var(--surface-raised)`,
      }}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: product }} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[30px] leading-none font-bold tabular-nums" style={{ color: 'var(--ink-primary)' }}>
            {line.line}
          </span>
          {line.product && <ProductPill product={line.product} />}
          {line.test && <Pill color={TONE_COLOR.warning}>Sinov</Pill>}
        </div>
        {line.since && (
          <span className="text-[30px] leading-none font-semibold tabular-nums sm:text-[34px]" style={{ color: 'var(--ink-primary)' }} title="Shu holatda qancha vaqtdan beri">
            {elapsedText(line.since, at)}
          </span>
        )}
      </div>
      <p className="flex items-center gap-2 text-[17px] leading-snug font-semibold" style={{ color }}>
        <StateGlyph state={line.state} size={20} />
        <span>{line.label}</span>
      </p>
      {(line.client || line.deal !== null) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
          {line.client && (
            <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
              {line.client}
            </span>
          )}
          {line.deal !== null && <DealLink deal={line.deal} />}
        </p>
      )}
      {line.seller && (
        <p className="flex items-center gap-2 text-[20px] leading-tight font-semibold" style={{ color: inked(line.state === 'with_seller' ? TONE_COLOR.good : TONE_COLOR.warning) }}>
          <ArrowRightGlyph size={20} />
          <span className="tabular-nums">{line.seller.label}</span>
        </p>
      )}
      {!line.live && (
        <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
          Mijoz va sotuvchi tafsiloti AI serveri yangilangach koʻrinadi
        </p>
      )}
    </li>
  )
}

/** Every busy line big, the free ones in one dim row, a line the ATS does not know in red. */
function LinesBoard({ board, fresh, receivedAt, now }: { readonly board: Board; readonly fresh: boolean; readonly receivedAt: string; readonly now: Date }) {
  // A stale picture keeps the moment it was taken: its timers stop there.
  const at = fresh ? now : new Date(receivedAt)
  return (
    <Panel
      title="Jonli ulanish taxtasi"
      hint={fresh ? 'Har band AI liniyasi: mijoz kim, qaysi sotuvchiga ulanyapti, qancha vaqtdan beri' : `AI xabari eskirgan — bu ${formatClock(receivedAt)} dagi holat`}
    >
      {board.busy.length === 0 ? (
        <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          {fresh ? 'Hozir band liniya yoʻq — AI navbatdagi qoʻngʻiroqni kutyapti.' : 'Oxirgi xabarda band liniya yoʻq edi.'}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3" style={{ opacity: fresh ? 1 : 0.6 }}>
          {board.busy.map((line) => (
            <LineCard key={line.line} line={line} at={at} />
          ))}
        </ul>
      )}
      {(board.free.length > 0 || board.unregistered.length > 0 || board.other.length > 0) && (
        <div className="flex flex-col gap-2 border-t pt-3 text-[15px]" style={{ borderColor: 'var(--grid)' }}>
          {board.free.length > 0 && (
            <p style={{ color: 'var(--ink-secondary)' }}>
              <span className="font-medium">Boʻsh:</span> <span className="tabular-nums">{board.free.join(' · ')}</span>
            </p>
          )}
          {board.unregistered.length > 0 && (
            <p className="flex flex-wrap items-center gap-2">
              {board.unregistered.map((line) => (
                <StatePill key={line} tone="critical">
                  {line} — ATSʼda roʻyxatda emas
                </StatePill>
              ))}
            </p>
          )}
          {board.other.length > 0 && (
            <p style={{ color: 'var(--ink-secondary)' }}>{board.other.map((o) => `${o.line}: ${o.word}`).join(' · ')}</p>
          )}
        </div>
      )}
    </Panel>
  )
}

/** The sellers in four columns by what they do now — the AI ringing one first. */
function SellersBoard({ report, fresh }: { readonly report: AiReport; readonly fresh: boolean }) {
  const groups = sellerGroups(report.sellers, fresh)
  return (
    <Panel title="Sotuvchilar" hint={fresh ? 'AI ulaydigan sotuvchilar hozir — holat boʻyicha' : 'AI xabari eskirgan — sotuvchilar holati hozir nomaʼlum'}>
      {groups.every((g) => g.sellers.length === 0) ? (
        <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          AI sotuvchilar haqida xabar bermagan.
        </p>
      ) : (
        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${groups.length > 1 ? 'xl:grid-cols-4' : ''}`}>
          {groups.map((g) => {
            const color = g.tone === 'neutral' ? 'var(--ink-muted)' : TONE_COLOR[g.tone]
            const lit = g.key === 'ringing' && g.sellers.length > 0
            return (
              <section
                key={g.key}
                aria-label={`${g.label} · ${g.sellers.length}`}
                className="flex flex-col gap-2 rounded-[var(--radius-panel-sm)] border p-3"
                style={{
                  borderColor: lit ? `color-mix(in oklab, ${color} 55%, transparent)` : 'var(--border)',
                  background: lit ? `color-mix(in oklab, ${color} 13%, transparent)` : 'transparent',
                }}
              >
                <header className="flex items-center gap-2">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                  <h3 className="text-[15px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
                    {g.label}
                  </h3>
                  <span className="ml-auto text-[24px] leading-none font-semibold tabular-nums" style={{ color: g.sellers.length > 0 && g.tone !== 'neutral' ? inked(color) : 'var(--ink-secondary)' }}>
                    {g.sellers.length}
                  </span>
                </header>
                {g.sellers.length === 0 ? (
                  <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                    yoʻq
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {g.sellers.map((s) => (
                      <li
                        key={s.ext}
                        aria-label={`Sotuvchi ${s.ext}`}
                        className="flex min-w-0 flex-col rounded-[var(--radius-panel-sm)] px-2.5 py-1.5"
                        style={{ background: 'var(--surface-sunken)' }}
                      >
                        {/* Divs, not <p>: globals.css gives every <p> `text-wrap: pretty`, which outranks `truncate`. */}
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 flex-1 truncate text-[15px]" style={{ color: 'var(--ink-primary)' }}>
                            <strong className="tabular-nums">{s.ext}</strong>
                            {s.first && <> · {s.first}</>}
                          </div>
                          {s.product && <ProductPill product={s.product} />}
                        </div>
                        <div className="truncate text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                          {s.last && <>{s.last} · </>}bugun {formatNumber(s.transfersToday)} ta ulandi
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

/** The last put-throughs, newest first: time · line · client · deal · → seller · how it ended. */
function Feed({ report, nameOf }: { readonly report: AiReport; readonly nameOf: (ext: string) => string | null }) {
  const rows = recentRows(report, nameOf)
  const today = formatNumber(report.today.transferred)
  return (
    <Panel title="Soʻnggi ulanishlar" hint="Yangisi tepada">
      {!report.live ? (
        <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          Ulanishlar lentasi AI serveri yangilangach toʻladi — bugun hozircha <strong style={{ color: 'var(--ink-primary)' }}>{today}</strong> ta ulandi.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          Lenta AI server ishga tushganidan beri yoziladi — hali yozuv yoʻq; bugun jami <strong style={{ color: 'var(--ink-primary)' }}>{today}</strong> ta ulandi.
        </p>
      ) : (
        <div className="flex flex-col">
          <div aria-hidden className="hidden gap-x-4 pb-1 text-[13px] font-medium sm:flex" style={{ color: 'var(--ink-secondary)' }}>
            <span className="w-14">Vaqt</span>
            <span className="w-14">Liniya</span>
            <span className="w-36">Mijoz</span>
            <span className="w-32">Sdelka</span>
            <span className="flex-1">Sotuvchi</span>
            <span>Natija</span>
          </div>
          <ul className="flex flex-col">
            {rows.map((r) => (
              // Two lines on a phone (who · line · client, then deal → seller · result), one row of columns from `sm`.
              <li
                key={r.key}
                className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-x-3 border-t py-2.5 text-[15px] sm:flex sm:items-center sm:gap-x-4"
                style={{ borderColor: 'var(--grid)' }}
              >
                <span className="tabular-nums sm:w-14" style={{ color: 'var(--ink-secondary)' }}>
                  {r.time}
                </span>
                <div className="flex min-w-0 flex-col gap-1 sm:contents">
                  <div className="flex min-w-0 items-center gap-3 sm:contents">
                    <span className="shrink-0 font-semibold tabular-nums sm:w-14" style={{ color: 'var(--ink-primary)' }}>
                      {r.line}
                    </span>
                    <span className="flex min-w-0 items-center gap-2 sm:w-36">
                      <span className="truncate" style={{ color: 'var(--ink-primary)' }}>
                        {r.client ?? '—'}
                      </span>
                      {r.test && <Pill color={TONE_COLOR.warning}>Sinov</Pill>}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:contents">
                    <span className="sm:w-32">{r.deal !== null ? <DealLink deal={r.deal} /> : <span style={{ color: 'var(--ink-secondary)' }}>—</span>}</span>
                    <span className="flex min-w-0 items-center gap-1.5 sm:flex-1" style={{ color: 'var(--ink-primary)' }}>
                      {r.seller ? (
                        <>
                          <ArrowRightGlyph size={15} />
                          <span className="truncate tabular-nums">{r.seller}</span>
                        </>
                      ) : (
                        <span className="hidden sm:inline" style={{ color: 'var(--ink-secondary)' }}>
                          —
                        </span>
                      )}
                    </span>
                    {r.ok ? (
                      <StatePill tone="good" dot={false}>
                        <CheckCircleGlyph size={13} /> {r.result}
                      </StatePill>
                    ) : (
                      <StatePill tone="neutral">{r.result}</StatePill>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}
