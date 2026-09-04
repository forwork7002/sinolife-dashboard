'use client'

import type { ReactNode } from 'react'

import { Sparkline } from '@/components/charts/Sparkline'
import { GaugeTile } from '@/components/ui/Stat'
import { Tooltip } from '@/components/ui/Tooltip'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import type { DeltaDto } from '@/lib/api'
import { NO_VALUE } from '@/lib/format'
import {
  amountOf,
  type MarketingDayDto,
  type MarketingMetricsDto,
} from './marketingApi'
import {
  BUYOUT_THRESHOLDS,
  QL_THRESHOLDS,
  QUALITY_THRESHOLDS,
  type CurrencyMode,
  type Thresholds,
  count,
  deltaOf,
  gradeOf,
  moneyFromUsd,
  moneyFromUzs,
  percent,
  ratio,
} from './marketingFormat'

/**
 * The KPI band, in the source's own order — now eleven tiles, not twelve.
 *
 * The order is not ours to improve: a reader who checks the published page and
 * this screen in the same minute is comparing tile against tile, and a band
 * re-sequenced "better" turns that comparison into a hunt. Spend first, the
 * funnel's counts and costs through the middle — and the money still comes
 * back at the end, where "Tushum" now stands as the page's hero PANEL
 * (MarketingHero) rather than as the band's last cell. The sequence a source
 * reader knows is intact; the twelfth stop simply grew into an instrument.
 *
 * Four tiles are INVERTED: CPL, CPO, CAC and Deal Time are costs, and a cost
 * that fell is good news. The arrow still points the way the number moved —
 * TrendIndicator's `inverted` changes the colour, not the direction — because
 * an arrow that lies about the direction of travel is worse than no arrow.
 *
 * Three tiles carry sparklines from the same daily rows the dynamics panels
 * plot — spend, leads, sales are the counters the sheet actually fills daily.
 * The shape ties each headline to its days without claiming a y-scale; the
 * spend sparkline wears the spend series' own hue so tile and bars read as one
 * measure. QL and buyout no longer ride other tiles as text hints: each is a
 * graded ring below the band (MarketingRateRings), where the client's own
 * thresholds can actually be seen instead of read.
 */
