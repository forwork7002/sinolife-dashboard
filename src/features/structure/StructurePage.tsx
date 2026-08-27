'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, type UIEvent } from 'react'

import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { ChartCard } from '@/components/ui/Card'
import { InitialChip } from '@/components/ui/DataTable'
import { RingGauge, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type StructureDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * The company as Bitrix24 records it.
 *
 * Figures roll up: a department shows itself plus everything beneath it, which
 * is what "how is Navoiy doing" means to the person asking. The unit's own
 * headcount is shown separately so a manager with a large tree and no direct
 * reports is not mistaken for one running a team of forty.
 */
export function StructurePage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['structure', apiParams],
    queryFn: ({ signal }) =>
      apiGet<StructureDto[]>('/insights/structure', apiParams, signal),
  })

  /** One derivation, so no tile can disagree with its own page. */
  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'
  const roots = query.data?.data ?? []
  const flat = flatten(roots)
  // All three now roll up in the service, so the roots carry inclusive totals.
  // Summing the FLATTENED list would double-count every parent.
  const totalPeople = roots.reduce((sum, r) => sum + r.headcount, 0)
  const activePeople = roots.reduce((sum, r) => sum + r.activeHeadcount, 0)
  const workingPeople = roots.reduce((sum, r) => sum + r.workingHeadcount, 0)
  const silentPeople = activePeople - workingPeople
  const totalRevenue = roots.reduce((sum, r) => sum + r.revenue.amount, 0)

  return (
    <PageShell
      title={t.modules.structure.title}
      description={t.modules.structure.lead}
      // Not series-8: it is 4.1 ΔE from --status-critical in light mode, so a
      // page accented with it makes red mean two things at once.
      accent="var(--series-6)"
      meta={query.data?.meta}
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
                    ? `Davr ichida kamida bitta qoʻngʻiroq yoki sotuv qilganlar · ${formatNumber(silentPeople)} nafari jim`
                    : 'Faol xodimlar roʻyxati boʻsh — Bitrix24 strukturasi import qilinmagan'}
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="stagger grid gap-3 sm:grid-cols-3">
        <StatTile status={tileStatus} label="Boʻlimlar" value={flat.length || null} unit="count" />
        <StatTile status={tileStatus} label="Xodimlar" value={totalPeople || null} unit="count" />
        <StatTile status={tileStatus} label="Tushum" value={totalRevenue || null} unit="money" />
      </div>

      <ChartCard
        title="Tuzilma"
        hint="Raqamlar boʻlimning oʻzi va uning ostidagi barcha boʻlimlar boʻyicha. «Oʻzida» ustuni — faqat toʻgʻridan-toʻgʻri biriktirilgan xodimlar."
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
        {roots.length > 0 && <Tree nodes={roots} />}
      </ChartCard>
    </PageShell>
  )
}

