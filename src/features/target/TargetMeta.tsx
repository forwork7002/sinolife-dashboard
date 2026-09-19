'use client'

import { Card } from '@/components/ui/Card'
import { type Column, DataTable } from '@/components/ui/DataTable'
import { SectionHeader } from '@/components/ui/Stat'
import {
  NO_VALUE,
  formatCompactUzs,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
} from '@/lib/format'

import type { MetaBlockDto, MetaOwnerDto, MetaProduct, MetaProductTotalsDto } from './targetApi'

/**
 * «Reklama xarajati» — Meta Ads spend per targetolog, read from the Marketing
 * API: the client's «Лид база» sheet, without anybody typing it.
 *
 * THREE READINGS, ONE SOURCE. The product rows put each product's spend beside
 * the Bitrix24 leads and money its own pages brought in — the one place the
 * two sources meet, and every figure there says which source it is. The
 * targetolog rows are Meta's alone. The day table is the sheet itself: a row
 * per day, a column per targetolog per product, in dollars, with the window's
 * total at the foot — laid out to be read against the sheet cell by cell.
 *
 * WHAT IT DOES NOT HAVE, SAID UNDER IT: the sheet's «Organic», «Telegram» and
 * Аббос columns come from outside the ad accounts this token sees, so the
 * «Jami» here is Meta's alone and runs below the sheet's «Итог» by exactly
 * those columns.
 */

const PRODUCT_LABEL: Readonly<Record<MetaProduct, string>> = {
  Collagen: 'Collagen',
  Zextra: 'Zextra',
  Boshqa: 'Boshqa',
}

const PRODUCT_TONE: Readonly<Record<MetaProduct, string>> = {
  Collagen: 'var(--series-4)',
  Zextra: 'var(--series-1)',
  Boshqa: 'var(--axis)',
}

const usdFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usdRound = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** «1 453.80 $» below a thousand's worth of noise, «18 257 $» above. */
function usd(value: number | null, exact = false): string {
  if (value === null) return NO_VALUE
  const text = exact || Math.abs(value) < 1000 ? usdFormat.format(value) : usdRound.format(value)
  return `${text.replace(/,/g, ' ')} $`
}

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
          title="Reklama xarajati (Meta Ads)"
          hint="Meta maʼlumoti hali olinmagan — serverda META_ACCESS_TOKEN oʻrnatilgach, har soatda oʻzi yangilanadi."
        />
      </Card>
    )
  }

  const total = meta?.total

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Reklama xarajati (Meta Ads)"
        hint={
          meta?.importedAt
            ? `Meta Ads Manager’dan, har soatda. Oxirgi yangilanish: ${formatDateTime(meta.importedAt)}.`
            : 'Meta Ads Manager’dan, har soatda.'
        }
      />

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Tile
          status={status}
          label="Reklama xarajati"
          value={total ? usd(total.spendUsd) : null}
          title={total ? usd(total.spendUsd, true) : undefined}
          hint={meta ? `${meta.owners.length} ta targetolog-mahsulot` : undefined}
        />
        <Tile
          status={status}
          label="Meta leadlari"
          value={total ? formatNumber(total.metaLeads) : null}
          hint={total ? `1 lead ${usd(total.metaCplUsd)} · Meta hisobi` : undefined}
        />
        <Tile
          status={status}
          label="Bitrix24 leadlari"
          value={total ? formatNumber(total.bitrixLeads) : null}
          hint="target sahifalaridan Регистрация ga tushgan"
        />
        <Tile
          status={status}
          label="1 Bitrix24 lead narxi"
          value={total ? usd(total.costPerBitrixLeadUsd) : null}
          hint="Meta xarajati ÷ Bitrix24 leadlari"
        />
        <Tile
          status={status}
          label="ROAS"
          value={total ? (total.roas === null ? NO_VALUE : `${total.roas.toFixed(2)}x`) : null}
          hint={
            total
              ? `tushum ${formatCompactUzs(total.deliveredMoney.amount)} soʻm ÷ xarajat`
              : undefined
          }
        />
      </div>

      <Card className="p-0">
        <DataTable<ProductRow>
          columns={PRODUCT_COLUMNS}
          rows={productRows(meta)}
          rowKey={(row) => row.key}
          status={status}
          emptyTitle="Bu davrda reklama xarajati yoʻq"
          emptyBody="Tanlangan kunlarda Meta akkauntlarida sarf yozilmagan."
          minWidth={900}
          maxHeight="none"
          stickyLastRow
        />
      </Card>
      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
        Bitrix24 ustunlari — shu mahsulotning target sahifalaridan kelgan leadlar va ulardan
        yetkazilgan tushum (Sinolife sahifalari → Collagen, Zextra sahifalari → Zextra). ROAS —
        tushum ÷ (xarajat × kurs)
        {meta?.usdRate
          ? `, 1 $ = ${formatNumber(Math.round(meta.usdRate))} soʻm (${meta.usdRateDate})`
          : ''}
        .
      </p>

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

