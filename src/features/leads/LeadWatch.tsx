'use client'

import dynamic from 'next/dynamic'
import { useState, type ReactNode } from 'react'

import { ChartSkeleton, statusOf } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import {
  ChatGlyph,
  CheckCircleGlyph,
  ChevronGlyph,
  DotGlyph,
  FolderXGlyph,
  HourglassGlyph,
  PauseCircleGlyph,
  PhoneXGlyph,
  RingGlyph,
  ScaleGlyph,
  SquareGlyph,
  TriangleGlyph,
  UserXGlyph,
  type GlyphProps,
} from '@/components/ui/Icons'
import { formatNumber } from '@/lib/format'
import { LEAD_WATCH_SETTINGS } from '@/lib/leadWatchSettings'
import { t } from '@/lib/messages'
import { useMinuteNow } from '@/lib/useMinuteNow'

import type { LeadWatchDto, LeadWatchIssueDto, WatchIssueKind } from './leadWatchApi'
import { LeadWatchDrawer } from './LeadWatchDrawer'
import {
  TONE_COLOR,
  WATCH_KINDS,
  WATCH_TITLE,
  freshnessOf,
  isOpenable,
  issueSubline,
  orderIssues,
  toneOf,
  verdictOf,
  type WatchTone,
} from './leadWatchLogic'
import { useLeadWatch } from './leadWatchQueries'

/**
 * «Лид назорати» — what is going wrong with leads RIGHT NOW, at the top of
 * «Lid manbalari»: seven problems as cards, the worst first, each opening the
 * list behind it, and today's arrivals hour by hour underneath.
 *
 * ITS OWN REQUEST, ITS OWN FAILURE. The block asks `/leads/watch` on its own
 * clock and draws its own error line, so it cannot take the page's figures
 * down and the page cannot take it down.
 *
 * ALWAYS TODAY, ALWAYS THE WHOLE COMPANY. The period control and the brand
 * switch above it do not reach it — a stuck lead is stuck whatever window the
 * reader is studying — and the caption says so, because a block that ignores
 * the filters beside it without saying so reads as a bug.
 *
 * Recharts is behind `next/dynamic` like every chart in the product
 * (`cohortChartChunk.test.ts` says why).
 */

const CHART_HEIGHT = 180

const LeadFlowChart = dynamic(() => import('./LeadFlowChart').then((m) => m.LeadFlowChart), {
  ssr: false,
  loading: () => <ChartSkeleton height={CHART_HEIGHT + 24} />,
})

const ICON: Readonly<Record<WatchIssueKind, (props: GlyphProps) => ReactNode>> = {
  unassigned: UserXGlyph,
  idle: HourglassGlyph,
  chats: ChatGlyph,
  missedCalls: PhoneXGlyph,
  channelStop: PauseCircleGlyph,
  uneven: ScaleGlyph,
  noProject: FolderXGlyph,
}

/** The house's state marks: a dot is good, a triangle warns, a square is critical — a shape as well as a colour. */
const TONE_GLYPH: Readonly<Record<WatchTone, (props: GlyphProps) => ReactNode>> = {
  good: DotGlyph,
  warning: TriangleGlyph,
  critical: SquareGlyph,
}

const muted = { color: 'var(--ink-muted)' } as const
const everyMinutes = Math.round(LEAD_WATCH_SETTINGS.refreshEveryMs / 60_000)

export function LeadWatch({ enabled = true }: { enabled?: boolean }) {
  const query = useLeadWatch(enabled)
  const now = useMinuteNow()
  const [openKind, setOpenKind] = useState<WatchIssueKind | null>(null)

  const status = statusOf(query)
  const dto = query.data?.data

  return (
    <section aria-labelledby="lead-watch-title" className="flex min-w-0 flex-col gap-3">
      <Header dto={status === 'ready' ? dto : undefined} now={now} failing={query.isError} loading={status === 'loading'} />

      {status === 'loading' ? (
        <WatchSkeleton />
      ) : status === 'error' || dto === undefined ? (
        <WatchError
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <WatchBody dto={dto} now={now} openKind={openKind} onOpen={setOpenKind} />
      )}
    </section>
  )
}

