'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states/States'
import { InitialChip } from '@/components/ui/DataTable'
import { MultiplyGlyph } from '@/components/ui/Icons'
import { apiGet, type DepartmentMemberDto, type StructureDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/**
 * The unit's own people, in the panel the portal opens beside the chart.
 *
 * It answers the question the client asked this screen to be wired to the floor
 * for — «kim kimning qoʻlida ishlayapti» — so the roster is the panel's whole
 * content and the head is at the top of it, marked.
 *
 * IT NOW ALSO ANSWERS IT UPWARD. The breadcrumb over the unit's name is its
 * chain to the company root and every crumb is a button, so walking up the tree
 * is a click rather than a pan — and selecting an ancestor re-centres its card,
 * which makes the breadcrumb animate the chain it is describing. Under the name
 * sits the one line a seller opens this page to read: who this unit answers to.
 * That is not always the unit's own head — «Тошкент онлайн» has no `UF_HEAD` at
 * all — so it walks up until it finds one.
 *
 * A SECOND REQUEST, not a field on every node. The chart draws twenty cards and
 * a reader opens one panel; shipping 289 people to render thirteen of them
 * would put the entire roster on the wire again on every change of selection.
 *
 * WHAT THE SOURCE HAS AND THIS DOES NOT: the «Коммуникации» tab, «Добавить
 * сотрудников» and the «...» menu. The first is a Bitrix24 chat feature this
 * application has no access to; the other two write into the portal, and
 * nothing here writes to a CRM.
 */
export function DepartmentPanel({
  node,
  trail,
  highlightName,
  onSelect,
  onClose,
}: {
  node: StructureDto
  /**
   * This unit's ancestors, root first, WITHOUT the unit itself.
   *
   * Built by the page from the tree it already holds rather than from a
   * `parentId` on the DTO, which there is not one of. Empty on the root, where
   * the breadcrumb is simply not drawn — «SinoLife ›» over «SinoLife» would be
   * a crumb pointing at the heading beneath it.
   */
  trail: readonly {
    readonly id: string
    readonly name: string
    /** That ancestor's own head, where the portal lists one. */
    readonly headName: string | null
  }[]
  /**
   * A person the search matched, to be marked in the list.
   *
   * A NAME rather than an id, deliberately. `memberNames` on the tree and
   * `fullName` here are the same `employee."fullName"` column, so a string
   * compare is exact — and carrying ids instead would mean turning the SQL's
   * `array_agg(e."fullName")` into a `jsonb_agg` of objects, which ripples
   * through the node type, the `src/lib/api.ts` mirror and both test fixtures
   * to mark one row. Two people who genuinely share a full name both light,
   * which is the honest answer to a search for that name.
   */
  highlightName?: string
  /** Selecting an ancestor from the breadcrumb. */
  onSelect: (id: string) => void
  onClose: () => void
}) {
  /*
    NO WINDOW IN THE KEY, because there is none in the request.

    This used to carry the page's `apiParams` so the panel's money matched the
    card's. There is no money on either any more and the endpoint is dateless,
    so the roster of one unit is one answer, cached once, for as long as the
    reader is on the page.
  */
  const query = useQuery({
    queryKey: ['structure-roster', node.id],
    queryFn: ({ signal }) =>
      apiGet<DepartmentMemberDto[]>('/insights/structure/roster', { departmentId: node.id }, signal),
  })

  /*
    Escape closes it, from anywhere on the page.

    Not a focus trap: this panel sits beside the chart rather than over it, and
    trapping focus would take the arrow keys away from the tree the reader is
    steering. Escape is the one thing a panel owes a keyboard user, and the
    close button is the first thing in its own tab order.
  */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const people = query.data?.data ?? []
  const active = people.filter((p) => p.isActive)

  /*
    A CRUMB CLICK REMOUNTS THIS PANEL, AND FOCUS MUST NOT FALL TO <body>.

    The page keys the panel by department, so selecting an ancestor from the
    breadcrumb destroys the very button that was activated and mounts a new
    panel. With nothing focused, the next Tab restarted at the skip link and
    walked the entire application chrome to get back here. Focus lands on the
    new panel — but only when it was genuinely lost: a card click leaves focus
    on the card, and a pasted link leaves it wherever the browser put it, and
    neither may be stolen.
  */
  const asideRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (document.activeElement === document.body) {
      asideRef.current?.focus({ preventScroll: true })
    }
  }, [])

  /*
    WHO THIS UNIT ANSWERS TO — not always its own head.

    Two shapes on this portal make the naive version wrong. «Тошкент онлайн» has
    no `UF_HEAD`, so its people answer upward to NEWGEN's head; and a unit whose
    named head does not sit in it gets no head row at all (see `head` on the
    DTO), which is the same case. Walking the trail from the nearest ancestor
    outward gives the first real manager above this unit, and null only at the
    top of a company that has named nobody.
  */
  const manager =
    node.head?.name ??
    [...trail].reverse().find((step) => step.headName !== null)?.headName ??
    null

  return (
    <aside
      ref={asideRef}
      className="org-panel"
      aria-label={`${node.name} — xodimlar`}
      // A live region would announce the whole roster on every selection. The
      // heading below is what a screen reader is sent to instead.
      tabIndex={-1}
    >
      <header className="org-panel-head">
        <div className="min-w-0 flex-1">
          {trail.length > 0 && (
            /*
              The chain, in words, over the unit it belongs to.

              `flex` with the last crumb allowed to shrink and the separators
              fixed: the panel is 320px and three Cyrillic unit names do not fit,
              so the names truncate individually rather than wrapping the nav to
              three lines and pushing the roster down.
            */
            <nav className="org-trail" aria-label="Yuqoridagi boʻlimlar">
              {trail.map((step, i) => (
                <span key={step.id} className="org-trail-step">
                  {i > 0 && (
                    <span className="org-trail-sep" aria-hidden="true">
                      ›
                    </span>
                  )}
                  <button
                    type="button"
                    className="focusable org-trail-link"
                    onClick={() => onSelect(step.id)}
                    title={`${step.name} boʻlimiga oʻtish`}
                  >
                    {step.name}
                  </button>
                </span>
              ))}
            </nav>
          )}

          <h3 className="truncate text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
            {node.name}
          </h3>

          {manager ? (
            <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
              {/* «Rahbar» when it is this unit's own; «Yuqoridagi rahbar» when
                  it was inherited, or the line would name somebody who does not
                  lead this team as though they did. */}
              {node.head ? 'Rahbar' : 'Yuqoridagi rahbar'}:{' '}
              <span style={{ color: 'var(--ink-primary)' }}>{manager}</span>
            </p>
          ) : (
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Rahbar tayinlanmagan
            </p>
          )}

          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {/*
              The count above the list is the ACTIVE one, and the list carries
              everybody. A panel reading «13 xodim» over nine visible rows is a
              gap that costs an afternoon, so the deactivated are counted out
              loud rather than quietly dropped.
            */}
            {/*
              «RAHBAR BILAN», because the card one click away says the other
              number. The card prints `subordinateCount` — the portal's count,
              head excluded — and this prints `memberCount`, which the DTO
              defines as that plus 0 or 1. Same unit, one click apart, two
              figures, and nothing said which was which. Naming the head is
              cheaper than changing either number, and both stay true.
            */}
            Jami {formatNumber(node.memberCount)} faol xodim
            {node.head !== null && ' (rahbar bilan)'}
            {people.length > active.length &&
              ` · ${formatNumber(people.length - active.length)} oʻchirilgan`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Yopish"
          className="focusable org-panel-close"
        >
          <MultiplyGlyph />
        </button>
      </header>

      <div className="org-panel-body">
        {query.isPending && <LoadingSkeleton rows={5} />}

        {query.isError && (
          <ErrorState
            message={(query.error as Error).message}
            onRetry={() => void query.refetch()}
          />
        )}

        {!query.isPending && !query.isError && people.length === 0 && (
          <EmptyState
            title="Boʻlim boʻsh"
            body="Bitrix24 bu boʻlimda hech kimni koʻrsatmayapti. Odatda bu boʻlim ostidagi jamoalarda ishlaydi."
          />
        )}

        {people.length > 0 && (
          <ul className="org-panel-list">
            {people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                found={highlightName !== undefined && person.fullName === highlightName}
              />
            ))}
          </ul>
        )}

        {/*
          SAY WHY THIS LIST IS LONGER THAN THE UNIT IT BELONGS TO.

          Bitrix24 lists a person in every unit of their `UF_DEPARTMENT` and
          this dashboard credits each person to the first one. Nine of the
          portal's 208 active people sit in two units, so a roster can carry
          somebody whose home is another team — which is exactly what a reader
          asking «kim kimning qoʻl ostida» has to be told, or they will read a
          borrowed operator as a member of this team.
        */}
        {people.some((p) => !p.isPrimary) && (
          <p className="mt-2 px-1.5 pb-1 text-[10px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
            «Ikkinchi boʻlim» belgisi qoʻyilgan xodimlarning asosiy boʻlimi boshqa — Bitrix24 ularni
            bir vaqtning oʻzida ikkala boʻlimda koʻrsatadi.
          </p>
        )}
      </div>
    </aside>
  )
}

