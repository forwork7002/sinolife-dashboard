'use client'

import type { ReactNode } from 'react'

import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent, formatUzs } from '@/lib/format'

import type { MetaBlockDto, MetaProduct, MetaProductTotalsDto } from './targetApi'
import { PRODUCT_LABEL, PRODUCT_TONE, usd } from './targetTheme'

/**
 * «COLLAGEN VA ZEXTRA» — the page's lead instrument.
 *
 * Asked for on 2026-09-19: «collagen va zextrani alohida koʻrib… qaysi biri
 * qancha lead yeyayapti xulosa chiqara olishim kerak». Three layers, read top
 * to bottom:
 *
 *   1. ONE NUMBER FIRST — the window's Meta spend, at hero size, with the
 *      fraction under it that says what it bought (docs/DESIGN.md: a hero
 *      that is only a number is a poster).
 *   2. WHO TAKES WHAT — three 100 % bars on one scale: each product's share of
 *      the spend, of the Bitrix24 leads and of the delivered money. A product
 *      whose spend bar is wider than its lead bar is eating more than it
 *      brings; that is the question, drawn.
 *   3. SIDE BY SIDE, THEN IN WORDS — every figure for both products in two
 *      columns, the better of each pair marked in words, and a few sentences
 *      that state the conclusion so nobody has to derive it from a grid.
 *
 * With one product chosen the bars have nothing to compare and step aside;
 * the column and its figures stay.
 */