// --- header -----------------------------------------------------------------

function Header({
  dto,
  now,
  failing,
  loading,
}: {
  dto: LeadWatchDto | undefined
  now: number
  failing: boolean
  loading: boolean
}) {
  const freshness = dto ? freshnessOf(dto, now, failing) : null
  const verdict = dto ? verdictOf(dto.issues) : null
  const VerdictGlyph = verdict ? TONE_GLYPH[verdict.tone] : null

  return (
    <header className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2
          id="lead-watch-title"
          className="text-[15px] font-semibold tracking-tight"
          style={{ color: 'var(--ink-primary)' }}
        >
          Лид назорати
        </h2>

        {loading ? (
          <span className="skeleton h-4 w-40" aria-hidden="true" />
        ) : (
          // Polite: a screen reader hears «Yangilanmayapti» when it becomes true, not every minute's tick.
          <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            <span
              className="inline-flex"
              style={{ color: freshness?.live ? 'var(--status-good)' : 'var(--ink-muted)' }}
            >
              {freshness?.live ? <DotGlyph size={10} /> : <RingGlyph size={10} />}
            </span>
            <span className="tabular">{freshness?.label ?? 'Yangilanmayapti'}</span>
          </span>
        )}

        {loading ? (
          <span className="skeleton ml-auto h-6 w-36 rounded-full" aria-hidden="true" />
        ) : (
          verdict &&
          VerdictGlyph && (
            <span
              role="status"
              className="tabular ml-auto inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold"
              style={{
                // Mixed into the glass card, not into nothing: a veil of the status over the
                // lit page left its own label at 3.98:1 (leadWatchContrast.test.ts).
                background: `color-mix(in oklab, ${TONE_COLOR[verdict.tone]} 12%, var(--glass-card))`,
                color: TONE_COLOR[verdict.tone],
              }}
            >
              <VerdictGlyph size={10} />
              {verdict.label}
            </span>
          )
        )}
      </div>
      <p className="text-[11px]" style={muted}>
        Bugun, butun kompaniya boʻyicha — yuqoridagi davr va brend filtri bu blokka taʼsir qilmaydi. Har {everyMinutes}{' '}
        daqiqada yangilanadi.
      </p>
    </header>
  )
}

// --- the ready body ---------------------------------------------------------

function WatchBody({
  dto,
  now,
  openKind,
  onOpen,
}: {
  dto: LeadWatchDto
  now: number
  openKind: WatchIssueKind | null
  onOpen: (kind: WatchIssueKind | null) => void
}) {
  const issues = orderIssues(dto.issues)
  const open = openKind === null ? undefined : issues.find((issue) => issue.kind === openKind)

  return (
    <>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {issues.map((issue) => (
          <li key={issue.kind} className="flex min-w-0">
            <IssueCard issue={issue} now={now} expanded={openKind === issue.kind} onOpen={() => onOpen(issue.kind)} />
          </li>
        ))}
      </ul>

      <Card className="px-4 pt-3.5 pb-4 sm:px-5">
        <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            Bugungi lead oqimi
          </h3>
          <p className="text-[11px]" style={muted}>
            Soatma-soat, Toshkent vaqti
          </p>
        </div>
        <LeadFlowChart flow={dto.flow} height={CHART_HEIGHT} />
      </Card>

      {open && (
        // Keyed by problem: a different card opens on «Hammasi» and its first fifty rows.
        <LeadWatchDrawer key={open.kind} issue={open} now={now} onClose={() => onOpen(null)} />
      )}
    </>
  )
}

/** Tall enough for the tallest state, so a card changing state never moves its neighbours. */
const CARD_BOX = 'w-full min-h-[112px] flex-col px-4 py-3.5 text-left'

