'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { RingGauge } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import {
  STRUCTURE_VIEWS,
  type StructureView,
  useDashboardFilters,
} from '@/features/shared/useDashboardFilters'
import { type StructureDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

import { DepartmentPanel } from './DepartmentPanel'
import { OrgChart } from './OrgChart'
import { StructureTable } from './StructureTable'

/**
 * The company as Bitrix24 records it.
 *
 * TWO READINGS OF ONE ANSWER. The default is the org chart the portal itself
 * draws at `obey.bitrix24.kz/hr/structure/` — cards on a pannable canvas,
 * joined by connectors, one row per level — because the question the floor
 * brings to this page is «kim kimning qoʻlida ishlayapti», and a table of
 * indented rows answers it badly. The table is still here behind the toggle:
 * it is the only reading that shows every column at once, and the only one
 * that prints.
 *
 * Both read the SAME request. The chart and the table are two renderings of
 * one `/insights/structure` answer, so they cannot disagree about a figure and
 * switching between them costs nothing.
 *
 * Figures roll up: a department shows itself plus everything beneath it, which
 * is what "how is Navoiy doing" means to the person asking. The unit's own
 * headcount is shown separately so a manager with a large tree and no direct
 * reports is not mistaken for one running a team of forty.
 */
export function StructurePage() {
  const { filters, update, apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['structure', apiParams],
    queryFn: ({ signal }) =>
      apiGet<StructureDto[]>('/insights/structure', apiParams, signal),
  })

  /** One derivation, so no tile can disagree with its own page. */
  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'
  const roots = useMemo(() => query.data?.data ?? [], [query.data])
  const flat = useMemo(() => flatten(roots), [roots])

  // All three now roll up in the service, so the roots carry inclusive totals.
  // Summing the FLATTENED list would double-count every parent.
  const totalPeople = roots.reduce((sum, r) => sum + r.headcount, 0)
  const activePeople = roots.reduce((sum, r) => sum + r.activeHeadcount, 0)
  const workingPeople = roots.reduce((sum, r) => sum + r.workingHeadcount, 0)
  const silentPeople = activePeople - workingPeople

  /*
    Money is withheld, not zeroed, for a reader who may not see the company's.

    The org chart is the one company-wide screen an OWN-scoped salesperson is
    meant to open — that is what it was asked for. The server sends null rather
    than 0 (see StructureDto) and the page drops the tile entirely: a «0 soʻm»
    over a company that closed a billion is a lie, and a «—» with an
    explanation still says the figure exists and is being kept from them.
  */
  const withMoney = roots.some((r) => r.revenue !== null)
  const totalRevenue = roots.reduce((sum, r) => sum + (r.revenue?.amount ?? 0), 0)

  const viewerDepartmentId = flat.find((n) => n.isViewerDepartment)?.id ?? null
  const selected = filters.dep ? (flat.find((n) => n.id === filters.dep) ?? null) : null

  return (
    <PageShell
      title={t.modules.structure.title}
      description={t.modules.structure.lead}
      // Not series-8: it is 4.1 ΔE from --status-critical in light mode, so a
      // page accented with it makes red mean two things at once.
      accent="var(--series-6)"
      // The window is this page's only control, and the tree wants the row it
      // was standing in. See PageShell.
      periodInHeader
      meta={query.data?.meta}
      stale={query.isPlaceholderData}
    >
      {/*
        FOUR FACTS IN ONE STRIP, because the chart is what this page is for.

        This used to be a hero panel carrying a 116px ring over three
        full-height tiles — some 340px of page above the org chart, on a screen
        whose entire job is the org chart. Everything they said is still here
        and still in the same order; it is the register that changed, not the
        content, and the tree starts roughly where the ring used to end.

        «Ishlagan xodimlar» keeps the lead position and the only ring, because
        it is the one figure here that is a RATE and the one the page was built
        to expose: who is on the roster, marked active, and produced nothing.
        The other three are counts and read fine as counts.
      */}
      <section className="card reveal flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        {query.isError ? (
          <ErrorState
            message={(query.error as Error).message}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-3">
              {query.isPending ? (
                <div className="skeleton h-[54px] w-[54px] shrink-0 rounded-full" role="status">
                  <span className="sr-only">Yuklanmoqda</span>
                </div>
              ) : (
                <RingGauge
                  value={activePeople === 0 ? null : (workingPeople / activePeople) * 100}
                  size={54}
                  thickness={5}
                  tone={
                    activePeople > 0 && workingPeople / activePeople < 0.7 ? 'warning' : 'neutral'
                  }
                  label="Ishlagan xodimlar"
                />
              )}

              <div className="min-w-0">
                <p className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                  Ishlagan xodimlar
                </p>
                {query.isPending ? (
                  <div className="skeleton mt-1 h-[22px] w-28" role="status">
                    <span className="sr-only">Yuklanmoqda</span>
                  </div>
                ) : activePeople > 0 ? (
                  /* The fraction, not a second copy of the percentage — the ring
                     already states that. A rate without its denominator is an
                     opinion. */
                  <p
                    className="tabular text-[20px] leading-tight font-semibold"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    <AnimatedNumber
                      value={workingPeople}
                      format={(v) => formatNumber(Math.round(v))}
                    />
                    <span className="text-[13px] font-normal" style={{ color: 'var(--ink-muted)' }}>
                      {' '}/ {formatNumber(activePeople)}
                    </span>
                  </p>
                ) : (
                  // Genuine null: no active roster imported. An em dash, never
                  // 0 — "nobody worked" is a different fact from "nobody is on
                  // the roster to measure".
                  <p
                    className="text-[20px] leading-tight font-semibold"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    {NO_VALUE}
                  </p>
                )}
              </div>
            </div>

            {!query.isPending && (
              <p className="text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
                {activePeople > 0
                  ? `Davr ichida kamida bitta bitim yopganlar · ${formatNumber(silentPeople)} nafari jim`
                  : 'Faol xodimlar roʻyxati boʻsh — Bitrix24 strukturasi import qilinmagan'}
              </p>
            )}

            {/*
              TWO OF THESE THREE DO NOT MOVE WITH THE PRESET, and they say so.

              The org chart is a fact about today — how many units exist, how
              many people are on the roster — and no window makes it a different
              number. Revenue beside them is period-scoped.
            */}
            <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
              <Figure
                status={tileStatus}
                label="Boʻlimlar"
                value={flat.length || null}
                hint="Hozirgi holat"
              />
              <Figure
                status={tileStatus}
                label="Xodimlar"
                value={totalPeople || null}
                hint="Hozirgi holat"
              />
              {withMoney && (
                <Figure
                  status={tileStatus}
                  label="Tushum"
                  value={totalRevenue || null}
                  money
                  hint="Davr ichida yopilgan bitimlar"
                />
              )}
            </div>
          </>
        )}
      </section>

      <ChartCard
        title="Tuzilma"
        hint={
          filters.view === 'chart'
            ? 'Kartani bosing — boʻlim xodimlari ochiladi. Xodim soni faqat shu boʻlimniki, pul — shu boʻlim va ostidagilar boʻyicha. Fonni sudrab suring.'
            : 'Raqamlar boʻlimning oʻzi va uning ostidagi barcha boʻlimlar boʻyicha. «Boʻysunuvchi» — Bitrix24 shu boʻlimda koʻrsatgan faol xodimlar, rahbarsiz; «Oʻzida» — faqat toʻgʻridan-toʻgʻri biriktirilganlar.'
        }
        action={
          <SegmentedControl<StructureView>
            value={filters.view}
            options={STRUCTURE_VIEWS.map((view) => ({
              value: view,
              label: view === 'chart' ? 'Chizma' : 'Roʻyxat',
            }))}
            onChange={(view) => update({ view })}
            ariaLabel="Koʻrinish"
          />
        }
      >
        {query.isPending && <ChartSkeleton height={280} />}
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
          (filters.view === 'chart' ? (
            <OrgChart
              roots={roots}
              selectedId={selected?.id ?? null}
              onSelect={(id) => update({ dep: id ?? undefined })}
              viewerDepartmentId={viewerDepartmentId}
              /*
                As tall as the viewport leaves it.

                The subtraction is everything above the canvas plus what is
                below it: measured in the browser at 339px of page above the
                canvas and 21px of card beneath it, plus 16px so the card does
                not sit flush on the fold. Guessing it left the zoom stepper
                just past the bottom of the window. The floor keeps a short
                laptop window usable — there the page simply scrolls, which is
                the right trade against a 200px sliver of chart.
              */
              height="max(420px, calc(100vh - 376px))"
              panel={
                selected && (
                  <DepartmentPanel
                    // Keyed by department, so switching cards remounts the
                    // panel rather than showing the previous unit's roster
                    // under the new unit's name while the request is in flight.
                    key={selected.id}
                    node={selected}
                    apiParams={apiParams}
                    onClose={() => update({ dep: undefined })}
                  />
                )
              }
            />
          ) : (
            <StructureTable nodes={roots} />
          ))}
      </ChartCard>
    </PageShell>
  )
}

