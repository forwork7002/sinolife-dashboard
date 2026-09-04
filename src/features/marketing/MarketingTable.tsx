'use client'

import type { ReactNode } from 'react'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { StatusChip } from '@/components/ui/Stat'
import { Tooltip } from '@/components/ui/Tooltip'
import { NO_VALUE } from '@/lib/format'
import {
  DIMENSION_ROW_LABELS,
  DRILL_CHILD,
  LEAD_DIMENSIONS,
  META_DIMENSIONS,
  type MarketingBreakdownRowDto,
  type MarketingDimension,
  type MarketingMetricsDto,
  amountOf,
} from './marketingApi'
import {
  BUYOUT_THRESHOLDS,
  type CurrencyMode,
  GRADE_WORDS,
  QL_THRESHOLDS,
  QUALITY_THRESHOLDS,
  ROAS_THRESHOLDS,
  type Thresholds,
  count,
  dayLabel,
  gradeOf,
  moneyFromUsd,
  moneyFromUzs,
  monthLabel,
  percent,
  ratio,
} from './marketingFormat'

/**
 * The dimension table — every column their `cols()` builds, in that order.
 *
 * The column SET depends on the dimension, and the omissions are the honest
 * part: a region has no impressions because the sheet records a region at
 * order time, not at ad-delivery time, so the Meta block is absent rather than
 * present and empty. Product, region and ROP have no lead block for the same
 * reason. Printing twenty columns of em dashes would look like a data fault
 * instead of a data boundary.
 *
 * Sorting is client-side and total, not paged: the whole dimension is already
 * in memory (1 710 creatives is the largest slice the source publishes) and a
 * server round trip per header click would be slower and no more correct.
 */

export type SortDirection = 'asc' | 'desc'

export interface TableSort {
  /** A column key, or `IDENTITY_SORT` for the row-name column. */
  readonly key: string
  readonly direction: SortDirection
}

/** The row-identity column's sort key. On `days` this is the date. */
export const IDENTITY_SORT = '__identity__'