interface ProductRow extends MetaProductTotalsDto {
  readonly key: string
  readonly product: MetaProduct | null
}

function productRows(meta: MetaBlockDto | undefined): ProductRow[] {
  if (!meta || meta.products.length === 0) return []
  return [
    ...meta.products.map((p) => ({ ...p, key: p.product })),
    { ...meta.total, key: 'total', product: null },
  ]
}

const muted = { color: 'var(--ink-muted)' }

function ProductName({ product }: { product: MetaProduct | null }) {
  if (product === null) return <span className="eyebrow">Jami</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-sm"
        style={{ background: PRODUCT_TONE[product] }}
      />
      {PRODUCT_LABEL[product]}
    </span>
  )
}

const PRODUCT_COLUMNS: readonly Column<ProductRow>[] = [
  {
    key: 'product',
    header: 'Mahsulot',
    rowHeader: true,
    render: (row) => <ProductName product={row.product} />,
  },
  {
    key: 'spend',
    header: 'Xarajat',
    align: 'right',
    numeric: true,
    render: (row) => <span title={usd(row.spendUsd, true)}>{usd(row.spendUsd)}</span>,
  },
  {
    key: 'metaLeads',
    header: 'Meta leadlari',
    align: 'right',
    numeric: true,
    render: (row) => (
      <>
        {formatNumber(row.metaLeads)}
        <span className="ml-1.5 text-xs" style={muted}>
          {usd(row.metaCplUsd)}
        </span>
      </>
    ),
  },
  {
    key: 'bitrixLeads',
    header: 'Bitrix24 leadlari',
    align: 'right',
    numeric: true,
    render: (row) => formatNumber(row.bitrixLeads),
  },
  {
    key: 'perLead',
    header: '1 Bitrix24 lead narxi',
    align: 'right',
    numeric: true,
    render: (row) => usd(row.costPerBitrixLeadUsd),
  },
  {
    key: 'delivered',
    header: 'Tushum (Bitrix24)',
    align: 'right',
    numeric: true,
    render: (row) => `${formatCompactUzs(row.deliveredMoney.amount)} soʻm`,
  },
  {
    key: 'roas',
    header: 'ROAS',
    align: 'right',
    numeric: true,
    render: (row) => (row.roas === null ? NO_VALUE : `${row.roas.toFixed(2)}x`),
  },
]

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
    key: 'ctr',
    header: 'CTR',
    align: 'right',
    numeric: true,
    render: (row) => formatPercent(row.ctrPercent),
  },
]

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

  const cell = (value: number) =>
    value === 0 ? <span style={muted}>—</span> : usdFormat.format(value).replace(/,/g, ' ')

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

/** A tile whose value is already text — dollars, which `StatTile` does not format. */
function Tile({
  label,
  value,
  hint,
  title,
  status,
}: {
  label: string
  value: string | null
  hint?: string
  title?: string
  status: 'loading' | 'error' | 'ready'
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="text-[12px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>
      {status === 'loading' ? (
        <div className="skeleton h-7 w-24 rounded" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : (
        <p
          className="display tabular text-[22px] leading-tight font-semibold"
          style={{ color: status === 'error' ? 'var(--ink-muted)' : 'var(--ink-primary)' }}
          title={title}
        >
          {status === 'error' ? NO_VALUE : (value ?? NO_VALUE)}
        </p>
      )}
      {hint && status === 'ready' && (
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}
    </Card>
  )
}
