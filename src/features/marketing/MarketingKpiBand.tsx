'use client'

import type { ReactNode } from 'react'

import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import type { DeltaDto } from '@/lib/api'
import { NO_VALUE } from '@/lib/format'
import {
  amountOf,
  type MarketingMetricsDto,
} from './marketingApi'
import {
  type CurrencyMode,
  count,
  deltaOf,
  moneyFromUsd,
  moneyFromUzs,
  percent,
  ratio,
} from './marketingFormat'

/**
 * The twelve-tile band, in the source's own order.
 *
 * The order is not ours to improve: a reader who checks the published page and
 * this screen in the same minute is comparing tile against tile, and a band
 * re-sequenced "better" turns that comparison into a hunt. Spend first, the
 * funnel's counts and costs through the middle, revenue last — the money goes
 * out at the top-left and comes back at the bottom-right.
 *
 * Four of the twelve are INVERTED: CPL, CPO, CAC and Deal Time are costs, and
 * a cost that fell is good news. The arrow still points the way the number
 * moved — TrendIndicator's `inverted` changes the colour, not the direction —
 * because an arrow that lies about the direction of travel is worse than no
 * arrow at all.
 *
 * "Tushum" is this page's ONE hero: `.card-hero` + `.figure-hero`, with ROAS
 * and Meta's share of it in the hint so the biggest number on the screen never
 * stands there unqualified.
 */
export function MarketingKpiBand({
  current,
  previous,
  mode,
  rate,
  status,
}: {
  current: MarketingMetricsDto | undefined
  previous: MarketingMetricsDto | undefined
  mode: CurrencyMode
  rate: number
  status: 'loading' | 'error' | 'ready'
}) {
  const c = current
  const p = previous

  /** A metric from both windows, as a delta. `undefined` data reads as null. */
  const d = (
    pick: (m: MarketingMetricsDto) => number | null,
  ): DeltaDto => deltaOf(c ? pick(c) : null, p ? pick(p) : null)

  const usd = (value: number | null) => moneyFromUsd(value, mode, rate, 'compact')
  const usdExact = (value: number | null) => moneyFromUsd(value, mode, rate, 'unit')
  const uzs = (value: number | null) => moneyFromUzs(value, mode, rate, 'compact')
  const uzsExact = (value: number | null) => moneyFromUzs(value, mode, rate, 'unit')

  const spend = c ? c.spend.amount : null
  const revenue = c ? c.revenue.amount : null
  const cheque = c ? amountOf(c.averageCheque) : null
  const arpl = c ? amountOf(c.arpl) : null

  return (
    <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <Tile
        status={status}
        label="Xarajat"
        value={usd(spend)}
        exact={usdExact(spend)}
        delta={d((m) => m.spend.amount)}
      />
      <Tile
        status={status}
        label="Lidlar"
        value={count(c ? c.leads : null)}
        hint={c ? `toza: ${count(c.clean)}` : undefined}
        delta={d((m) => m.leads)}
      />
      <Tile
        status={status}
        label="CPL"
        value={usd(c ? amountOf(c.cpl) : null)}
        exact={usdExact(c ? amountOf(c.cpl) : null)}
        hint="lid narxi"
        delta={d((m) => amountOf(m.cpl))}
        inverted
      />
      <Tile
        status={status}
        label="Kvalifikatsiya"
        value={count(c ? c.kval : null)}
        hint={c ? `QL ${percent(c.qlPercent)}` : undefined}
        delta={d((m) => m.kval)}
      />
      <Tile
        status={status}
        label="Sotuvlar"
        value={count(c ? c.sold : null)}
        hint={c ? `sotib olish ${percent(c.buyoutPercent)}` : undefined}
        delta={d((m) => m.sold)}
      />
      <Tile
        status={status}
        label="CPO"
        value={usd(c ? amountOf(c.cpo) : null)}
        exact={usdExact(c ? amountOf(c.cpo) : null)}
        hint="sotuv narxi"
        delta={d((m) => amountOf(m.cpo))}
        inverted
      />
      <Tile
        status={status}
        label="CAC"
        value={usd(c ? amountOf(c.cac) : null)}
        exact={usdExact(c ? amountOf(c.cac) : null)}
        hint="yangi mijoz"
        delta={d((m) => amountOf(m.cac))}
        inverted
      />
      <Tile
        status={status}
        label="Konversiya"
        value={percent(c ? c.conversionPercent : null)}
        hint="liddan sotuvgacha"
        delta={d((m) => m.conversionPercent)}
      />
      <Tile
        status={status}
        label="Oʻrtacha chek"
        value={uzs(cheque)}
        exact={uzsExact(cheque)}
        delta={d((m) => amountOf(m.averageCheque))}
      />
      <Tile
        status={status}
        label="ARPL"
        value={uzs(arpl)}
        exact={uzsExact(arpl)}
        hint="liddan tushum"
        delta={d((m) => amountOf(m.arpl))}
      />
      <Tile
        status={status}
        label="Deal Time"
        /*
          Every `dsum`/`dcnt` the source publishes today is zero, so this tile
          renders an em dash and its delta reads "maʼlumot yoʻq". That is the
          honest rendering of a metric the sheet does not fill in — the
          alternative, "0 kun", would claim every lead closed the same day.
        */
        value={
          c && c.dealTimeDays !== null ? `${ratio(c.dealTimeDays, 1)} kun` : NO_VALUE
        }
        hint="liddan sotuvgacha"
        delta={d((m) => m.dealTimeDays)}
        inverted
      />
      <Tile
        status={status}
        hero
        label="Tushum"
        value={uzs(revenue)}
        exact={uzsExact(revenue)}
        hint={
          c ? (
            <>
              ROAS {c.roas === null ? NO_VALUE : `${ratio(c.roas)}×`}
              {c.metaSharePercent !== null && (
                <> · {percent(c.metaSharePercent, 0)} Meta</>
              )}
            </>
          ) : undefined
        }
        delta={d((m) => m.revenue.amount)}
      />
    </div>
  )
}

