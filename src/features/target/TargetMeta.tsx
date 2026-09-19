'use client'

import { Card } from '@/components/ui/Card'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { SectionHeader } from '@/components/ui/Stat'
import { formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format'

import type { MetaBlockDto, MetaOwnerDto, MetaTargetologDto } from './targetApi'
import { PRODUCT_LABEL, PRODUCT_TONE, usd, usdCell } from './targetTheme'

/**
 * «Reklama xarajati» — Meta Ads spend per targetolog, read from the Marketing
 * API: the client's «Лид база» sheet, without anybody typing it.
 *
 * THREE READINGS, ONE SOURCE. A card per targetolog (the first question: how
 * much did this person spend, and what did it buy), the targetolog × product
 * table beneath it, and the day table — the sheet itself: a row per day, a
 * column per targetolog per product, in dollars, with the window's total at
 * the foot, laid out to be read against the sheet cell by cell. The products
 * set against each other and against Bitrix24 are `ProductCompare`, above.
 *
 * WHAT IT DOES NOT HAVE, SAID UNDER IT: the sheet's «Organic», «Telegram» and
 * Аббос columns come from outside the ad accounts this token sees, so the
 * «Jami» here is Meta's alone and runs below the sheet's «Итог» by exactly
 * those columns.
 */

export function TargetMeta({
  meta,
  status,
}: {
  meta: MetaBlockDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  if (status === 'ready' && meta && meta.importedAt === null) {
    return (
      <Card className="p-5">
        <SectionHeader
          title="Targetologlar · Meta Ads"
          hint="Meta maʼlumoti hali olinmagan — serverda META_ACCESS_TOKEN oʻrnatilgach, har soatda oʻzi yangilanadi."
        />
      </Card>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Targetologlar · Meta Ads"
        hint={
          meta?.importedAt
            ? `Meta Ads Manager’dan, har soatda. Oxirgi yangilanish: ${formatDateTime(meta.importedAt)}.`
            : 'Meta Ads Manager’dan, har soatda.'
        }
      />

      <TargetologCards people={meta?.targetologs ?? []} status={status} />

      <Card className="p-0">
        <DataTable<MetaOwnerDto>
          columns={OWNER_COLUMNS}
          rows={meta?.owners ?? []}
          rowKey={(row) => row.key}
          status={status}
          emptyTitle="Bu davrda reklama xarajati yoʻq"
          minWidth={900}
          maxHeight="none"
        />
      </Card>

      <LeadBaseTable meta={meta} status={status} />
    </section>
  )
}

const muted = { color: 'var(--ink-muted)' }

const OWNER_COLUMNS: readonly Column<MetaOwnerDto>[] = [
  {
    key: 'who',
    header: 'Targetolog',
    rowHeader: true,
    render: (row) => (
      <span className="flex flex-col leading-tight">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: PRODUCT_TONE[row.product] }}
          />
          {row.targetolog}
          <span className="text-[11px] font-normal" style={muted}>
            · {PRODUCT_LABEL[row.product]}
          </span>
        </span>
        <span className="max-w-[320px] truncate text-[11px] font-normal" style={muted} title={row.accounts.join(', ')}>
          {row.accounts.join(', ')}
        </span>
      </span>
    ),
  },
  {
    key: 'spend',
    header: 'Xarajat',
    align: 'right',
    numeric: true,
    render: (row) => <span title={usd(row.spendUsd, true)}>{usd(row.spendUsd)}</span>,
  },
  {
    key: 'leads',
    header: 'Meta leadlari',
    align: 'right',
    numeric: true,
    render: (row) => formatNumber(row.metaLeads),
  },
  {
    key: 'cpl',
    header: '1 lead narxi',
    align: 'right',
    numeric: true,
    render: (row) => usd(row.metaCplUsd),
  },
  {
    key: 'impressions',
    header: 'Koʻrsatish',
    align: 'right',
    numeric: true,
    render: (row) => formatNumber(row.impressions),
  },
  {
    key: 'clicks',
    header: 'Klik',
    align: 'right',
    numeric: true,
    render: (row) => formatNumber(row.clicks),
  },
  {
    key: 'ctr',
    header: 'CTR',
    align: 'right',
    numeric: true,
    render: (row) => formatPercent(row.ctrPercent),
  },
  {
    key: 'cpc',
    header: '1 klik narxi',
    align: 'right',
    numeric: true,
    render: (row) => usd(row.cpcUsd),
  },
]

/**
 * «THIS TARGETOLOG SPENT THIS MUCH» — one card per person, the first thing in
 * the block, because it is the first question the client asks of it.
 *
 * The spend is the headline; under it, what the money bought on Meta's own
 * count (leads, clicks, impressions) and what each of those cost. A person who
 * runs both products gets a thin split bar, so Sobirjon's Zextra and Collagen
 * are one card and still two numbers. Biggest spender first, as the server
 * sent them.
 */
function TargetologCards({
  people,
  status,
}: {
  people: readonly MetaTargetologDto[]
  status: 'loading' | 'error' | 'ready'
}) {
  if (status === 'loading') {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-[200px] rounded-[var(--radius-panel)]" />
        ))}
      </div>
    )
  }
  if (people.length === 0) return null

  const total = people.reduce((n, p) => n + p.spendUsd, 0)

  return (
    <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="targetolog-cards">
      {people.map((p) => (
        <Card key={p.targetolog} className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
                {p.targetolog}
              </p>
              <p className="truncate text-[11px]" style={muted} title={p.accounts.join(', ')}>
                {p.accounts.join(', ')}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className="display tabular text-[24px] leading-tight font-semibold"
                style={{ color: 'var(--ink-primary)' }}
                title={usd(p.spendUsd, true)}
              >
                {usd(p.spendUsd)}
              </p>
              <p className="text-[11px]" style={muted}>
                sarf · jamining {formatPercent(total > 0 ? (p.spendUsd / total) * 100 : null)}
              </p>
            </div>
          </div>

          {p.products.length > 1 && (
            <div className="flex flex-col gap-1">
              <div
                className="flex h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: 'var(--track)' }}
                aria-hidden
              >
                {p.products.map((part) => (
                  <span
                    key={part.product}
                    style={{
                      width: `${p.spendUsd > 0 ? (part.spendUsd / p.spendUsd) * 100 : 0}%`,
                      background: PRODUCT_TONE[part.product],
                    }}
                  />
                ))}
              </div>
              <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]" style={muted}>
                {p.products.map((part) => (
                  <span key={part.product} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: PRODUCT_TONE[part.product] }}
                    />
                    {PRODUCT_LABEL[part.product]} {usd(part.spendUsd)} · {formatNumber(part.metaLeads)} lead
                  </span>
                ))}
              </p>
            </div>
          )}
          {p.products.length === 1 && (
            <p className="inline-flex items-center gap-1.5 text-[11px]" style={muted}>
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: PRODUCT_TONE[p.products[0]!.product] }}
              />
              faqat {PRODUCT_LABEL[p.products[0]!.product]}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
            <Metric label="Meta leadlari" value={formatNumber(p.metaLeads)} />
            <Metric label="1 lead narxi" value={usd(p.metaCplUsd)} strong />
            <Metric label="Kliklar" value={formatNumber(p.clicks)} />
            <Metric label="1 klik narxi" value={usd(p.cpcUsd)} />
            <Metric label="Koʻrsatishlar" value={formatNumber(p.impressions)} />
            <Metric label="1 000 koʻrsatish" value={usd(p.cpmUsd)} />
            <Metric label="CTR" value={formatPercent(p.ctrPercent)} />
          </dl>
        </Card>
      ))}
    </div>
  )
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt style={muted}>{label}</dt>
      <dd
        className="tabular-nums"
        style={{ color: 'var(--ink-primary)', fontWeight: strong ? 600 : 400 }}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * The «Лид база» sheet itself: a row per day, a column per targetolog per
 * product, the window's total at the foot. Dollars with cents in every cell,
 * as the sheet prints them, so the two can be compared cell by cell.
 */
