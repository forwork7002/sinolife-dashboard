'use client'

import { Fragment, useLayoutEffect, useRef, useState } from 'react'

import { MedalMark } from '@/features/sellers/MedalMark'
import { MEDALS, MEDAL_ORDER, RARE_MEDALS } from '@/features/sellers/medalCatalog'
import type { MedalCode } from '@/lib/api'
import { useReducedMotion } from '@/lib/useReducedMotion'

/**
 * Medallar tasnifi — what every medal on the board means, crawling along the
 * foot of the screen.
 *
 * WHY IT EXISTS. A medal on this board prints no word: a seat's shelf and a
 * row's three marks are drawings, and their names live in `aria-label`s a
 * television never reads out. Fourteen drawings with no key are decoration; a
 * seller who does not know that the crescent is «oy yakunida 1-oʻrin» cannot
 * want it. The client asked for the key on the board itself, 2026-09-18 —
 * «medallar tasnifi pastda aylanib turishi kerak».
 *
 * A CRAWL, FOR THE RECORD WALL'S REASONS (`RecordWall`): a television has no
 * mouse, so nothing here can be opened or hovered; fourteen entries do not fit
 * one line at a size read from a desk away; and a card that flips hides
 * thirteen meanings behind a wait. Same mechanism, to the letter — the run is
 * rendered twice and slides exactly one copy's width, the pace is fixed in
 * PIXELS so it reads the same on a laptop and on the television, and reduced
 * motion hands back a strip the reader scrolls by hand.
 *
 * SLOWER THAN THE WALL. The wall carries names and sums a reader already
 * knows how to parse; this carries a rule, which is a sentence to be read
 * once and understood. 38 px/s is a full loop in about two minutes.
 *
 * THE RULES ARE RESTATED FROM THE ENGINE, NOT INVENTED HERE. Each line below
 * is `domain/analytics/sellerMedals.ts` in the floor's words — the thresholds
 * (`MEDAL_MIN_ORDERS` 20, `CLEAN_MONTH_PERCENT` 80, `WORK_MONTH_SHARE` 60%,
 * `JUMP_GROWTH` ×1,5, three CLOSED months for a streak, top-3 / top-10) are
 * the numbers the medals are actually awarded on. The frontend may not import
 * the server domain (layer rule), so they are typed out; change a threshold
 * there and the sentence here changes in the same commit, or this strip lies
 * to the people it is meant to motivate.
 *
 * THREE GROUPS, NAMED — that is the «tasnif». The metal already says the group
 * on the medal itself (a solid disc, a gold ring, a steel ring); the strip
 * says it once in words at the head of each group, so the drawing and the
 * word are learnt together.
 *
 * THIS IS A KEY TO THE MEDALS, NOT THE LEVEL LADDER COMING BACK. The client
 * removed seller levels on 2026-09-17 («uroven kerak emas, medallar qolsin»)
 * and `sellersMedals.test.tsx` still refuses that board's vocabulary anywhere
 * on the page — which is why nothing here is named after it. A group is a
 * property of a MEDAL; no seller is ranked, gated or titled by it.
 */

/** How fast the strip travels, in CSS pixels per second. See above. */
const PIXELS_PER_SECOND = 38

/** The strip's medal size, px — a row medal's sibling, so what is explained is what is seen. */
const TASNIF_MEDAL_SIZE = 28

const RULES: Readonly<Record<MedalCode, string>> = Object.freeze({
  'year-champion': 'yil yakunida 1-oʻrin',
  'month-gold': 'oy yakunida 1-oʻrin',
  'month-silver': 'oy yakunida 2-oʻrin',
  'month-bronze': 'oy yakunida 3-oʻrin',
  'streak-fire': '3 oy ketma-ket top-3 da',
  'conversion-master': 'oyning eng yuqori konversiyasi (20+ buyurtma)',
  'day-record': 'eng katta kunlik savdo rekordi',
  'streak-steady': '3 oy ketma-ket top-10 da',
  'clean-month': 'oyda 80% va undan koʻp yetkazilgan (20+ buyurtma)',
  jump: 'oʻtgan oydan 1,5 barobar koʻp savdo',
  rookie: 'birinchi toʻliq oyida top-10 da',
  'day-winner': 'kun yakunida 1-oʻrin',
  'work-month': 'ish kunlarining 60% va undan koʻpida savdo',
  'first-sale': 'birinchi yetkazilgan savdo',
})

