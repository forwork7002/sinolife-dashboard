'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { PeriodFilter } from '@/components/layout/PeriodFilter'
import { Shell } from '@/components/layout/Shell'
import { Button } from '@/components/ui/Button'
import { MultiSelect, SearchInput } from '@/components/ui/Controls'
import { apiGet, type ResponseMeta } from '@/lib/api'
import type { RoleValue } from '@/lib/roles'
import type { SectionValue } from '@/lib/sections'
import { formatDate } from '@/lib/format'
import { t } from '@/lib/messages'
import type { DataScopeValue } from '@/lib/dataScope'
import { useDashboardFilters, useRestoreRememberedPeriod } from './useDashboardFilters'

export interface FilterOptions {
  readonly employees: readonly { id: string; fullName: string }[]
  readonly departments: readonly { id: string; name: string }[]
  readonly products: readonly { id: string; name: string }[]
  readonly sources: readonly { id: string; name: string }[]
  readonly stages: readonly { id: string; name: string }[]
  readonly lastSyncedAt: string | null
  /** Who is looking. Drives which nav entries render. */
  readonly viewer?: {
    readonly userId: string
    readonly role: RoleValue
    readonly sections: readonly SectionValue[]
    /** How much of each granted screen this account reads. See `@/lib/dataScope`. */
    readonly dataScope: DataScopeValue
    readonly canManageUsers: boolean
  }
}

/**
 * Filter options, fetched once and shared by every page.
 *
 * Cached for the session: employees, products and stages change on sync, not
 * between page views, so refetching them on every navigation would be a
 * round trip for data that has not moved.
 */
export function useFilterOptions() {
  return useQuery({
    queryKey: ['filters'],
    queryFn: ({ signal }) => apiGet<FilterOptions>('/meta/filters', {}, signal),
    /*
      BOTH, BECAUSE `staleTime` DOES NOT GATE THE TIMER.

      `refetchInterval` fires on its own clock and never asks whether the data
      is stale (query-core's `#updateRefetchInterval` calls `#executeFetch`
      directly), so this query inherited the global one-minute poll and the
      five minutes above bought nothing at all. Six statements — employees,
      departments, products, sources, stages, last sync — for five dropdowns
      whose contents change when the sync writes, once a minute, on every open
      tab, in front of a single database core.
    */
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })
}

export interface FilterToggles {
  /**
   * What the search box says it searches.
   *
   * The default is a bare "Qidirish…", which is honest on a page whose search
   * covers a title and nothing else. Where the box genuinely spans a whole
   * table, saying so is the difference between someone typing a phone number
   * and someone assuming it will not work.
   */
  readonly searchPlaceholder?: string
  readonly employees?: boolean
  readonly departments?: boolean
  readonly stages?: boolean
  readonly products?: boolean
  readonly sources?: boolean
  readonly search?: boolean
}

/**
 * Standard page frame: nav, period control, title, filter row.
 *
 * Every page shares it so the period control sits in the same place, the demo
 * badge is always visible, and the reporting window carries across navigation.
 */
