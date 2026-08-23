'use client'

import { useEffect, useId, useRef, useState } from 'react'

import { formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

/** Debounced search box. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Qidirish…',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [local, setLocal] = useState(value)
  const committed = useRef(value)

  // Keep in step when the URL changes from outside (back button, reset).
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setLocal(value)
    }
  }, [value])

  // Debounced so typing does not fire a query per keystroke.
  useEffect(() => {
    if (local === committed.current) return
    const timer = setTimeout(() => {
      committed.current = local
      onChange(local)
    }, 350)
    return () => clearTimeout(timer)
  }, [local, onChange])

  return (
    <div className="relative">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
      >
        <circle cx="11" cy="11" r="6.5" stroke="var(--ink-muted)" strokeWidth="1.8" />
        <path d="M16 16l4 4" stroke="var(--ink-muted)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border py-1.5 pr-2.5 pl-8 text-xs outline-none"
        style={{
          background: 'var(--surface-raised)',
          borderColor: 'var(--border-strong)',
          color: 'var(--ink-primary)',
          minWidth: 200,
        }}
      />
    </div>
  )
}

export interface Option {
  readonly id: string
  readonly label: string
}

/**
 * Multi-select dropdown.
 *
 * A plain popover over checkboxes rather than a combobox library: the option
 * lists here are short and known, and the native controls keep keyboard and
 * screen-reader behaviour for free.
 */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  disabled,
}: {
  label: string
  options: readonly Option[]
  selected: readonly string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (optionId: string) => {
    onChange(
      selected.includes(optionId)
        ? selected.filter((s) => s !== optionId)
        : [...selected, optionId],
    )
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50"
        style={{
          background: selected.length ? 'var(--grid)' : 'var(--surface-raised)',
          borderColor: 'var(--border-strong)',
          color: 'var(--ink-primary)',
        }}
      >
        {label}
        {selected.length > 0 && (
          <span
            className="tabular rounded-full px-1.5 text-[10px]"
            style={{ background: 'var(--series-1)', color: '#fff' }}
          >
            {selected.length}
          </span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          id={id}
          className="absolute z-30 mt-1 max-h-72 w-60 overflow-y-auto rounded-xl border p-1 shadow-lg"
          style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)' }}
        >
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mb-1 w-full rounded-md px-2 py-1.5 text-left text-xs"
              style={{ color: 'var(--ink-muted)' }}
            >
              Tozalash
            </button>
          )}
          {options.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--grid)]"
              style={{ color: 'var(--ink-primary)' }}
            >
              <input
                type="checkbox"
                checked={selected.includes(option.id)}
                onChange={() => toggle(option.id)}
                className="h-3.5 w-3.5"
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/** Single-choice segmented control. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: readonly { readonly value: T; readonly label: string }[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center gap-0.5 rounded-lg border p-0.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors"
            style={{
              background: active ? 'var(--ink-primary)' : 'transparent',
              color: active ? 'var(--surface)' : 'var(--ink-secondary)',
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Server-driven pagination. */
export function Pagination({
  page,
  totalPages,
  totalItems,
  onPage,
}: {
  page: number
  totalPages: number
  totalItems: number
  onPage: (page: number) => void
}) {
  if (totalItems === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <p className="tabular text-xs" style={{ color: 'var(--ink-muted)' }}>
        {formatNumber(totalItems)} ta yozuv · {page}/{totalPages}
      </p>
      <div className="flex items-center gap-1">
        <PageButton disabled={page <= 1} onClick={() => onPage(page - 1)} label="Oldingi" />
        <PageButton
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          label="Keyingi"
        />
      </div>
    </div>
  )
}

function PageButton({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border px-2.5 py-1.5 text-xs font-medium transition-opacity disabled:opacity-40"
      style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
    >
      {label}
    </button>
  )
}

/** Deal / payment status pill. Icon-free but always labelled in words. */
export function StatusBadge({ status }: { status: string }) {
  const palette: Record<string, { bg: string; dot: string; label: string }> = {
    OPEN: { bg: 'var(--grid)', dot: 'var(--seq-350)', label: t.status.OPEN },
    WON: {
      bg: 'color-mix(in srgb, var(--status-good) 14%, transparent)',
      dot: 'var(--status-good)',
      label: t.status.WON,
    },
    LOST: {
      bg: 'color-mix(in srgb, var(--status-critical) 12%, transparent)',
      dot: 'var(--status-critical)',
      label: t.status.LOST,
    },
    PAID: {
      bg: 'color-mix(in srgb, var(--status-good) 14%, transparent)',
      dot: 'var(--status-good)',
      label: 'Toʻlangan',
    },
    PARTIAL: {
      bg: 'color-mix(in srgb, var(--status-warning) 18%, transparent)',
      dot: 'var(--status-warning)',
      label: 'Qisman',
    },
    UNPAID: {
      bg: 'color-mix(in srgb, var(--status-critical) 12%, transparent)',
      dot: 'var(--status-critical)',
      label: 'Toʻlanmagan',
    },
    ACHIEVED: {
      bg: 'color-mix(in srgb, var(--status-good) 14%, transparent)',
      dot: 'var(--status-good)',
      label: t.kpiStatus.ACHIEVED,
    },
    ON_TRACK: {
      bg: 'color-mix(in srgb, var(--status-good) 10%, transparent)',
      dot: 'var(--status-good)',
      label: t.kpiStatus.ON_TRACK,
    },
    AT_RISK: {
      bg: 'color-mix(in srgb, var(--status-warning) 18%, transparent)',
      dot: 'var(--status-warning)',
      label: t.kpiStatus.AT_RISK,
    },
    BEHIND: {
      bg: 'color-mix(in srgb, var(--status-critical) 12%, transparent)',
      dot: 'var(--status-critical)',
      label: t.kpiStatus.BEHIND,
    },
  }

  const style = palette[status] ?? { bg: 'var(--grid)', dot: 'var(--ink-muted)', label: status }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ background: style.bg, color: 'var(--ink-primary)' }}
    >
      {/* Colour plus a word — never colour alone. */}
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: style.dot }}
      />
      {style.label}
    </span>
  )
}
