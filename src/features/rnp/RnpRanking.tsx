'use client'

import { type ReactNode, useState } from 'react'

import { Sparkline } from '@/components/charts/Sparkline'
import { RankBadge } from '@/components/ui/Stat'
import { formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import type { RnpRowDto } from './rnpApi'
import { BaseTag } from './RnpRopRail'
import { type RnpTeamSummary, TONE_COLOR, dayMonth, indexTone, livedValues } from './rnpDerive'
import { TableCard, muted } from '@/features/reklama/reklamaUi'

/**
 * «Jamoalar reytingi» — every team on one line, in the server's order (FAKT 1
 * for the month), each figure the same row of that team's own block. A click
 * anywhere on the line opens the team; the name is the keyboard's button.
 *
 * Reach is the team's own measure: handed-out leads, or connected calls for a
 * БАЗА team — labelled per line, because the two are not the same unit.
 */
export function RnpRanking({
  teams,
  days,
  today,
  onSelect,
}: {
  teams: readonly RnpTeamSummary[]
  days: readonly string[]
  today: string
  onSelect: (rop: string) => void
}) {
  const [scrolledX, setScrolledX] = useState(false)
  const edge = `tcol-sticky is-edge${scrolledX ? ' is-scrolled-x' : ''}`
  const reachFrom = (base: boolean) => teams.find((s) => s.team.isBase === base)?.reach?.reliableFrom ?? null
  const windows = [
    reachFrom(false) && `lid ${dayMonth(reachFrom(false)!)} dan`,
    reachFrom(true) && `qoʻngʻiroq ${dayMonth(reachFrom(true)!)} dan`,
  ].filter(Boolean)
  const head = 'thead-sticky px-3 py-2 text-[11px] font-medium tracking-wide whitespace-nowrap uppercase'
  const th = `${head} text-right`

  return (
    <TableCard
      title="Jamoalar reytingi"
      hint={`FAKT 1 boʻyicha. Qatorni bosing — oʻsha ROP ochiladi.${windows.length > 0 ? ` Bitrix24 da ${windows.join(', ')} toʻliq.` : ''}`}
    >
      <div
        className="relative overflow-x-auto pb-3"
        onScroll={(e) => {
          const next = e.currentTarget.scrollLeft > 0
          if (next !== scrolledX) setScrolledX(next)
        }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr style={{ color: 'var(--ink-muted)' }}>
              <th scope="col" className={`${head} ${edge} pl-5 text-left`} style={{ left: 0, background: 'var(--surface-sunken)' }}>
                Jamoa
              </th>
              <th scope="col" className={th}>Lid / Дозвон</th>
              <th scope="col" className={th}>Konv. %</th>
              <th scope="col" className={th}>Buyurtma</th>
              <th scope="col" className={th}>FAKT 1</th>
              <th scope="col" className={th}>Reja %</th>
              <th scope="col" className={th}>FAKT 2</th>
              <th scope="col" className={th}>Успешность</th>
              <th scope="col" className={`${head} pr-5 text-left`}>FAKT 1 · kunlar</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((s) => (
              <tr
                key={s.team.rop}
                onClick={() => onSelect(s.team.rop)}
                className="cursor-pointer border-t transition-colors hover:bg-[var(--surface-sunken)]"
                style={{ borderColor: 'var(--border)' }}
              >
                <th scope="row" className={`${edge} py-1.5 pr-3 pl-4 text-left font-normal`} style={{ left: 0 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(s.team.rop)
                    }}
                    className="focusable flex min-h-[44px] w-[9rem] items-center gap-2 rounded-[var(--radius-panel-sm)] px-1 text-left sm:w-[14rem]"
                    aria-label={`${s.team.label} — ROP ni ochish`}
                  >
                    <RankBadge rank={s.rank} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
                          {s.team.label}
                        </span>
                        {s.team.isBase && <BaseTag />}
                      </span>
                      <span className="block truncate text-[11px]" style={muted}>
                        {s.team.head ?? '—'}
                      </span>
                    </span>
                  </button>
                </th>
                <Num>
                  {count(s.reach)}
                  <span className="ml-1 text-[10.5px]" style={muted}>
                    {s.team.isBase ? 'дозвон' : 'lid'}
                  </span>
                </Num>
                <Num>{pct(s.conversion)}</Num>
                <Num>{count(s.orders)}</Num>
                <Num strong>{money(s.fakt1)}</Num>
                <Num>
                  <IndexText row={s.fakt1} />
                </Num>
                <Num>{money(s.fakt2)}</Num>
                <Num>{pct(s.success)}</Num>
                <td className="py-1.5 pr-5 pl-3">
                  <div className="w-28">
                    <Sparkline
                      values={livedValues(s.fakt1, days, today)}
                      color="var(--series-2)"
                      height={24}
                      label={`${s.team.label}: FAKT 1 kunma-kun`}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TableCard>
  )
}

function Num({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <td
      className={`tabular px-3 py-1.5 text-right whitespace-nowrap ${strong ? 'font-semibold' : ''}`}
      style={{ color: strong ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}
    >
      {children}
    </td>
  )
}

const dash = <span style={muted}>—</span>

function count(row: RnpRowDto | null) {
  return row?.fact == null ? dash : formatNumber(Math.round(row.fact))
}

function pct(row: RnpRowDto | null) {
  return row?.fact == null ? dash : formatPercent(row.fact)
}

function money(row: RnpRowDto | null) {
  return row?.fact == null ? dash : formatFullUzs(row.fact)
}

function IndexText({ row }: { row: RnpRowDto | null }) {
  if (row?.index == null) return dash
  return (
    <span className="font-medium" style={{ color: TONE_COLOR[indexTone(row.index, row.better)] }}>
      {formatPercent(row.index)}
    </span>
  )
}
