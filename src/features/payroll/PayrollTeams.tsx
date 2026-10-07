'use client'

import { type MouseEvent, useId, useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/Controls'
import { ChevronGlyph } from '@/components/ui/Icons'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import type { PayrollSellerDto, PayrollTeamDto } from '@/lib/api'
import { formatCompactUzs, formatFullUzs, formatNumber } from '@/lib/format'

/**
 * «Sotuvchilar oyligi» by ROP — 2026-10-05 («ROP larga ajratilsin, ichida
 * sotuvchilari boʻlsin … kim qanchaga oʻsganligi … grafiklar bilan»).
 *
 * THREE READINGS OF ONE PAYLOAD, no request of their own: the teams and the
 * comparison window both ride `/payroll/*`, so the bars, the movers and the
 * cards cannot disagree with the hero or with each other — the cards add up to
 * the fund because the server sums them from the rows it prints.
 *
 * PLAIN HTML BARS, NOT RECHARTS. Each chart here is one measure per row on one
 * scale; a bar is a width, and the page already draws its rung strip and tier
 * rails that way. It costs no chart bundle, wraps to a phone without a
 * resize observer, and every bar carries its exact figures in the shared
 * Tooltip.
 */

/** The page's accent — this period. The comparison window is the same hue, washed. */
const NOW_COLOUR = 'var(--series-3)'
const THEN_COLOUR = 'color-mix(in oklab, var(--series-3) 32%, var(--track))'

/** «ROP yoʻq» — sellers in no (ROP) department. Said the same way on every card. */
export const NO_ROP = 'ROP yoʻq'

// ---------------------------------------------------------------------------
// ROP lar taqqoslash
// ---------------------------------------------------------------------------

type CompareMetric = 'total' | 'fakt2'

/**
 * One row per ROP: this period's bar over the comparison window's, on ONE
 * scale for the whole card, so a longer bar is more money wherever it stands.
 * Payroll or FAKT 2, one control — the same two figures every card states.
 */
export function RopCompareChart({
  teams,
  comparisonLabel,
}: {
  teams: readonly PayrollTeamDto[]
  /** «1-sen – 5-sen» — the window the washed bars are. */
  comparisonLabel: string | null
}) {
  const [metric, setMetric] = useState<CompareMetric>('total')

  const pick = (team: PayrollTeamDto) => ({
    now: metric === 'total' ? team.total.amount : team.fakt2.amount,
    then: team.previous ? (metric === 'total' ? team.previous.total : team.previous.fakt2).amount : 0,
    delta: metric === 'total' ? team.totalDelta : team.fakt2Delta,
  })
  const scale = Math.max(1, ...teams.flatMap((team) => [pick(team).now, pick(team).then]))
  const width = (value: number) => `${Math.max(0, (value / scale) * 100)}%`

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
          style={{ color: 'var(--ink-secondary)' }}
        >
          <LegendSwatch colour={NOW_COLOUR} label="Shu davr" />
          {comparisonLabel && (
            <LegendSwatch colour={THEN_COLOUR} label={`Oʻtgan davr · ${comparisonLabel}`} />
          )}
        </ul>
        <SegmentedControl<CompareMetric>
          value={metric}
          onChange={setMetric}
          ariaLabel="Koʻrsatkich"
          options={[
            { value: 'total', label: 'Toʻlov' },
            { value: 'fakt2', label: 'FAKT 2' },
          ]}
        />
      </div>

      <ul className="flex flex-col gap-3">
        {teams.map((team) => {
          const { now, then, delta } = pick(team)
          const name = team.rop ?? NO_ROP
          return (
            <li
              key={name}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[140px_minmax(0,1fr)_150px]"
            >
              <span
                className="col-start-1 row-start-1 truncate text-[12px] font-semibold sm:col-start-auto sm:row-start-auto"
                style={{ color: 'var(--ink-primary)' }}
                title={name}
              >
                {name}
              </span>

              <span className="col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-auto sm:row-start-auto">
                <Tooltip
                  className="block w-full"
                  content={
                    <span className="tabular block text-left">
                      <span className="block font-semibold">{name}</span>
                      <span className="block">Shu davr: {formatFullUzs(now)} soʻm</span>
                      <span className="block">
                        Oʻtgan davr: {team.previous ? `${formatFullUzs(then)} soʻm` : 'yoʻq edi'}
                      </span>
                    </span>
                  }
                >
                  <span
                    className="flex w-full flex-col gap-[3px]"
                    role="img"
                    aria-label={`${name}: shu davr ${formatCompactUzs(now)}, oʻtgan davr ${team.previous ? formatCompactUzs(then) : 'yoʻq'}`}
                  >
                    <span className="block h-[10px] w-full overflow-hidden rounded-r" style={{ background: 'var(--grid)' }}>
                      <span
                        className="block h-full rounded-r"
                        style={{
                          width: width(now),
                          background: NOW_COLOUR,
                          transition: 'width var(--duration-enter) var(--ease-out)',
                        }}
                      />
                    </span>
                    <span className="block h-[6px] w-full overflow-hidden rounded-r">
                      <span
                        className="block h-full rounded-r"
                        style={{
                          width: width(then),
                          background: THEN_COLOUR,
                          transition: 'width var(--duration-enter) var(--ease-out)',
                        }}
                      />
                    </span>
                  </span>
                </Tooltip>
              </span>

              <span className="col-start-2 row-start-1 flex items-center justify-end gap-2 sm:col-start-auto sm:row-start-auto">
                <span className="tabular text-[12px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  {formatCompactUzs(now)}
                </span>
                {!comparisonLabel ? null : team.previous ? (
                  <TrendIndicator delta={delta} />
                ) : (
                  <NewChip team />
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function LegendSwatch({ colour, label }: { colour: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-2 w-3 rounded-sm" style={{ background: colour }} />
      {label}
    </li>
  )
}

/**
 * A seller or a team with nothing in the comparison window — new, not «+∞%».
 *
 * A TEAM's baseline is its sellers AS THEY WERE THEN, so a team can be «yangi»
 * while sellers in it carry last period's figures from another team — the
 * team's tooltip says that rather than the seller's sentence.
 */
export function NewChip({ team = false }: { team?: boolean }) {
  return (
    <Tooltip
      content={
        team
          ? 'Oʻtgan davrda bu jamoa nomi ostida yetkazilgan pul yoʻq edi (sotuvchilar oʻsha paytdagi jamoasi boʻyicha)'
          : 'Oʻtgan davrda yetkazilgan buyurtma yoʻq edi'
      }
    >
      <span
        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{ background: 'var(--grid)', color: 'var(--ink-secondary)' }}
      >
        yangi
      </span>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Eng koʻp oʻsganlar / tushganlar
// ---------------------------------------------------------------------------

const MOVERS = 5

interface Mover {
  readonly row: PayrollSellerDto
  /** FAKT 2 now minus FAKT 2 then, in soʻm. */
  readonly change: number
}

/**
 * Who moved the most, in SOʻM OF FAKT 2 — not in per cent, which ranks a
 * seller who went from 1 to 3 mln above one who added 20.
 *
 * Only people in BOTH windows: a seller new this period has no change to
 * rank, and one who sold nothing now is not on the payroll at all. The
 * newcomers are counted under the lists instead of vanishing.
 */
export function PayrollMovers({
  sellers,
  gone,
}: {
  sellers: readonly PayrollSellerDto[]
  /** Sellers who delivered money then and have no row now (`previous.gone`). */
  gone: number
}) {
  const { up, down, fresh } = useMemo(() => {
    const movers: Mover[] = sellers
      .filter((row) => row.previous !== null)
      .map((row) => ({ row, change: row.fakt2.amount - row.previous!.fakt2.amount }))
    return {
      up: movers.filter((m) => m.change > 0).sort((a, b) => b.change - a.change).slice(0, MOVERS),
      down: movers.filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, MOVERS),
      fresh: sellers.filter((row) => row.previous === null).length,
    }
  }, [sellers])

  // One scale across both lists, so a green bar and a red bar of one length are one sum.
  const scale = Math.max(1, ...up.map((m) => m.change), ...down.map((m) => -m.change))

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-2">
        <MoverList title="Eng koʻp oʻsganlar" movers={up} scale={scale} tone="up" />
        <MoverList title="Eng koʻp tushganlar" movers={down} scale={scale} tone="down" />
      </div>
      {fresh > 0 && (
        <p className="mt-4 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Yana {formatNumber(fresh)} ta sotuvchi oʻtgan davrda yetkazilgan buyurtmasiz edi — ular
          roʻyxatda «yangi» deb belgilangan.
        </p>
      )}
      {gone > 0 && (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {formatNumber(gone)} ta sotuvchi oʻtgan davrda pul yetkazgan, bu davrda esa buyurtmasi
          yoʻq — ular bu roʻyxatlarda koʻrinmaydi.
        </p>
      )}
    </div>
  )
}

function MoverList({
  title,
  movers,
  scale,
  tone,
}: {
  title: string
  movers: readonly Mover[]
  scale: number
  tone: 'up' | 'down'
}) {
  const colour = tone === 'up' ? 'var(--delta-up)' : 'var(--delta-down)'
  return (
    <section>
      <h3 className="text-[12px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
        {title}
      </h3>
      {movers.length === 0 ? (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {tone === 'up' ? 'Bu davrda FAKT 2 si oshgan sotuvchi yoʻq.' : 'Bu davrda FAKT 2 si kamaygan sotuvchi yoʻq.'}
        </p>
      ) : (
        <ol className="mt-2 flex flex-col gap-2.5">
          {movers.map(({ row, change }) => (
            <li key={row.employeeId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  {row.fullName}
                </span>
                <span className="block truncate text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                  {row.rop ?? NO_ROP} · {formatCompactUzs(row.previous!.fakt2.amount)} →{' '}
                  {formatCompactUzs(row.fakt2.amount)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular text-[12px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  {change > 0 ? '+' : '−'}
                  {formatCompactUzs(Math.abs(change))}
                </span>
                <TrendIndicator delta={row.fakt2Delta} />
              </span>
              <span
                className="col-span-2 block h-[6px] w-full overflow-hidden rounded-r"
                style={{ background: 'var(--grid)' }}
                role="img"
                aria-label={`${row.fullName}: FAKT 2 ${change > 0 ? 'oshdi' : 'kamaydi'} ${formatCompactUzs(Math.abs(change))}`}
              >
                <span
                  className="block h-full rounded-r"
                  style={{
                    width: `${(Math.abs(change) / scale) * 100}%`,
                    background: colour,
                    transition: 'width var(--duration-enter) var(--ease-out)',
                  }}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ROP kartalari
// ---------------------------------------------------------------------------

/**
 * One card per ROP, its sellers inside, in the server's order (biggest fund
 * first, «ROP yoʻq» last). The rows keep their COMPANY-WIDE rank, so «3» in
 * Lola's card means third in the company, as it did in the single table.
 *
 * A SEARCH OPENS AND NARROWS. A card with a matching seller shows only those;
 * a card whose ROP name matches shows everybody; the rest are hidden. The
 * header figures stay the team's whole period while it does — they are the
 * team's pay, not the search's.
 */
export function RopCards<Line>({
  teams,
  sellers,
  search,
  columns,
  toLines,
  rowKey,
  comparisonLabel,
}: {
  teams: readonly PayrollTeamDto[]
  sellers: readonly PayrollSellerDto[]
  search: string
  columns: Column<Line>[]
  /** The card's table lines: its (matching) sellers, and the team's own footer. */
  toLines: (rows: readonly PayrollSellerDto[], team: PayrollTeamDto) => Line[]
  rowKey: (line: Line) => string
  comparisonLabel: string | null
}) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const idBase = useId()
  const needle = search.trim().toLowerCase()

  const cards = useMemo(() => {
    const byRop = new Map<string | null, PayrollSellerDto[]>()
    for (const row of sellers) {
      const held = byRop.get(row.rop)
      if (held) held.push(row)
      else byRop.set(row.rop, [row])
    }
    return teams
      .map((team) => {
        const all = byRop.get(team.rop) ?? []
        const name = team.rop ?? NO_ROP
        const rows = !needle || name.toLowerCase().includes(needle)
          ? all
          : all.filter((row) => row.fullName.toLowerCase().includes(needle))
        return { team, name, rows }
      })
      .filter((card) => card.rows.length > 0)
  }, [teams, sellers, needle])

  const toggle = (name: string) =>
    setClosed((held) => {
      const next = new Set(held)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  if (cards.length === 0) {
    return (
      <p className="py-6 text-center text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        «{search.trim()}» boʻyicha sotuvchi ham, ROP ham topilmadi.
      </p>
    )
  }

  const allOpen = cards.every((card) => !closed.has(card.name))

  return (
    <div className="flex flex-col gap-3">
      {!needle && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setClosed(allOpen ? new Set(cards.map((card) => card.name)) : new Set())}
          >
            {allOpen ? 'Hammasini yigʻish' : 'Hammasini ochish'}
          </Button>
        </div>
      )}
      {cards.map(({ team, name, rows }, index) => {
        const open = !closed.has(name)
        const bodyId = `${idBase}-rop-${index}`
        return (
          <section
            key={name}
            // The house panel radius and border, not a 12px corner on --grid.
            className="overflow-hidden rounded-[var(--radius-panel-sm)] border"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
          >
            {/* An INSET ring: the panel clips its table to its corners, and
                `.focusable`'s outer ring would be clipped with it on three sides. */}
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => toggle(name)}
            >
              <span style={{ color: 'var(--ink-muted)' }}>
                <ChevronGlyph direction={open ? 'down' : 'right'} />
              </span>
              <span className="min-w-0 flex-1 basis-[180px]">
                <span className="block truncate text-[14px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  {name}
                </span>
                <span className="tabular block text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {formatNumber(team.sellers)} ta sotuvchi · FAKT 2 {formatCompactUzs(team.fakt2.amount)}
                  {team.previous && ` · oldin ${formatCompactUzs(team.previous.fakt2.amount)}`}
                </span>
              </span>
              {/*
                A tap on the pill opens its tooltip; it must not also fold the card.
              */}
              <span className="ml-auto flex items-center gap-2" onClick={stopToggle}>
                <span className="text-right">
                  <span className="tabular block text-[16px] leading-tight font-semibold" style={{ color: 'var(--ink-primary)' }}>
                    {formatFullUzs(team.total.amount)}
                  </span>
                  <span className="tabular block text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                    {team.previous
                      ? `oʻtgan davr ${formatFullUzs(team.previous.total.amount)}`
                      : 'jami toʻlov, soʻm'}
                  </span>
                </span>
                {team.previous ? (
                  <TrendIndicator delta={team.totalDelta} />
                ) : comparisonLabel ? (
                  <NewChip team />
                ) : null}
              </span>
            </button>
            {/* Mounted while folded, so `aria-controls` always names an element. */}
            <div
              id={bodyId}
              hidden={!open}
              className="border-t px-2 pb-2 sm:px-3"
              style={{ borderColor: 'var(--grid)' }}
            >
              {open && (
                <DataTable<Line>
                  columns={columns}
                  rows={toLines(rows, team)}
                  rowKey={rowKey}
                  status="ready"
                  emptyTitle=""
                  emptyBody=""
                  minWidth={940}
                  /* Every seller of the team at once: a payroll hides nobody behind a scrollbar. */
                  maxHeight="none"
                  stickyColumns={1}
                />
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function stopToggle(event: MouseEvent) {
  event.stopPropagation()
}
