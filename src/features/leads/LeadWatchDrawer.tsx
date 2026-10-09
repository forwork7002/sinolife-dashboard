'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '@/components/ui/Button'
import { ArrowUpRightGlyph, MultiplyGlyph } from '@/components/ui/Icons'
import { bitrixDealUrl } from '@/features/target/targetApi'
import { PRODUCT_TONE } from '@/features/target/targetTheme'
import { NO_VALUE, formatNumber } from '@/lib/format'
import { LEAD_CHANNELS } from '@/lib/leadChannels'

import type { LeadWatchIssueDto, LeadWatchRowDto, WatchIssueKind } from './leadWatchApi'
import {
  ROWS_PER_PAGE,
  TONE_COLOR,
  WATCH_TITLE,
  channelChips,
  filterRows,
  formatWait,
  issueSubline,
  minutesSince,
  nextPageSize,
  toneOf,
  waitTone,
  type ChannelFilter,
} from './leadWatchLogic'

/**
 * The list behind a problem card — who is waiting, where, on whom, for how
 * long, and the way to the deal in Bitrix24.
 *
 * A MODAL, AND IT BEHAVES LIKE ONE: focus moves in and cannot Tab out, Escape
 * and a press on the scrim close it, the page under it does not scroll, and
 * focus goes back to the card that opened it. The house has no drawer
 * primitive to reuse — the phone menu is chrome and the department panel
 * deliberately does not trap — so the discipline is the command palette's,
 * restated for a panel on the right.
 *
 * OPAQUE, because it carries a table («Data never sits on glass»), over the
 * page-tinted scrim every modal uses.
 *
 * ONE CLOCK: `now` comes from the block's single minute ticker, so fifty
 * timers re-render together and none owns an interval.
 *
 * RESERVED, NOT BUILT: the leading column is an empty slot the width of a
 * checkbox and the footer holds a hidden bar — where selecting rows and
 * handing them to a ROP will go. Nothing in either yet, on purpose.
 */

const DESK = '(min-width: 640px)'

