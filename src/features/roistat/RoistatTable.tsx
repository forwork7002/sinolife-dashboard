'use client'

import { type ReactNode, useId, useMemo, useState } from 'react'

import { type Column, DataTable } from '@/components/ui/DataTable'
import { ArrowDownGlyph, ArrowUpGlyph } from '@/components/ui/Icons'
import { Select } from '@/components/ui/Select'
import { RankBadge, StatusChip } from '@/components/ui/Stat'
import { NO_VALUE, formatCents, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'

import type { RoistatColumnsDto, RoistatCountersDto, RoistatDaysDto, RoistatDim } from './roistatApi'
import { type RoistatCurrency, type RoistatMetrics, deriveMetrics, fromUsd, fromUzs } from './roistatMetrics'

/**
 * The «Анализ по» table — one row per campaign / adset / ad / targetolog / …,
 * with the reference dashboard's `cols()` exactly: a Meta group, a leads
 * group and a sales group, each drawn only when the server's `columns` says
 * the cut can fill it, and the spend-based columns (Расход, CPM, CPC, CPL,
 * CPQL, CPO, ROAS) only where a dollar can be attributed.
 *
 * SORTING IS LOCAL. Every row is on the payload, so a header press re-ranks
 * in the browser — no request, no cache key. Defaults as the reference:
 * «Продажи» descending, «Дни» newest first. A row with no answer (null
 * ratio) sinks to the bottom in either direction rather than ranking as
 * zero. «Дни» is not a /roistat tab: Savdo dinamikasi draws it («Kunlar
 * boʻyicha», `AdSalesDaysTable`).
 *
 * The ИТОГО row is the server's `total`, ratios taken from its sums, and is
 * pinned to the bottom of the scroll box (`stickyLastRow`). Headers stay in
 * Russian, as in the reference — the client's team reads them that way.
 *
 * The parent keys this component by the cut it shows, so a new cut opens on
 * its own default sort instead of inheriting a column it may not have.
 */

type Line = {
  readonly key: string
  readonly label: string
  /** The ad's cabinet, shown before its name on `ad`. */
  readonly account: string | null
  readonly kind: 'row' | 'total'
  readonly rank: number
  readonly c: RoistatCountersDto
  readonly m: RoistatMetrics
  /** A day still settling (`freshFrom` on) — `days` only. */
  readonly fresh: boolean
}

interface Spec {
  readonly key: string
  readonly header: string
  readonly value: (line: Line) => number | null
  readonly render: (line: Line) => ReactNode
}

const DRILLABLE: ReadonlySet<RoistatDim> = new Set<RoistatDim>(['camp', 'adset'])

/** What the name column is called on each cut. */
export const DIM_LABEL: Readonly<Record<RoistatDim, string>> = {
  camp: 'Кампании',
  adset: 'Адсеты',
  ad: 'Объявления',
  targetolog: 'Таргетолог',
  form: 'Форма',
  source: 'Источник',
  product: 'Товар',
  region: 'Регион',
  rop: 'РОП',
  seller: 'Продавец',
  registrator: 'Регистратор',
  days: 'Дни',
}

const muted = { color: 'var(--ink-muted)' }

function dash(): ReactNode {
  return <span style={muted}>{NO_VALUE}</span>
}

/** Graded percentage, on the reference's thresholds (good ≥ g, amber ≥ a). */
function badge(value: number | null, good: number, amber: number): ReactNode {
  if (value === null) return dash()
  const tone = value >= good ? 'good' : value >= amber ? 'warning' : 'critical'
  return <StatusChip tone={tone}>{formatPercent(value)}</StatusChip>
}

/**
 * ROAS: ≥ 3× green, ≥ 1.5× amber, below red. No spend is NOT a red verdict —
 * it is a row the money cannot be divided over — so it reads neutral.
 */
function roasBadge(value: number | null, spendUsd: number): ReactNode {
  // Spend with no ROAS means no CBU rate, not no spend.
  if (value === null) return spendUsd > 0 ? dash() : <StatusChip tone="neutral">нет расхода</StatusChip>
  const tone = value >= 3 ? 'good' : value >= 1.5 ? 'warning' : 'critical'
  return <StatusChip tone={tone}>{formatCents(value)}x</StatusChip>
}

/** «05.10.2026» — the reference's day label, from `YYYY-MM-DD`. */
export function dayLabel(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
}

function buildSpecs(cols: RoistatColumnsDto, currency: RoistatCurrency, rate: number | null): Spec[] {
  const unit = currency === 'uzs' ? 'сум' : '$'
  const money = (value: number | null): ReactNode =>
    value === null ? dash() : currency === 'uzs' ? formatFullUzs(Math.round(value)) : formatCents(value)
  const usd = (pick: (l: Line) => number | null) => (l: Line) => fromUsd(pick(l), currency, rate)
  const uzs = (pick: (l: Line) => number | null) => (l: Line) => fromUzs(pick(l), currency, rate)
  const count = (pick: (l: Line) => number): Pick<Spec, 'value' | 'render'> => ({
    value: pick,
    render: (l) => formatNumber(pick(l)),
  })
  const inMoney = (read: (l: Line) => number | null): Pick<Spec, 'value' | 'render'> => ({
    value: read,
    render: (l) => money(read(l)),
  })

  const specs: Spec[] = []
  const spend = cols.spend

  if (spend) specs.push({ key: 'spend', header: `Расход, ${unit}`, ...inMoney(usd((l) => l.c.spendUsd)) })

  if (cols.meta) {
    specs.push(
      { key: 'impressions', header: 'Показы', ...count((l) => l.c.impressions) },
      {
        key: 'freq',
        header: 'Частота',
        value: (l) => l.m.freq,
        render: (l) => (l.m.freq === null ? dash() : formatCents(l.m.freq)),
      },
      { key: 'clicks', header: 'Клики', ...count((l) => l.c.clicks) },
      { key: 'ctr', header: 'CTR', value: (l) => l.m.ctr, render: (l) => formatPercent(l.m.ctr) },
    )
    if (spend) {
      specs.push(
        { key: 'cpm', header: `CPM, ${unit}`, ...inMoney(usd((l) => l.m.cpm)) },
        { key: 'cpc', header: `CPC, ${unit}`, ...inMoney(usd((l) => l.m.cpc)) },
      )
    }
    specs.push({ key: 'metaLeads', header: 'Лиды Meta', ...count((l) => l.c.metaLeads) })
  }

  if (cols.leads) {
    specs.push(
      { key: 'leads', header: 'Лиды', ...count((l) => l.c.leads) },
      { key: 'clean', header: 'Чистые', ...count((l) => l.c.clean) },
      { key: 'qual', header: 'Качество', value: (l) => l.m.qual, render: (l) => badge(l.m.qual, 80, 60) },
    )
    if (spend) specs.push({ key: 'cpl', header: `CPL, ${unit}`, ...inMoney(usd((l) => l.m.cpl)) })
    specs.push(
      { key: 'kval', header: 'Квал', ...count((l) => l.c.kval) },
      { key: 'ql', header: 'QL %', value: (l) => l.m.ql, render: (l) => badge(l.m.ql, 30, 15) },
    )
    if (spend) specs.push({ key: 'cpql', header: `CPQL, ${unit}`, ...inMoney(usd((l) => l.m.cpql)) })
  }

  if (cols.sales) {
    specs.push(
      { key: 'ordered', header: `Заказы, ${unit}`, ...inMoney(uzs((l) => l.c.orderedUzs)) },
      {
        key: 'sold',
        header: `Продажи, ${unit}`,
        value: uzs((l) => l.c.soldUzs),
        render: (l) => {
          const v = fromUzs(l.c.soldUzs, currency, rate)
          return (
            <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
              {money(v)}
            </span>
          )
        },
      },
      { key: 'buy', header: 'Выкуп', value: (l) => l.m.buy, render: (l) => badge(l.m.buy, 80, 60) },
    )
    if (spend) specs.push({ key: 'cpo', header: `CPO, ${unit}`, ...inMoney(usd((l) => l.m.cpo)) })
    specs.push({ key: 'avg', header: `Ср.чек, ${unit}`, ...inMoney(uzs((l) => l.m.avg)) })
    if (spend) specs.push({ key: 'roas', header: 'ROAS', value: (l) => l.m.roas, render: (l) => roasBadge(l.m.roas, l.c.spendUsd) })
  }

  return specs
}

/** The reference's default: «Продажи» descending — or the first column this cut has. */
function defaultSort(dim: RoistatDim, specs: readonly Spec[]): string {
  if (dim === 'days') return 'name'
  for (const key of ['sold', 'leads', 'spend', 'impressions']) {
    if (specs.some((s) => s.key === key)) return key
  }
  return 'name'
}

export function RoistatTable({
  data,
  status,
  currency,
  errorMessage,
  onRetry,
  onDrill = () => {},
  emptyTitle = 'Bu kesimda maʼlumot yoʻq',
  emptyBody = 'Tanlangan davrda bu kesim boʻyicha qator topilmadi.',
}: {
  /** The overview, or the «Дни» cut alone — the table reads only these fields. */
  data: RoistatDaysDto | undefined
  status: 'loading' | 'error' | 'ready'
  currency: RoistatCurrency
  errorMessage?: string
  onRetry: () => void
  /** Only the drillable cuts (`camp`, `adset`) call it. */
  onDrill?: (dim: RoistatDim, key: string) => void
  emptyTitle?: string
  emptyBody?: string
}) {
  const dim: RoistatDim = data?.dim ?? 'camp'
  const rate = data?.rate?.uzsPerUsd ?? null
  const specs = useMemo(
    () => (data ? buildSpecs(data.columns, currency, rate) : []),
    [data, currency, rate],
  )

  const [sortKey, setSortKey] = useState<string | null>(null)
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const activeSort = sortKey !== null && (sortKey === 'name' || specs.some((s) => s.key === sortKey))
    ? sortKey
    : defaultSort(dim, specs)

  const lines: Line[] = useMemo(() => {
    if (!data || data.rows.length === 0) return []
    const freshFrom = data.freshFrom
    const rows: Line[] = data.rows.map((row) => ({
      key: row.key,
      label: row.label,
      account: row.account,
      kind: 'row',
      rank: 0,
      c: row,
      m: deriveMetrics(row, rate),
      fresh: dim === 'days' && row.key >= freshFrom,
    }))

    const sign = order === 'asc' ? 1 : -1
    if (activeSort === 'name') {
      // Days sort by their ISO key, which is chronological; names alphabetically.
      rows.sort((a, b) =>
        sign * (dim === 'days' ? a.key.localeCompare(b.key) : a.label.localeCompare(b.label, 'ru')),
      )
    } else {
      const spec = specs.find((s) => s.key === activeSort)
      if (spec) {
        rows.sort((a, b) => {
          const x = spec.value(a)
          const y = spec.value(b)
          if (x === null && y === null) return 0
          if (x === null) return 1
          if (y === null) return -1
          return sign * (x - y)
        })
      }
    }

    const ranked = rows.map((line, i) => ({ ...line, rank: i + 1 }))
    return [
      ...ranked,
      {
        key: '__total__',
        label: 'ИТОГО',
        account: null,
        kind: 'total',
        rank: 0,
        c: data.total,
        m: deriveMetrics(data.total, rate),
        fresh: false,
      },
    ]
  }, [data, rate, dim, activeSort, order, specs])

  const sortBy = (key: string) => {
    if (key === activeSort) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setOrder('desc')
    }
  }

  const drillable = DRILLABLE.has(dim)

  const columns: Column<Line>[] = [
    {
      key: 'rank',
      header: '#',
      width: '44px',
      // A day is a position in time, not a place won — the reference numbers it plainly.
      render: (l) =>
        l.kind === 'total' ? null : dim === 'days' ? <span style={muted}>{l.rank}</span> : <RankBadge rank={l.rank} />,
    },
    {
      key: 'name',
      header: DIM_LABEL[dim],
      sortKey: 'name',
      rowHeader: true,
      render: (l) => <NameCell line={l} dim={dim} drillable={drillable} onDrill={onDrill} />,
    },
    ...specs.map(
      (s): Column<Line> => ({
        key: s.key,
        header: s.header,
        sortKey: s.key,
        align: 'right',
        numeric: true,
        render: (l) => <span className="whitespace-nowrap">{s.render(l)}</span>,
      }),
    ),
  ]

  return (
    <div className="flex flex-col gap-2">
      {status === 'ready' && lines.length > 0 && (
        <MobileSort
          options={[
            { key: 'name', label: DIM_LABEL[dim] },
            ...specs.map((s) => ({ key: s.key, label: s.header })),
          ]}
          value={activeSort}
          order={order}
          onChange={(key) => {
            setSortKey(key)
            setOrder('desc')
          }}
          onFlip={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
        />
      )}
      <DataTable<Line>
        columns={columns}
        rows={lines}
        rowKey={(l) => l.key}
        status={status}
        errorMessage={errorMessage}
        onRetry={onRetry}
        sort={activeSort}
        order={order}
        onSort={sortBy}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
        minWidth={Math.max(720, 300 + specs.length * 104)}
        maxHeight="70dvh"
        stickyColumns={2}
        stickyLastRow
      />
    </div>
  )
}

function NameCell({
  line,
  dim,
  drillable,
  onDrill,
}: {
  line: Line
  dim: RoistatDim
  drillable: boolean
  onDrill: (dim: RoistatDim, key: string) => void
}) {
  if (line.kind === 'total') return <span className="eyebrow">ИТОГО</span>

  if (dim === 'days') {
    return (
      <span className="whitespace-nowrap font-medium">
        {dayLabel(line.key)}
        {line.fresh && (
          <span className="ml-1" title="Kun hali yopilmagan — sotuvlar keyinroq tushadi">
            ⏳<span className="sr-only"> hali toʻliq emas</span>
          </span>
        )}
      </span>
    )
  }

  if (!drillable) {
    if (line.account) {
      return (
        <span className="block max-w-[260px]" title={`${line.account} · ${line.label}`}>
          <span className="block truncate text-xs" style={muted}>{line.account}</span>
          <span className="block truncate">{line.label}</span>
        </span>
      )
    }
    return (
      <span className="block max-w-[260px] truncate" title={line.label}>
        {line.label}
      </span>
    )
  }

  /*
    A real button in the name cell rather than a clickable ROW: the ИТОГО row
    shares the table and must not announce itself as a control, and a button
    is reachable and named without the row having to pretend to be one.
  */
  return (
    <button
      type="button"
      onClick={() => onDrill(dim, line.key)}
      title={line.label}
      className="focusable -my-1 inline-flex min-h-[32px] max-w-[260px] items-center gap-1 rounded text-left font-medium hover:underline"
      style={{ color: 'var(--accent-ink)' }}
    >
      <span className="truncate">{line.label}</span>
      <span aria-hidden className="shrink-0">›</span>
      <span className="sr-only">{dim === 'camp' ? ' — adsetlarini ochish' : ' — eʼlonlarini ochish'}</span>
    </button>
  )
}

/**
 * Below 640px the header buttons are scrolled off to the right of a wide
 * table, so the sort gets its own control above it — the reference's «ss»
 * select, plus the direction it could only ever set to descending.
 */
function MobileSort({
  options,
  value,
  order,
  onChange,
  onFlip,
}: {
  options: readonly { key: string; label: string }[]
  value: string
  order: 'asc' | 'desc'
  onChange: (key: string) => void
  onFlip: () => void
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-2 sm:hidden">
      <label htmlFor={id} className="text-xs" style={muted}>
        Saralash
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} height="touch" className="min-w-0 flex-1">
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </Select>
      <button
        type="button"
        onClick={onFlip}
        aria-label={order === 'desc' ? 'Kamayish tartibida — oʻsishga oʻtkazish' : 'Oʻsish tartibida — kamayishga oʻtkazish'}
        className="focusable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-panel-sm)] border"
        style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
      >
        {order === 'desc' ? <ArrowDownGlyph size={14} /> : <ArrowUpGlyph size={14} />}
      </button>
    </div>
  )
}