function LeadBaseTable({
  meta,
  status,
}: {
  meta: MetaBlockDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  const columns = meta?.columns ?? []

  type Row = { readonly key: string; readonly date: string | null; readonly total: number; readonly cells: readonly number[] }
  const rows: Row[] = meta
    ? [
        ...meta.days.map((d) => ({ key: d.date, date: d.date, total: d.total, cells: d.cells })),
        ...(meta.days.length > 0
          ? [
              {
                key: 'total',
                date: null,
                total: meta.total.spendUsd,
                cells: meta.owners.map((o) => o.spendUsd),
              },
            ]
          : []),
      ]
    : []

  const cell = (value: number) => (value === 0 ? <span style={muted}>—</span> : usdCell(value))

  const tableColumns: Column<Row>[] = [
    {
      key: 'date',
      header: 'Kun',
      rowHeader: true,
      render: (row) =>
        row.date === null ? (
          <span className="eyebrow">Jami</span>
        ) : (
          <span className="whitespace-nowrap">{formatDate(`${row.date}T12:00:00Z`)}</span>
        ),
    },
    {
      key: 'total',
      header: 'Jami, $',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span className="font-medium whitespace-nowrap" style={{ color: 'var(--ink-primary)' }}>
          {cell(row.total)}
        </span>
      ),
    },
    ...columns.map((c, index) => ({
      key: c.key,
      header: `${c.targetolog} · ${PRODUCT_LABEL[c.product]}`,
      align: 'right' as const,
      numeric: true,
      render: (row: Row) => <span className="whitespace-nowrap">{cell(row.cells[index] ?? 0)}</span>,
    })),
  ]

  return (
    <Card className="p-0">
      <header className="px-5 pt-4 pb-3">
        <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
          Kunlik xarajat — «Лид база»
        </h3>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
          Har kun, har targetolog va mahsulot boʻyicha, dollarda. Faqat Meta akkauntlari: jadvaldagi
          Organic, Telegram va Аббос ustunlari bu yerda yoʻq, shuning uchun «Jami» jadvaldagi «Итог»
          dan shu ustunlar qadar kam.
        </p>
      </header>
      <DataTable<Row>
        columns={tableColumns}
        rows={rows}
        rowKey={(row) => row.key}
        status={status}
        emptyTitle="Bu davrda reklama xarajati yoʻq"
        minWidth={Math.max(720, 220 + columns.length * 120)}
        maxHeight="60dvh"
        stickyColumns={2}
        stickyLastRow
      />
    </Card>
  )
}