function useDesk(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(DESK)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => window.matchMedia(DESK).matches,
    () => true,
  )
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function LeadWatchDrawer({
  issue,
  now,
  onClose,
}: {
  issue: LeadWatchIssueDto
  now: number
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const desk = useDesk()
  const [filter, setFilter] = useState<ChannelFilter>('all')
  const [shown, setShown] = useState(ROWS_PER_PAGE)

  // Focus in on open, back to the card on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previous?.focus()
  }, [])

  // The page under a modal does not scroll.
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

  const chips = channelChips(issue)
  // A refresh can empty the chosen channel under the reader: fall back rather than show nothing.
  const active = chips.find((chip) => chip.value === filter && !chip.disabled)?.value ?? 'all'
  const rows = filterRows(issue.rows, active)
  const visible = rows.slice(0, shown)
  const more = nextPageSize(rows.length, shown)
  const unlisted = issue.count - issue.rows.length
  const tone = TONE_COLOR[toneOf(issue.severity)]
  const subline = issueSubline(issue, now)

  return createPortal(
    <div
      className="backdrop-dim drawer-backdrop-enter fixed inset-0 z-50 flex justify-end"
      // mousedown, not click: a drag that starts on a row and ends on the scrim must not close it.
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
        className="watch-drawer watch-drawer-enter flex h-dvh w-full flex-col outline-none sm:w-[580px] sm:max-w-[92vw]"
      >
        <header
          className="shrink-0 border-b px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-5 sm:pt-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2
                  id={titleId}
                  className="text-base font-semibold tracking-tight"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {WATCH_TITLE[issue.kind]}
                </h2>
                <span
                  className="tabular inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold"
                  style={{ background: `color-mix(in oklab, ${tone} 12%, transparent)`, color: tone }}
                >
                  {formatNumber(issue.count)} ta
                </span>
              </div>
              {subline && (
                <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {subline}
                </p>
              )}
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

          <div role="group" aria-label="Kanal boʻyicha" className="mt-3 flex flex-wrap gap-1.5">
            {chips.map((chip) => {
              const pressed = chip.value === active
              return (
                <button
                  key={chip.value}
                  type="button"
                  disabled={chip.disabled}
                  aria-pressed={pressed}
                  onClick={() => {
                    setFilter(chip.value)
                    setShown(ROWS_PER_PAGE)
                  }}
                  className={`focusable inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-panel-sm)] border px-3 text-[13px] font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-45 sm:h-8 sm:px-2.5 sm:text-xs ${
                    pressed ? 'shadow-[var(--glass-highlight)]' : 'hover:bg-[var(--glass-hover)]'
                  }`}
                  style={{
                    background: pressed ? 'var(--glass-raised)' : undefined,
                    borderColor: pressed ? 'var(--border-strong)' : 'var(--border)',
                    color: pressed ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                  }}
                >
                  {chip.value !== 'all' && (
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: LEAD_CHANNELS[chip.value].color }}
                    />
                  )}
                  {chip.label}
                  <span className="tabular" style={{ color: 'var(--ink-muted)' }}>
                    {formatNumber(chip.count)}
                  </span>
                </button>
              )
            })}
          </div>

          {unlisted > 0 && (
            <p className="mt-2 text-[11.5px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
              Jami {formatNumber(issue.count)} ta — eng uzoq kutayotgan {formatNumber(issue.rows.length)} tasi
              roʻyxatda, qolgan {formatNumber(unlisted)} tasi koʻrsatilmagan.
            </p>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {visible.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm" style={{ color: 'var(--ink-secondary)' }}>
              Hozir bu roʻyxat boʻsh.
            </p>
          ) : desk ? (
            <RowTable rows={visible} kind={issue.kind} now={now} />
          ) : (
            <RowCards rows={visible} kind={issue.kind} now={now} />
          )}

          {more > 0 && (
            <div className="px-4 py-3 sm:px-5">
              <Button
                variant="secondary"
                className="h-11 w-full sm:h-8"
                onClick={() => setShown((count) => count + ROWS_PER_PAGE)}
              >
                Yana {more} ta
              </Button>
              <p className="tabular mt-1.5 text-center text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {formatNumber(visible.length)} / {formatNumber(rows.length)}
              </p>
            </div>
          )}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>

        {/* Reserved: the bar bulk actions (handing rows to a ROP) will live in. Empty and out of the tree until then. */}
        <footer data-slot="bulk-actions" hidden aria-hidden="true" />
      </div>
    </div>,
    document.body,
  )
}

// --- cells ------------------------------------------------------------------

function ChannelPill({ row }: { row: LeadWatchRowDto }) {
  if (row.channel === null && row.brand === null) return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
  const spec = row.channel === null ? null : LEAD_CHANNELS[row.channel]
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      {spec && (
        <span
          className="inline-flex h-[22px] min-w-0 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-medium whitespace-nowrap"
          style={{ background: spec.wash, color: spec.text }}
        >
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: spec.color }} />
          {spec.label}
        </span>
      )}
      {row.brand && (
        // The brand switch's own mark: a small square in the product's colour, named for a reader who cannot see it.
        <span
          role="img"
          aria-label={row.brand}
          title={row.brand}
          className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
          style={{ background: PRODUCT_TONE[row.brand] }}
        />
      )}
    </span>
  )
}

function Owner({ row }: { row: LeadWatchRowDto }) {
  if (row.owner === null && row.rop === null) return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
  return (
    <>
      {row.owner && (
        <span className="block break-words" style={{ color: 'var(--ink-primary)' }}>
          {row.owner}
        </span>
      )}
      {row.rop && (
        <span className="block text-[11.5px] break-words" style={{ color: 'var(--ink-muted)' }}>
          ROP: {row.rop}
        </span>
      )}
    </>
  )
}

const WAIT_COLOR = {
  normal: 'var(--ink-primary)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
} as const

function Wait({ since, kind, now }: { since: string | null; kind: WatchIssueKind; now: number }) {
  const minutes = minutesSince(since, now)
  if (minutes === null) return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
  const tone = waitTone(minutes, kind)
  return (
    <span
      className={`tabular whitespace-nowrap ${tone === 'critical' ? 'font-semibold' : tone === 'warning' ? 'font-medium' : ''}`}
      style={{ color: WAIT_COLOR[tone] }}
    >
      {formatWait(minutes)}
    </span>
  )
}

