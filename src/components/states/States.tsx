import { t } from '@/lib/messages'

/**
 * Loading / empty / error / unavailable.
 *
 * Four distinct states, never conflated. "No deals this month" is a fact about
 * the business; "the request failed" is a fault; "not connected" means the data
 * source does not supply this yet. Showing the same grey box for all three
 * teaches people to distrust the dashboard.
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

export function EmptyState({ title, body }: { title?: string; body?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="var(--ink-muted)" strokeWidth="1.5" />
        <path d="M3 10h18" stroke="var(--ink-muted)" strokeWidth="1.5" />
      </svg>
      <p className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>
        {title ?? t.state.emptyTitle}
      </p>
      <p className="max-w-xs text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {body ?? t.state.emptyBody}
      </p>
    </div>
  )
}

export function ErrorState({
  message,
  correlationId,
  onRetry,
}: {
  message?: string
  correlationId?: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {/* Icon + label, never colour alone. */}
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="var(--status-critical)" strokeWidth="1.5" />
        <path d="M12 7v6" stroke="var(--status-critical)" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="12" cy="16.5" r="1" fill="var(--status-critical)" />
      </svg>
      <p className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>
        {t.state.errorTitle}
      </p>
      <p className="max-w-sm text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {message ?? t.state.errorBody}
      </p>
      {correlationId && (
        <p className="tabular text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          ID: {correlationId}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
        >
          {t.state.retry}
        </button>
      )}
    </div>
  )
}

/** The data source does not supply this entity. Not an error, not a zero. */
export function UnavailableState({ hint }: { hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
      <span
        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
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
