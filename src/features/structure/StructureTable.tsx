'use client'

import { useState, type UIEvent } from 'react'

import { InitialChip } from '@/components/ui/DataTable'
import type { StructureDto } from '@/lib/api'
import { formatCompactUzs, formatNumber } from '@/lib/format'

/**
 * The company as a table — the list view behind the header's toggle.
 *
 * This is the reading `/structure` has always had, kept rather than replaced:
 * it is the only one that shows every column at once, the only one that prints,
 * and the only one that works at a width the chart cannot. The chart answers
 * "who works under whom"; this answers "which unit closed what".
 *
 * Extracted from StructurePage unchanged in behaviour, with two additions: the
 * «Boʻysunuvchi» column, so the two views cannot state different headcounts for
 * the same unit, and a money column that disappears rather than printing zero
 * for a reader who may not see the company's figures.
 */
export function StructureTable({ nodes }: { nodes: readonly StructureDto[] }) {
  const siblingMax = Math.max(1, ...nodes.map((n) => n.revenue?.amount ?? 0))
  /** One decision for the whole table: the server sends null or it does not. */
  const withMoney = nodes.some((n) => n.revenue !== null)

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

  const headers: readonly { label: string; align: 'left' | 'right'; hint?: string }[] = [
    { label: 'Boʻlim', align: 'left' },
    { label: 'Rahbar', align: 'left' },
    {
      label: 'Boʻysunuvchi',
      align: 'right',
      hint: 'Bitrix24 shu boʻlimda koʻrsatgan faol xodimlar, rahbarsiz. Portaldagi «Подчинённые» soni.',
    },
    { label: 'Xodim', align: 'right' },
    { label: 'Ishlagan', align: 'right' },
    { label: 'Oʻzida', align: 'right' },
    ...(withMoney
      ? ([
          { label: 'Sotuv', align: 'right' as const },
          { label: 'Tushum', align: 'right' as const },
          { label: '', align: 'left' as const },
        ] as const)
      : []),
  ]

  return (
    /*
      Bounded, so the sticky header has something to stick to: a fully open
      tree runs past twenty departments, and without the cap the column names
      leave the screen exactly when the reader is deepest in the branches.
      Short trees never reach the cap and behave as before.
    */
    <div
      className="overflow-x-auto"
      style={{ maxHeight: 560, overflowY: 'auto', position: 'relative' }}
      onScroll={onScroll}
    >
      <table className="w-full text-sm" style={{ minWidth: 820 }}>
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th
                key={header.label || i}
                scope="col"
                title={header.hint}
                /* `.thead-sticky` on the CELLS, not the row — sticky <tr>
                   rendering is still uneven across engines, while cells pin
                   everywhere and their contiguous sunken backgrounds read as
                   one opaque band the rows slide under. */
                className={`thead-sticky ${scrolled ? 'is-scrolled' : ''} px-3 py-2 text-[11px] font-medium ${
                  header.align === 'right' ? 'text-right' : 'text-left'
                }`}
                style={{ color: 'var(--ink-muted)', borderBottom: '1px solid var(--border)' }}
              >
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-rows">
          {nodes.map((node) => (
            <Branch key={node.id} node={node} siblingMax={siblingMax} withMoney={withMoney} />
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
function Branch({
  node,
  siblingMax,
  withMoney,
}: {
  node: StructureDto
  siblingMax: number
  withMoney: boolean
}) {
  /** The children compare against each other, not against their parent. */
  const childMax = Math.max(1, ...node.children.map((c) => c.revenue?.amount ?? 0))
  /**
   * Open by default down to depth 2.
   *
   * At `depth < 1` the tree showed 5 of 20 departments on first paint and left
   * roughly 430px of the card empty — a page that renders a quarter of its own
   * content and looks finished. Two levels is the whole company here.
   */
  const [open, setOpen] = useState(node.depth < 2)
  const hasChildren = node.children.length > 0
  const revenue = node.revenue?.amount ?? 0

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
          {/*
            The card's rule, in the table too: a head the portal does not list
            in this unit is not shown as its head. `headName` is still sent for
            anyone who needs the raw field; `head` is the resolved answer.
          */}
          {node.head ? (
            /* The chip anchors the eye the way an avatar would; it is
               aria-hidden inside InitialChip because it only repeats the
               first letter of the name printed right beside it. The name
               truncates rather than wrapping under the chip — a long Uzbek
               full name must survive the column, not reshape it. */
            <span className="flex items-center gap-2">
              <InitialChip name={node.head.name} />
              <span className="truncate">{node.head.name}</span>
            </span>
          ) : (
            <span style={{ color: 'var(--ink-muted)' }}>—</span>
          )}
        </td>

        <td
          className="tabular px-3 py-1.5 text-right text-xs"
          style={{ color: 'var(--ink-primary)' }}
          title="Bitrix24 shu boʻlimda koʻrsatgan faol xodimlar, rahbarsiz"
        >
          {formatNumber(node.subordinateCount)}
        </td>

        <td
          className="tabular px-3 py-1.5 text-right text-xs"
          style={{ color: 'var(--ink-secondary)' }}
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
          title="Davr ichida kamida bitta bitim yopganlar"
        >
          {formatNumber(node.workingHeadcount)}
        </td>

        <td className="tabular px-3 py-1.5 text-right text-xs" style={{ color: 'var(--ink-muted)' }}>
          {formatNumber(node.ownHeadcount)}
        </td>

        {withMoney && (
          <>
            <td
              className="tabular px-3 py-1.5 text-right text-xs"
              style={{ color: 'var(--ink-secondary)' }}
            >
              {formatNumber(node.deals ?? 0)}
            </td>
            <td
              className="tabular px-3 py-1.5 text-right text-xs font-medium"
              style={{ color: 'var(--ink-primary)' }}
            >
              {revenue === 0 ? (
                <span style={{ color: 'var(--ink-muted)' }}>—</span>
              ) : (
                formatCompactUzs(revenue)
              )}
            </td>
            <td className="px-3 py-1.5" style={{ width: 120 }}>
              {/* Share of the sibling group, so branches compare at a glance
                  without the reader converting nine-digit figures in their head. */}
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: 'var(--track)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (revenue / siblingMax) * 100)}%`,
                    /*
                      Sequential, and normalised to the SIBLING group.

                      Against the company total the root branch was always full
                      and every leaf was a sliver — the bar carried no
                      information at any depth but the first. Comparing a unit
                      to its own siblings is the comparison a reader of a tree
                      is actually making.

                      One hue, because this is a single quantity. It used to be
                      --series-8, a red the eye cannot separate from
                      --status-critical.
                    */
                    background: 'var(--seq-450)',
                  }}
                />
              </div>
            </td>
          </>
        )}
      </tr>

      {open &&
        node.children.map((child) => (
          <Branch key={child.id} node={child} siblingMax={childMax} withMoney={withMoney} />
        ))}
    </>
  )
}
