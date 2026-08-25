'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ChartCard } from '@/components/ui/Card'
import { StatTile } from '@/components/ui/Stat'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type StructureDto, apiGet } from '@/lib/api'
import { formatCompactUzs, formatNumber } from '@/lib/format'
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

  const roots = query.data?.data ?? []
  const flat = flatten(roots)
  const totalPeople = roots.reduce((sum, r) => sum + r.headcount, 0)
  const activePeople = flat.reduce((sum, n) => sum + n.activeHeadcount, 0)
  const totalRevenue = roots.reduce((sum, r) => sum + r.revenue.amount, 0)

  return (
    <PageShell
      title={t.modules.structure.title}
      description={t.modules.structure.lead}
      accent="var(--series-8)"
      meta={query.data?.meta}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Boʻlimlar" value={flat.length || null} unit="count" />
        <StatTile label="Xodimlar" value={totalPeople || null} unit="count" />
        <StatTile
          label="Faol xodimlar"
          value={activePeople || null}
          unit="count"
          hint={
            totalPeople > 0
              ? `${formatNumber(totalPeople - activePeople)} nafari faol emas`
              : undefined
          }
          tone={
            totalPeople > 0 && activePeople / totalPeople < 0.7 ? 'warning' : 'neutral'
          }
        />
        <StatTile label="Tushum" value={totalRevenue || null} unit="money" />
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
        {!query.isPending && roots.length === 0 && (
          <EmptyState
            title="Tuzilma boʻsh"
            body="Bitrix24 kompaniya strukturasi import qilinmagan."
          />
        )}
        {roots.length > 0 && <Tree nodes={roots} maxRevenue={Math.max(totalRevenue, 1)} />}
      </ChartCard>
    </PageShell>
  )
}

function flatten(nodes: readonly StructureDto[]): StructureDto[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

function Tree({
  nodes,
  maxRevenue,
}: {
  readonly nodes: readonly StructureDto[]
  maxRevenue: number
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: 760 }}>
        <thead>
          <tr>
            {['Boʻlim', 'Rahbar', 'Xodim', 'Oʻzida', 'Sotuv', 'Tushum', ''].map((header, i) => (
              <th
                key={header || i}
                scope="col"
                className={`px-3 py-2 text-[11px] font-medium ${i >= 2 && i <= 5 ? 'text-right' : 'text-left'}`}
                style={{ color: 'var(--ink-muted)', borderBottom: '1px solid var(--border)' }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-rows">
          {nodes.map((node) => (
            <Branch key={node.id} node={node} maxRevenue={maxRevenue} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Branch({ node, maxRevenue }: { node: StructureDto; maxRevenue: number }) {
  // Roots start open; deeper branches start closed, so the first paint is the
  // shape of the company rather than a wall of every team at once.
  const [open, setOpen] = useState(node.depth < 1)
  const hasChildren = node.children.length > 0

  return (
    <>
      <tr>
        <td className="px-3 py-1.5" style={{ paddingLeft: 12 + node.depth * 18 }}>
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
        </td>
        <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {node.headName ?? <span style={{ color: 'var(--ink-muted)' }}>—</span>}
        </td>
        <td className="tabular px-3 py-1.5 text-right text-xs" style={{ color: 'var(--ink-primary)' }}>
          {formatNumber(node.headcount)}
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
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--grid)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (node.revenue.amount / maxRevenue) * 100)}%`,
                background: 'var(--series-8)',
              }}
            />
          </div>
        </td>
      </tr>
      {open &&
        node.children.map((child) => (
          <Branch key={child.id} node={child} maxRevenue={maxRevenue} />
        ))}
    </>
  )
}
