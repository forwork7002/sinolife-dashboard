'use client'

import { type KeyboardEvent, useEffect, useRef } from 'react'

import { DotGlyph, RingGlyph, SquareGlyph, TriangleGlyph } from '@/components/ui/Icons'
import { formatCompactUzs, formatNumber, formatPercent } from '@/lib/format'

import type { RnpRowDto } from './rnpApi'
import { type RnpTeamSummary, type RnpTone, TONE_COLOR, indexTone } from './rnpDerive'

/**
 * «Har bir ROP ga alohida tanlash usuli» — the page's primary navigation: the
 * whole company, then every team in the server's order (FAKT 1 for the
 * month). A rail of chips that scrolls sideways at every width, so seventeen
 * teams never wrap into a wall; the chosen one is scrolled into view.
 *
 * Buttons with `aria-pressed`, like `SegmentedControl`, plus ← / → between
 * them so a keyboard reader does not tab through seventeen stops to reach the
 * last team. The status mark is a glyph as well as a colour — dot, triangle,
 * square, ring — and its meaning is spelled out for a screen reader.
 */
export function RnpRopRail({
  teams,
  company,
  value,
  onChange,
}: {
  teams: readonly RnpTeamSummary[]
  /** The company's «Сумма ФАКТ 1» row. */
  company: RnpRowDto | null
  /** The chosen team, or null for the whole company. */
  value: string | null
  onChange: (rop: string | null) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const rail = railRef.current
    const chip = rail?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!rail || !chip) return
    const left = chip.offsetLeft - rail.offsetLeft
    if (left < rail.scrollLeft || left + chip.offsetWidth > rail.scrollLeft + rail.clientWidth) {
      rail.scrollLeft = Math.max(0, left - 16)
    }
  }, [value])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    const chips = [...(railRef.current?.querySelectorAll<HTMLButtonElement>('button[data-chip]') ?? [])]
    const at = chips.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    e.preventDefault()
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? chips.length - 1 : e.key === 'ArrowRight' ? Math.min(chips.length - 1, at + 1) : Math.max(0, at - 1)
    chips[next]?.focus()
  }

  return (
    <div
      ref={railRef}
      role="group"
      aria-label="ROP tanlash"
      onKeyDown={onKeyDown}
      className="relative -mx-1 flex max-w-full snap-x snap-proximity gap-2 overflow-x-auto px-1 pt-0.5 pb-2"
    >
      <Chip
        name="Butun kompaniya"
        sub={`${formatNumber(teams.length)} ta jamoa`}
        fakt1={company}
        selected={value === null}
        onClick={() => onChange(null)}
      />
      {teams.map((s) => (
        <Chip
          key={s.team.rop}
          name={s.team.label}
          sub={s.team.head ?? 'rahbar koʻrsatilmagan'}
          base={s.team.isBase}
          fakt1={s.fakt1}
          selected={value === s.team.rop}
          onClick={() => onChange(s.team.rop)}
        />
      ))}
    </div>
  )
}

const GLYPH = { good: DotGlyph, warning: TriangleGlyph, critical: SquareGlyph, neutral: RingGlyph } as const
const TONE_WORD: Record<RnpTone, string> = {
  good: 'rejada',
  warning: 'rejadan biroz orqada',
  critical: 'rejadan orqada',
  neutral: 'reja yoʻq',
}

function Chip({
  name,
  sub,
  base = false,
  fakt1,
  selected,
  onClick,
}: {
  name: string
  sub: string
  base?: boolean
  fakt1: RnpRowDto | null
  selected: boolean
  onClick: () => void
}) {
  const tone = indexTone(fakt1?.index ?? null, 'up')
  const Glyph = GLYPH[tone]
  const status = fakt1?.index != null ? `FAKT 1 indeksi ${formatPercent(fakt1.index)}, ${TONE_WORD[tone]}` : TONE_WORD[tone]
  const money = fakt1?.fact != null ? `${formatCompactUzs(fakt1.fact)} soʻm` : '—'
  return (
    <button
      type="button"
      data-chip
      aria-pressed={selected}
      // One sentence for a screen reader; the drawn chip is three lines of spans.
      aria-label={`${name}${base ? ' (БАЗА)' : ''} — ${sub}. FAKT 1: ${money}. ${status}`}
      onClick={onClick}
      className="focusable flex w-[9.75rem] shrink-0 snap-start flex-col items-start gap-0.5 rounded-[var(--radius-panel-sm)] border px-3 py-2 text-left transition-colors hover:bg-[var(--surface-sunken)] sm:w-[10.5rem]"
      style={{
        background: selected ? 'var(--accent-soft)' : 'var(--surface-raised)',
        borderColor: selected ? 'var(--accent)' : 'var(--border)',
        boxShadow: selected ? 'inset 0 0 0 1px var(--accent)' : 'var(--shadow-card)',
      }}
    >
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span className="inline-flex shrink-0" style={{ color: TONE_COLOR[tone] }}>
          <Glyph size={10} />
        </span>
        <span className="min-w-0 truncate text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {name}
        </span>
        {base && <BaseTag />}
      </span>
      <span className="w-full truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {sub}
      </span>
      <span className="tabular text-xs font-medium" style={{ color: selected ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}>
        {money}
      </span>
    </button>
  )
}

/** «БАЗА» — a team that works existing customers, measured by calls. */
export function BaseTag() {
  return (
    <span
      className="shrink-0 rounded px-1 py-px text-[9.5px] font-semibold tracking-wide"
      style={{ background: 'var(--grid)', color: 'var(--ink-secondary)', boxShadow: 'inset 0 0 0 1px var(--border-strong)' }}
      title="БАЗА — mavjud mijozlar bilan ishlaydi, qoʻngʻiroqlar boʻyicha oʻlchanadi"
    >
      БАЗА
    </span>
  )
}

/** The rail's silhouette while loading. */
export function RnpRopRailSkeleton() {
  return (
    <div className="flex gap-2 overflow-hidden pb-2" aria-hidden="true">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="skeleton h-[68px] w-[9.75rem] shrink-0 rounded-[var(--radius-panel-sm)] sm:w-[10.5rem]" />
      ))}
    </div>
  )
}
