'use client'

import { InitialChip } from '@/components/ui/DataTable'
import type { StructureDto } from '@/lib/api'
import { formatCompactUzs, formatNumber } from '@/lib/format'

/**
 * One department, drawn the way the portal draws it.
 *
 * The anatomy is `obey.bitrix24.kz/hr/structure/`'s own, top to bottom: the
 * unit's name, the head with a pill counting everyone under them, the
 * «Подчинённые» caption over the unit's own headcount, and a footer that either
 * expands the units below or says there are none. Every figure in it was
 * checked against that screen on 2026-09-05 — see the SQL that produces them.
 *
 * WHAT THE SOURCE HAS AND THIS DOES NOT: the drag handle, the «+» on the
 * connector, the «...» menu and the ДОБАВИТЬ button. All four are writes into
 * Bitrix24, and nothing in this application writes to a CRM — the sync engine
 * is the only thing that speaks to one, and it reads. Drawing them anyway would
 * put four controls on the card that do nothing, which is worse than a card
 * that admits it is a mirror. What the card gains instead is the one thing the
 * portal cannot show: the unit's money over the reporting window.
 */
export function OrgCard({
  node,
  x,
  y,
  width,
  height,
  selected,
  collapsed,
  matched,
  dimmed,
  onSelect,
  onToggle,
  index,
  total,
  tabbable,
}: {
  node: StructureDto
  /** Where the layout put it. Applied HERE rather than on a wrapper — see below. */
  x: number
  y: number
  width: number
  height: number
  selected: boolean
  collapsed: boolean
  /** Lit by the search box. */
  matched: boolean
  /** A search is running and this card is not one of the answers. */
  dimmed: boolean
  onSelect: () => void
  onToggle: () => void
  /** 1-based position among siblings, for the tree semantics. */
  index: number
  total: number
  /** The one card in the tab order. See the roving tabindex note in OrgChart. */
  tabbable: boolean
}) {
  const hasChildren = node.childCount > 0
  const money = node.revenue

  return (
    /*
      THE TREEITEM IS THE CONTROL, AND IT CARRIES ITS OWN POSITION.

      Two things this deliberately does NOT do. It does not sit inside a
      positioning wrapper: `role="tree"` owns its `treeitem`s, and a generic
      div between them is a relationship some screen readers simply do not
      follow — so the coordinates the layout computed are applied to this
      element itself. And it does not put a `<button>` inside the treeitem: a
      nested button is announced as a button, which loses the level, the
      position among siblings and the expanded state that make a tree navigable
      at all. The div takes the click, the roving tab stop and the arrow keys
      (handled by the canvas, which they bubble to), which is the WAI-ARIA tree
      pattern as written.
    */
    <div
      role="treeitem"
      data-card-id={node.id}
      aria-level={node.depth + 1}
      aria-setsize={total}
      aria-posinset={index}
      aria-selected={selected}
      {...(hasChildren ? { 'aria-expanded': !collapsed } : {})}
      tabIndex={tabbable ? 0 : -1}
      onClick={onSelect}
      className="focusable org-card"
      data-selected={selected || undefined}
      data-matched={matched || undefined}
      data-dimmed={dimmed || undefined}
      style={{ left: x, top: y, width, height }}
      // The accessible name has to carry what the card says, because a screen
      // reader gets no help from the layout that makes it legible.
      aria-label={`${node.name}. ${
        node.head ? `Rahbar ${node.head.name}. ` : 'Rahbar tayinlanmagan. '
      }${formatNumber(node.subordinateCount)} xodim.`}
    >
      <div className="org-card-hit">
        <span className="org-card-titlerow">
          <span className="org-card-title" title={node.name}>
            {node.name}
          </span>
          {/* The reader's own unit. The portal badges it «ВАШ ОТДЕЛ»; this is
              the same idea in the app's language, and it is why «Meni topish»
              in the corner has somewhere to fly to. */}
          {node.isViewerDepartment && <span className="org-badge-you">SIZ</span>}
        </span>

        {node.head ? (
          <span className="org-card-head">
            <InitialChip name={node.head.name} />
            <span className="min-w-0 flex-1">
              <span className="org-card-head-name" title={node.head.name}>
                {node.head.name}
              </span>
              {node.head.position && (
                <span className="org-card-head-role" title={node.head.position}>
                  {node.head.position}
                </span>
              )}
            </span>
            {/*
              Everyone under this head, across the WHOLE branch — the portal's
              own pill. It is not the unit's own headcount and it is not the sum
              of the row below: somebody who sits in two units of one branch is
              one person, counted once.
            */}
            <span
              className="org-card-pill"
              title={`Butun tarmoq boʻyicha ${formatNumber(node.head.managesCount)} xodim`}
            >
              <PeopleGlyph />
              {formatNumber(node.head.managesCount)}
            </span>
          </span>
        ) : (
          /*
            «Rahbar tayinlanmagan» is printed, not left blank.

            Two different facts land here and both are real on this portal:
            «Тошкент онлайн» has no UF_HEAD at all, and «Навоий» names one whose
            own units are two others — the source screen draws no head row for
            either. A blank strip would make the card look half-loaded; saying
            it is the difference between a gap in the data and a gap in the page.
          */
          <span className="org-card-head org-card-head-empty">Rahbar tayinlanmagan</span>
        )}

        <span className="org-card-meta">
          <span className="org-card-caption">Boʻysunuvchilar</span>
          <span className="org-card-count">{formatNumber(node.subordinateCount)} xodim</span>
        </span>

        {/*
          The one line the portal has no way to print.

          Only for a reader who may see the company's money — an OWN-scoped
          salesperson gets the chart without it rather than a «0 soʻm» beside a
          department that closed a billion. Null, never zero: see StructureDto.
        */}
        {money && (
          /*
            THE MONEY IS ROLLED UP; THE HEADCOUNT ABOVE IT IS NOT.

            `revenue` and `deals` are the unit plus everything beneath it —
            "how is Navoiy doing" means the branch — while «Boʻysunuvchilar» two
            lines up is the unit's own membership and is deliberately not
            rolled. On this portal that puts «0 xodim» directly above the whole
            company's revenue on the root card, and «Навоий» reads 0 people over
            six teams' worth of money. The two altitudes are both right and the
            card has to say which is which.
          */
          <span
            className="org-card-money"
            title="Shu boʻlim va uning ostidagi barcha boʻlimlar boʻyicha"
          >
            {money.amount === 0 ? (
              <span style={{ color: 'var(--ink-muted)' }}>Davr ichida tushum yoʻq</span>
            ) : (
              <>
                <span className="tabular" style={{ color: 'var(--ink-primary)' }}>
                  {formatCompactUzs(money.amount)}
                </span>
                <span style={{ color: 'var(--ink-muted)' }}>
                  {' '}
                  · {formatNumber(node.deals ?? 0)} bitim
                </span>
              </>
            )}
          </span>
        )}
      </div>

      <div className="org-card-foot">
        {hasChildren ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggle()
            }}
            aria-label={
              collapsed
                ? `${node.name} ostidagi ${formatNumber(node.childCount)} boʻlimni ochish`
                : `${node.name} ostidagi ${formatNumber(node.childCount)} boʻlimni yopish`
            }
            /*
              OUT of the tab order, on purpose.

              In a tree, folding is ArrowLeft and unfolding is ArrowRight — the
              treeitem's own `aria-expanded` announces the state and the arrow
              keys change it. A second tab stop per card would double the tab
              cost of the whole chart to reach a control the pattern already
              provides. It stays a real button so a pointer has something to
              hit and an element list still finds it.
            */
            tabIndex={-1}
            className="focusable org-card-foot-btn"
          >
            {formatNumber(node.childCount)} boʻlim
            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d={collapsed ? 'M2 4.5l4 4 4-4' : 'M2 7.5l4-4 4 4'}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <span className="org-card-foot-empty">boʻysunuvchi boʻlim yoʻq</span>
        )}
      </div>
    </div>
  )
}

/** The portal puts a people glyph in the head's pill; so does this. */
function PeopleGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <circle cx="6" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M1.8 13.2c0-2.2 1.9-3.6 4.2-3.6s4.2 1.4 4.2 3.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M11 4.2a2.2 2.2 0 0 1 0 4.2M12.2 13.2c0-1.5-.5-2.5-1.4-3.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
