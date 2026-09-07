/**
 * The instant answer to a click, for every screen at once.
 *
 * Every route here is force-dynamic, and a dynamic route with NO loading
 * state gives the router nothing to show — Next's prefetch fetches a dynamic
 * route only as far as its loading boundary, so with no boundary it fetched
 * nothing and the click blocked on the server render: 320–725 ms of a page
 * that did not respond, measured on production. This file IS that boundary.
 * It renders inside the shell (the shell lives in the root layout above it),
 * so a navigation now swaps the content area to this sketch immediately and
 * the real page streams in over it.
 *
 * Deliberately generic — a title line, a filter row, a band of cards — so it
 * is honest scaffolding for all eleven screens rather than a wrong guess at
 * one of them. Heights echo PageShell's header so the real page lands with
 * minimal shift.
 */
export default function Loading() {
  return (
    <div className="page-container space-y-4" role="status" aria-label="Yuklanmoqda">
      <div className="space-y-4">
        <div>
          <div className="skeleton h-8 w-56" />
          <div className="skeleton mt-2 h-4 w-80 max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="skeleton h-9 w-72 max-w-full" />
          <div className="skeleton h-9 w-28" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="skeleton h-28" />
        <div className="skeleton h-28" />
        <div className="skeleton h-28" />
        <div className="skeleton h-28" />
      </div>
      <div className="skeleton h-72" />
    </div>
  )
}
