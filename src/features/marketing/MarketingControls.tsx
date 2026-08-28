'use client'

import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/Controls'
import { formatDateTime, formatNumber } from '@/lib/format'
import type { MarketingSnapshotDto, MarketingWindowDto } from './marketingApi'
import { type CurrencyMode, dayLabel } from './marketingFormat'

/**
 * The window this screen reports on.
 *
 * Three choices, exactly as `per()` in logic.js resolves them:
 *   today  — the snapshot's own `today`, one day wide
 *   all    — minDate .. maxDate, the default
 *   custom — two dates, swapped if entered backwards, clamped at the low end
 *
 * This does NOT reuse the app-wide period control. Every other screen's
 * presets ("this month", "last quarter") are computed against the clock, and
 * this module's clock is the published blob: a preset that resolves to a
 * window the import does not cover would render an empty screen and blame the
 * business for it. The window here is always a fact about the snapshot.
 */
export type PeriodChoice = 'today' | 'all' | 'custom'

export interface MarketingPeriod {
  readonly choice: PeriodChoice
  /** Set only while `choice === 'custom'`. */
  readonly from?: string
  readonly to?: string
}

/** Resolve a choice to a real window, the way `per()` does. */
export function resolveWindow(
  period: MarketingPeriod,
  snapshot: MarketingSnapshotDto,
): MarketingWindowDto {
  if (period.choice === 'today') {
    return { from: clamp(snapshot.today, snapshot), to: snapshot.today }
  }
  if (period.choice === 'custom' && period.from && period.to) {
    const [from, to] =
      period.from <= period.to ? [period.from, period.to] : [period.to, period.from]
    return { from: clamp(from, snapshot), to: clamp(to, snapshot) }
  }
  return { from: snapshot.minDate, to: snapshot.maxDate }
}

/**
 * The selectable bounds.
 *
 * The low bound is `minDate`. The high bound is `today`, NOT `maxDate` — and
 * the difference is real data, not pedantry: in the current snapshot
 * `maxDate` is 2026-08-11 while the camp/adset/creative/days slices carry rows
 * through 2026-08-27, because `maxDate` tracks the SLOWEST dimension. Clamping
 * the date inputs to it would put a fortnight of published rows out of reach
 * of a control while the "Bugun" button walked straight to them. The coverage
 * line under the table states where each dimension actually stops.
 */
function clamp(date: string, snapshot: MarketingSnapshotDto): string {
  if (date < snapshot.minDate) return snapshot.minDate
  if (date > snapshot.today) return snapshot.today
  return date
}

export function MarketingPeriodControl({
  period,
  snapshot,
  onChange,
}: {
  period: MarketingPeriod
  snapshot: MarketingSnapshotDto
  onChange: (period: MarketingPeriod) => void
}) {
  const [from, setFrom] = useState(period.from ?? snapshot.minDate)
  const [to, setTo] = useState(period.to ?? snapshot.maxDate)

  /**
   * Keep the inputs in step when the window changes from OUTSIDE this control
   * — a preset button, a reset — so "Qoʻllash" can never apply a range the
   * reader has stopped looking at.
   *
   * Adjusted during render against the previous props rather than in an
   * effect. React documents this as the way to reset state on a prop change:
   * the component re-renders immediately with the corrected draft and the
   * browser never paints the stale one, whereas an effect paints first and
   * corrects after — a visible flicker of the old dates, and a lint error
   * (react-hooks/set-state-in-effect) for the same reason.
   */
  const [seen, setSeen] = useState(period)
  if (seen !== period) {
    setSeen(period)
    if (period.choice === 'custom' && period.from && period.to) {
      setFrom(period.from)
      setTo(period.to)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl<PeriodChoice>
        ariaLabel="Davr"
        value={period.choice}
        options={[
          { value: 'today', label: 'Bugun' },
          { value: 'all', label: 'Barcha sanalar' },
          { value: 'custom', label: 'Oraliq' },
        ]}
        onChange={(choice) =>
          onChange(choice === 'custom' ? { choice, from, to } : { choice })
        }
      />

      {period.choice === 'custom' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <DateInput label="Boshlanish" value={from} min={snapshot.minDate} max={snapshot.today} onChange={setFrom} />
          <span style={{ color: 'var(--ink-muted)' }}>–</span>
          <DateInput label="Tugash" value={to} min={snapshot.minDate} max={snapshot.today} onChange={setTo} />
          <Button size="sm" variant="secondary" onClick={() => onChange({ choice: 'custom', from, to })}>
            Qoʻllash
          </Button>
        </div>
      )}
    </div>
  )
}

function DateInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: string
  min: string
  max: string
  onChange: (value: string) => void
}) {
  return (
    <input
      type="date"
      value={value}
      min={min}
      max={max}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      className="focusable rounded-[var(--radius-panel-sm)] border px-2 py-1 text-xs"
      style={{
        background: 'var(--surface-raised)',
        borderColor: 'var(--border-strong)',
        color: 'var(--ink-primary)',
      }}
    />
  )
}

