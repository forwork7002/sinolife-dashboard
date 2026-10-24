'use client'

import { useMemo } from 'react'

import { Button } from '@/components/ui/Button'
import { MultiSelect, type Option } from '@/components/ui/Controls'
import { MultiplyGlyph } from '@/components/ui/Icons'
import { type PayrollTierPick, type PayrollTrendPick, useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { PAYROLL_NO_ROP_PICK, type PayrollChoicesDto, type PayrollSellerDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

import { tierProgress } from './PayrollSheet'
import { NO_ROP } from './PayrollTeams'

/**
 * «Sotuvchilar oyligi»'s filters in the top panel — the client, 2026-10-24:
 * «sotuvchilar oyligiga rop lar boʻyicha filtrlar kerak … eng kerakli
 * filtrlarni tepa panelga». Four, both tabs, all in the URL so a picked
 * payroll is a link:
 *
 *   «Boʻlim» and «ROP» PICK TEAMS, ON THE SERVER (`?blocks=` / `?rops=` to
 *   `/payroll/sellers`). A team is kept or dropped whole with its ROP's row,
 *   so every figure on the page — the facts beside the toolbar, the hero,
 *   «Jamoa jami», the block's and the company's foot, the charts, Excel — is
 *   the server's sum over the picked teams, exactly as the whole payroll is.
 *
 *   «Bosqich» and «Oʻsish» PICK PEOPLE, IN THE BROWSER, the way the search box
 *   does — and like it they take the team / block / company sums off the
 *   sheet while on. Some of a team's people summed is not a figure anybody is
 *   paid: the team's row is its whole FAKT 2 and its ROP's 2% is on all of it.
 *   What they show is counted beside the toolbar instead.
 *
 * The «ROP» list follows «Boʻlim»: with a block picked it offers that block's
 * teams. A team picked from a stale link stays listed so it can be unticked.
 */

/** `/payroll/sellers`' parameters — the window and the picked teams — and `/payroll/days`' (the window alone). */
export function usePayrollParams(): { readonly params: Record<string, string>; readonly window: Record<string, string> } {
  const { filters } = useDashboardFilters()
  const period = useMemo(() => {
    const out: Record<string, string> = { preset: filters.preset }
    if (filters.preset === 'custom' && filters.from && filters.to) {
      out.from = filters.from
      out.to = filters.to
    }
    return out
  }, [filters.preset, filters.from, filters.to])
  /*
    The days stay on the window alone: they are keyed per seller and per
    label, the sheet sums only the rows it draws, and one request then serves
    every pick.
  */
  const params = useMemo(() => {
    const out = { ...period }
    if (filters.rops.length) out.rops = [...filters.rops].sort().join(',')
    if (filters.blocks.length) out.blocks = [...filters.blocks].sort().join(',')
    return out
  }, [period, filters.rops, filters.blocks])
  return { params, window: period }
}

/** Whether «Boʻlim» or «ROP» narrows the payload — the page's totals are then the picked teams'. */
export function usePayrollPicked(): boolean {
  const { filters } = useDashboardFilters()
  return filters.rops.length > 0 || filters.blocks.length > 0
}

export type RowPick = (row: PayrollSellerDto) => boolean

/** Within a fifth of the next rung — the bar under «Fiksa» four-fifths full. */
const NEAR_PROGRESS = 80

const TIER_OPTIONS: readonly { id: PayrollTierPick; label: string }[] = [
  { id: 'fixed', label: 'Fiksa / oklad olgan' },
  { id: 'nofixed', label: 'Fiksasiz' },
  { id: 'near', label: 'Keyingi bosqichga yaqin' },
]

const TREND_OPTIONS: readonly { id: PayrollTrendPick; label: string }[] = [
  { id: 'up', label: 'Oʻsgan' },
  { id: 'down', label: 'Tushgan' },
  { id: 'new', label: 'Yangi (oʻtgan davrda yoʻq)' },
]

function tierOf(row: PayrollSellerDto, pick: PayrollTierPick): boolean {
  switch (pick) {
    case 'fixed':
      return row.fixed.amount > 0
    case 'nofixed':
      return row.fixed.amount === 0
    case 'near':
      return row.nextFloor !== null && tierProgress(row) >= NEAR_PROGRESS
  }
}

/** By FAKT 2 itself, the pay's basis — not the delta's wording, which folds a thin baseline into «baza kichik». */
function trendOf(row: PayrollSellerDto, pick: PayrollTrendPick): boolean {
  if (row.previous === null) return pick === 'new'
  const now = BigInt(row.fakt2.amountMinor)
  const then = BigInt(row.previous.fakt2.amountMinor)
  return pick === 'up' ? now > then : pick === 'down' ? now < then : false
}

/**
 * The people «Bosqich» and «Oʻsish» keep, or null when neither is on. Inside
 * one control the choices are «or»; the two controls together are «and».
 * «Oʻsish» needs a comparison window — without one it keeps everybody.
 */
export function rowPickOf(tiers: readonly PayrollTierPick[], trend: readonly PayrollTrendPick[], compared: boolean): RowPick | null {
  const byTrend = compared && trend.length > 0
  if (tiers.length === 0 && !byTrend) return null
  return (row) =>
    (tiers.length === 0 || tiers.some((pick) => tierOf(row, pick))) && (!byTrend || trend.some((pick) => trendOf(row, pick)))
}

/** The page's row pick, from the URL. */
export function useRowPick(compared: boolean): RowPick | null {
  const { filters } = useDashboardFilters()
  return useMemo(() => rowPickOf(filters.tiers, filters.trend, compared), [filters.tiers, filters.trend, compared])
}

/** The no-team bucket's filter value and name, as the server spells them. */
const pickOf = (rop: string | null) => rop ?? PAYROLL_NO_ROP_PICK
const nameOf = (pick: string) => (pick === PAYROLL_NO_ROP_PICK ? NO_ROP : pick)

/** A selection the list does not carry, still offered — so a stale link's choice can be unticked. */
function withSelected(options: Option[], selected: readonly string[], label: (id: string) => string): Option[] {
  const listed = new Set(options.map((option) => option.id))
  return [...options, ...selected.filter((id) => !listed.has(id)).map((id) => ({ id, label: label(id) }))]
}

export function PayrollFilters({ choices, compared }: { readonly choices: PayrollChoicesDto | undefined; readonly compared: boolean }) {
  const { filters, update } = useDashboardFilters()
  const blockLabel = useMemo(() => new Map((choices?.blocks ?? []).map((b) => [b.branch as string, b.label])), [choices])

  const blockOptions = useMemo(
    () =>
      withSelected(
        (choices?.blocks ?? []).map((b) => ({ id: b.branch, label: `${b.label} · ${formatNumber(b.sellers)} kishi` })),
        filters.blocks,
        (id) => id,
      ),
    [choices, filters.blocks],
  )
  const ropOptions = useMemo(() => {
    const blocks = new Set<string>(filters.blocks)
    const teams = (choices?.teams ?? []).filter((team) => blocks.size === 0 || blocks.has(team.branch))
    return withSelected(
      teams.map((team) => ({
        id: pickOf(team.rop),
        label: `${nameOf(pickOf(team.rop))} · ${blockLabel.get(team.branch) ?? team.branch} · ${formatNumber(team.sellers)}`,
      })),
      filters.rops,
      nameOf,
    )
  }, [choices, filters.blocks, filters.rops, blockLabel])

  const active = filters.blocks.length + filters.rops.length + filters.tiers.length + (compared ? filters.trend.length : 0)

  return (
    <>
      <MultiSelect
        label="Boʻlim"
        options={blockOptions}
        selected={filters.blocks}
        onChange={(ids) => update({ blocks: ids as typeof filters.blocks })}
      />
      <MultiSelect label="ROP" options={ropOptions} selected={filters.rops} onChange={(rops) => update({ rops })} />
      <MultiSelect
        label="Bosqich"
        options={TIER_OPTIONS}
        selected={filters.tiers}
        onChange={(ids) => update({ tiers: ids as PayrollTierPick[] })}
      />
      {compared && (
        <MultiSelect
          label="Oʻsish"
          options={TREND_OPTIONS}
          selected={filters.trend}
          onChange={(ids) => update({ trend: ids as PayrollTrendPick[] })}
        />
      )}
      {active > 0 && (
        // Red, with a ×, like PageShell's «Filtrlarni tozalash» — this page draws its own.
        <Button
          variant="danger"
          size="sm"
          icon={<MultiplyGlyph size={13} />}
          onClick={() => update({ blocks: [], rops: [], tiers: [], trend: [] })}
        >
          Filtrlarni tozalash ({active})
        </Button>
      )}
    </>
  )
}

/** Σ of the drawn people's pay, in minor units — a count beside the toolbar while «Bosqich» / «Oʻsish» is on. */
export function shownTotal(rows: readonly PayrollSellerDto[]): { readonly people: number; readonly total: number } {
  const minor = rows.reduce((acc, row) => acc + BigInt(row.total.amountMinor), 0n)
  return { people: rows.length, total: Number(minor) / 100 }
}