type Group = 'honour' | 'rare' | 'daily'

const GROUP_LABEL: Readonly<Record<Group, string>> = Object.freeze({
  honour: 'Oliy mukofot',
  rare: 'Nodir',
  daily: 'Kundalik',
})

/** The four awards struck as a solid metal disc — a year or a month won outright. */
const HONOURS: ReadonlySet<MedalCode> = new Set<MedalCode>(['year-champion', 'month-gold', 'month-silver', 'month-bronze'])

/** Solid metal disc → honour; a gold ring → rare; a steel ring → daily. `RARE_MEDALS` is the catalog's own set. */
function groupOf(code: MedalCode): Group {
  return HONOURS.has(code) ? 'honour' : RARE_MEDALS.has(code) ? 'rare' : 'daily'
}

export function MedalTasnif() {
  const reduced = useReducedMotion()
  const runRef = useRef<HTMLDivElement>(null)
  const [travel, setTravel] = useState(0)

  /*
    Measured in a LAYOUT effect and re-measured on resize, exactly as the
    record wall does and for its reasons: the type ramps with the viewport, so
    the same fourteen entries are a different number of pixels on a laptop and
    on the television. `ResizeObserver` is tested for because jsdom has none —
    there the strip simply does not crawl.
  */
  useLayoutEffect(() => {
    const el = runRef.current
    if (!el) return
    const measure = () => setTravel(el.scrollWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const seconds = travel > 0 ? travel / PIXELS_PER_SECOND : 0
  const crawling = !reduced && seconds > 0

  return (
    <div className="medal-tasnif" role="group" aria-label="Medallar tasnifi" aria-live="off">
      {/* Fixed, not crawling: the strip's own name, so a reader who looks up
          mid-loop knows what the moving line is a list OF. */}
      <span className="medal-tasnif-title">Medallar</span>
      <div className="medal-tasnif-window">
        <div
          className={`medal-tasnif-track${crawling ? ' medal-tasnif-track--crawling' : ''}`}
          style={
            crawling
              ? ({
                  '--tasnif-travel': `${travel}px`,
                  animationDuration: `${seconds}s`,
                } as React.CSSProperties)
              : undefined
          }
        >
          <TasnifRun ref={runRef} />
          {/* The second copy is decoration, not content — see `RecordWall`. */}
          {crawling && <TasnifRun hidden />}
        </div>
      </div>
    </div>
  )
}

function TasnifRun({ ref, hidden = false }: { ref?: React.Ref<HTMLDivElement>; hidden?: boolean }) {
  return (
    <div className="medal-tasnif-run" ref={ref} aria-hidden={hidden ? 'true' : undefined} role={hidden ? undefined : 'list'}>
      {MEDAL_ORDER.map((code, index) => {
        const group = groupOf(code)
        const opensGroup = index === 0 || groupOf(MEDAL_ORDER[index - 1]!) !== group
        return (
          <Fragment key={code}>
            {opensGroup && (
              <span className="medal-tasnif-group" data-group={group}>
                {GROUP_LABEL[group]}
              </span>
            )}
            <span className="medal-tasnif-entry" role={hidden ? undefined : 'listitem'}>
              {/* The name is printed beside it, so the drawing stays silent. */}
              <span aria-hidden="true" className="medal-tasnif-mark">
                <MedalMark code={code} size={TASNIF_MEDAL_SIZE} />
              </span>
              <span className="medal-tasnif-name">{MEDALS[code].name}</span>
              <span className="medal-tasnif-rule">{RULES[code]}</span>
            </span>
          </Fragment>
        )
      })}
    </div>
  )
}
