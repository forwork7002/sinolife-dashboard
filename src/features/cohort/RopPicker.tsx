'use client'

import { type CohortRopDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/**
 * Which team's customers the matrix is cut to.
 *
 * A NATIVE `<select>`, not the shared `MultiSelect`. That control is a list of
 * checkboxes and this is one choice: a cohort has ONE denominator, and a
 * checkbox list would offer a reader two teams at once and then have to decide
 * what the union of two cohorts means — which is a question with no answer the
 * matrix could draw. The native element also brings the platform's own type-to-
 * find, which is what fifteen Uzbek team names are actually scanned with.
 *
 * THE OPTIONS ARE NOT FETCHED UNTIL SOMEBODY REACHES FOR THEM. Listing the
 * teams costs a grouping and two joins on the slowest statement in the product
 * (see `InsightsRepository.cohorts`), and the default view never needs it, so
 * the request goes out on the first focus or pointer-down and the control says
 * so while it is in flight. Same shape, and the same reason, as «ROP» inside
 * «+ Yangi hisob» on `/users`: a picker most readers never open must not be
 * paid for by every reader.
 *
 * WHILE THEY LOAD, THE CURRENT CHOICE IS STILL AN OPTION. A `<select>` whose
 * `value` matches none of its options shows blank, so a reader arriving on a
 * shared `?rop=` link would see the control empty above a matrix that is
 * plainly cut — the one moment the control most needs to name the cut. The
 * selected team is therefore always present, whether or not the list has
 * arrived.
 */
export function RopPicker({
  value,
  options,
  loading,
  onOpen,
  onChange,
}: {
  /** The team on screen, or null for the whole company. */
  readonly value: string | null
  readonly options: readonly CohortRopDto[]
  readonly loading: boolean
  /** Fetch the options. Called on the first focus or pointer-down. */
  readonly onOpen: () => void
  readonly onChange: (rop: string | null) => void
}) {
  /* `value` first, so a shared link's team is selectable before the list
     lands; the fetched list then replaces it by key. */
  const listed = options.some((option) => option.rop === value)

  return (
    <label className="inline-flex items-center gap-1.5 text-[11px]">
      <span className="font-medium" style={{ color: 'var(--ink-muted)' }}>
        Jamoa
      </span>
      <select
        className="h-7 rounded-md border px-2 text-[11px]"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--surface)',
          color: 'var(--ink-primary)',
        }}
        value={value ?? ''}
        onFocus={onOpen}
        onPointerDown={onOpen}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        aria-label="Kogortani jamoa boʻyicha kesish"
      >
        <option value="">Butun kompaniya</option>
        {value !== null && !listed && <option value={value}>{value}</option>}
        {options.map((option) => (
          <option key={option.rop} value={option.rop}>
            {option.rop} — {formatNumber(option.customers)} mijoz
          </option>
        ))}
        {/* Not `disabled` on the whole control: a reader who arrived on a
            `?rop=` link must be able to get back to the company view without
            waiting for a list they are not going to use. */}
        {loading && <option disabled>yuklanmoqda…</option>}
      </select>
    </label>
  )
}