/**
 * One count in the strip.
 *
 * Not `StatTile`: that is a card with its own surface, padding and hover, and
 * three of them side by side inside a card is a card inside a card. This is
 * the same information at the strip's register — label over figure, hint on
 * the title so the caption does not cost a third line.
 *
 * A null value is an em dash, never 0 — the distinction is the whole point:
 * "no departments imported" and "zero departments" are different claims.
 */
function Figure({
  status,
  label,
  value,
  hint,
  money = false,
}: {
  status: 'loading' | 'error' | 'ready'
  label: string
  value: number | null
  hint: string
  money?: boolean
}) {
  return (
    <div className="min-w-0" title={hint}>
      <p className="text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      {status === 'loading' ? (
        <div className="skeleton mt-1 h-[22px] w-16" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : (
        <p
          className="tabular text-[20px] leading-tight font-semibold whitespace-nowrap"
          style={{ color: 'var(--ink-primary)' }}
        >
          {value === null || status === 'error' ? (
            <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
          ) : money ? (
            <>
              {formatCompactUzs(value)}
              <span className="text-[12px] font-normal" style={{ color: 'var(--ink-muted)' }}>
                {' '}
                soʻm
              </span>
            </>
          ) : (
            <AnimatedNumber value={value} format={(v) => formatNumber(Math.round(v))} />
          )}
        </p>
      )}
    </div>
  )
}

function flatten(nodes: readonly StructureDto[]): StructureDto[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}