/** Default sort per dimension: revenue desc, except `days`, which is date desc. */
export function defaultSort(dimension: MarketingDimension): TableSort {
  return dimension === 'days'
    ? { key: IDENTITY_SORT, direction: 'desc' }
    : { key: 'revenue', direction: 'desc' }
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface MetricColumn {
  readonly key: string
  readonly header: string
  /** The number the column sorts on. Null sorts as zero, as it does upstream. */
  readonly value: (m: MarketingMetricsDto) => number | null
  /** `exact` is set on the JAMI row, where the un-compacted figure is worth a hover. */
  readonly render: (m: MarketingMetricsDto, exact: boolean) => ReactNode
  readonly emphasis?: boolean
}

function buildColumns(
  dimension: MarketingDimension,
  mode: CurrencyMode,
  rate: number,
): readonly MetricColumn[] {
  const usd =
    (pick: (m: MarketingMetricsDto) => number | null, scale: 'unit' | 'compact' = 'unit') =>
    (m: MarketingMetricsDto, exact: boolean) =>
      money(moneyFromUsd(pick(m), mode, rate, scale), moneyFromUsd(pick(m), mode, rate, 'unit'), exact)

  const uzs =
    (pick: (m: MarketingMetricsDto) => number | null, scale: 'unit' | 'compact' = 'compact') =>
    (m: MarketingMetricsDto, exact: boolean) =>
      money(moneyFromUzs(pick(m), mode, rate, scale), moneyFromUzs(pick(m), mode, rate, 'unit'), exact)

  const columns: MetricColumn[] = [
    {
      // Always first, whatever the dimension — the question this module exists
      // to answer starts with what was spent.
      key: 'spend',
      header: 'Xarajat',
      value: (m) => m.spend.amount,
      render: usd((m) => m.spend.amount, 'compact'),
    },
  ]

  if (META_DIMENSIONS.has(dimension)) {
    columns.push(
      {
        key: 'impressions',
        header: 'Koʻrsatishlar', // Показы
        value: (m) => m.impressions,
        render: (m) => count(m.impressions),
      },
      {
        key: 'frequency',
        header: 'Chastota', // Частота
        value: (m) => m.frequency,
        render: (m) => ratio(m.frequency),
      },
      {
        key: 'clicks',
        header: 'Kliklar', // Клики
        value: (m) => m.clicks,
        render: (m) => count(m.clicks),
      },
      {
        key: 'ctr',
        header: 'CTR',
        value: (m) => m.ctrPercent,
        render: (m) => percent(m.ctrPercent),
      },
      {
        key: 'cpm',
        header: 'CPM',
        value: (m) => amountOf(m.cpm),
        render: usd((m) => amountOf(m.cpm)),
      },
      {
        key: 'cpc',
        header: 'CPC',
        value: (m) => amountOf(m.cpc),
        render: usd((m) => amountOf(m.cpc)),
      },
      {
        key: 'metaLeads',
        header: 'Meta lidlari', // Лиды Meta
        value: (m) => m.metaLeads,
        render: (m) => count(m.metaLeads),
      },
    )
  }

  if (LEAD_DIMENSIONS.has(dimension)) {
    columns.push(
      {
        key: 'leads',
        header: 'Lidlar', // Лиды
        value: (m) => m.leads,
        render: (m) => count(m.leads),
      },
      {
        key: 'clean',
        header: 'Toza', // Чистые
        value: (m) => m.clean,
        render: (m) => count(m.clean),
      },
      {
        key: 'quality',
        header: 'Sifat', // Качество
        value: (m) => m.qualityPercent,
        render: (m) => <Graded value={m.qualityPercent} thresholds={QUALITY_THRESHOLDS} />,
      },
      {
        key: 'cpl',
        header: 'CPL',
        value: (m) => amountOf(m.cpl),
        render: usd((m) => amountOf(m.cpl)),
      },
      {
        key: 'kval',
        header: 'Kval', // Квал
        value: (m) => m.kval,
        render: (m) => count(m.kval),
      },
      {
        key: 'ql',
        header: 'QL %',
        value: (m) => m.qlPercent,
        render: (m) => <Graded value={m.qlPercent} thresholds={QL_THRESHOLDS} />,
      },
      {
        key: 'cpql',
        header: 'CPQL',
        value: (m) => amountOf(m.cpql),
        render: usd((m) => amountOf(m.cpql)),
      },
    )
  }

  columns.push(
    {
      key: 'ordered',
      header: 'Buyurtmalar', // Заказы
      value: (m) => m.ordered.amount,
      render: uzs((m) => m.ordered.amount),
    },
    {
      key: 'revenue',
      header: 'Sotuvlar', // Продажи
      value: (m) => m.revenue.amount,
      render: uzs((m) => m.revenue.amount),
      // The one column drawn in full ink: it is the default sort and the
      // measure every other column is here to explain.
      emphasis: true,
    },
    {
      key: 'buyout',
      header: 'Sotib olish', // Выкуп
      value: (m) => m.buyoutPercent,
      render: (m) => <Graded value={m.buyoutPercent} thresholds={BUYOUT_THRESHOLDS} />,
    },
    {
      key: 'cpo',
      header: 'CPO',
      value: (m) => amountOf(m.cpo),
      render: usd((m) => amountOf(m.cpo)),
    },
    {
      key: 'averageCheque',
      header: 'Oʻrtacha chek', // Ср.чек
      value: (m) => amountOf(m.averageCheque),
      render: uzs((m) => amountOf(m.averageCheque), 'unit'),
    },
    {
      key: 'roas',
      header: 'ROAS',
      value: (m) => m.roas,
      render: (m) => <RoasCell value={m.roas} />,
    },
  )

  return columns
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * A money cell, with the exact figure behind it only where it was compacted
 * AND the row is worth hovering.
 *
 * There is no tooltip on ordinary rows on purpose: a 1 710-row creative table
 * with six money columns would mount ten thousand popover components to serve
 * a hover nobody makes. The JAMI row is where the precise total is actually
 * read, and it gets one.
 */
function money(display: string, exact: string, withTooltip: boolean): ReactNode {
  if (!withTooltip || display === exact) return display
  return (
    <Tooltip content={<span className="tabular">{exact}</span>}>
      <span tabIndex={0} className="focusable rounded">
        {display}
      </span>
    </Tooltip>
  )
}

/**
 * A graded rate: colour, glyph AND word.
 *
 * Their page paints the number green/amber/red and stops there. Colour is
 * never the only channel here, so the chip carries a shape that differs per
 * tone (dot / triangle / square) and a one-word verdict beside the figure.
 */
function Graded({ value, thresholds }: { value: number | null; thresholds: Thresholds }) {
  const grade = gradeOf(value, thresholds)
  if (grade === null) {
    return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
  }

  return (
    <StatusChip tone={grade}>
      <span className="tabular">{percent(value)}</span>
      <span className="opacity-80">{GRADE_WORDS[grade]}</span>
    </StatusChip>
  )
}

/**
 * ROAS, graded at 3.0 / 1.5 — and "xarajat yoʻq" when there was no spend.
 *
 * Null is NOT an em dash here, and that is a deliberate departure from the
 * house null rule. Revenue attributed to a campaign that spent nothing means
 * the attribution is broken, not that the ratio is unknown: the largest row in
 * this dataset is "— вне Meta —", 4,2 mlrd soʻm against zero spend. Their page
 * paints exactly that case red and says so; an em dash would file the module's
 * biggest measurement gap under "no data".
 */
function RoasCell({ value }: { value: number | null }) {
  if (value === null) {
    return <StatusChip tone="critical">xarajat yoʻq</StatusChip>
  }

  const grade = gradeOf(value, ROAS_THRESHOLDS)!
  return (
    <StatusChip tone={grade}>
      <span className="tabular">{ratio(value)}×</span>
      <span className="opacity-80">{GRADE_WORDS[grade]}</span>
    </StatusChip>
  )
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type TableRow =
  | {
      readonly kind: 'data'
      readonly rank: number
      readonly key: string
      readonly metrics: MarketingMetricsDto
    }
  | { readonly kind: 'total'; readonly metrics: MarketingMetricsDto }

export function MarketingTable({
  dimension,
  rows,
  total,
  mode,
  rate,
  dailyFrom,
  freshFrom,
  sort,
  onSort,
  onDrill,
  status,
  errorMessage,
  onRetry,
}: {
  readonly dimension: MarketingDimension
  readonly rows: readonly MarketingBreakdownRowDto[]
  readonly total: MarketingMetricsDto | undefined
  readonly mode: CurrencyMode
  readonly rate: number
  readonly dailyFrom: string
  readonly freshFrom: string
  readonly sort: TableSort
  readonly onSort: (key: string) => void
  /** Present only on camp and adset — the two levels that have a level below. */
  readonly onDrill?: (key: string) => void
  readonly status: 'loading' | 'error' | 'ready'
  readonly errorMessage?: string
  readonly onRetry?: () => void
}) {
  const metricColumns = buildColumns(dimension, mode, rate)
  const isDays = dimension === 'days'

  const sorted = [...rows].sort((a, b) => {
    const factor = sort.direction === 'desc' ? -1 : 1

    if (sort.key === IDENTITY_SORT) {
      // Days sort by their key because the key IS the date; every other
      // dimension sorts its names alphabetically in the reader's locale.
      return factor * a.key.localeCompare(b.key, isDays ? 'en' : 'uz-UZ')
    }

    const column = metricColumns.find((c) => c.key === sort.key)
    if (!column) return 0
    // Null sorts as zero — the same rule their page applies — so a row with
    // no CPL lands at the bottom of a CPL sort instead of jumping to the top.
    return factor * ((column.value(a.metrics) ?? 0) - (column.value(b.metrics) ?? 0))
  })

  const dataRows: TableRow[] = sorted.map((row, index) => ({
    kind: 'data',
    rank: index + 1,
    key: row.key,
    metrics: row.metrics,
  }))

  /*
    JAMI is a row of the table, not a strip under it, because a total that
    does not sit in the columns it totals cannot be read against them. It is
    appended AFTER sorting so it stays at the bottom whichever header is
    clicked, and it is computed server-side from the summed RAW fields —
    re-deriving the rates from the sum, never averaging the rendered
    percentages, which would weight a 4-lead campaign like a 4 000-lead one.
  */
  const allRows: TableRow[] =
    total && dataRows.length > 0 ? [...dataRows, { kind: 'total', metrics: total }] : dataRows

  const columns: Column<TableRow>[] = [
    {
      key: 'rank',
      header: '#',
      width: '46px',
      numeric: true,
      render: (row) =>
        row.kind === 'total' ? (
          ''
        ) : (
          <span style={{ color: 'var(--ink-muted)' }}>{row.rank}</span>
        ),
    },
    {
      key: 'identity',
      header: DIMENSION_ROW_LABELS[dimension],
      sortKey: IDENTITY_SORT,
      rowHeader: true,
      width: '260px',
      render: (row) =>
        row.kind === 'total' ? (
          <span className="eyebrow" style={{ color: 'var(--ink-primary)' }}>
            JAMI
          </span>
        ) : (
          <RowName
            name={row.key}
            isDays={isDays}
            dailyFrom={dailyFrom}
            freshFrom={freshFrom}
            onDrill={onDrill}
          />
        ),
    },
    ...metricColumns.map<Column<TableRow>>((column) => ({
      key: column.key,
      header: column.header,
      sortKey: column.key,
      align: 'right',
      numeric: true,
      render: (row) => (
        <span
          style={
            row.kind === 'total' || column.emphasis
              ? { color: 'var(--ink-primary)', fontWeight: row.kind === 'total' ? 600 : 500 }
              : undefined
          }
        >
          {column.render(row.metrics, row.kind === 'total')}
        </span>
      ),
    })),
  ]

  return (
    <>
      {/* The sort control for a viewport that cannot reach column 19's header.
          Native <select>, so the phone's own picker does the work. */}
      <label className="mb-2 flex items-center gap-2 sm:hidden">
        <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Saralash
        </span>
        <select
          value={sort.key}
          onChange={(event) => onSort(event.target.value)}
          className="focusable min-w-0 flex-1 rounded-[var(--radius-panel-sm)] border px-2 py-1.5 text-xs"
          style={{
            background: 'var(--surface-raised)',
            borderColor: 'var(--border-strong)',
            color: 'var(--ink-primary)',
          }}
        >
          <option value={IDENTITY_SORT}>{DIMENSION_ROW_LABELS[dimension]}</option>
          {metricColumns.map((column) => (
            <option key={column.key} value={column.key}>
              {column.header}
            </option>
          ))}
        </select>
      </label>

      <DataTable
        columns={columns}
        rows={allRows}
        rowKey={(row) => (row.kind === 'total' ? '__jami__' : row.key)}
        status={status}
        errorMessage={errorMessage}
        onRetry={onRetry}
        sort={sort.key}
        order={sort.direction}
        onSort={onSort}
        emptyTitle="Bu davrda maʼlumot yoʻq"
        emptyBody="Tanlangan sana oraligʻida bu kesim boʻyicha bironta qator yoʻq. Davrni kengaytiring yoki boshqa kesimni tanlang."
        // Rank + name + one column's worth of width each. Wide by
        // construction: twenty-one measures is what the source publishes for a
        // campaign, and the container scrolls rather than the page.
        minWidth={306 + metricColumns.length * 108}
        // A bounded height is what gives the sticky header something to stick
        // to; without it the header scrolls away and a 1 710-row table becomes
        // twenty screens of unlabelled numbers.
        maxHeight={560}
      />
    </>
  )
}

/**
 * The row's name, plus the two states the `days` dimension carries.
 *
 * Before `dailyFrom` the source stores MONTHS, not days, and labelling a
 * month-start row "01.02.2026" would state a day's figures for a month's data.
 * On or after `freshFrom` the row is still filling: sales and cash close
 * later, so a low ROAS in the last week is normal and the row says so rather
 * than letting the reader draw the obvious wrong conclusion.
 */
function RowName({
  name,
  isDays,
  dailyFrom,
  freshFrom,
  onDrill,
}: {
  name: string
  isDays: boolean
  dailyFrom: string
  freshFrom: string
  onDrill?: (key: string) => void
}) {
  const monthly = isDays && name < dailyFrom
  const incomplete = isDays && !monthly && name >= freshFrom
  const label = isDays ? (monthly ? `${monthLabel(name)} (oy)` : dayLabel(name)) : name

  const body = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate">{label}</span>
      {incomplete && (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            background: 'color-mix(in oklab, var(--status-warning) 12%, transparent)',
            color: 'var(--status-warning)',
          }}
        >
          <HourglassGlyph />
          toʻliq emas
        </span>
      )}
    </span>
  )

  if (!onDrill) {
    return (
      <span className="flex max-w-[240px] truncate" title={label}>
        {body}
      </span>
    )
  }

  /*
    A real button in the name cell rather than a click handler on the whole
    row. Their page makes the entire <tr> clickable, which a mouse likes and
    nothing else does: the row announces as a row, Tab does not reach it, and
    in a table this wide the JAMI row would have to pretend to be a button too.
    One button, in the column that names what you are drilling into.
  */
  return (
    <button
      type="button"
      onClick={() => onDrill(name)}
      title={`${label} — ichiga kirish`}
      /*
        `flex`, not `block`, and it is what makes the 240px cap mean anything.

        The name inside is an inline-flex carrying the label and, on a day
        row, the «toʻliq emas» chip. An inline-level box wider than its
        container does not shrink to it — it overflows — so the `truncate`
        already sitting on the label never engaged and the longest campaign
        names ran 228px past this cap into the column beside them. As a flex
        container the cap is a real constraint, the label shrinks inside it
        and ellipsises where it should. Its non-drillable twin above gets the
        same treatment for the same reason.
      */
      className="focusable flex max-w-[240px] rounded text-left transition-colors hover:underline"
      style={{ color: 'var(--ink-primary)' }}
    >
      {body}
    </button>
  )
}

/** The "still filling" mark. Drawn, not the ⏳ character, which renders as a
 *  full-colour emoji on most platforms and would be the loudest thing on the
 *  page. House geometry: 1.7 stroke, currentColor. */
function HourglassGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3h10M7 21h10M8 3v3.5l4 4 4-4V3M8 21v-3.5l4-4 4 4V21"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Exposed so the page can offer the drill only where a level below exists. */
export function canDrill(dimension: MarketingDimension): boolean {
  return DRILL_CHILD[dimension] !== undefined
}