function OpenLink({ row, touch = false }: { row: LeadWatchRowDto; touch?: boolean }) {
  if (row.dealId === null) return null
  return (
    <a
      href={bitrixDealUrl(row.dealId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${row.title} — Bitrix24 da ochish (yangi oynada)`}
      className={`focusable inline-flex items-center justify-center gap-1 rounded-[var(--radius-panel-sm)] font-medium whitespace-nowrap text-[var(--accent-ink)] transition-colors hover:bg-[var(--glass-hover)] ${
        touch ? 'h-11 min-w-11 px-3 text-[13px]' : 'h-7 px-2 text-xs'
      }`}
    >
      Ochish
      <ArrowUpRightGlyph size={12} />
    </a>
  )
}

function Customer({ row }: { row: LeadWatchRowDto }) {
  return (
    <>
      <span className="block font-medium break-words" style={{ color: 'var(--ink-primary)' }}>
        {row.title}
      </span>
      {row.note && (
        <span className="mt-0.5 block text-[11.5px] leading-snug break-words" style={{ color: 'var(--ink-muted)' }}>
          {row.note}
        </span>
      )}
    </>
  )
}

interface RowsProps {
  readonly rows: readonly LeadWatchRowDto[]
  readonly kind: WatchIssueKind
  readonly now: number
}

const TH = 'eyebrow px-2 py-2 text-left font-semibold'

function RowTable({ rows, kind, now }: RowsProps) {
  return (
    <table className="w-full table-fixed border-collapse text-[13px]">
      <colgroup>
        {/* Reserved for a per-row checkbox. */}
        <col className="w-5" />
        <col />
        {/* «Входящий» and the brand mark beside it, with air between them. */}
        <col className="w-[126px]" />
        <col className="w-[104px]" />
        {/* «23 soat 59 daq» in tabular figures, on one line. */}
        <col className="w-[116px]" />
        <col className="w-[80px]" />
      </colgroup>
      <thead className="sticky top-0 z-10" style={{ background: 'var(--surface-sunken)' }}>
        <tr>
          <td aria-hidden="true" />
          <th scope="col" className={TH}>
            Mijoz
          </th>
          <th scope="col" className={TH}>
            Kanal
          </th>
          <th scope="col" className={TH}>
            Kimda
          </th>
          <th scope="col" className={`${TH} text-right`}>
            Kutyapti
          </th>
          <th scope="col" className={`${TH} pr-4 text-right`}>
            Bitrix
          </th>
        </tr>
      </thead>
      <tbody className="divide-rows">
        {rows.map((row) => (
          <tr key={row.key} className="align-top">
            <td aria-hidden="true" />
            <td className="px-2 py-2.5">
              <Customer row={row} />
            </td>
            <td className="px-2 py-2.5">
              <ChannelPill row={row} />
            </td>
            <td className="px-2 py-2.5">
              <Owner row={row} />
            </td>
            <td className="px-2 py-2.5 text-right">
              <Wait since={row.since} kind={kind} now={now} />
            </td>
            <td className="py-1.5 pr-3 pl-1 text-right">
              <OpenLink row={row} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The same five facts, stacked: a phone has no room for five columns and must not scroll sideways. */
function RowCards({ rows, kind, now }: RowsProps) {
  return (
    <ul className="divide-rows">
      {rows.map((row) => (
        <li key={row.key} className="flex gap-2 py-3 pr-2 pl-2 text-[13.5px]">
          {/* Reserved for a per-row checkbox. */}
          <span aria-hidden="true" className="w-2 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Customer row={row} />
              </div>
              <span className="shrink-0 text-right">
                <span className="sr-only">Kutyapti: </span>
                <Wait since={row.since} kind={kind} now={now} />
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px]">
                <ChannelPill row={row} />
                <span className="min-w-0">
                  <Owner row={row} />
                </span>
              </div>
              <OpenLink row={row} touch />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