/**
 * One tile.
 *
 * Not `StatTile`: that component formats money itself, and it only knows how
 * to say soʻm. This screen has a currency toggle, so the caller formats and
 * the tile only draws — which also lets "Deal Time" print its own unit and the
 * hero print a two-part hint.
 *
 * Loading, failure and a genuine null are three renderings, as everywhere: a
 * skeleton, the word "Olinmadi" in critical ink, and an em dash.
 */
function Tile({
  label,
  value,
  exact,
  hint,
  delta,
  inverted = false,
  hero = false,
  status,
}: {
  label: string
  value: string
  /** The un-compacted figure, shown on hover/focus. Omit when nothing was lost. */
  exact?: string
  hint?: ReactNode
  delta: DeltaDto
  inverted?: boolean
  hero?: boolean
  status: 'loading' | 'error' | 'ready'
}) {
  const figureClass = hero
    ? 'figure-hero block'
    : 'figure block text-[26px] leading-none font-semibold'

  const figure =
    status === 'loading' ? (
      <div
        className={`skeleton mt-2 w-2/3 ${hero ? 'h-[40px]' : 'h-[26px]'}`}
        role="status"
      >
        <span className="sr-only">Yuklanmoqda</span>
      </div>
    ) : status === 'error' ? (
      <p
        className="mt-2 text-base font-medium"
        style={{ color: 'var(--status-critical)' }}
        title="Maʼlumot olinmadi"
      >
        Olinmadi
      </p>
    ) : exact && exact !== value ? (
      /*
        The exact amount rides the Tooltip primitive rather than a native
        `title`: it reaches focus and touch as well as a patient mouse, and
        the figure is a tab stop precisely because compacting is the only
        thing standing between the reader and the real number.
      */
      <div className="mt-2">
        <Tooltip content={<span className="tabular">{exact}</span>}>
          <span
            tabIndex={0}
            className={`focusable rounded-[var(--radius-panel-sm)] ${figureClass}`}
            style={{ color: 'var(--ink-primary)' }}
          >
            {value}
          </span>
        </Tooltip>
      </div>
    ) : (
      <p className={`mt-2 ${figureClass}`} style={{ color: 'var(--ink-primary)' }}>
        {value}
      </p>
    )

  return (
    <div className={`flex flex-col px-4 py-3.5 ${hero ? 'card-hero' : 'card'}`}>
      <p
        className="truncate text-[12.5px] font-medium"
        style={{ color: 'var(--ink-secondary)' }}
        title={label}
      >
        {label}
      </p>

      {figure}

      {/* The Datadog rule: no bare big number. Every tile that has context
          prints it directly under the figure, and the hero's context is the
          two ratios that judge it — ROAS and how much of it Meta claims. */}
      {hint && (
        <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}

      <div className="mt-auto pt-2.5">
        <TrendIndicator delta={delta} inverted={inverted} />
      </div>
    </div>
  )
}
