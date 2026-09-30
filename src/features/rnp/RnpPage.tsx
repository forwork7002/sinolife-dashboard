'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { useCohortRop } from '@/features/cohort/useCohortRop'
import { PageShell } from '@/features/shared/PageShell'
import { type Status, muted } from '@/features/reklama/reklamaUi'
import { apiGet } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

import { RnpColumnScope } from './RnpColumnResizer'
import { RnpPlanEditor } from './RnpPlanEditor'
import { RnpSheetTable } from './RnpSheetTable'
import type { RnpOverviewDto } from './rnpApi'
import { dayMonth, dayMonthYear, ropLines } from './rnpDerive'
import { canvasMeasure, contentMinWidths } from './rnpFigures'

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
 * today's date — and «Rejalar», where the plans (column C) are set. The
 * P&L's five cost lines are the one thing typed in the grid itself
 * (`RnpCostCell.tsx`), and only by an account that may edit plans.
 *
 * THE PAGE IS THE GRID. `fill` gives the grid every pixel under the header,
 * and it scrolls inside its own box with the column headers and the label
 * column frozen — the sheet's frozen row 3, over ~370 rows.
 *
 * ITS OWN MONTH, not the dashboard preset: the sheet is a calendar month by
 * construction, the same reason «Sotuv · ROP» keeps its own. It opens on the
 * month it is today in Tashkent and follows the calendar on its own — a page
 * left open over the 1st moves to the new month — unless somebody picked
 * another month to look at.
 *
 * «ROP» CUTS THE SHEET TO ONE TEAM (the client, 2026-09-30: «barchasi va
 * roplar bo'yicha ham»): its block and its logistics, each
 * under a heading (`ropLines`). Kept in the URL (`?rop=`), so a link opens on
 * the team; no request — the whole sheet is already on the page.
 */
export function RnpPage() {
  const current = useCurrentMonth()
  const [picked, setPicked] = useState<string | null>(null)
  const month = picked ?? current
  const { rop, setRop } = useCohortRop()

  const overview = useQuery({
    queryKey: ['rnp-overview', { month }],
    queryFn: ({ signal }) => apiGet<RnpOverviewDto>('/rnp/overview', { month }, signal),
    placeholderData: keepPreviousData,
  })

  const status: Status = overview.isPending ? 'loading' : overview.isError ? 'error' : 'ready'
  const data = overview.data?.data
  // How wide each column kind must be so that no figure is cut. Data only
  // exists in the browser, so the canvas is there when this runs.
  const minWidths = useMemo(
    () => (data ? contentMinWidths(data.blocks, canvasMeasure(getComputedStyle(document.body).fontFamily)) : undefined),
    [data],
  )
  const teams = useMemo(
    () => (data ? data.teams.filter((t) => data.lines.some((l) => l.team === t.rop)) : []),
    [data],
  )
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
      actions={data?.canEditPlans ? <RnpPlanEditor key={data.month} data={data} /> : undefined}
      toolbar={
        <>
          <label className="flex items-center gap-2 text-xs" style={muted}>
            Oy
            <input
              type="month"
              value={month}
              max={current}
              onChange={(e) => e.target.value && setPicked(e.target.value === current ? null : e.target.value)}
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
          {data && <SheetFacts data={data} />}
        </>
      }
    >
      {/* The grid reads its column widths from here (`RnpColumnScope`). */}
      <RnpColumnScope minWidths={minWidths} className="flex h-full min-h-0 flex-col">
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
 * A description list — each is a term and its value, not a control.
 */
function SheetFacts({ data }: { data: RnpOverviewDto }) {
  const rate = data.settings.usdRate
  const on = data.settings.usdRateDate
  return (
    <dl className="flex flex-wrap items-center gap-2 text-xs">
      <Fact term="Oʻtgan kunlar">{data.elapsedDays}</Fact>
      <Fact
        term={on ? `Dollar kursi (MB, ${dayMonth(on)})` : 'Dollar kursi'}
        title="Oʻzbekiston Respublikasi Markaziy banki rasmiy kursi (cbu.uz). Jadval har kunni oʻsha kungi kurs bilan hisoblaydi."
      >
        {rate === null ? <span className="font-normal" style={muted}>Markaziy bankdan olinmadi</span> : `${formatNumber(rate)} soʻm`}
      </Fact>
      <Fact term="Bugun">{dayMonthYear(data.today)}</Fact>
    </dl>
  )
}

function Fact({ term, title, children }: { term: string; title?: string; children: ReactNode }) {
  return (
    <div
      title={title}
      className="flex h-8 items-center gap-1.5 rounded-[var(--radius-panel-sm)] border px-2.5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
    >
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