function PersonRow({
  person,
  found,
}: {
  person: DepartmentMemberDto
  /** The search's answer, marked where the reader was sent to look for it. */
  found: boolean
}) {
  /*
    MARKED AND BROUGHT INTO VIEW. The roster is in the SQL's order, not the
    match's, so in a unit of eighteen the person the reader searched for could
    sit at row fifteen — below the fold of a scroller that is two thirds of a
    phone. A mark nobody can see is the «eighteen rows to scan» this exists to
    spare them. jsdom has no scrollIntoView, hence the guard.
  */
  const rowRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (found && typeof rowRef.current?.scrollIntoView === 'function') {
      rowRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [found])

  return (
    <li
      ref={rowRef}
      className="org-person"
      data-inactive={!person.isActive || undefined}
      data-found={found || undefined}
    >
      <InitialChip name={person.fullName} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px]" style={{ color: 'var(--ink-primary)' }}>
            {person.fullName}
          </span>
          {person.isHead && <span className="org-tag org-tag--head">Rahbar</span>}
          {/*
            «Ikkinchi boʻlim» is not decoration.

            Bitrix24 lists a person in every unit of their UF_DEPARTMENT, and
            the tree draws them on every one of those cards. Without the tag
            their row here would read as a member of this team, which is the
            one thing this screen must not get wrong.
          */}
          {!person.isPrimary && <span className="org-tag">Ikkinchi boʻlim</span>}
          {!person.isActive && <span className="org-tag org-tag--off">Faol emas</span>}
        </div>

        {person.position && (
          <p className="truncate text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
            {person.position}
          </p>
        )}
      </div>
    </li>
  )
}
