'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'

import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/features/shared/PageShell'
import { type Status, muted } from '@/features/reklama/reklamaUi'
import { apiGet } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

import { ResetColumnWidths, RnpColumnScope } from './RnpColumnResizer'
import { RnpPlanEditor } from './RnpPlanEditor'
import { RnpSheetTable } from './RnpSheetTable'
import type { RnpOverviewDto } from './rnpApi'
import { dayMonthYear } from './rnpDerive'
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
 * today's date — and «Rejalar», where the plans (column C) are set.
 *
 * THE PAGE IS THE GRID. `fill` gives the grid every pixel under the header,
 * and it scrolls inside its own box with the column headers and the label
 * column frozen — the sheet's frozen row 3, over ~370 rows.
 *
 * ITS OWN MONTH, not the dashboard preset: the sheet is a calendar month by
 * construction, the same reason «Sotuv · ROP» keeps its own.
 */
export function RnpPage() {
  const [month, setMonth] = useState(() => thisMonth())

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
              max={thisMonth()}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="focusable h-11 rounded-[var(--radius-panel-sm)] border px-2 text-xs sm:h-8"
              style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
            />
          </label>
          {data && <SheetFacts data={data} />}
          <ResetColumnWidths />
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
            <RnpSheetTable lines={data.lines} blocks={data.blocks} days={data.days} today={data.today} />
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
  return (
    <dl className="flex flex-wrap items-center gap-2 text-xs">
      <Fact term="Oʻtgan kunlar">{data.elapsedDays}</Fact>
      <Fact term="Dollar kursi">
        {rate === null ? <span className="font-normal" style={muted}>kiritilmagan</span> : `${formatNumber(rate)} soʻm`}
      </Fact>
      <Fact term="Bugun">{dayMonthYear(data.today)}</Fact>
    </dl>
  )
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div
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

function thisMonth(): string {
  // The reader's calendar month in Tashkent, where the floor works.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7)
}
