'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { PageShell } from '@/features/shared/PageShell'
import {
  STRUCTURE_VIEWS,
  type StructureView,
  useDashboardFilters,
} from '@/features/shared/useDashboardFilters'
import { type StructureDto, apiGet } from '@/lib/api'
import { t } from '@/lib/messages'

import { DepartmentPanel } from './DepartmentPanel'
import { OrgChart } from './OrgChart'
import { StructureTable } from './StructureTable'

/**
 * The company as Bitrix24 records it — and nothing else.
 *
 * ONE QUESTION, ONE SCREEN. The client's own words for what this page is for:
 * «har bir xodim kim kimning qoʻl ostida ishlayotganini tushunishi kerak».
 * Everything that did not answer that has been taken off it — the «Ishlagan
 * xodimlar» ring, the three tiles, the reporting window and every figure in
 * soʻm. Money on this dashboard is stated in one place, Boshqaruv markazi, and
 * a second statement of it here was a second place for it to disagree.
 *
 * WHAT THAT BUYS IS THE SCREEN ITSELF. The band those instruments occupied was
 * around 420px of a 950px viewport, so the chart — the only thing on the page
 * anybody opens it for — began below the fold and the reader scrolled to reach
 * a canvas that then had 200px to draw a company in. It now takes the whole
 * page (`fill`), which is the difference between a diagram and a keyhole.
 *
 * NO REPORTING WINDOW, and the endpoint has none either. Who reports to whom is
 * a fact about today; the two figures that were period-scoped are gone.
 * `period={false}` is the whole mechanism: PageShell draws no window control
 * and tells Shell (`periodAware`) that this screen has no dates — the same path
 * Foydalanuvchilar takes. The rail's link still carries the reader's remembered
 * `?preset=` here, as it does to /users; nothing on this page reads it, and the
 * requests below deliberately send none of it.
 *
 * TWO READINGS OF ONE ANSWER. The default is the org chart the portal itself
 * draws at `obey.bitrix24.kz/hr/structure/` — cards on a pannable canvas,
 * joined by connectors, one row per level — because a table of indented rows
 * answers «kim kimning qoʻlida» badly. The table is still here behind the
 * toggle: it is the only reading that shows every column at once, and the only
 * one that prints. Both read the SAME request, so they cannot disagree about a
 * figure and switching between them costs nothing.
 */
