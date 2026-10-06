import type { ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { t } from '@/lib/messages'

/**
 * Loading / empty / error / unavailable.
 *
 * Four distinct states, never conflated. "No deals this month" is a fact about
 * the business; "the request failed" is a fault; "not connected" means the data
 * source does not supply this yet. Showing the same grey box for all three
 * teaches people to distrust the dashboard.
 *
 * Each terminal state sits in a `.state-well` — min-height 200px, message
 * centred where the missing number would have been — so a tile whose fetch
 * failed keeps short-card height and the grid rhythm holds. And each carries
 * its own small illustration, drawn from the chrome tokens (`--track`,
 * `--grid` — never a series colour: an illustration is furniture, not data).
 * Three DIFFERENT silhouettes on purpose: ghost bars, a broken line, a
 * dashed socket — recognisable from across the room, before a word is read.
 */

export type ViewStatus = 'loading' | 'error' | 'ready'

/**
 * Which of the three a block draws for its query: a skeleton, the error card
 * or the figures — the rule below, stated once. (A few blocks that already
 * had it right spell it inline as `isError && !data`; same answer.)
 *
 * THE ERROR CARD IS FOR HAVING NOTHING TO SHOW. TanStack Query 5 keeps the
 * last good `data` when a refetch fails and still reports `isError`, so a
 * block that read `isError` alone threw away figures it was holding: two
 * misses in a row on the 120 s poll (`retry: 1` in `providers.tsx`) — a
 * deploy restart, one statement timeout on a busy database — and the TV
 * board, Logistika or «Lid manbalari» sat behind «Qayta urinish» until the
 * next good poll, with every number still in memory. A failed BACKGROUND
 * refetch keeps the screen; the next good poll replaces it.
 *
 * A first read that fails still gets the card, and so does a new period
 * whose read fails: placeholder data covers only a query that is still
 * pending, so after the failure there is no `data` to keep.
 */
export function statusOf(query: {
  readonly isPending: boolean
  readonly isError: boolean
  readonly data: unknown
}): ViewStatus {
  if (query.isPending) return 'loading'
  return query.isError && query.data === undefined ? 'error' : 'ready'
}

export function LoadingSkeleton({ rows = 3, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-label={t.state.loading}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton h-4"
          style={{ width: `${100 - i * 12}%` }}
        />
      ))}
      <span className="sr-only">{t.state.loading}</span>
    </div>
  )
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="skeleton w-full" style={{ height }} role="status" aria-label={t.state.loading}>
      <span className="sr-only">{t.state.loading}</span>
    </div>
  )
}

/**
 * Empty: a bar chart with nothing to say. Ghost bars in `--track` over a
 * `--grid` baseline — the silhouette of the data that is not there, which is
 * exactly the claim an empty state makes.
 */
function EmptyIllustration() {
  return (
    <svg width="72" height="40" viewBox="0 0 72 40" fill="none" aria-hidden="true">
      <rect x="8" y="20" width="8" height="15" rx="2" fill="var(--track)" />
      <rect x="21" y="12" width="8" height="23" rx="2" fill="var(--track)" />
      <rect x="34" y="25" width="8" height="10" rx="2" fill="var(--track)" />
      <rect x="47" y="17" width="8" height="18" rx="2" fill="var(--track)" />
      <rect x="60" y="28" width="8" height="7" rx="2" fill="var(--track)" />
      <path d="M4 37h64" stroke="var(--grid)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Error: a trend line that breaks mid-flight. The line itself stays in
 * `--track` — the fault mark alone wears `--status-critical`, and never
 * carries the meaning by colour alone: the words below it state the fault.
 */
function ErrorIllustration() {
  return (
    <svg width="72" height="40" viewBox="0 0 72 40" fill="none" aria-hidden="true">
      <path
        d="M4 30L16 22l10 4 4-3"
        stroke="var(--track)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M44 21l10 3 14-14"
        stroke="var(--track)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M33 16l6 8M39 16l-6 8"
        stroke="var(--status-critical)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function EmptyState({
  title,
  body,
  hint,
}: {
  title?: string
  body?: string
  /** One-line suggestion of what to DO about it ("Davrni kengaytiring"). */
  hint?: ReactNode
}) {
  return (
    // role="status": the panel replaces content, politely — never an alert.
    <div className="state-well gap-1.5 px-6 py-8" role="status">
      <EmptyIllustration />
      <p className="mt-1 text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>
        {title ?? t.state.emptyTitle}
      </p>
      <p className="max-w-xs text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {body ?? t.state.emptyBody}
      </p>
      {hint && (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    // role="status", not "alert": a dashboard can fail many tiles at once,
    // and a chorus of assertive announcements would drown the one that
    // matters. The visible word and the retry affordance carry the urgency.
    <div className="state-well gap-1.5 px-6 py-8" role="status">
      <ErrorIllustration />
      <p className="mt-1 text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>
        {t.state.errorTitle}
      </p>
      <p className="max-w-sm text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {message ?? t.state.errorBody}
      </p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-1.5" onClick={onRetry}>
          {t.state.retry}
        </Button>
      )}
    </div>
  )
}
