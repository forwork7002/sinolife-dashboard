'use client'

import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { MultiplyGlyph } from '@/components/ui/Icons'
import type { MoneyDto, PayrollLateDayDto, PayrollLateSkip, PayrollSellerDto } from '@/lib/api'
import { formatFullUzs, formatNumber } from '@/lib/format'

/**
 * THE LATENESS FINE'S PROOF (the owner, 2026-11-05: «sen shu vaqtda
 * kelgansan, shuncha jarima bo'lgan, shu kunlar deb turishi kerak»). A press
 * on a seller's «Kechikish» opens every day TimePay called them late: the
 * day, the shift start, the FaceID arrival, the minutes and the soʻm — and,
 * struck through with the reason, the late days the rule did not fine. The
 * figures are the server's (`lateDays`); only minutes × the rate is done here.
 */

const LateProofContext = createContext<((row: PayrollSellerDto) => void) | null>(null)

/** Wraps a payroll table: its «Kechikish» cells open the proof through this. */
export function LateProofProvider({ perMinute, children }: { perMinute: MoneyDto; children: ReactNode }) {
  const [row, setRow] = useState<PayrollSellerDto | null>(null)
  const open = useCallback((next: PayrollSellerDto) => setRow(next), [])
  return (
    <LateProofContext.Provider value={open}>
      {children}
      {row && <LateDrawer row={row} perMinute={perMinute} onClose={() => setRow(null)} />}
    </LateProofContext.Provider>
  )
}

/** The opener, or null outside a provider (a cell then prints without a button). */
export function useLateProof(): ((row: PayrollSellerDto) => void) | null {
  return useContext(LateProofContext)
}

const WEEKDAY = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'] as const

/** «02.11 · Du» */
function dayLabel(day: string): string {
  const [, m, d] = day.split('-')
  return `${d}.${m} · ${WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()]}`
}