export function ProductCompare({
  meta,
  status,
}: {
  meta: MetaBlockDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  if (status === 'loading' || !meta) {
    return (
      <section className="card-hero px-5 py-5 sm:px-6" aria-busy="true">
        <div className="skeleton h-[38px] w-60" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="skeleton h-[280px] rounded-lg" />
          <div className="skeleton h-[280px] rounded-lg" />
        </div>
      </section>
    )
  }

  const products = meta.products.filter((p) => p.product !== 'Boshqa')
  const total = meta.total
  const pair = products.length === 2
  const verdicts = productVerdicts(products)

  return (
    <section
      className="card-hero brackets reveal px-5 py-5 sm:px-6"
      aria-label="Collagen va Zextra"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
            {pair
              ? 'Reklamaga ketgan pul — Collagen va Zextra'
              : `Reklamaga ketgan pul — ${PRODUCT_LABEL[products[0]?.product ?? 'Boshqa']}`}
          </p>
          <p
            className="figure-hero mt-1"
            style={{ color: 'var(--ink-primary)' }}
            title={usd(total.spendUsd, true)}
          >
            {usd(total.spendUsd)}
          </p>
          <p className="mt-1.5 text-[12.5px] tabular" style={{ color: 'var(--ink-muted)' }}>
            {formatNumber(total.bitrixLeads)} ta Bitrix24 lead · 1 lead{' '}
            {usd(total.costPerBitrixLeadUsd)} · {formatNumber(total.orders)} buyurtma · tushum{' '}
            {formatCompactUzs(total.deliveredMoney.amount)} soʻm
          </p>
        </div>
        {meta.importedAt && (
          <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Meta: {meta.window.from} – {meta.window.to}
          </p>
        )}
      </div>

      {pair && <ShareBars products={products} />}

      <div className={`mt-5 grid gap-4 ${pair ? 'md:grid-cols-2' : ''}`}>
        {products.map((p) => (
          <ProductColumn
            key={p.product}
            product={p}
            rival={pair ? products.find((o) => o !== p) : undefined}
          />
        ))}
      </div>

      {products.length === 0 && (
        <p className="mt-4 text-sm" style={{ color: 'var(--ink-muted)' }}>
          Bu davrda Meta akkauntlarida sarf yozilmagan.
        </p>
      )}

      {verdicts.length > 0 && (
        <div
          className="mt-5 rounded-[var(--radius-panel-sm)] border px-4 py-3"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface-sunken)',
          }}
          data-testid="product-verdicts"
        >
          <p className="eyebrow">Xulosa</p>
          <ul
            className="mt-2 flex flex-col gap-1.5 text-[13px] leading-relaxed"
            style={{ color: 'var(--ink-primary)' }}
          >
            {verdicts.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden style={{ color: 'var(--ink-muted)' }}>
                  •
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/**
 * Three rows, one scale: share of spend, of leads, of delivered money.
 * Each row is 100 %, split between the two products in their own colours.
 */
function ShareBars({ products }: { products: readonly MetaProductTotalsWithName[] }) {
  const rows: {
    label: string
    value: (p: MetaProductTotalsWithName) => number
    format: (p: MetaProductTotalsWithName) => string
  }[] = [
    { label: 'Sarf', value: (p) => p.spendUsd, format: (p) => usd(p.spendUsd) },
    {
      label: 'Leadlar',
      value: (p) => p.bitrixLeads,
      format: (p) => formatNumber(p.bitrixLeads),
    },
    {
      label: 'Buyurtmalar',
      value: (p) => p.orders,
      format: (p) => formatNumber(p.orders),
    },
    {
      label: 'Tushum',
      value: (p) => p.deliveredMoney.amount,
      format: (p) => `${formatCompactUzs(p.deliveredMoney.amount)} soʻm`,
    },
  ]

  return (
    <div className="mt-5 flex flex-col gap-2.5" aria-label="Ulushlar">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {products.map((p) => (
          <span key={p.product} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: PRODUCT_TONE[p.product] }}
            />
            {PRODUCT_LABEL[p.product]}
          </span>
        ))}
        <span style={{ color: 'var(--ink-muted)' }}>
          — har bir qator 100 %, kim qancha oladi va qancha beradi
        </span>
      </div>
      {rows.map((row) => {
        const sum = products.reduce((n, p) => n + row.value(p), 0)
        return (
          <div
            key={row.label}
            className="grid grid-cols-[84px_1fr] items-center gap-2 sm:grid-cols-[150px_1fr] sm:gap-3"
          >
            <span className="text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
              {row.label}
            </span>
            {sum > 0 ? (
              <div
                className="flex h-6 w-full overflow-hidden rounded-md"
                style={{ background: 'var(--track)' }}
              >
                {products.map((p) => {
                  const share = (row.value(p) / sum) * 100
                  return (
                    <div
                      key={p.product}
                      className="flex min-w-0 items-center px-1.5 text-[11px] sm:px-2 font-medium whitespace-nowrap tabular-nums"
                      style={{
                        width: `${share}%`,
                        background: `color-mix(in oklab, ${PRODUCT_TONE[p.product]} 22%, transparent)`,
                        borderLeft: `3px solid ${PRODUCT_TONE[p.product]}`,
                        color: 'var(--ink-primary)',
                      }}
                      title={`${PRODUCT_LABEL[p.product]}: ${row.format(p)} (${formatPercent(share)})`}
                    >
                      {share >= 12 && (
                        <>
                          {formatPercent(share, 0)}
                          {/* The figure needs room a phone does not have; the share alone fits. */}
                          <span className="hidden sm:inline">&nbsp;· {row.format(p)}</span>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                {NO_VALUE}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

type MetaProductTotalsWithName = MetaProductTotalsDto & {
  readonly product: MetaProduct
}

/**
 * Which way a figure is better — a cost is better low, a return high.
 *
 * Marked on the four figures the comparison is about (a lead's price, an
 * order's price, Meta's own lead price, ROAS) and nowhere else: a pill on
 * every row marks nothing, and a bigger lead COUNT is not «better» when it
 * was bought with a bigger budget.
 */
type Better = 'low' | 'high'

function ProductColumn({
  product,
  rival,
}: {
  product: MetaProductTotalsWithName
  rival: MetaProductTotalsWithName | undefined
}) {
  const tone = PRODUCT_TONE[product.product]

  const row = (
    label: string,
    value: ReactNode,
    compare?: { mine: number | null; theirs: number | null; better: Better },
    strong = false,
  ) => {
    const wins =
      compare &&
      rival &&
      compare.mine !== null &&
      compare.theirs !== null &&
      compare.mine !== compare.theirs
        ? compare.better === 'low'
          ? compare.mine < compare.theirs
          : compare.mine > compare.theirs
        : false
    return (
      <div className="flex items-baseline justify-between gap-3 py-1">
        <dt className="text-[12.5px]" style={{ color: 'var(--ink-secondary)' }}>
          {label}
        </dt>
        <dd className="flex items-baseline gap-2 tabular-nums">
          {wins && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                background: 'color-mix(in oklab, var(--status-good) 12%, transparent)',
                color: 'var(--status-good)',
              }}
            >
              yaxshiroq
            </span>
          )}
          <span
            className={strong ? 'text-[15px] font-semibold' : 'text-[13px]'}
            style={{ color: 'var(--ink-primary)' }}
          >
            {value}
          </span>
        </dd>
      </div>
    )
  }

  return (
    <div
      className="rounded-[var(--radius-panel-sm)] border px-4 pt-3 pb-2"
      style={{
        borderColor: 'var(--border)',
        borderTop: `3px solid ${tone}`,
        background: 'var(--surface)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {PRODUCT_LABEL[product.product]}
        </p>
        <p
          className="display tabular text-[22px] font-semibold"
          style={{ color: 'var(--ink-primary)' }}
          title={usd(product.spendUsd, true)}
        >
          {usd(product.spendUsd)}
        </p>
      </div>

      {/* One product alone has the whole width: its two groups sit side by side. */}
      <div className={rival ? '' : 'grid gap-x-8 md:grid-cols-2'}>
        <div>
          <p className="eyebrow mt-3">Reklama · Meta</p>
          <dl className="mt-1 divide-y" style={{ borderColor: 'var(--border)' }}>
            {row('Meta leadlari', formatNumber(product.metaLeads))}
            {row('1 Meta lead narxi', usd(product.metaCplUsd), {
              mine: product.metaCplUsd,
              theirs: rival?.metaCplUsd ?? null,
              better: 'low',
            })}
            {row('Kliklar', `${formatNumber(product.clicks)} · ${usd(product.cpcUsd)} / klik`)}
            {row('CTR', formatPercent(product.ctrPercent))}
          </dl>
        </div>
        <div>
          <p className="eyebrow mt-3">Natija · Bitrix24</p>
          <dl className="mt-1 divide-y" style={{ borderColor: 'var(--border)' }}>
            {row('Leadlar', formatNumber(product.bitrixLeads))}
            {row(
              '1 lead narxi',
              usd(product.costPerBitrixLeadUsd),
              {
                mine: product.costPerBitrixLeadUsd,
                theirs: rival?.costPerBitrixLeadUsd ?? null,
                better: 'low',
              },
              true,
            )}
            {row(
              'Buyurtmalar',
              `${formatNumber(product.orders)} · ${formatPercent(product.orderPercent)}`,
            )}
            {row('1 buyurtma narxi', usd(product.costPerOrderUsd), {
              mine: product.costPerOrderUsd,
              theirs: rival?.costPerOrderUsd ?? null,
              better: 'low',
            })}
            {row(
              'Tushum (yetkazildi)',
              <span title={formatUzs(product.deliveredMoney.amount)}>
                {formatCompactUzs(product.deliveredMoney.amount)} soʻm
              </span>,
            )}
            {row(
              'ROAS',
              product.roas === null ? NO_VALUE : `${product.roas.toFixed(2)}x`,
              {
                mine: product.roas,
                theirs: rival?.roas ?? null,
                better: 'high',
              },
              true,
            )}
          </dl>
        </div>
      </div>
    </div>
  )
}

const times = (n: number) => (n >= 10 ? n.toFixed(0) : n.toFixed(1)).replace('.', ',')

/**
 * The comparison stated in sentences — so the conclusion is read, not derived.
 *
 * Only what the figures on screen support: every sentence is a ratio of two
 * numbers printed above it, and a sentence whose inputs are missing (no leads,
 * no rate) is left out rather than written around a gap. Exported for its test.
 */
export function productVerdicts(products: readonly MetaProductTotalsWithName[]): string[] {
  const [a, b] = products
  if (!a || !b) return []
  const out: string[] = []
  const name = (p: MetaProductTotalsWithName) => PRODUCT_LABEL[p.product]

  // 1. Who eats more than it brings: share of spend against share of leads.
  const spend = a.spendUsd + b.spendUsd
  const leads = a.bitrixLeads + b.bitrixLeads
  if (spend > 0 && leads > 0) {
    const hungry =
      a.spendUsd / spend - a.bitrixLeads / leads >= b.spendUsd / spend - b.bitrixLeads / leads
        ? a
        : b
    out.push(
      `${name(hungry)} reklama pulining ${formatPercent((hungry.spendUsd / spend) * 100, 0)}ini oladi, ` +
        `lekin leadlarning ${formatPercent((hungry.bitrixLeads / leads) * 100, 0)}ini beradi.`,
    )
  }

  // 2. The price of one lead, and by how much.
  if (a.costPerBitrixLeadUsd !== null && b.costPerBitrixLeadUsd !== null) {
    const [cheap, dear] = a.costPerBitrixLeadUsd <= b.costPerBitrixLeadUsd ? [a, b] : [b, a]
    const k = dear.costPerBitrixLeadUsd! / cheap.costPerBitrixLeadUsd!
    out.push(
      `1 lead: ${name(cheap)} ${usd(cheap.costPerBitrixLeadUsd)}, ${name(dear)} ${usd(dear.costPerBitrixLeadUsd)}` +
        (k >= 1.1 ? ` — ${name(dear)} leadi ${times(k)} marta qimmat.` : ' — deyarli bir xil.'),
    )
  }

  // 3. The price of an order — what the lead price is for.
  if (a.costPerOrderUsd !== null && b.costPerOrderUsd !== null) {
    const [cheap, dear] = a.costPerOrderUsd <= b.costPerOrderUsd ? [a, b] : [b, a]
    out.push(
      `1 buyurtma: ${name(cheap)} ${usd(cheap.costPerOrderUsd)}, ${name(dear)} ${usd(dear.costPerOrderUsd)}.`,
    )
  }

  // 4. Does each product's advertising pay for itself?
  const returns = [a, b].filter((p) => p.roas !== null)
  if (returns.length === 2) {
    const text = returns
      .map((p) => `${name(p)} har 1 $ ga ${p.roas!.toFixed(2).replace('.', ',')} $ tushum`)
      .join(', ')
    const losing = returns.filter((p) => p.roas! < 1).map(name)
    out.push(
      `${text} qaytaryapti` +
        (losing.length > 0
          ? ` — ${losing.join(' va ')} reklamasi hozircha oʻzini qoplamayapti.`
          : ' — ikkalasi ham oʻzini qoplayapti.'),
    )
  }

  return out
}