export function PageShell({
  title,
  description,
  meta,
  filters: enabled = {},
  accent,
  actions,
  toolbar,
  controlsBesideTitle = false,
  stale = false,
  children,
  period = true,
  fill = false,
}: {
  title: string
  /**
   * The line under the title — and `null` is not the same as leaving it off.
   *
   * Omitted means "nothing written here YET": the paragraph is still drawn,
   * because a page that prints `meta.period`'s dates has to claim that height
   * before the first response lands (see the reservation note further down).
   * `null` means this page puts nothing there in any state — no lead line and
   * no dates — so nothing is held open for text that cannot arrive.
   *
   * ONLY PASS `null` ON A PAGE THAT ALSO SENDS NO `meta`. Everything meta
   * carries lives inside this one paragraph, dates included and — the part
   * that is easy to miss — the «davr qisqartirildi» badge, which is rendered
   * nowhere else in the application. A page that suppressed the line while
   * still passing a truncated comparison would drop that warning with nothing
   * on screen and no error anywhere.
   */
  description?: string | null
  meta?: ResponseMeta
  filters?: FilterToggles
  /**
   * Page identity, as a CSS colour.
   *
   * Sets `--accent` for this subtree. Exactly two things read it: the rule
   * under the title and the focus ring. Nothing that encodes a value does —
   * series colour has to stay stable across pages, or the same bar means two
   * things in two places.
   *
   * The sidebar's active marker is NOT in this subtree and never was. It sits
   * in Shell, above every page, so it resolved --accent from :root and was
   * permanently series-1 blue while this comment claimed otherwise. It is
   * chrome rather than page identity, and it is now explicitly coloured as
   * such rather than appearing to follow something it cannot see.
   */
  accent?: string
  actions?: ReactNode
  /**
   * The page's OWN controls, in the filter row rather than beside the title.
   *
   * `actions` sits in the header, right-aligned — the place for a page-level
   * ACTION, which is what Foydalanuvchilar' «+ Yangi hisob» is. A page whose
   * controls are FILTERS wants them with the other filters: the confirmation
   * board's РОП, status and Статистика sat on the far right of the header
   * while the window and the search box sat on the left, so one screen carried
   * two toolbars a metre apart and the reader crossed the page to narrow one
   * table.
   *
   * The ROW belongs to the shell, what goes in the slot belongs to the page.
   * Pass a Fragment rather than a wrapping `<div>` — then each control wraps
   * on its own against this row's `gap-2` instead of the group moving as one
   * block with a nested gap of its own.
   */
  toolbar?: ReactNode
  /**
   * Put the control row on the TITLE'S line instead of under it.
   *
   * The row is a line of its own by default, and on nearly every screen that
   * is right: five or six MultiSelects do not fit beside a heading, and a row
   * that sat under the title on one page and beside it on the next would make
   * the app look like it shifts as you navigate.
   *
   * The confirmation board is the exception, and the reason is arithmetic. Its
   * whole content is one table, its title is two words, and its controls come
   * to about half the width of the screen — so the row was spending a line,
   * plus the 16px gap above it, to say nothing the title's own line could not
   * have said beside it. Fifty pixels, on the page with the least to spare.
   *
   * The mechanism is `basis-full`, not a second copy of the row: the row is
   * always the header's last child, and it either claims a line of its own or
   * it does not. One row, one place in the DOM, and the same tab order either
   * way.
   */
  controlsBesideTitle?: boolean
  /**
   * True while the numbers on screen still belong to the PREVIOUS window.
   *
   * The query client keeps old data on a key change (placeholderData), which
   * is what stops a preset switch collapsing the page to skeletons — but it
   * also means the screen shows one window's figures under another window's
   * control for a moment, marked "ready". Wire this to `isPlaceholderData`
   * and the content dims until the honest numbers land. Background refetches
   * of the SAME window never set it, so the page stays still on the poll.
   */
  stale?: boolean
  children: ReactNode
  /**
   * Whether this page is read in a reporting window at all.
   *
   * Almost every page is. Account administration is not: a list of who may
   * sign in has no "this month", and a date control over it would be a
   * control that does nothing — which is worse than no control, because a
   * reader assumes it must be filtering something.
   */
  period?: boolean
  /**
   * Stretch the page body to the screen instead of to its own content.
   *
   * For a page whose content is an instrument rather than a document. Two
   * pages are, for two different reasons: Kadrlar tuzilmasi's org chart is a
   * canvas you pan and zoom, and every pixel it does not get is a card the
   * reader has to drag into view; Tasdiqlash navbati is one long table read
   * beside the portal's own board all day, and as an ordinary page it carried
   * TWO scrollbars — its own bounded table inside a page that also scrolled —
   * with the pager below the fold. Same word and same mechanism as
   * `ChartCard`'s `fill`, deliberately: this application has one name for
   * "take the height that is there".
   *
   * WHAT A PAGE ACTUALLY GETS IS ONE PLAIN BLOCK — `min-h-0 flex-1`, with no
   * `display: flex` and no gap, because the page this was written for holds a
   * single canvas. A page with several children builds its own column inside
   * it (the confirmation board does) rather than changing this wrapper, which
   * would move the org chart underneath it for a reason that has nothing to do
   * with the org chart.
   *
   * WHY `h-full` IS ENOUGH, with no `calc(100dvh − header)` anywhere. The
   * application is already exactly one viewport tall (`Shell`'s root sets
   * `height: 100dvh; overflow: hidden`) and `main` is `min-h-0 flex-1`, which
   * gives a flex item a DEFINITE main size — so a percentage height inside it
   * resolves, against `main`'s own content box, which is the padded area this
   * page is allowed to use. Nothing here has to know how tall the header is,
   * and nothing breaks the day it changes.
   *
   * The one thing that would break it is a `height` appearing on
   * `.page-container` in globals.css: that rule is unlayered and would beat the
   * layered Tailwind utility (the file documents the same mechanism for
   * `max-w-*`). `space-y-4` also has to go — margins cannot stretch a child —
   * and `gap-4` on the flex column is the visually identical replacement.
   */
  fill?: boolean
}) {
  const { filters, update, setPeriod, reset, activeCount } = useDashboardFilters()
  // Once per page: see the hook's own note on why it does not live in
  // useDashboardFilters, which a dozen components call.
  useRestoreRememberedPeriod(period)
  const options = useFilterOptions()
  const data = options.data?.data

  const anyFilter =
    enabled.employees || enabled.departments || enabled.stages || enabled.products ||
    enabled.sources || enabled.search

  const periodControl = period ? (
    <PeriodFilter
      value={filters.preset}
      from={filters.from}
      to={filters.to}
      onChange={setPeriod}
    />
  ) : null

  return (
    /*
      The sync time is no longer threaded through here. It used to be read
      from the filters payload and handed down for the rail's footer; the
      header fetches it from `/meta/alerts` itself, beside the two other facts
      it states, so no page has to carry a fact about the application in a
      prop any more.
    */
    <Shell
      dataSource={meta?.dataSource ?? options.data?.meta.dataSource}
      periodAware={period}
    >
      <div
        className={`page-container ${fill ? 'flex h-full min-h-0 flex-col gap-4' : 'space-y-4'}`}
        style={{
          ...(accent ? ({ '--accent': accent } as React.CSSProperties) : undefined),
          // A dimmed page is data awaiting replacement; opacity is cheap to
          // composite and the transition keeps the change from flickering.
          opacity: stale ? 0.6 : 1,
          transition: 'opacity 150ms var(--ease-out)',
        }}
        aria-busy={stale || undefined}
      >
        {/*
          The header zone carries the aurora — title, description and filters
          sit over it; data never does.

          `.page-atmosphere` (globals.css) paints two blurred chrome-tint
          blobs and masks them away over the bottom of the band, so the
          atmosphere dies before the first chart. It lives in
          its own absolutely-positioned, overflow-hidden layer rather than
          putting overflow-hidden on the content: the MultiSelect popovers in
          the filter row open downward past this box and must not be clipped.
          The layer bleeds up into main's padding so the glow starts at the
          top of the page, not 20px into it. pointer-events-none because
          scenery must never intercept a click meant for the controls over it.
        */}
        <div className={`relative ${fill ? 'shrink-0' : ''}`}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-5 bottom-0 overflow-hidden lg:-top-6"
          >
            <div className="page-atmosphere" />
          </div>

          <div className="relative space-y-4">
            {/*
              THE ROW IS A CHILD OF THIS HEADER, on its own line or beside the
              title — see `controlsBesideTitle`. Hence `gap-y-4` and not the
              old `gap-3`: when the row wraps to its own line, that gap is what
              used to be `space-y-4` on the container, so every other page keeps
              the 16px it had. `gap-x-3` keeps the horizontal 12px.
            */}
            <header
              className={`flex flex-wrap justify-between gap-x-3 gap-y-4 ${
                controlsBesideTitle ? 'items-center' : 'items-start'
              }`}
            >
              <div className="min-w-0">
                {accent && <div className="accent-rule mb-2.5" aria-hidden="true" />}
                {/* `.display` (tight tracking for large sizes) at 24px — the page
                    title's one job is to outrank every section heading below it. */}
                <h1
                  className="display text-2xl font-semibold"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {title}
                </h1>
                {/*
                  `period` reserves the line BEFORE the first response arrives.

                  The dates come from the response's meta, so on a page with no
                  description the whole line used to pop in a beat after the
                  header rendered and push the filter row and every card down
                  one line. A page that WILL print dates claims the height from
                  the start; the text simply arrives into space already held.

                  `description={null}` opts out of the reservation, and that is
                  not the same as leaving the prop off: it says this page prints
                  no lead line and no dates in any state, so the twenty pixels
                  would be held open for something that can never arrive. On a
                  page whose one piece of content is a table, twenty pixels is
                  a row.
                */}
                {description !== null && (description || period || meta?.period) && (
                  <p className="mt-1 max-w-2xl text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {description}
                    {description && meta?.period && <span className="mx-1.5">·</span>}
                    {meta?.period ? (
                      <>
                        {formatDate(meta.period.start)} –{' '}
                        {formatDate(new Date(new Date(meta.period.end).getTime() - 1).toISOString())}
                      </>
                    ) : (
                      // Occupies the line while the dates are in flight.
                      period && !description && <span aria-hidden="true">&nbsp;</span>
                    )}
                    {meta?.comparisonTruncated && (
                      <span
                        className="ml-2 rounded px-1.5 py-0.5"
                        style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
                      >
                        {t.period.truncated}
                      </span>
                    )}
                  </p>
                )}
              </div>
              {actions}
              {/*
                THE REPORTING WINDOW BELONGS TO THE PAGE, not to the chrome.

                It used to sit in the app header, above every screen, which said
                it was one setting for the whole dashboard — and it never was:
                each section is read in its own window, and each keeps it. A
                control rendered over the top bar cannot say that. Down here it
                sits with the section's other filters, in the section's own
                header, and reads as what it is: this page's dates. (Under the
                title or beside it — see `controlsBesideTitle`; either way it is
                the page's header and not the app's.)

                The header keeps the search, which genuinely is global — it looks
                across every screen at once.

                The row renders even when a page has no other filters, because
                the window is not optional on a page that has one — a screen
                without the control would have no way to change its dates. A page
                with no window (`period={false}`) gets no row from that clause —
                but it still gets one if it brought controls of its own.

                That last term is reached by no page today, deliberately: the one
                screen with a toolbar also enables a search box, so `anyFilter`
                already opens its row in every mode, backlog included. It is here
                so that a page whose ONLY controls are its own gets a row rather
                than losing them silently — which is a rendering nothing would
                report, in a slot whose whole promise is that the shell owns
                where the controls go.
              */}
              {(period || anyFilter || toolbar) && (
              <div
                className={`flex flex-wrap items-center gap-2 ${
                  controlsBesideTitle ? 'ml-auto' : 'basis-full'
                }`}
              >
                {periodControl}
                {anyFilter && (
                  <>
                  {enabled.search && (
                    <SearchInput
                      value={filters.q ?? ''}
                      onChange={(q) => update({ q: q || undefined })}
                      placeholder={enabled.searchPlaceholder}
                    />
                  )}
                  {enabled.employees && (
                    <MultiSelect
                      label="Xodim"
                      options={(data?.employees ?? []).map((e) => ({ id: e.id, label: e.fullName }))}
                      selected={filters.employeeIds}
                      onChange={(employeeIds) => update({ employeeIds })}
                    />
                  )}
                  {enabled.departments && (
                    <MultiSelect
                      label="Boʻlim"
                      options={(data?.departments ?? []).map((d) => ({ id: d.id, label: d.name }))}
                      selected={filters.departmentIds}
                      onChange={(departmentIds) => update({ departmentIds })}
                    />
                  )}
                  {enabled.stages && (
                    <MultiSelect
                      label="Bosqich"
                      options={(data?.stages ?? []).map((s) => ({ id: s.id, label: s.name }))}
                      selected={filters.stageIds}
                      onChange={(stageIds) => update({ stageIds })}
                    />
                  )}
                  {enabled.products && (
                    <MultiSelect
                      label="Mahsulot"
                      options={(data?.products ?? []).map((p) => ({ id: p.id, label: p.name }))}
                      selected={filters.productIds}
                      onChange={(productIds) => update({ productIds })}
                    />
                  )}
                  {enabled.sources && (
                    <MultiSelect
                      label="Manba"
                      options={(data?.sources ?? []).map((s) => ({ id: s.id, label: s.name }))}
                      selected={filters.sourceIds}
                      onChange={(sourceIds) => update({ sourceIds })}
                    />
                  )}
                  </>
                )}
                {toolbar}
                {/*
                  STILL GUARDED ON `anyFilter`, which is not cosmetic — and last
                  in the row on purpose.

                  `activeCount` counts employeeIds / departmentIds / stageIds /
                  productIds / sourceIds / status / outcomes / rop / q straight
                  off the URL, regardless of what this page enables — and eight
                  screens render PageShell with no `filters` prop at all. Left
                  unguarded, a stale `?employeeIds=` riding in on a pasted link
                  would grow a «Filtrlarni tozalash (1)» button on a page that
                  has never had one and cannot show what it would clear.

                  Hoisted out of the fragment so the page's own controls come
                  first: a clear button standing between the search box and the
                  toolbar it also clears reads as part of that toolbar.
                */}
                {anyFilter && activeCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={reset}>
                    Filtrlarni tozalash ({activeCount})
                  </Button>
                )}
              </div>
              )}
            </header>

          </div>
        </div>

        {/* The body takes what the header left, and its own children size
            against it — hence `min-h-0`, without which the flex child refuses
            to shrink below its content and the canvas grows the page instead
            of fitting into it. */}
        {fill ? <div className="min-h-0 flex-1">{children}</div> : children}
      </div>
    </Shell>
  )
}
