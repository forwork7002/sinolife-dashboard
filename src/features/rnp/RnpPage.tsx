'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { useCohortRop } from '@/features/cohort/useCohortRop'
import { PageShell } from '@/features/shared/PageShell'
import { type Status, muted } from '@/features/reklama/reklamaUi'
import { apiGet } from '@/lib/api'
import { t } from '@/lib/messages'

import { RnpColumnScope } from './RnpColumnResizer'
import { RnpSheetTable, scrollToToday } from './RnpSheetTable'
import type { RnpOverviewDto } from './rnpApi'
import { RNP_FIRST_MONTH, dayMonth, dayMonthYear, rnpMonthIn, ropLines } from './rnpDerive'
import { canvasMeasure, contentMinWidths, rnpNumber } from './rnpFigures'

/**
 * «RNP jadvali» — the client's «СентябрРНП» sheet and nothing else, one
 * calendar month, every row built on the server from Bitrix24 and Meta
 * (`rnpSheet.ts`, laid out row by row in `rnpSheetView.ts`).
 *
 * THE SHEET, FULLY, AND ONLY THE SHEET (the client, 2026-09-30: «faqat jadval
 * … to'liqligicha … keraksiz narsalarni olib tashla»). The ROP rail and its
 * `?rop=`, the KPI cards, the daily charts, the funnel, the ranking and the
 * company / team views were deleted that day. What stays around the grid is
 * the sheet's own rows 1–2 — the month, the days gone by, the dollar rate,
 * today's date. «Rejalar», the plans form, was taken off on 2026-10-01 (the
 * client: «butunlay olib tashla»): the plans the sheet types in column C, the
 * P&L's five cost lines and each ROP's «Ходим сони» are typed in the grid
 * itself (`RnpCostCell.tsx`), and only by a `kpi:manage` account.
 *
 * THE PAGE IS THE GRID. `fill` gives the grid every pixel under the header,
 * and it scrolls inside its own box with the column headers and the label
 * column frozen — the sheet's frozen row 3, over ~370 rows.
 *
 * ITS OWN MONTH, not the dashboard preset: the sheet is a calendar month by
 * construction. It opens on the month it is today in Tashkent and follows
 * the calendar on its own — a page left open over the 1st moves to the new
 * month — unless somebody picked another month to look at, which the URL
 * keeps (`?month=`, 2026-10-02), so a reload or a link opens on it.
 *
 * «ROP» CUTS THE SHEET TO ONE TEAM (the client, 2026-09-30: «barchasi va
 * roplar bo'yicha ham»): its block and its logistics, each
 * under a heading (`ropLines`). Kept in the URL (`?rop=`), so a link opens on
 * the team; no request — the whole sheet is already on the page.
 */
