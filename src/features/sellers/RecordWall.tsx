'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useReducedMotion } from '@/lib/useReducedMotion'
import { type SellerRecordDto, type SellerRecordsDto, apiGet } from '@/lib/api'
import { formatNumber, formatUzs } from '@/lib/format'

/**
 * The record wall — every month's best seller, crawling through the title line.
 *
 * A TICKER, NOT A CARD THAT SWAPS. The first two drawings were a plaque
 * showing one month at a time and turning every eight seconds. The client
 * asked for the other thing outright — «alohida card bo'lib emas… huddi
 * yangiliklarda aylanib turadiku… har bir oyda kim eng ko'p qilganligini
 * ko'rib tursa bo'ladigan» — and a crawl really is the better instrument
 * here. A card that flips shows ONE month and hides the rest behind a wait: a
 * reader who wants August has to stand there until August comes round. A crawl
 * carries the whole run continuously, so "how does this month compare" is
 * answered on screen rather than eight seconds away. It is also a form a
 * television audience already reads without being taught.
 *
 * NO BOX. The plaque's border and fill were what made it a separate object
 * sitting in the header; the ceremony travels on the type instead — the medal
 * glyph, the month in the podium's gold, a metal lozenge between entries. The
 * strip belongs to the header now rather than being placed on top of it.
 *
 * SEAMLESS, WHICH IS WHY THE LIST IS RENDERED TWICE. The track holds two
 * identical copies and slides exactly one copy's width before resetting, so
 * the join lands on the frame the animation restarts and there is no visible
 * jump. Any other loop — stepping, or running to the end and springing back —
 * reads as a fault on a screen watched from across a room.
 *
 * THE PACE IS FIXED IN PIXELS, NOT IN SECONDS. A fixed duration would make the
 * crawl faster every month the portal adds, because the same seconds would
 * have to carry a longer track. The width is measured and the duration derived
 * from it, so a name is legible for as long next year as it is today.
 *
 * REDUCED MOTION STOPS IT and hands back a strip the reader can scroll by
 * hand. The months are all still there, which a merely frozen crawl would not
 * be — it would show whichever entries happened to fit and hide the rest with
 * no way to reach them.
 *
 * ITS OWN QUERY, ON ITS OWN CLOCK. `?include=records` is a second request
 * rather than a field on the board's payload: the wall spans every month since
 * the attribution became trustworthy, so its cohort is the widest read on this
 * screen, while the answer only changes when a month closes. Ten minutes for
 * both `staleTime` and `refetchInterval` — `refetchInterval` never consults
 * staleness, so setting one alone buys nothing (the same pairing
 * `/users?include=heads` uses, and for the same reason).
 */

/**
 * How fast the crawl travels, in CSS pixels per second.
 *
 * Measured against what it has to serve: a name staying readable to someone
 * glancing up from a desk on the far side of the floor. Much above this and
 * the eye is chasing the text; much below and the strip stops looking like it
 * moves at all, which is worse than a static line because the reader waits.
 */
const PIXELS_PER_SECOND = 46

export function RecordWall() {
  const reduced = useReducedMotion()

  const records = useQuery({
    queryKey: ['sellers', 'records'],
    queryFn: ({ signal }) =>
      apiGet<SellerRecordsDto>('/analytics/sellers', { include: 'records' }, signal),
    staleTime: 600_000,
    refetchInterval: 600_000,
    placeholderData: (previous) => previous,
  })

  const months = records.data?.data.months ?? []

  /*
    OLDEST FIRST, unlike the payload.

    The route answers newest first, which is right for a list read top-down. A
    crawl is read left to right as time, so running it newest-first would walk
    the reader backwards through the year.
  */
  const ordered = [...months].reverse()

  const runRef = useRef<HTMLDivElement>(null)
  const [travel, setTravel] = useState(0)

  /*
    Measured in a LAYOUT effect: the duration is a style, and setting it after
    paint would show one frame at the wrong speed every time the list changes.
    A ResizeObserver rather than a one-off read, because the `--record-*` sizes
    ramp with the viewport — the same months are a different number of pixels
    on a laptop and on the television.
  */
  useLayoutEffect(() => {
    const el = runRef.current
    if (!el) return
    const measure = () => setTravel(el.scrollWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ordered.length, records.dataUpdatedAt])

  // Nothing to say yet, and nothing worth holding the line open for: the title
  // and the preset chips are the header's own content and neither moves.
  if (ordered.length === 0) return null

  const seconds = travel > 0 ? travel / PIXELS_PER_SECOND : 0
  const crawling = !reduced && seconds > 0

  return (
    <div
      className="record-wall min-w-0 flex-1"
      /*
        A live region would announce a new champion to a screen reader every
        time the crawl came round. The strip repeats what the board below
        already says, so it stays quiet about the movement.
      */
      aria-live="off"
      aria-label="Har oyning eng yaxshi sotuvchisi"
    >
      <div
        className={`record-track${crawling ? ' record-track--crawling' : ''}`}
        style={
          crawling
            ? ({
                '--record-travel': `${travel}px`,
                animationDuration: `${seconds}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <div className="record-run" ref={runRef}>
          {ordered.map((m) => (
            <RecordEntry key={m.month} record={m} />
          ))}
        </div>
        {/*
          The second copy is decoration, not content — a screen reader that
          read both would announce every month twice.
        */}
        {crawling && (
          <div className="record-run" aria-hidden="true">
            {ordered.map((m) => (
              <RecordEntry key={m.month} record={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RecordEntry({ record }: { record: SellerRecordDto }) {
  return (
    <span className="record-entry">
      <span aria-hidden="true" className="record-medal">
        🏆
      </span>
      <span className="record-month">
        {/*
          THE MONTH'S STATE, IN THE WORD. «Rekord» is a month that is over and
          can no longer change; «Yetakchi» is the month still running, whose
          leader may yet lose the place. Without it, a running month's smaller
          figure reads as a record having collapsed.
        */}
        {record.running ? 'Yetakchi' : 'Rekord'} · {monthLabel(record.month)}
      </span>
      <span className="record-who">{record.fullName}</span>
      {record.rop && <span className="record-team">{record.rop}</span>}
      <span className="record-sum">{formatUzs(record.amount.amount)}</span>
      <span className="record-note">
        {formatNumber(record.orders)} ta ·{' '}
        {/*
          WHICH FIGURE THIS IS, ALWAYS SAID. The wall switches between FAKT 2
          and FAKT 1 by the podium's rule — FAKT 2 decides, FAKT 1 only where
          nobody has delivered yet — so a month can print a bigger number
          purely because none of it is on the road. Unlabelled, that change of
          measure reads as a record being broken.
        */}
        {record.basis === 'delivered' ? 'yetkazilgan' : 'tasdiqlangan'}
      </span>
      <span aria-hidden="true" className="record-sep">
        ◆
      </span>
    </span>
  )
}

/**
 * «Avgust 2026» from `2026-08-01`.
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

export function monthLabel(month: SellerRecordDto['month']): string {
  const [year, index] = month.split('-')
  const name = MONTHS[Number(index) - 1]
  return name ? `${name} ${year}` : month
}