const SKIP_TEXT: Record<PayrollLateSkip, string> = {
  sunday: 'yakshanba — ish kuni emas',
  holiday: 'bayram',
  leave: 'taʼtil',
  no_mark: 'kelish belgisi yoʻq',
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

function LateDrawer({ row, perMinute, onClose }: { row: PayrollSellerDto; perMinute: MoneyDto; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const fined = row.lateDays.filter((d) => d.skipped === null)
  const skipped = row.lateDays.filter((d) => d.skipped !== null)

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

  const som = (minutes: number) => formatFullUzs(minutes * perMinute.amount)
  const head = 'border-b px-3 py-2 text-[11px] font-semibold'
  const cell = 'border-b px-3 py-2 tabular whitespace-nowrap'
  const rule = { borderColor: 'var(--border)' }

  return createPortal(
    <div
      className="backdrop-dim drawer-backdrop-enter fixed inset-0 z-50 flex justify-end"
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
        className="watch-drawer watch-drawer-enter flex h-dvh w-full flex-col outline-none sm:w-[600px] sm:max-w-[94vw]"
      >
        <header className="shrink-0 border-b px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-5 sm:pt-4" style={rule}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-base font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
                Kechikish · {row.fullName}
              </h2>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                TimePay (FaceID) maʼlumoti · har kechikkan daqiqa {formatFullUzs(perMinute.amount)} soʻm · faqat ish kunlari
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
          <p className="mt-3 text-[13px]" style={{ color: 'var(--ink-primary)' }}>
            <b>{formatNumber(fined.length)}</b> kun kechikkan · jami <b>{formatNumber(row.lateMinutes ?? 0)}</b> daqiqa · jarima{' '}
            <b style={{ color: 'var(--delta-down)' }}>−{formatFullUzs(row.lateFine.amount)} soʻm</b>
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3 text-[12.5px] sm:px-3">
          {row.lateDays.length === 0 ? (
            <p className="px-3 py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
              Bu davrda kechikish yoʻq.
            </p>
          ) : (
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr style={{ color: 'var(--ink-muted)' }}>
                  <th scope="col" className={`${head} text-left`} style={rule}>
                    Kun
                  </th>
                  <th scope="col" className={`${head} text-right`} style={rule}>
                    Kelishi kerak edi
                  </th>
                  <th scope="col" className={`${head} text-right`} style={rule}>
                    Keldi
                  </th>
                  <th scope="col" className={`${head} text-right`} style={rule}>
                    Kechikdi
                  </th>
                  <th scope="col" className={`${head} text-right`} style={rule}>
                    Jarima
                  </th>
                </tr>
              </thead>
              <tbody>
                {row.lateDays.map((d) => (
                  <DayRow key={d.day} day={d} som={som} cell={cell} rule={rule} />
                ))}
              </tbody>
              <tfoot>
                <tr style={{ color: 'var(--ink-primary)' }}>
                  <th scope="row" colSpan={3} className="px-3 py-2 text-left font-semibold">
                    Jami
                  </th>
                  <td className="tabular px-3 py-2 text-right font-semibold">{formatNumber(row.lateMinutes ?? 0)} daq</td>
                  <td className="tabular px-3 py-2 text-right font-semibold" style={{ color: 'var(--delta-down)' }}>
                    −{formatFullUzs(row.lateFine.amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
          {skipped.length > 0 && (
            <p className="px-3 pt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Chizilgan kunlar jarimaga kirmaydi — sababi yonida.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function DayRow({
  day: d,
  som,
  cell,
  rule,
}: {
  day: PayrollLateDayDto
  som: (minutes: number) => string
  cell: string
  rule: { borderColor: string }
}) {
  const off = d.skipped !== null
  const ink = off ? 'var(--ink-muted)' : 'var(--ink-primary)'
  return (
    <tr style={{ color: ink }}>
      <td className={`${cell} text-left`} style={rule}>
        {dayLabel(d.day)}
        {off && (
          <span className="block text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
            {SKIP_TEXT[d.skipped!]}
          </span>
        )}
      </td>
      <td className={`${cell} text-right`} style={rule}>
        {d.shiftStart ?? '—'}
      </td>
      <td className={`${cell} text-right font-semibold`} style={rule}>
        {d.checkIn}
      </td>
      <td className={`${cell} text-right`} style={{ ...rule, textDecoration: off ? 'line-through' : undefined }}>
        {formatNumber(d.minutes)} daq
      </td>
      <td className={`${cell} text-right`} style={{ ...rule, color: off ? 'var(--ink-muted)' : 'var(--delta-down)', textDecoration: off ? 'line-through' : undefined }}>
        {off ? '0' : `−${som(d.minutes)}`}
      </td>
    </tr>
  )
}

/** A seller's «Kechikish» as a press that opens the proof — or the bare figure outside a provider. */
export function LateButton({ row, children }: { row: PayrollSellerDto; children: ReactNode }) {
  const open = useLateProof()
  if (!open || row.lateDays.length === 0) return <>{children}</>
  return (
    <button
      type="button"
      onClick={() => open(row)}
      title="Kunlar boʻyicha: qachon kelishi kerak edi, qachon keldi, necha daqiqa"
      className="focusable -my-1 -mr-1 cursor-pointer rounded-[var(--radius-panel-sm)] px-1 py-1 text-right underline decoration-dotted underline-offset-2 hover:bg-[var(--glass-hover)]"
    >
      {children}
    </button>
  )
}

/** «02.11 08:46 (16 daq); 03.11 08:35 (5 daq)» — the fined days, for the exports. */
export function lateDaysText(row: PayrollSellerDto): string {
  return row.lateDays
    .filter((d) => d.skipped === null)
    .map((d) => `${d.day.slice(8, 10)}.${d.day.slice(5, 7)} ${d.checkIn} (${d.minutes} daq)`)
    .join('; ')
}
