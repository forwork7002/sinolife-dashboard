'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useTipPosition } from '@/components/ui/Tooltip'
import { MedalMark } from '@/features/sellers/MedalMark'
import { monthLabel } from '@/features/sellers/RecordWall'
import {
  MEDALS,
  MEDAL_GROUP_LABEL,
  MEDAL_RULES,
  isKnownMedal,
  medalGroupOf,
} from '@/features/sellers/medalCatalog'
import type { MedalCode, SellerMedalDto, SellerMedalRowDto } from '@/lib/api'
import { formatDate, formatNumber, formatPercent, formatUzs } from '@/lib/format'

/**
 * The medal's own card, on hover — «medal ustiga olib borganda medal tasnifi
 * kelib chiqsin» (the client, 2026-09-18).
 *
 * ONE TIP FOR THE WHOLE BOARD, NOT A WRAPPER PER MEDAL. The shared `Tooltip`
 * wraps its trigger in an `inline-flex` span; around a medal that span breaks
 * the three layout promises the MEDALS block keeps by DIRECT-CHILD selectors
 * (`.seat-medals > .medal-mark`, `.row-medals > .medal-mark` — the shrink, the
 * margins, the one-medal-tall holder), and three hundred of them would be
 * three hundred timers. So this listens once, on the document, for a pointer
 * over `.tv-board svg.medal-mark`, and draws one `.tip` panel with the shared
 * placement (`useTipPosition`: above unless cramped, clamped to the viewport).
 * The strip at the foot is NOT a target — it prints the same card in words.
 *
 * WHAT IT SAYS — the medal's name, its group, the rule it is awarded on (the
 * same sentence as the strip, `MEDAL_RULES`), and THIS seller's instance of
 * it: how many times, the month or day of the latest, and the figure that won
 * it. The instance is read from the payload (`?include=medals`), found through
 * the holder's `data-employee`; the DTO keeps the latest reason with its own
 * figure (the engine walks months and days in order), so date and figure
 * always describe the same event.
 *
 * A TELEVISION HAS NO POINTER, so none of this ever shows there and nothing
 * on the board depends on it. A phone gets it on a tap (a second tap, or a tap
 * elsewhere, closes it); a scroll that moves the medal closes it, because a tip
 * left floating over the wrong row is worse than none.
 */

/** Hover delay, ms — the shared `Tooltip`'s. */
const DELAY = 150

const MEDAL_SELECTOR = '.tv-board svg.medal-mark[data-medal]'

interface Shown {
  readonly anchor: Element
  readonly code: MedalCode
  readonly medal: SellerMedalDto | null
  /** Bumped per opening, so each medal gets a freshly measured panel. */
  readonly seq: number
}

export function MedalTip({ medals }: { medals: ReadonlyMap<string, SellerMedalRowDto> }) {
  const [shown, setShown] = useState<Shown | null>(null)
  // The listeners are attached once; the payload they read moves every ten minutes.
  const medalsRef = useRef(medals)
  useEffect(() => {
    medalsRef.current = medals
  }, [medals])

  useEffect(() => {
    let timer: number | undefined
    let seq = 0
    let current: Element | null = null

    const medalAt = (target: EventTarget | null): Element | null =>
      target instanceof Element ? target.closest(MEDAL_SELECTOR) : null

    const describe = (anchor: Element): Shown | null => {
      const code = anchor.getAttribute('data-medal')
      if (!code || !isKnownMedal(code)) return null
      const owner = anchor.closest('[data-employee]')?.getAttribute('data-employee')
      const medal = owner ? (medalsRef.current.get(owner)?.medals.find((m) => m.code === code) ?? null) : null
      seq += 1
      return { anchor, code, medal, seq }
    }

    const open = (anchor: Element) => {
      current = anchor
      setShown(describe(anchor))
    }
    const close = () => {
      window.clearTimeout(timer)
      current = null
      setShown(null)
    }

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const anchor = medalAt(event.target)
      if (!anchor || anchor === current) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => open(anchor), DELAY)
    }
    const onOut = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const from = medalAt(event.target)
      if (!from || medalAt(event.relatedTarget) === from) return
      close()
    }
    const onDown = (event: PointerEvent) => {
      const anchor = medalAt(event.target)
      if (event.pointerType === 'touch' && anchor) {
        window.clearTimeout(timer)
        if (anchor === current) close()
        else open(anchor)
        return
      }
      if (!anchor) close()
    }
    // Only a scroll that carries the medal: the other column's list scrolls on
    // its own clock and must not close a tip over this one.
    const onScroll = (event: Event) => {
      if (current && event.target instanceof Node && event.target.contains(current)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  if (!shown) return null
  return <MedalTipPanel key={shown.seq} anchor={shown.anchor} code={shown.code} medal={shown.medal} />
}

function MedalTipPanel({ anchor, code, medal }: { anchor: Element; code: MedalCode; medal: SellerMedalDto | null }) {
  const anchorRef = useRef<Element | null>(anchor)
  const tipRef = useRef<HTMLDivElement>(null)
  const position = useTipPosition(true, anchorRef, tipRef)
  const group = medalGroupOf(code)
  const count = medal?.count ?? 1
  const when = medal?.at ? whenLabel(code, medal.at) : null
  const figure = medal ? figureOf(code, medal) : null

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      className="tip medal-tip"
      style={{
        position: 'fixed',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        maxWidth: 300,
        zIndex: 60,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <span aria-hidden="true" className="medal-tip-mark">
        <MedalMark code={code} size={34} />
      </span>
      <p className="medal-tip-name">
        {MEDALS[code].name}
        {count > 1 && <span className="medal-tip-count"> ×{formatNumber(count)}</span>}
      </p>
      <span className="medal-tasnif-group" data-group={group}>
        {MEDAL_GROUP_LABEL[group]}
      </span>
      <p className="medal-tip-rule">{MEDAL_RULES[code]}</p>
      {when && (
        <p className="medal-tip-when">
          {count > 1 ? `${formatNumber(count)} marta · oxirgisi ${when}` : when}
          {figure && <> · {figure}</>}
        </p>
      )}
    </div>,
    document.body,
  )
}

/** Day medals name the day, the year medal the year, every other medal its month. */
function whenLabel(code: MedalCode, at: string): string {
  if (code === 'day-winner' || code === 'day-record') return formatDate(at)
  if (code === 'year-champion') return `${at.slice(0, 4)}-yil`
  return monthLabel(at)
}

/**
 * The figure that won THIS instance, where the medal has one worth printing.
 *
 * `orders` is read by NAME per medal and never generically: on `rookie` it
 * carries the PLACE and on `work-month` the DAYS worked (see `SellerMedalDto`),
 * so a shared «N buyurtma» would print both wrong. Streaks and the first sale
 * carry no figure.
 */
function figureOf(code: MedalCode, medal: SellerMedalDto): string | null {
  switch (code) {
    case 'month-gold':
    case 'month-silver':
    case 'month-bronze':
    case 'day-winner':
    case 'day-record':
    case 'year-champion':
      return medal.amount ? formatUzs(medal.amount.amount) : null
    case 'jump':
      return medal.percent !== null ? `+${formatPercent(medal.percent, 0)}` : null
    case 'conversion-master':
    case 'clean-month':
      return medal.percent !== null ? `${formatPercent(medal.percent, 1)} yetkazilgan` : null
    case 'work-month':
      return medal.orders !== null ? `${formatNumber(medal.orders)} kun ishlagan` : null
    case 'rookie':
      return medal.orders !== null ? `${formatNumber(medal.orders)}-oʻrin` : null
    default:
      return null
  }
}
