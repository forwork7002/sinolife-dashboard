'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useReducedMotion } from '@/lib/useReducedMotion'
import { type SellerRecordDto, type SellerRecordsDto, apiGet } from '@/lib/api'
import { formatNumber, formatUzs } from '@/lib/format'

/**
 * The record wall — one month's champion at a time, in the board's title line.
 *
 * WHY IT IS HERE AND NOT ON THE BOARD. The client asked for it in this strip
 * («shu yer qismida rekord deb turishi kerak»), and the strip is the one place
 * on this screen with room: the title sits left, the preset chips sit right,
 * and on the 1920px television the floor reads this on, the metre between them
 * is empty. Nothing below it can be given away — both columns are already
 * fighting for rows under their podiums.
 *
 * IT TURNS, BECAUSE A TELEVISION HAS NO MOUSE. Same premise as
 * `useAutoScroll`: whatever is not on screen is never seen, and a wall that
 * showed only the newest month would be a wall of one. Eight seconds a card,
 * which is the pace a name stays legible from across a room without the strip
 * becoming the thing people watch instead of the board.
 *
 * REDUCED MOTION STOPS IT COMPLETELY and shows the newest record, which is the
 * one a reader would have picked. A strip that changed under someone who asked
 * the operating system for stillness is exactly what that preference is for,
 * and unlike the lists below it there is no scrollbar here to reach the rest
 * by hand — so this degrades to the single most useful card rather than to a
 * control nobody can use.
 *
 * ITS OWN QUERY, ON ITS OWN CLOCK. `?include=records` is a second request
 * rather than a field on the board's payload: the wall spans every month since
 * the attribution became trustworthy, so its cohort is the widest read on this
 * screen, while the answer only changes when a month closes. Ten minutes for
 * both `staleTime` and `refetchInterval` — `refetchInterval` never consults
 * staleness, so setting one alone buys nothing (the same pairing
 * `/users?include=heads` uses, and for the same reason).
 */

/** How long one card holds the strip. */
const TURN_MS = 8_000

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
  const [index, setIndex] = useState(0)

  /*
    The turn is driven by an interval rather than by a CSS animation because
    the number of cards is not known when the stylesheet is written, and it
    stops dead when there is nothing to turn between — a one-card wall that
    still ran a timer would re-render the strip every eight seconds forever.
  */
  useEffect(() => {
    if (reduced || months.length < 2) return
    const id = setInterval(() => setIndex((i) => (i + 1) % months.length), TURN_MS)
    return () => clearInterval(id)
  }, [reduced, months.length])

  /*
    A wall that grew a month while the reader was on its last card would index
    past the end for one frame. Clamping on render rather than in an effect
    keeps that frame from ever being drawn.
  */
  const shown = months.length === 0 ? null : months[Math.min(index, months.length - 1)]!

  // Nothing to say yet, and nothing worth holding the line open for: the title
  // and the preset chips are the header's own content and neither moves.
  if (!shown) return null

  return (
    <div
      className="record-wall min-w-0 flex-1"
      // A live region would announce a new champion every eight seconds to a
      // screen reader that never asked for one. The strip is decorative
      // repetition of what the board below already says, so it is polite about
      // the turn and honest about the content.
      aria-live="off"
    >
      <div className="record-plaque mx-auto flex w-fit max-w-full min-w-0 items-center gap-3 pl-3.5 pr-14">
        {/*
          THE RANK, AS THE SEATS DRAW IT. Every row this strip can show is a
          first place, so the numeral is a fact rather than an ornament — and
          it is the podium's own move, which is most of what makes this read
          as part of the screen instead of a box on top of it.
        */}
        <span className="record-ghost" aria-hidden="true">
          1
        </span>

        {/*
          The medal ring is the object the seats put their avatars in — a
          conic sweep through lighter and darker cuts of one metal, which is
          what reads as metallic without a literal hex per theme. Not
          `--crowned`: that wider halo belongs to the champion of the window
          the floor is actually reading, one screen down.
        */}
        <span
          className="medal-ring shrink-0"
          aria-hidden="true"
          style={{ position: 'relative' }}
        >
          <span
            className="flex items-center justify-center rounded-full"
            style={{
              width: 'calc(var(--record-name) * 1.72)',
              height: 'calc(var(--record-name) * 1.72)',
              background: 'var(--surface-raised)',
              fontSize: 'calc(var(--record-name) * 0.86)',
              lineHeight: 1,
            }}
          >
            🏆
          </span>
        </span>

        <div className="relative min-w-0">
          <div className="flex items-center gap-2" style={{ lineHeight: 1.1 }}>
            <span className="record-tag shrink-0">
              {shown.running ? 'Yetakchi' : 'Rekord'}
            </span>
            <span
              className="shrink-0"
              style={{ color: 'var(--ink-muted)', fontSize: 'var(--record-label)' }}
            >
              {monthLabel(shown.month)}
            </span>
            {/*
              The turn indicator, on the tag row rather than in the corner.
              Beside the ghost numeral it crowded the one piece of the podium's
              language this strip borrows; here it sits where the composition
              already has room, and it is drawn in the METAL rather than the
              page accent — one pink dot inside a gold object is the kind of
              detail that makes a composition look assembled rather than
              designed.
            */}
            {months.length > 1 && !reduced && (
              <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
                {months.map((m, i) => (
                  <span
                    key={m.month}
                    className="block rounded-full transition-opacity"
                    style={{
                      width: 3,
                      height: 3,
                      background: 'var(--metal)',
                      opacity: i === Math.min(index, months.length - 1) ? 1 : 0.32,
                    }}
                  />
                ))}
              </span>
            )}
          </div>

          <div
            className="truncate font-semibold"
            style={{
              color: 'var(--ink-primary)',
              fontSize: 'var(--record-name)',
              lineHeight: 1.25,
              marginTop: 1,
            }}
          >
            {shown.fullName}
            {shown.rop && (
              <span className="ml-1.5 font-normal" style={{ color: 'var(--ink-muted)' }}>
                · {shown.rop}
              </span>
            )}
          </div>

          <div
            className="truncate"
            style={{
              color: 'var(--ink-secondary)',
              fontSize: 'var(--record-figure)',
              lineHeight: 1.2,
            }}
          >
            <span className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
              {formatUzs(shown.amount.amount)}
            </span>
            <span style={{ color: 'var(--ink-muted)' }}>
              {' · '}
              {formatNumber(shown.orders)} ta ·{' '}
              {/*
                WHICH FIGURE THIS IS, ALWAYS SAID. The wall switches between
                FAKT 2 and FAKT 1 by the podium's rule, so a running month can
                print a bigger number than a closed one purely because nothing
                in it has been delivered yet. Unlabelled, that reads as a
                record being broken.
              */}
              {shown.basis === 'delivered' ? 'yetkazilgan' : 'tasdiqlangan'}
            </span>
          </div>
        </div>

      </div>
    </div>
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
