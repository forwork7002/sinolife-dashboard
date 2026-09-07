'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { PeriodFilter } from '@/components/layout/PeriodFilter'
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
    /** ALL or OWN — how much of each granted screen this account reads. */
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
  /**
   * How many characters this page's search needs before it asks the server.
   *
   * Forwarded straight to `SearchInput`, which defaults to 1 — right for a box
   * that narrows a list already in the browser. A page whose box reaches a
   * trigram index sets its own floor and says why at the call site; the shell
   * only carries the number, it does not choose it.
   */
  readonly searchMinLength?: number
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
  stale = false,
  children,
  period = true,
  periodMuted = false,
  periodMutedReason,
  periodExtra,
  filtersInHeader = false,
  fill = false,
}: {
  title: string
  /**
   * The sentence under the title — and the difference between `undefined` and
   * `null`, which is not a nicety.
   *
   * `undefined` means "no text of its own, but the resolved dates are still
   * coming" — the line is RESERVED (see the note above the paragraph itself)
   * so it does not push the filter row and every card down one line when they
   * land. `null` means "this page prints nothing here, ever", and the line is
   * not drawn at all: the confirmation board suppresses its `meta` outright,
   * so on it the reservation was holding twenty pixels open for text that
   * could never arrive.
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
   * ACTION (Foydalanuvchilar' «+ Yangi hisob»). A page whose controls are
   * FILTERS wants them with the other filters: the confirmation board's РОП,
   * status and Статистика sat on the far right of the header while the window
   * and the search box sat on the left, so one screen carried two toolbars and
   * the reader crossed the page between them to narrow one table.
   *
   * Same division of labour as `periodExtra`: the ROW belongs to the shell,
   * what goes in the slot belongs to the page. Pass a Fragment rather than a
   * wrapper `<div>` — then each control wraps on its own against the row's
   * `gap-2` instead of moving as one block with a nested gap of its own.
   */
  toolbar?: ReactNode
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
   * True while the page HAS a window control but is not answering in it.
   *
   * The confirmation board does this while a search is running: a search is a
   * lookup for one order, so it spans every date, and the control above the
   * rows is momentarily describing a window they do not obey. Dimming it is
   * the honest middle between hiding it — which reflows the filter row under
   * the caret on every keystroke's worth of search — and leaving it looking
   * like it is in force.
   */
  periodMuted?: boolean
  /** Hover text for a muted control: why this page is ignoring it. */
  periodMutedReason?: string
  /**
   * One extra chip in the period group, for a page that reaches past dates.
   *
   * The confirmation board's «Жами» is the only one today. It belongs beside
   * Bugun / Kecha / Shu oy rather than among the page's filters, because it
   * answers the same question those three do — how far back — and the page
   * owns what it MEANS while this row owns where it sits.
   */
  periodExtra?: {
    readonly label: string
    readonly active: boolean
    readonly onSelect: () => void
    readonly title?: string
  }
  /**
   * Stretch the page body to the screen instead of to its own content.
   *
   * For a page whose ONE piece of content is an instrument rather than a
   * document — today that is Kadrlar tuzilmasi's org chart, which is a canvas
   * you pan and zoom, and every pixel it does not get is a card the reader has
   * to drag into view. Same word and same mechanism as `ChartCard`'s `fill`,
   * deliberately: this application has one name for "take the height that is
   * there".
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
  /**
   * Put the filter row ON THE TITLE LINE, right-aligned, instead of under it.
   *
   * For a screen that is WORKED IN rather than read. Тасдиклаш навбати prints
   * nothing under its title (`description={null}`) and its one piece of
   * content is a table the floor scrolls all day, so the filter row was
   * spending a whole line — the row itself plus the gap under it, ~52px — to
   * say what it says just as well beside the title. Up here it costs none and
   * the tile band, the table and three more of its rows start that much
   * higher.
   *
   * It has NOT left the page. The row moves within the page header, not into
   * the app chrome — the distinction the row's own note is about is between a
   * control over the top bar (one window for the whole dashboard, which was
   * never true) and a control under this section's title. Right-aligned beside
   * that title it is still the section's own row.
   *
   * Narrow screens get the old layout for free: the header is `flex-wrap`, and
   * `justify-between` puts a lone item on a wrapped line at the START, so the
   * row drops back under the title left-aligned rather than hugging the right
   * edge under it.
   */
  filtersInHeader?: boolean
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

  /*
    THE REPORTING WINDOW BELONGS TO THE PAGE, not to the chrome.

    It used to sit in the app header, above every screen, which said
    it was one setting for the whole dashboard — and it never was:
    each section is read in its own window, and each keeps it. A
    control rendered over the top bar cannot say that. Here it sits
    with the section's other filters, under the section's title — or
    beside it, right-aligned, where a page asks for that
    (`filtersInHeader`) — and reads as what it is: this page's dates.
    Either way it is INSIDE the page's own header block, which is the
    line that matters; the app chrome above it still carries nothing
    that filters anything.

    The global search — the ⌘K palette over `/api/v1/search` — is
    gone, both the palette and the route, so the header now carries
    only the data-source badge, the bell and the refresh leaf; every
    search box left in this application is a PAGE control and belongs
    in this row with the rest of that page's filters.

    The row renders even when a page has no other filters, because
    the window is not optional on a page that has one — a screen
    without the control would have no way to change its dates. The
    one page that has no window (`period={false}`) gets no row.

    `toolbar` opens it too, so a page whose only controls are its own
    still gets the row rather than silently dropping them.
  */
  const filterRow = period || anyFilter || toolbar ? (
    <div className="flex flex-wrap items-center gap-2">
    {period && (
      <PeriodFilter
        value={filters.preset}
        from={filters.from}
        to={filters.to}
        onChange={setPeriod}
        muted={periodMuted}
        mutedReason={periodMutedReason}
        extra={periodExtra}
      />
    )}
    {anyFilter && (
      <>
      {enabled.search && (
        <SearchInput
          value={filters.q ?? ''}
          onChange={(q) => update({ q: q || undefined })}
          placeholder={enabled.searchPlaceholder}
          minLength={enabled.searchMinLength}
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
      STILL GUARDED ON `anyFilter`, which is not cosmetic.

      `activeCount` counts employeeIds / departmentIds / stageIds /
      productIds / sourceIds / status / outcomes / rop / q straight
      off the URL, regardless of what this page enables — and eight
      screens render PageShell with no `filters` prop at all. Hoisted
      out of the fragment unguarded, a stale `?employeeIds=` riding
      in on a pasted link would grow a «Filtrlarni tozalash (1)»
      button on pages that have never had one and cannot show what
      it would clear.
    */}
    {anyFilter && activeCount > 0 && (
      <Button variant="ghost" size="sm" onClick={reset}>
        Filtrlarni tozalash ({activeCount})
      </Button>
    )}
  </div>
  ) : null

  return (
    /*
      No <Shell> around this any more. The shell mounts once in the root
      layout (see AppFrame) so navigation stops rebuilding the chrome; this
      component now owns only what belongs to a PAGE — title, window, filter
      row. The two facts it used to hand upward travel on their own:
      `dataSource` comes off the filters payload the shell already fetches,
      and "does this screen have a window" is read from the pathname against
      SCREENS_WITHOUT_A_PERIOD in Shell.tsx — so `period={false}` here and
      that list must agree, which tests/features/shellPeriodScreens.test.ts
      enforces.
    */
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
            <header
              className={`flex flex-wrap justify-between gap-3 ${
                /*
                  `items-center` ONLY when the row is up here, so the controls
                  sit level with the title instead of level with the accent
                  rule above it. Every other page keeps `items-start`, which is
                  what an `actions` button is placed against on a page that
                  also prints a description — centring those would drop the
                  button half a line the moment the dates arrive.
                */
                filtersInHeader ? 'items-center' : 'items-start'
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

                  `description === null` opts out of the reservation entirely,
                  for a page that prints nothing here in any state — see the
                  prop's own note. The reservation is only worth its height on
                  a page where something is genuinely on its way.
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
              {/*
                On the title line, right-aligned — see `filtersInHeader`.
                `justify-between` holds it against the right edge while there
                is room and drops it to a line of its own, left-aligned, when
                there is not.
              */}
              {filtersInHeader && filterRow}
              {actions}
            </header>

            {!filtersInHeader && filterRow}
          </div>
        </div>

        {/* The body takes what the header left, and its own children size
            against it — hence `min-h-0`, without which the flex child refuses
            to shrink below its content and the canvas grows the page instead
            of fitting into it. */}
        {fill ? <div className="min-h-0 flex-1">{children}</div> : children}
      </div>
  )
}
