'use client'

import { InitialChip } from '@/components/ui/DataTable'
import type { StructureDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

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
 * that admits it is a mirror.
 *
 * WHAT IT GAINS INSTEAD IS THE TEAM. The strip above the footer used to be the
 * unit's revenue over the reporting window; the client asked for money to be
 * stated on «Boshqaruv markazi» and nowhere else, and this screen has no window
 * at all. That screen went on 2026-09-10; the absence here is unchanged.
 * The room it left goes to the people, because «har bir sotuvchi bilishi kerak
 * kim kimlar borligini» is half of what this page was asked for and it was
 * previously answered one unit at a time, by opening a panel. The names ride
 * the tree's own payload already — they were put there for the search box — so
 * a face on every card at once costs no request.
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
  onHover,
  index,
  total,
  tabbable,
  onChain,
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
  /** Pointer entered (true) or left (false) this card. */
  onHover: (over: boolean) => void
  /** 1-based position among siblings, for the tree semantics. */
  index: number
  total: number
  /** The one card in the tab order. See the roving tabindex note in OrgChart. */
  tabbable: boolean
  /**
   * On the chain from the highlighted card up to the company root.
   *
   * This is the answer to «kim kimning qoʻl ostida ishlayapti», drawn rather
   * than written: one lit path from a team up to the company, instead of a
   * single lit connector and nineteen identical grey ones the reader had to
   * trace by eye. The chain's own END wears it too — it is a path, not a set of
   * superiors — and `selected` still reads on top of it, because that rule
   * comes later in the stylesheet.
   */
  onChain: boolean
}) {
  const hasChildren = node.childCount > 0
  /*
    FIVE, AND THE COUNT NEXT TO THEM IS THE CAPTION'S.

    Five chips is what fits at 236px beside a «+N» without the strip wrapping
    and breaking the fixed card box the connectors are drawn against. The
    overflow is stated rather than silently cut: a card showing five faces over
    a unit of eighteen would be a wrong answer to the question the strip exists
    to answer.

    THE HEAD IS NOT IN IT. They have their own row two lines up, and the caption
    directly above the strip says «Boʻysunuvchilar: N» — the portal's own count,
    which excludes them. Drawn from `memberNames` unfiltered, the strip showed
    one face more than the number over it and the head's initials twice on one
    card. Matched by name, the same way the search marks a roster row.
  */
  const shown = node.memberNames.filter((name) => name !== node.head?.name).slice(0, 5)
  const more = Math.max(0, node.subordinateCount - shown.length)

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
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      className="focusable org-card"
      data-selected={selected || undefined}
      data-chain={onChain || undefined}
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
          THE TEAM, AS FACES.

          Overlapped like a stack of avatars rather than laid out in a row: at
          236px five separate chips and a «+N» do not fit, and the overlap is
          also what makes them read as one group — «these people», not five
          fields. Deliberately NOT clickable: the whole card is one control, the
          tree pattern gives it one tab stop, and a chip that opened a person
          would put six more targets inside every treeitem.

          aria-hidden, because the names are already in the card's accessible
          label's neighbourhood — the panel is where a screen reader is sent for
          the roster, and six initials read aloud between the head's name and
          the fold button is noise, not information.
        */}
        {shown.length > 0 && (
          <span
            className="org-card-people"
            aria-hidden="true"
            title={
              more > 0
                ? `${shown.join(', ')} va yana ${formatNumber(more)} xodim`
                : shown.join(', ')
            }
          >
            {shown.map((name, i) => (
              <span key={`${name}-${i}`} className="org-card-chip">
                <InitialChip name={name} />
              </span>
            ))}
            {more > 0 && <span className="org-card-more">+{formatNumber(more)}</span>}
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