/**
 * soʻm ⇄ $, and the rate that does it.
 *
 * The rate is printed beside the toggle with its own date, because a
 * conversion is a claim about a moment: 11 824 soʻm was the rate on
 * 27.08.2026, and a dollar figure on this screen means that rate and no other.
 * A toggle that silently re-priced a quarter of data at today's rate would be
 * the most quietly wrong thing on the page.
 */
export function CurrencyToggle({
  mode,
  onChange,
  snapshot,
}: {
  mode: CurrencyMode
  onChange: (mode: CurrencyMode) => void
  snapshot: MarketingSnapshotDto
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl<CurrencyMode>
        ariaLabel="Valyuta"
        value={mode}
        options={[
          { value: 'uzs', label: 'soʻm' },
          { value: 'usd', label: '$' },
        ]}
        onChange={onChange}
      />
      <p className="tabular text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        1 $ = {formatNumber(Math.round(snapshot.usdRate))} soʻm · {snapshot.rateDate}
      </p>
    </div>
  )
}

/**
 * A note with a coloured edge rather than a coloured wash.
 *
 * A tinted panel at the alpha a dark surface can take is a muddy brown that
 * neither reads as a warning nor stays out of the way; a full-strength bar on
 * the leading edge is unambiguous at any surface lightness. The word carries
 * the meaning, the bar only finds it.
 */
export function Note({
  tone,
  children,
}: {
  tone: 'warning' | 'neutral'
  children: ReactNode
}) {
  return (
    <div
      className="rounded-[var(--radius-panel)] border px-4 py-3 text-xs leading-relaxed"
      style={{
        background: 'var(--surface-raised)',
        borderColor: 'var(--border)',
        borderInlineStartWidth: 3,
        borderInlineStartColor: tone === 'warning' ? 'var(--status-warning)' : 'var(--border-strong)',
        color: 'var(--ink-secondary)',
      }}
    >
      {children}
    </div>
  )
}

/**
 * Where these numbers come from — stated on the screen, every time.
 *
 * Roistat is NOT in Bitrix24. A live probe of the portal found no Roistat
 * fields, sources, apps or smart processes at all; this module reads the
 * client's own Google Sheets plus Meta Ads, published as a static blob on
 * their Roistat page and imported from there. Two systems, two ledgers, and
 * the figures below must never be added to a Bitrix24 revenue total.
 *
 * Both stamps are shown and neither is the portal's sync time: the blob's own
 * `updated` label is when THEIR page last rebuilt, ours is when we last
 * fetched it. A reader who sees only one of the two cannot tell a stale import
 * from a stale source.
 */
export function ProvenanceLine({ snapshot }: { snapshot: MarketingSnapshotDto }) {
  return (
    <Note tone="neutral">
      <p>
        <strong style={{ color: 'var(--ink-primary)' }}>Maʼlumot manbasi: Bitrix24 emas.</strong>{' '}
        Bu boʻlimdagi raqamlar mijozning Google Sheets jadvallari (ishchi + arxiv) va Meta Ads
        hisobidan olinadi — ular Roistat sahifasida chop etilgan, biz oʻsha sahifadan import
        qilamiz. Bitrix24 tushumi bilan qoʻshilmaydi: ikki tizim, ikki hisob kitobi.
      </p>
      <p className="mt-1.5 tabular" style={{ color: 'var(--ink-muted)' }}>
        Manba yangilangan: {snapshot.updatedLabel} · Import qilingan:{' '}
        {formatDateTime(snapshot.importedAt)} · {formatNumber(snapshot.rowCount)} qator ·{' '}
        {snapshot.sourceUrl}
      </p>
    </Note>
  )
}

/**
 * The formula line, verbatim from their footer.
 *
 * Five definitions is not decoration on a screen with twenty-one columns: a
 * reader who thinks "Sotib olish" means "share of leads that bought" will
 * misread the most heavily graded column on the page.
 */
export function FormulaHint({ snapshot }: { snapshot: MarketingSnapshotDto }) {
  return (
    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
      Sifat = toza / lidlar · QL % = kval / lidlar · Sotib olish = Sotuvlar / Buyurtmalar · ROAS =
      Tushum / Xarajat · CAC = xarajat / yangi mijozlar ·{' '}
      <span>{dayLabel(snapshot.dailyFrom)} gacha — oylik jamlanma.</span>
    </p>
  )
}

/** "The last seven days are not closed yet" — shown only when the window reaches them. */
export function FreshnessWarning({ snapshot }: { snapshot: MarketingSnapshotDto }) {
  return (
    <Note tone="warning">
      <strong style={{ color: 'var(--ink-primary)' }}>
        Soʻnggi kunlar hali toʻliq emas.
      </strong>{' '}
      {dayLabel(snapshot.freshFrom)} dan keyingi qatorlar toʻldirilmoqda — sotuvlar va kassa
      keyinroq yopiladi, shuning uchun bu kunlarda ROAS past koʻrinishi normal holat.
    </Note>
  )
}