export function RnpPage() {
  const current = useCurrentMonth()
  const { month, setMonth } = useRnpMonth(current)
  // What the month box holds while it is not yet a month the sheet can show (`rnpMonthIn`).
  const [draft, setDraft] = useState<string | null>(null)
  const { rop, setRop } = useCohortRop()
  // The grid's box lives under the scope: the toolbar's «Bugun» scrolls it.
  const scope = useRef<HTMLDivElement>(null)

  const overview = useQuery({
    queryKey: ['rnp-overview', { month }],
    queryFn: ({ signal }) => apiGet<RnpOverviewDto>('/rnp/overview', { month }, signal),
    placeholderData: keepPreviousData,
  })

  const data = overview.data?.data
  // A failed BACKGROUND refetch keeps the sheet it has (and a half-typed cell): the error card is for no data at all.
  const status: Status = overview.isPending ? 'loading' : overview.isError && !data ? 'error' : 'ready'
  // How wide each column kind must be so that no figure is cut. Data only
  // exists in the browser, so the canvas is there when this runs.
  const minWidths = useMemo(
    () => (data ? contentMinWidths(data.blocks, canvasMeasure(getComputedStyle(document.body).fontFamily)) : undefined),
    [data],
  )
  /*
    The ROP options in the sheet's own order — where each team's lines first
    appear — so the list reads like the page and does not reshuffle with the
    month's money (2026-10-02). A team with lines but no block (Шохжахон's
    logistics in a quiet month) is offered too, under its name in
    `data.teams`, else its block's column-B text.
  */
  const teams = useMemo(() => {
    if (!data) return []
    const named = new Map(data.teams.map((t) => [t.rop, t.label]))
    const order = new Map<string, string | null>()
    for (const l of data.lines) {
      if (l.team === null) continue
      const sub = l.kind === 'value' && (l.tone === 'team' || l.tone === 'section') ? l.sub : null
      if (!order.has(l.team) || order.get(l.team) === null) order.set(l.team, named.get(l.team) ?? sub)
    }
    return [...order].map(([rop, label]) => ({ rop, label: label ?? rop }))
  }, [data])
  const chosen = teams.find((t) => t.rop === rop) ?? null
  const lines = useMemo(
    () => (data ? ropLines(data.lines, chosen?.rop ?? null, chosen?.label ?? '') : []),
    [data, chosen],
  )

  return (
    <PageShell
      title={t.modules.rnp.title}
      description={t.modules.rnp.lead}
      accent="var(--series-7)"
      meta={overview.data?.meta}
      stale={overview.isPlaceholderData}
      period={false}
      fill
      toolbar={
        <>
          <label className="flex items-center gap-2 text-xs" style={muted}>
            Oy
            <input
              type="month"
              value={draft ?? month}
              min={RNP_FIRST_MONTH}
              max={current}
              onChange={(e) => {
                // Only a whole month the sheet can show is requested. Anything else — a year half typed,
                // or text where Firefox and Safari draw no picker — stays in the box until it is one.
                const next = rnpMonthIn(e.target.value, current)
                setDraft(next === null ? e.target.value : null)
                if (next !== null) setMonth(next)
              }}
              onBlur={() => setDraft(null)}
              className="focusable h-11 rounded-[var(--radius-panel-sm)] border px-2 text-xs sm:h-8"
              style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
            />
          </label>
          <label className="flex items-center gap-2 text-xs" style={muted}>
            ROP
            <select
              value={chosen?.rop ?? ''}
              onChange={(e) => setRop(e.target.value === '' ? null : e.target.value)}
              disabled={teams.length === 0}
              className="focusable h-11 max-w-[14rem] rounded-[var(--radius-panel-sm)] border px-2 text-xs sm:h-8"
              style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
            >
              <option value="">Barchasi</option>
              {teams.map((t) => (
                <option key={t.rop} value={t.rop}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {data && (
            <SheetFacts
              data={data}
              onToday={() => {
                const box = scope.current?.querySelector<HTMLElement>('[data-rnp-grid]')
                if (box) scrollToToday(box)
              }}
            />
          )}
        </>
      }
    >
      {/* The grid reads its column widths from here (`RnpColumnScope`). */}
      <RnpColumnScope ref={scope} minWidths={minWidths} className="flex h-full min-h-0 flex-col">
        {status === 'error' ? (
          <Card className="p-5">
            <ErrorState
              message={overview.error instanceof Error ? overview.error.message : undefined}
              onRetry={() => void overview.refetch()}
            />
          </Card>
        ) : status === 'loading' || !data ? (
          <Card className="p-5">
            <LoadingSkeleton rows={10} />
          </Card>
        ) : data.blocks.length === 0 ? (
          <Card className="p-5">
            <EmptyState title="Bu oy uchun jadval yoʻq" body="Bu oy uchun jadval hali yigʻilmagan — boshqa oyni tanlang." />
          </Card>
        ) : (
          // On a phone the header strip wraps to four lines and would leave the grid a
          // letterbox; there the card is nearly a screen tall and the page scrolls the
          // header away first (the confirmation board's floor, for the same reason).
          <Card as="div" className="min-h-[320px] min-w-0 flex-1 overflow-hidden p-0 max-sm:min-h-[calc(100dvh-5rem)]">
            <RnpSheetTable
              lines={lines}
              blocks={data.blocks}
              days={data.days}
              today={data.today}
              // The P&L's typed cost lines are the one thing on the sheet an editor types in place.
              editCostsFor={data.canEditPlans ? data.month : null}
            />
          </Card>
        )}
      </RnpColumnScope>
    </PageShell>
  )
}

/**
 * The sheet's rows 1–2: «Неча иш куни ўтди», the dollar rate, today's date.
 * A description list — each is a term and its value. Today's date is also a
 * button on a month that has today (2026-10-02): it brings today's column
 * beside the frozen block, a month's thirty columns away on the 30th.
 */
function SheetFacts({ data, onToday }: { data: RnpOverviewDto; onToday: () => void }) {
  const rate = data.settings.usdRate
  const on = data.settings.usdRateDate
  return (
    <dl className="flex flex-wrap items-center gap-2 text-xs">
      <Fact term="Oʻtgan kunlar">{data.elapsedDays}</Fact>
      <Fact
        term={on ? `Dollar kursi (MB, ${dayMonth(on)})` : 'Dollar kursi'}
        title="Oʻzbekiston Respublikasi Markaziy banki rasmiy kursi (cbu.uz). Jadval har kunni oʻsha kungi kurs bilan hisoblaydi."
      >
        {rate === null ? <span className="font-normal" style={muted}>Markaziy bankdan olinmadi</span> : `${rnpNumber(rate)} soʻm`}
      </Fact>
      {data.days.includes(data.today) ? (
        <div>
          <dt className="sr-only">Bugun</dt>
          <dd>
            {/* The whole chip is the button: the same look as its neighbours, the term drawn inside it. */}
            <button
              type="button"
              onClick={onToday}
              title="Bugungi kunga oʻtish"
              aria-label={`Bugun: ${dayMonthYear(data.today)}`}
              className={`focusable cursor-pointer ${FACT_CHIP}`}
              style={FACT_STYLE}
            >
              <span style={muted}>Bugun:</span>
              <span className="tabular font-semibold" style={{ color: 'var(--ink-primary)' }}>
                {dayMonthYear(data.today)}
              </span>
            </button>
          </dd>
        </div>
      ) : (
        <Fact term="Bugun">{dayMonthYear(data.today)}</Fact>
      )}
    </dl>
  )
}

const FACT_CHIP = 'flex h-8 items-center gap-1.5 rounded-[var(--radius-panel-sm)] border px-2.5'
const FACT_STYLE = { borderColor: 'var(--border)', background: 'var(--surface-raised)' } as const

function Fact({ term, title, children }: { term: string; title?: string; children: ReactNode }) {
  return (
    <div title={title} className={FACT_CHIP} style={FACT_STYLE}>
      <dt style={muted}>{term}:</dt>
      <dd className="tabular font-semibold" style={{ color: 'var(--ink-primary)' }}>
        {children}
      </dd>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * The month it is now in Tashkent, kept current: re-read every minute, so a
 * page left open over midnight on the 1st moves to the new month by itself.
 */
function useCurrentMonth(): string {
  const [month, setMonth] = useState(thisMonth)
  useEffect(() => {
    const timer = window.setInterval(() => setMonth(thisMonth()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return month
}

function thisMonth(): string {
  // The reader's calendar month in Tashkent, where the floor works.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7)
}

/**
 * The month on screen: `?month=` when it is one the sheet can show
 * (`rnpMonthIn`), else the current one. Kept in the URL the way «ROP» keeps
 * `?rop=` (`useCohortRop`, which says why: `replaceState` and
 * `useSyncExternalStore`), and stripped for the current month, so a page
 * nobody pointed at a month still follows the calendar by itself.
 */
function useRnpMonth(current: string): { readonly month: string; readonly setMonth: (month: string) => void } {
  const asked = useSyncExternalStore(subscribeMonth, monthSnapshot, monthServerSnapshot)
  const setMonth = useCallback(
    (next: string) => {
      const url = new URL(window.location.href)
      if (next === current) url.searchParams.delete('month')
      else url.searchParams.set('month', next)
      window.history.replaceState(null, '', url.toString())
      for (const listener of monthListeners) listener()
    },
    [current],
  )
  return { month: rnpMonthIn(asked, current) ?? current, setMonth }
}

const monthListeners = new Set<() => void>()

function subscribeMonth(onChange: () => void): () => void {
  monthListeners.add(onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    monthListeners.delete(onChange)
    window.removeEventListener('popstate', onChange)
  }
}

function monthSnapshot(): string | null {
  return new URL(window.location.href).searchParams.get('month')
}

function monthServerSnapshot(): string | null {
  return null
}
