'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { RingGauge, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import {
  STRUCTURE_VIEWS,
  type StructureView,
  useDashboardFilters,
} from '@/features/shared/useDashboardFilters'
import { type StructureDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatNumber } from '@/lib/format'
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
      meta={query.data?.meta}
      stale={query.isPlaceholderData}
    >
      {/*
        The lead instrument — the page's one hero, the only panel wearing the
        registration brackets.

        "Kim bor, kim yoʻq" — the question this page exists to answer.

        The Bitrix isActive flag alone cannot answer it: every deactivated
        person is also silent, so the flag finds nobody the roster does not
        already show. What management is asking is who is ON the roster,
        marked active, and produced nothing — and that was 58 of 206 people
        with no page saying so. That rate leads the page: the ring carries
        it, the hero figure carries the fraction it is drawn from — a rate
        without its denominator is an opinion — and the silent count stands
        in the caption because it is the number the rate exists to expose.
        Page-resolved tone: below 70% working is worth amber here, whatever
        the house thresholds say.
      */}
      <section className="card-hero brackets reveal px-5 py-5 sm:px-6" aria-label="Ishlagan xodimlar">
        {query.isError ? (
          <ErrorState
            message={(query.error as Error).message}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            {query.isPending ? (
              <div className="skeleton h-[116px] w-[116px] shrink-0 rounded-full" role="status">
                <span className="sr-only">Yuklanmoqda</span>
              </div>
            ) : (
              <RingGauge
                value={activePeople === 0 ? null : (workingPeople / activePeople) * 100}
                size={116}
                thickness={9}
                tone={
                  activePeople > 0 && workingPeople / activePeople < 0.7 ? 'warning' : 'neutral'
                }
                label="Ishlagan xodimlar"
              />
            )}

            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                Ishlagan xodimlar
              </p>

              {query.isPending ? (
                // Sized to the hero figure below, so ready never reflows loading.
                <div className="skeleton mt-2 h-[38px] w-44" role="status">
                  <span className="sr-only">Yuklanmoqda</span>
                </div>
              ) : activePeople > 0 ? (
                /*
                  The fraction, not a second copy of the percentage — the ring
                  already states that. Working people lead at hero size; the
                  active roster sits beside them a register quieter, numbers
                  only, so the nowrap hero line cannot overflow a narrow
                  screen with a long Uzbek word.
                */
                <p className="figure-hero mt-2" style={{ color: 'var(--ink-primary)' }}>
                  <AnimatedNumber
                    value={workingPeople}
                    format={(v) => formatNumber(Math.round(v))}
                  />
                  <span className="text-lg font-normal" style={{ color: 'var(--ink-muted)' }}>
                    {' '}/ {formatNumber(activePeople)}
                  </span>
                </p>
              ) : (
                // Genuine null: no active roster imported. An em dash, never
                // 0 — "nobody worked" is a different fact from "nobody is
                // on the roster to measure".
                <p className="figure-hero mt-2" style={{ color: 'var(--ink-primary)' }}>
                  {NO_VALUE}
                </p>
              )}

              {!query.isPending && (
                <p className="mt-2 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
                  {activePeople > 0
                    ? `Davr ichida kamida bitta bitim yopganlar · ${formatNumber(silentPeople)} nafari jim`
                    : 'Faol xodimlar roʻyxati boʻsh — Bitrix24 strukturasi import qilinmagan'}
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {/*
        TWO OF THESE THREE DO NOT MOVE WITH THE PRESET.

        The org chart is a fact about today — how many departments exist, how
        many people are on the roster — and no window makes it a different
        number. Revenue beside them is period-scoped. Three tiles in one row
        read as three answers to one question, so the two that are not say so
        rather than leaving a reader to click through the presets and wonder
        why only the third one changes.
      */}
      <div className={`stagger grid gap-3 ${withMoney ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <StatTile
          status={tileStatus}
          label="Boʻlimlar"
          value={flat.length || null}
          unit="count"
          hint="Hozirgi holat"
        />
        <StatTile
          status={tileStatus}
          label="Xodimlar"
          value={totalPeople || null}
          unit="count"
          hint="Hozirgi holat"
        />
        {withMoney && (
          <StatTile
            status={tileStatus}
            label="Tushum"
            value={totalRevenue || null}
            unit="money"
            hint="Davr ichida yopilgan bitimlar"
          />
        )}
      </div>

      <ChartCard
        title="Tuzilma"
        hint={
          filters.view === 'chart'
            ? 'Bitrix24 kompaniya strukturasi. Xodim soni — faqat shu boʻlimniki, pul — shu boʻlim va uning ostidagi barcha boʻlimlar boʻyicha. Kartani bosing — boʻlim xodimlari ochiladi. Fonni sudrab suring, Ctrl bilan gʻildirak — masshtab.'
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

function flatten(nodes: readonly StructureDto[]): StructureDto[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}