function flatten(nodes: readonly StructureDto[]): StructureDto[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

function Tree({ nodes }: { readonly nodes: readonly StructureDto[] }) {
  const siblingMax = Math.max(1, ...nodes.map((n) => n.revenue.amount))

  /*
    Same contract as DataTable's sticky header, hand-rolled because this
    table is: the hairline under a resting header belongs to the first row
    and scrolls away with it; `.is-scrolled` puts one back as a shadow so
    the header reads as floating — which is what it is then actually doing.
  */
  const [scrolled, setScrolled] = useState(false)

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const isScrolled = event.currentTarget.scrollTop > 0
    if (isScrolled !== scrolled) setScrolled(isScrolled)
  }

  return (
    /*
      Bounded, so the sticky header has something to stick to: a fully open
      tree runs past twenty departments, and without the cap the column names
      leave the screen exactly when the reader is deepest in the branches.
      Short trees never reach the cap and behave as before.
    */
    <div className="overflow-x-auto" style={{ maxHeight: 560, overflowY: 'auto' }} onScroll={onScroll}>
      <table className="w-full text-sm" style={{ minWidth: 760 }}>
        <thead>
          <tr>
            {['Boʻlim', 'Rahbar', 'Xodim', 'Ishlagan', 'Oʻzida', 'Sotuv', 'Tushum', ''].map((header, i) => (
              <th
                key={header || i}
                scope="col"
                /* `.thead-sticky` on the CELLS, not the row — sticky <tr>
                   rendering is still uneven across engines, while cells pin
                   everywhere and their contiguous sunken backgrounds read as
                   one opaque band the rows slide under. */
                className={`thead-sticky ${scrolled ? 'is-scrolled' : ''} px-3 py-2 text-[11px] font-medium ${i >= 2 && i <= 5 ? 'text-right' : 'text-left'}`}
                style={{ color: 'var(--ink-muted)', borderBottom: '1px solid var(--border)' }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-rows">
          {nodes.map((node) => (
            <Branch key={node.id} node={node} siblingMax={siblingMax} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * One unit and its children.
 *
 * `siblingMax` is the largest revenue among THIS node's siblings, so the bar
 * answers "how does this unit compare with the ones beside it" — the question
 * a reader of a tree is asking. Normalised to the company total instead, the
 * root was always full and every leaf a sliver.
 */
function Branch({ node, siblingMax }: { node: StructureDto; siblingMax: number }) {
  /** The children compare against each other, not against their parent. */
  const childMax = Math.max(1, ...node.children.map((c) => c.revenue.amount))
  // Roots start open; deeper branches start closed, so the first paint is the
  // shape of the company rather than a wall of every team at once.
  /**
   * Open by default down to depth 2.
   *
   * At `depth < 1` the tree showed 5 of 20 departments on first paint and left
   * roughly 430px of the card empty — a page that renders a quarter of its own
   * content and looks finished. Two levels is the whole company here.
   */
  const [open, setOpen] = useState(node.depth < 2)
  const hasChildren = node.children.length > 0

  return (
    <>
      {/* The same reading hover DataTable rows carry — this table is
          hand-rolled, and a row read across ten columns needs the wash under
          the cursor just as much. */}
      <tr className="transition-colors hover:bg-[var(--surface-sunken)]">
        {/* The department name is what a screen reader announces the row BY. */}
        <th
          scope="row"
          className="px-3 py-1.5 text-left font-normal"
          style={{ paddingLeft: 12 + node.depth * 18 }}
        >
          <div className="flex items-center gap-1.5">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label={open ? 'Yopish' : 'Ochish'}
                className="focusable flex h-4 w-4 shrink-0 items-center justify-center rounded"
                style={{ color: 'var(--ink-muted)' }}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d={open ? 'M2 4.5l4 4 4-4' : 'M4.5 2l4 4-4 4'}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ) : (
              <span className="w-4 shrink-0" aria-hidden="true" />
            )}
            <span
              className="truncate font-medium"
              style={{
                color: node.depth === 0 ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                fontSize: node.depth === 0 ? 13 : 12.5,
              }}
            >
              {node.name}
            </span>
          </div>
        </th>
        <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {node.headName ? (
            /* The chip anchors the eye the way an avatar would; it is
               aria-hidden inside InitialChip because it only repeats the
               first letter of the name printed right beside it. The name
               truncates rather than wrapping under the chip — a long Uzbek
               full name must survive the column, not reshape it. */
            <span className="flex items-center gap-2">
              <InitialChip name={node.headName} />
              <span className="truncate">{node.headName}</span>
            </span>
          ) : (
            <span style={{ color: 'var(--ink-muted)' }}>—</span>
          )}
        </td>
        <td
          className="tabular px-3 py-1.5 text-right text-xs"
          style={{ color: 'var(--ink-primary)' }}
          title={`${formatNumber(node.activeHeadcount)} faol · ${formatNumber(
            node.headcount - node.activeHeadcount,
          )} oʻchirilgan`}
        >
          {/* Active of total. A branch reading "109" was counting 34 people
              Bitrix24 had already deactivated. */}
          {formatNumber(node.activeHeadcount)}
          <span style={{ color: 'var(--ink-muted)' }}> / {formatNumber(node.headcount)}</span>
        </td>
        <td
          className="tabular px-3 py-1.5 text-right text-xs"
          style={{
            color:
              node.activeHeadcount > 0 && node.workingHeadcount === 0
                ? 'var(--status-critical)'
                : 'var(--ink-secondary)',
          }}
          title="Davr ichida kamida bitta qoʻngʻiroq yoki sotuv qilganlar"
        >
          {formatNumber(node.workingHeadcount)}
        </td>
        <td className="tabular px-3 py-1.5 text-right text-xs" style={{ color: 'var(--ink-muted)' }}>
          {formatNumber(node.ownHeadcount)}
        </td>
        <td className="tabular px-3 py-1.5 text-right text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {formatNumber(node.deals)}
        </td>
        <td className="tabular px-3 py-1.5 text-right text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
          {node.revenue.amount === 0 ? (
            <span style={{ color: 'var(--ink-muted)' }}>—</span>
          ) : (
            formatCompactUzs(node.revenue.amount)
          )}
        </td>
        <td className="px-3 py-1.5" style={{ width: 120 }}>
          {/* Share of the company total, so branches compare at a glance
              without the reader converting nine-digit figures in their head. */}
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--track)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (node.revenue.amount / siblingMax) * 100)}%`,
                /*
                  Sequential, and normalised to the SIBLING group.
                  
                  Against the company total the root branch was always full and
                  every leaf was a sliver — the bar carried no information at
                  any depth but the first. Comparing a unit to its own siblings
                  is the comparison a reader of a tree is actually making.
                  
                  One hue, because this is a single quantity. It used to be
                  --series-8, a red the eye cannot separate from
                  --status-critical.
                */
                background: 'var(--seq-450)',
              }}
            />
          </div>
        </td>
      </tr>
      {open &&
        node.children.map((child) => (
          <Branch key={child.id} node={child} siblingMax={childMax} />
        ))}
    </>
  )
}
