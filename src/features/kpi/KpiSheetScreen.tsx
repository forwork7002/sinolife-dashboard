'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states/States'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { MultiplyGlyph } from '@/components/ui/Icons'
import { DayOrders } from '@/features/kpi/SverkaDaysCard'
import { muted } from '@/features/reklama/reklamaUi'
import { dayMonthYear } from '@/features/rnp/rnpDerive'
import { scrollToToday } from '@/features/rnp/RnpSheetTable'
import { useCurrentMonth } from '@/features/rnp/useCurrentMonth'
import { downloadCsvText } from '@/features/shared/download'
import { PageShell } from '@/features/shared/PageShell'
import { PRODUCT_TONE } from '@/features/target/targetTheme'
import { ApiClientError, apiGet } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { t } from '@/lib/messages'

import { type KpiSheetDto, type KpiSheetScope, KPI_SHEET_FIRST_MONTH, kpiMonthIn, kpiSheetCsv, scopeLines } from './kpiSheetApi'
import { type KpiSheetDrill, KpiSheetTable } from './KpiSheetTable'
import { KpiSummary } from './KpiSummary'

const SCOPE_OPTIONS: readonly { readonly value: KpiSheetScope; readonly label: string; readonly swatch?: string }[] = [
  { value: 'all', label: 'Hammasi' },
  { value: 'Collagen', label: 'Collagen', swatch: PRODUCT_TONE.Collagen },
  { value: 'Zextra', label: 'Zextra', swatch: PRODUCT_TONE.Zextra },
]

/**
 * «KPI jadvali» — the first tab of «KPI rejalari» (the client, 2026-10-23):
 * «Нутрицолог», «Tovarlar» and «Kunlar boʻyicha» as one calendar-month sheet,
 * Bitrix24 against MoySklad a column per day, in the RNP sheet's frame
 * (`KpiSheetTable`). Every figure is built on the server from the same cached
 * cohort the cards read (`kpiSheet.ts`), so the sheet and the cards cannot
 * disagree; it refetches on the app's two-minute poll, as every screen does.
 *
 * ITS OWN MONTH, like «RNP jadvali»: it opens on the month it is in Tashkent
 * and follows the calendar unless another month is picked; the dashboard
 * window does not apply. «Hammasi · Collagen · Zextra» cuts it in the
 * browser. «Excel» downloads what is on screen as a CSV Excel opens into
 * columns. A day cell opens that day's orders in a drawer — each order on
 * both systems with its products — so a figure is checked against its deals.
 */
export function KpiSheetScreen({ tabs }: { readonly tabs: ReactNode }) {
  const current = useCurrentMonth()
  const [picked, setPicked] = useState<string | null>(null)
  const month = kpiMonthIn(picked, current) ?? current
  // What the month box holds while it is not yet a month the sheet can show.
  const [draft, setDraft] = useState<string | null>(null)
  const [scope, setScope] = useState<KpiSheetScope>('all')
  const [drill, setDrill] = useState<KpiSheetDrill | null>(null)
  const scopeRef = useRef<HTMLDivElement>(null)

  const query = useQuery({
    queryKey: ['kpi-sheet', { month }],
    queryFn: ({ signal }) => apiGet<KpiSheetDto>('/kpi/sheet', { month }, signal),
    placeholderData: keepPreviousData,
  })
  const data = query.data?.data
  const lines = useMemo(() => (data ? scopeLines(data.lines, scope) : []), [data, scope])
  const forbidden = query.error instanceof ApiClientError && query.error.status === 403
  const onOpen = useCallback((next: KpiSheetDrill) => setDrill(next), [])

  return (
    <PageShell
      title={t.nav.kpi}
      description="Bitrix24 va MoySklad — har kun alohida: buyurtmalar, Нутрицолог, summa, tovarlar · kun — bitim Tasdiqlashga tushgan kun (Toshkent) · katakni bosing — oʻsha kun buyurtmalari"
      meta={query.data?.meta}
      stale={query.isPlaceholderData}
      period={false}
      fill
      actions={tabs}
      toolbar={
        <>
          <SegmentedControl value={scope} options={SCOPE_OPTIONS} onChange={setScope} ariaLabel="Brend" />
          <label className="flex items-center gap-2 text-xs" style={muted}>
            Oy
            <input
              type="month"
              value={draft ?? month}
              min={KPI_SHEET_FIRST_MONTH}
              max={current}
              onChange={(e) => {
                const next = kpiMonthIn(e.target.value, current)
                setDraft(next === null ? e.target.value : null)
                if (next !== null) setPicked(next === current ? null : next)
              }}
              onBlur={() => setDraft(null)}
              className="focusable h-11 rounded-[var(--radius-panel-sm)] border px-2 text-xs sm:h-8"
              style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
            />
          </label>
          {data && (
            <SheetFacts
              data={data}
              onToday={() => {
                const box = scopeRef.current?.querySelector<HTMLElement>('[data-rnp-grid]')
                if (box) scrollToToday(box)
              }}
            />
          )}
          {data && (
            <Button
              variant="secondary"
              size="sm"
              className="h-11 sm:h-8"
              aria-label="Ekrandagi jadvalni Excel ochadigan CSV fayl qilib yuklab olish"
              onClick={() => downloadCsvText(`kpi-jadvali-${data.month}${scope === 'all' ? '' : `-${scope.toLowerCase()}`}.csv`, kpiSheetCsv(data, lines))}
            >
              Excel
            </Button>
          )}
        </>
      }
    >
      <div ref={scopeRef} className="flex h-full min-h-0 flex-col gap-3">
        {data && !forbidden && <KpiSummary lines={data.lines} scope={scope} />}
        {forbidden ? (
          <Card className="p-5">
            <EmptyState
              title="Bu jadval sizga yopiq"
              body="«KPI jadvali» «Sverka» boʻlimiga ruxsati bor hisoblarga koʻrinadi. «Kartalar» yorligʻini oching."
            />
          </Card>
        ) : query.isError && !data ? (
          <Card className="p-5">
            <ErrorState message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} />
          </Card>
        ) : !data ? (
          <Card className="p-5">
            <LoadingSkeleton rows={10} />
          </Card>
        ) : (
          <Card as="div" className="min-h-[320px] min-w-0 flex-1 overflow-hidden p-0 max-sm:min-h-[calc(100dvh-5rem)]">
            <KpiSheetTable lines={lines} days={data.days} today={data.today} onOpen={onOpen} />
          </Card>
        )}
      </div>
      {drill && data && <DayDrawer drill={drill} month={data.days} onClose={() => setDrill(null)} />}
    </PageShell>
  )
}

