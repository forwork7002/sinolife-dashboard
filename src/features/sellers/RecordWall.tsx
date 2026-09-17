'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'

import { MedalMark } from '@/features/sellers/MedalMark'
import { parseSellerName } from '@/features/sellers/sellerName'
import { type SellerRecordDto, type SellerRecordsDto, apiGet } from '@/lib/api'
import { formatNumber, formatSomFull } from '@/lib/format'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * The record wall — the two newest months, standing still in the title line.
 *
 * TWO PLAQUES, NOT A TICKER (EFIR Premium, spec §7). Each is a 58 px raised
 * plate: a 32 px medal (the running month's lead wears month-gold, a closed
 * month's record wears day-record), a caps label in neutral ink — never gold,
 * the medal is the metal — with «57 ta yetkazilgan» at its right, and a value
 * line of name · code · amount. Nothing on this page moves at rest.
 *
 * THE AMOUNT NEVER TRUNCATES. Each plaque is its own inline-size container:
 * under 400 px the count drops, under 320 px the code drops, and only then
 * does the NAME ellipsise. The figure is one text node with its U+202F group
 * separators inside it.
 *
 * NARROWER THAN ~1500px THE HEADER HOLDS ONE PLAQUE, and it CUTS to the other
 * every ten seconds — a cut, never a slide. Reduced motion stops the cut and
 * leaves the lead on screen. Under 1280 the wall is not drawn at all (CSS):
 * the page stops being a television there.
 *
 * ITS OWN QUERY, ON ITS OWN CLOCK. `?include=records` spans every month since
 * the attribution became trustworthy, and the answer only changes when a
 * month closes: ten minutes for both `staleTime` and `refetchInterval`
 * (`refetchInterval` never consults staleness, so one alone buys nothing).
 */
export const RECORD_CUT_MS = 10_000
export const RECORD_WIDE_QUERY = '(min-width: 1500px)'

function subscribeWide(onChange: () => void): () => void {
  const media = window.matchMedia(RECORD_WIDE_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** Whether the title line has room for two bands. The server answers yes. */
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(RECORD_WIDE_QUERY).matches,
    () => true,
  )
}

export function RecordWall() {
  const records = useQuery({
    queryKey: ['sellers', 'records'],
    queryFn: ({ signal }) =>
      apiGet<SellerRecordsDto>('/analytics/sellers', { include: 'records' }, signal),
    staleTime: 600_000,
    refetchInterval: 600_000,
    placeholderData: (previous) => previous,
  })
  const wide = useWide()
  const reduced = useReducedMotion()

  return <RecordWallView months={records.data?.data.months ?? []} wide={wide} reduced={reduced} />
}

/** The view, without the query — what the tests render. */
export function RecordWallView({
  months,
  wide,
  reduced,
}: {
  /** Newest month first, as the payload sends them. */
  months: readonly SellerRecordDto[]
  wide: boolean
  reduced: boolean
}) {
  const shown = months.slice(0, 2)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (wide || reduced || shown.length < 2) return
    const id = setInterval(() => setTick((n) => n + 1), RECORD_CUT_MS)
    return () => clearInterval(id)
  }, [wide, reduced, shown.length])

  // Nothing to say yet, and nothing worth holding the line open for.
  if (shown.length === 0) return null

  const items = wide ? shown : [shown[tick % shown.length]!]

  return (
    <div className="record-wall" data-bands={items.length} aria-label="Har oyning eng yaxshi sotuvchisi">
      {items.map((m) => (
        <RecordItem key={m.month} record={m} />
      ))}
    </div>
  )
}

function RecordItem({ record }: { record: SellerRecordDto }) {
  /*
    THE MONTH'S STATE, IN THE WORD AND THE MEDAL. «rekordi» is a month that is
    over and can no longer change; «yetakchisi» is the month still running,
    whose leader may yet lose the place. Without it a running month's smaller
    figure reads as a record having collapsed.
  */
  const label = record.running ? `${monthName(record.month)} yetakchisi` : `${monthLabel(record.month)} rekordi`
  const { name, code } = parseSellerName(record.fullName)
  return (
    <div className="plaque" data-running={record.running || undefined}>
      <MedalMark code={record.running ? 'month-gold' : 'day-record'} size={32} />
      <div className="plaque__t">
        <p className="plaque__k">
          <span className="plaque__label">{label}</span>
          {/*
            WHICH FIGURE THIS IS, ALWAYS SAID. The wall switches between FAKT 2
            and FAKT 1 by the podium's rule — FAKT 2 decides, FAKT 1 only where
            nobody has delivered yet — so a month can print a bigger number
            purely because none of it is on the road.
          */}
          <i className="plaque__count">
            {formatNumber(record.orders)} ta {record.basis === 'delivered' ? 'yetkazilgan' : 'tasdiqlangan'}
          </i>
        </p>
        <p className="plaque__v">
          <span className="nm">{name}</span>
          {code !== null && <span className="code">{code}</span>}
          <b className="plaque__amount">{formatSomFull(record.amount.amount)}</b>
        </p>
      </div>
    </div>
  )
}

/**
 * «Avgust 2026» from `2026-08-01`, «Sentabr» from `2026-09-01`.
 *
 * Built from the string rather than from a Date: the value is already a
 * calendar month resolved in the reporting timezone, and putting it through a
 * Date would re-resolve it in the BROWSER's zone — which for a machine set to
 * UTC turns the first of the month into the last of the one before.
 */
const MONTHS = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
] as const

export function monthName(month: SellerRecordDto['month']): string {
  const [, index] = month.split('-')
  return MONTHS[Number(index) - 1] ?? month
}

export function monthLabel(month: SellerRecordDto['month']): string {
  const [year, index] = month.split('-')
  const name = MONTHS[Number(index) - 1]
  return name ? `${name} ${year}` : month
}