export function MarketingKpiBand({
  current,
  previous,
  daily,
  mode,
  rate,
  status,
}: {
  current: MarketingMetricsDto | undefined
  previous: MarketingMetricsDto | undefined
  daily: readonly MarketingDayDto[]
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
  const cheque = c ? amountOf(c.averageCheque) : null
  const arpl = c ? amountOf(c.arpl) : null

  const sparkable = daily.length >= 2

  return (
    /*
      Four across at 1440px, six only from 1536px.

      Six across a 1176px content column leaves each tile ~180px, and a value
      like «16.8 ming soʻm» is ~205px at the figure size — it ran out past the
      tile's right edge on every "ming soʻm" tile. Shrinking the figure would
      make this band the one place on the dashboard where the same number is
      set smaller than everywhere else; a fourth row of tiles costs nothing.
    */
    <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      <Tile
        status={status}
        label="Xarajat"
        value={usd(spend)}
        exact={usdExact(spend)}
        delta={d((m) => m.spend.amount)}
        spark={sparkable ? daily.map((day) => day.spend.amount) : undefined}
        // The spend series' own hue (the bars in the dynamics panel), so the
        // tile and the chart below read as one measure at two sizes.
        sparkColor="var(--series-2)"
        sparkLabel="Kunlik xarajat"
      />
      <Tile
        status={status}
        label="Lidlar"
        value={count(c ? c.leads : null)}
        hint={c ? `toza: ${count(c.clean)}` : undefined}
        delta={d((m) => m.leads)}
        spark={sparkable ? daily.map((day) => day.leads) : undefined}
        sparkLabel="Kunlik lidlar"
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
        delta={d((m) => m.kval)}
      />
      <Tile
        status={status}
        label="Sotuvlar"
        value={count(c ? c.sold : null)}
        delta={d((m) => m.sold)}
        spark={sparkable ? daily.map((day) => day.sold) : undefined}
        sparkLabel="Kunlik sotuvlar"
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
    </div>
  )
}

/**
 * The four graded rates, drawn as the rings the design system prescribes for
 * tiles — and graded with the CLIENT's thresholds (`bd()` in logic.js), not
 * the house 85/60: Sifat and buyout at 80/60, QL at 30/15. Meta's share of
 * revenue has no client threshold, so its ring states magnitude in the
 * sequential hue and judges nothing.
 *
 * Each ring prints the fraction it was computed from — a rate without its
 * fraction is a claim, not a measurement — and carries the period-over-period
 * delta the flat hints never had room for.
 */
export function MarketingRateRings({
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

  const graded = (value: number | null, thresholds: Thresholds) => {
    const grade = gradeOf(value, thresholds)
    return grade ?? 'neutral'
  }

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <GaugeTile
        label="Sifat"
        value={c?.qualityPercent ?? null}
        tone={graded(c?.qualityPercent ?? null, QUALITY_THRESHOLDS)}
        status={status}
        hint={c ? `${count(c.clean)} / ${count(c.leads)} lid toza chiqdi` : undefined}
        context={
          <TrendIndicator
            delta={deltaOf(c?.qualityPercent ?? null, p?.qualityPercent ?? null)}
          />
        }
      />
      <GaugeTile
        label="QL — kvalifikatsiya ulushi"
        value={c?.qlPercent ?? null}
        tone={graded(c?.qlPercent ?? null, QL_THRESHOLDS)}
        status={status}
        hint={c ? `${count(c.kval)} / ${count(c.leads)} liddan` : undefined}
        context={
          <TrendIndicator delta={deltaOf(c?.qlPercent ?? null, p?.qlPercent ?? null)} />
        }
      />
      <GaugeTile
        label="Sotib olish"
        value={c?.buyoutPercent ?? null}
        tone={graded(c?.buyoutPercent ?? null, BUYOUT_THRESHOLDS)}
        status={status}
        hint={
          // Only while the rate itself exists: with nothing ordered the ring
          // shows an em dash, and a "X / 0 soʻm" fraction beside it would
          // state the division the module just refused to perform.
          c && c.buyoutPercent !== null
            ? `${moneyFromUzs(c.revenue.amount, mode, rate, 'compact')} / ${moneyFromUzs(
                c.ordered.amount,
                mode,
                rate,
                'compact',
              )} buyurtmadan`
            : undefined
        }
        context={
          <TrendIndicator
            delta={deltaOf(c?.buyoutPercent ?? null, p?.buyoutPercent ?? null)}
          />
        }
      />
      <GaugeTile
        label="Meta ulushi"
        value={c?.metaSharePercent ?? null}
        tone="neutral"
        status={status}
        hint={
          c && c.metaSharePercent !== null
            ? `${moneyFromUzs(c.metaRevenue.amount, mode, rate, 'compact')} / ${moneyFromUzs(
                c.revenue.amount,
                mode,
                rate,
                'compact',
              )} tushumdan`
            : undefined
        }
        context={
          <TrendIndicator
            delta={deltaOf(c?.metaSharePercent ?? null, p?.metaSharePercent ?? null)}
          />
        }
      />
    </div>
  )
}

/**
 * One tile.
 *
 * Not `StatTile`: that component formats money itself, and it only knows how
 * to say soʻm. This screen has a currency toggle, so the caller formats and
 * the tile only draws — which also lets "Deal Time" print its own unit.
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
  spark,
  sparkColor,
  sparkLabel,
  status,
}: {
  label: string
  value: string
  /** The un-compacted figure, shown on hover/focus. Omit when nothing was lost. */
  exact?: string
  hint?: ReactNode
  delta: DeltaDto
  inverted?: boolean
  /** Daily values behind the headline — rendered as a sparkline, shape only. */
  spark?: readonly number[]
  sparkColor?: string
  /** Accessible name for the sparkline; required whenever `spark` is passed. */
  sparkLabel?: string
  status: 'loading' | 'error' | 'ready'
}) {
  // 22px in a phone's 171px tile: «16.8 ming soʻm» is ~205px at 26.
  /*
    `figure-wrap` for the reason the note on the grid above already gives:
    «16.8 ming soʻm» does not fit a tile this band ever makes narrow, and the
    fix there was more rows rather than a smaller number. Two across at 360px
    the tile is 156px and the value measured 154px against ~140px of content
    box — 14px out over the card's own edge. The number keeps its size and
    takes a second line instead, breaking after «ming» because that is the
    last break that fits.
  */
  const figureClass =
    'figure figure-wrap block text-[22px] leading-none font-semibold sm:text-[26px]'

  const figure =
    status === 'loading' ? (
      <div className="skeleton mt-2 h-[22px] w-2/3 sm:h-[26px]" role="status">
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
    <div className="card flex flex-col px-4 py-3.5">
      <p
        className="truncate text-[12.5px] font-medium"
        style={{ color: 'var(--ink-secondary)' }}
        title={label}
      >
        {label}
      </p>

      {figure}

      {/* The Datadog rule: no bare big number. Every tile that has context
          prints it directly under the figure. */}
      {hint && (
        <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}

      {status === 'ready' && spark && spark.length >= 2 && (
        <div className="mt-1.5">
          <Sparkline values={spark} color={sparkColor} label={sparkLabel} height={22} />
        </div>
      )}

      <div className="mt-auto pt-2.5">
        <TrendIndicator delta={delta} inverted={inverted} />
      </div>
    </div>
  )
}