/** The sheet's facts beside its controls: today (a button to its column) and MoySklad's last read. */
function SheetFacts({ data, onToday }: { data: KpiSheetDto; onToday: () => void }) {
  const read = data.moysklad.lastSuccessAt
  return (
    <dl className="flex flex-wrap items-center gap-2 text-xs">
      <Fact term="MoySklad" title="MoySklad buyurtmalari oxirgi marta shu paytda oʻqildi — bir necha daqiqada bir yangilanadi">
        {read ? formatDateTime(read) : <span className="font-normal" style={muted}>hali oʻqilmagan</span>}
      </Fact>
      {data.days.includes(data.today) ? (
        <div>
          <dt className="sr-only">Bugun</dt>
          <dd>
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
// A day's orders
// ---------------------------------------------------------------------------

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
const SCOPE_NAME: Record<KpiSheetScope, string> = { all: 'Collagen + Zextra', Collagen: 'Collagen', Zextra: 'Zextra' }

/**
 * A day cell opened: «Kunlar boʻyicha»'s own list of that day's orders
 * (`DayOrders`), under the row's brand and FAKT figure. Asked over the
 * sheet's month as a custom window, so the server answers it from the very
 * cache entry the sheet was built from. The modal discipline is
 * `LeadWatchDrawer`'s: focus held inside, Escape and the scrim close it.
 */
function DayDrawer({ drill, month, onClose }: { drill: KpiSheetDrill; month: readonly string[]; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const params = useMemo(
    () => ({ preset: 'custom', from: month[0] ?? drill.day, to: month.at(-1) ?? drill.day, basis: drill.basis, brand: drill.scope }),
    [month, drill],
  )

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previous?.focus()
  }, [])
  useEffect(() => {
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = before
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const stops = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (!first || !last) return
    const at = document.activeElement
    if (event.shiftKey && (at === first || at === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && at === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="backdrop-dim drawer-backdrop-enter fixed inset-0 z-50 flex justify-end"
      // mousedown, not click: a drag that starts inside and ends on the scrim must not close it.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="watch-drawer watch-drawer-enter flex h-dvh w-full flex-col outline-none sm:w-[820px] sm:max-w-[94vw]"
      >
        <header className="shrink-0 border-b px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:px-5 sm:pt-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
                {dayMonthYear(drill.day)} · {SCOPE_NAME[drill.scope]} · {drill.basis === 'FAKT1' ? 'FAKT 1' : 'FAKT 2'}
              </h2>
              <p className="mt-0.5 text-xs" style={muted}>
                Oʻsha kuni Tasdiqlashga tushgan bitimlar — har biri Bitrix24 va MoySkladʼda, tovarlari bilan · farqlilari birinchi
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Yopish"
              className="focusable -mt-1 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-panel-sm)] text-[var(--ink-secondary)] transition-colors hover:bg-[var(--glass-hover)] hover:text-[var(--ink-primary)] sm:-mr-1.5 sm:h-9 sm:w-9"
            >
              <MultiplyGlyph size={16} />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 text-xs sm:px-4">
          <DayOrders params={params} day={drill.day} basis={drill.basis} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