function IssueCard({
  issue,
  now,
  expanded,
  onOpen,
}: {
  issue: LeadWatchIssueDto
  now: number
  expanded: boolean
  onOpen: () => void
}) {
  const Icon = ICON[issue.kind]
  const tone = toneOf(issue.severity)
  const calm = issue.severity === 'ok'
  const openable = isOpenable(issue)
  const subline = calm
    ? issue.count > 0
      ? `${formatNumber(issue.count)} ta kuzatuvda — hali meʼyorda`
      : 'muammo yoʻq'
    : issueSubline(issue, now)

  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className="inline-flex shrink-0" style={{ color: calm ? 'var(--ink-muted)' : TONE_COLOR[tone] }}>
          <Icon />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium"
          style={{ color: calm ? 'var(--ink-muted)' : 'var(--ink-secondary)' }}
        >
          {WATCH_TITLE[issue.kind]}
        </span>
        {openable && (
          <span className="inline-flex shrink-0" style={muted}>
            <ChevronGlyph direction="right" size={12} />
          </span>
        )}
      </span>

      {calm ? (
        <span
          className="mt-2.5 flex h-8 items-center gap-1.5 text-[15px] font-semibold"
          style={{ color: 'var(--status-good)' }}
        >
          <CheckCircleGlyph size={16} />
          Joyida
        </span>
      ) : (
        // 32px, tabular, on a line of its own height: a count that changes width or state never reflows the card.
        <span
          className="figure mt-2.5 block h-8 min-w-[2ch] text-[32px] leading-8 font-semibold"
          style={{ color: 'var(--ink-primary)' }}
        >
          <AnimatedNumber value={issue.count} format={formatNumber} duration={300} />
        </span>
      )}

      {/* Secondary ink, not muted: under the pointer's wash muted read 4.19:1 on a dark amber card. */}
      <span
        className="tabular mt-1.5 line-clamp-2 block text-[11.5px] leading-snug"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {subline ?? ' '}
      </span>
    </>
  )

  const className = `card watch-card watch-card--${tone} ${CARD_BOX}`
  if (!openable) {
    return (
      <div className={`${className} flex`} data-severity={issue.severity}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      data-severity={issue.severity}
      className={`focusable ${className} flex cursor-pointer`}
    >
      {body}
    </button>
  )
}

// --- loading and failure ----------------------------------------------------

function WatchSkeleton() {
  return (
    <div role="status" aria-label={t.state.loading} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {WATCH_KINDS.map((kind) => (
          <div key={kind} className={`card flex ${CARD_BOX}`}>
            <div className="skeleton h-[18px] w-3/5" />
            <div className="skeleton mt-2.5 h-8 w-16" />
            <div className="skeleton mt-2.5 h-3 w-4/5" />
          </div>
        ))}
      </div>
      <Card className="px-4 pt-3.5 pb-4 sm:px-5">
        <div className="skeleton mb-3 h-4 w-44" />
        <div className="skeleton w-full" style={{ height: CHART_HEIGHT + 24 }} />
      </Card>
      <span className="sr-only">{t.state.loading}</span>
    </div>
  )
}

/**
 * Compact on purpose: the block sits above the page's own figures, and a
 * 200px error well there would push them off the first screen to say one
 * sentence.
 */
function WatchError({ message, onRetry, retrying }: { message?: string; onRetry: () => void; retrying: boolean }) {
  return (
    <Card as="div" className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div role="status" className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 inline-flex shrink-0" style={{ color: 'var(--status-critical)' }}>
          <SquareGlyph size={12} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>
            Lid nazorati maʼlumotini yuklab boʻlmadi
          </p>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {message ?? t.state.errorBody} Sahifaning qolgan qismi ishlayapti.
          </p>
        </div>
      </div>
      <Button variant="secondary" className="h-11 sm:h-8" onClick={onRetry} disabled={retrying}>
        {t.state.retry}
      </Button>
    </Card>
  )
}
