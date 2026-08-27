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

/**
 * Unavailable: a socket nothing is plugged into — a dashed outline where a
 * panel would be. Deliberately the calmest of the three: not a fault, not an
 * absence of business, just a source that is not wired up yet.
 */
function UnavailableIllustration() {
  return (
    <svg width="72" height="40" viewBox="0 0 72 40" fill="none" aria-hidden="true">
      <rect
        x="15"
        y="8"
        width="42"
        height="24"
        rx="6"
        stroke="var(--track)"
        strokeWidth="2"
        strokeDasharray="5 4"
      />
      <circle cx="36" cy="20" r="3" fill="var(--grid)" />
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
  correlationId,
  hint,
  onRetry,
}: {
  message?: string
  correlationId?: string
  /** One-line suggestion beyond retrying, when the caller knows one. */
  hint?: ReactNode
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
      {hint && (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}
      {correlationId && (
        <p className="tabular text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          ID: {correlationId}
        </p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-1.5" onClick={onRetry}>
          {t.state.retry}
        </Button>
      )}
    </div>
  )
}

/** The data source does not supply this entity. Not an error, not a zero. */
export function UnavailableState({ hint }: { hint?: string }) {
  return (
    <div className="state-well gap-1.5 px-6 py-8" role="status">
      <UnavailableIllustration />
      <span
        className="mt-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
        style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
      >
        {t.state.unavailable}
      </span>
      <p className="max-w-xs text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {hint ?? t.state.unavailableHint}
      </p>
    </div>
  )
}