export function StructurePage() {
  const { filters, update } = useDashboardFilters()
  /*
    Which person the search sent the reader to, so the roster can mark them.

    Component state and not the URL: it is an artefact of one search in one
    session, not a view somebody would paste into a chat — `?dep=` already
    carries the part of that which is worth sharing.
  */
  const [foundPerson, setFoundPerson] = useState<string | undefined>(undefined)

  /*
    A CONSTANT KEY, AND NO PARAMETERS ON THE WIRE.

    `apiParams` always carries `preset`, read off the URL — and every sidebar
    link carries the reader's remembered window — so passing it here would key
    one unchanging answer under a dozen windows and refetch the whole tree each
    time somebody arrived from a different screen. The endpoint is dateless;
    the request says so.
  */
  const query = useQuery({
    queryKey: ['structure'],
    queryFn: ({ signal }) => apiGet<StructureDto[]>('/insights/structure', {}, signal),
  })

  const roots = useMemo(() => query.data?.data ?? [], [query.data])
  const flat = useMemo(() => flatten(roots), [roots])

  const viewerDepartmentId = flat.find((n) => n.isViewerDepartment)?.id ?? null
  const selected = filters.dep ? (flat.find((n) => n.id === filters.dep) ?? null) : null

  const chart = filters.view === 'chart'

  const toggle = (
    <SegmentedControl<StructureView>
      value={filters.view}
      options={STRUCTURE_VIEWS.map((view) => ({
        value: view,
        label: view === 'chart' ? 'Chizma' : 'Roʻyxat',
      }))}
      onChange={(view) => update({ view })}
      ariaLabel="Koʻrinish"
    />
  )

  return (
    <PageShell
      title={t.modules.structure.title}
      /*
        NO LEAD LINE, and none reserved either.

        The old one said what the money columns were dated by, which was the
        only thing on it a reader needed telling. With no money and no window
        there is nothing left to explain that the chart does not say better in
        its own controls — and PageShell only holds the line open for a page
        that has a window or a `meta.period` on the way, so a screen with
        neither costs nothing. On a canvas sized to the viewport, 20px of
        held-open space is 20px of chart.
      */
      // Not series-8: it is 4.1 ΔE from --status-critical in light mode, so a
      // page accented with it makes red mean two things at once.
      accent="var(--series-6)"
      period={false}
      // The toggle rides the title's own row. In the filter row it would open
      // a second band on a page whose whole point is the height below it.
      actions={toggle}
      // The chart is an instrument and takes the screen; the table is a
      // document and scrolls like every other table in the application.
      fill={chart}
    >
      {query.isPending && <ChartSkeleton height={chart ? 480 : 280} />}
      {query.isError && (
        <ErrorState
          message={(query.error as Error).message}
          onRetry={() => void query.refetch()}
        />
      )}
      {/* `!isError` too: a failed request rendered the error AND "the
          structure is empty" one under the other, which are contradictory
          claims — the second one is a guess about data nobody received. */}
      {!query.isPending && !query.isError && roots.length === 0 && (
        <EmptyState
          title="Tuzilma boʻsh"
          body="Bitrix24 kompaniya strukturasi import qilinmagan."
        />
      )}

      {roots.length > 0 &&
        (chart ? (
          /*
            NO CARD AROUND THE CANVAS.

            `.org-canvas` already paints the panel's own border, radius and
            sunken surface, so a ChartCard around it was a second frame drawn
            on top of the first — and it cost a ~49px header repeating the
            page title plus 19px of padding, on the one screen where every
            pixel is chart.
          */
          <OrgChart
            roots={roots}
            selectedId={selected?.id ?? null}
            onSelect={(id, person) => {
              setFoundPerson(person)
              update({ dep: id ?? undefined })
            }}
            viewerDepartmentId={viewerDepartmentId}
            panel={
              selected && (
                <DepartmentPanel
                  // Keyed by department, so switching cards remounts the
                  // panel rather than showing the previous unit's roster
                  // under the new unit's name while the request is in flight.
                  key={selected.id}
                  node={selected}
                  trail={trailTo(roots, selected.id)}
                  highlightName={foundPerson}
                  onSelect={(id) => {
                    setFoundPerson(undefined)
                    update({ dep: id })
                  }}
                  onClose={() => update({ dep: undefined })}
                />
              )
            }
          />
        ) : (
          <ChartCard
            title="Tuzilma"
            hint="«Boʻysunuvchi» — Bitrix24 shu boʻlimda koʻrsatgan faol xodimlar, rahbarsiz; «Oʻzida» — faqat toʻgʻridan-toʻgʻri biriktirilganlar. Xodim soni boʻlimning oʻzi va uning ostidagi barcha boʻlimlar boʻyicha."
          >
            <StructureTable nodes={roots} />
          </ChartCard>
        ))}
    </PageShell>
  )
}

function flatten(nodes: readonly StructureDto[]): StructureDto[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

/**
 * The chain of command down to one unit, root first.
 *
 * This is the answer the page exists to give, written out in words: «NEWGEN ›
 * Тошкент онлайн › Sevinch(ROP)». The chart draws it and the panel spells it,
 * because a reader who has just found their own team still has to trace the
 * connectors upward by eye to learn who is above it — and on a tree four
 * thousand units wide the parent is often off screen.
 *
 * Returns the ancestors ONLY, nearest last; the unit itself is the panel's own
 * heading and would read as its own manager.
 */
function trailTo(
  roots: readonly StructureDto[],
  id: string,
): readonly { id: string; name: string; headName: string | null }[] {
  const walk = (
    nodes: readonly StructureDto[],
    above: readonly StructureDto[],
  ): readonly StructureDto[] | null => {
    for (const node of nodes) {
      if (node.id === id) return above
      const hit = walk(node.children, [...above, node])
      if (hit) return hit
    }
    return null
  }
  /*
    `head`, not `headName`: the first is the resolved answer — null where the
    portal names somebody it does not list inside the unit — and the panel uses
    it to say who a headless unit actually answers to. Reading the raw field
    would seat «Навоий»'s named head over a unit his own record says he is not
    in, which is the one thing this screen must not do.
  */
  return (walk(roots, []) ?? []).map((n) => ({
    id: n.id,
    name: n.name,
    headName: n.head?.name ?? null,
  }))
}
