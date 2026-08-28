'use client'

import { useState } from 'react'

import { DataTable, type Column } from '@/components/ui/DataTable'
import { SegmentedControl } from '@/components/ui/Controls'
import { formatCompactUzs, formatNumber, NO_VALUE } from '@/lib/format'

import type { MarketingVerifyDto, VerifyCut, VerifyRowDto } from './marketingApi'
import { amountOf } from './marketingApi'
import { percent } from './marketingFormat'

/**
 * The two books, side by side.
 *
 * This component's whole job is to REFUSE to reconcile. Roistat and Bitrix24
 * count the same events under different rules — Roistat attributes revenue to
 * the lead's date and sees only paid traffic; Bitrix24 counts a won deal on
 * its close date across every pipeline — so a single "true" number does not
 * exist, and inventing one by averaging or adjusting would be the most
 * confident lie the dashboard could tell. Both figures are printed, the
 * difference is stated, and keys present on only one side are named rather
 * than quietly dropped: an unmatched key is usually a spelling difference in a
 * hand-typed sheet, and that is worth knowing.
 */
const CUT_LABELS: Readonly<Record<VerifyCut, string>> = Object.freeze({
  day: 'Kunlar',
  region: 'Region',
  product: 'Mahsulot',
  rop: 'ROP',
  seller: 'Sotuvchi',
})

export function MarketingVerify({
  data,
  status,
  onRetry,
}: {
  readonly data: MarketingVerifyDto | undefined
  readonly status: 'loading' | 'error' | 'ready'
  readonly onRetry?: () => void
}) {
  const cuts = data?.cuts ?? []
  const [cut, setCut] = useState<VerifyCut>('day')
  const active = cuts.find((c) => c.cut === cut) ?? cuts[0]

  const columns: Column<VerifyRowDto>[] = [
    {
      key: 'key',
      header: active ? CUT_LABELS[active.cut] : 'Kesim',
      rowHeader: true,
      render: (row) => row.key,
    },
    {
      key: 'roistat',
      header: 'Roistat tushum',
      align: 'right',
      numeric: true,
      render: (row) => money(amountOf(row.roistat?.revenue)),
    },
    {
      key: 'bitrix',
      header: 'Bitrix24 tushum',
      align: 'right',
      numeric: true,
      render: (row) => money(amountOf(row.bitrix?.revenue)),
    },
    {
      key: 'diff',
      header: 'Farq',
      align: 'right',
      numeric: true,
      render: (row) => money(amountOf(row.revenueDifference)),
    },
    {
      key: 'diffPercent',
      header: 'Farq %',
      align: 'right',
      numeric: true,
      /*
        Graded by SIZE, not by sign. Neither system is the reference here, so
        "Roistat is higher" is not good news and "lower" is not bad — what
        matters is whether the two books are within shouting distance of each
        other. A quarter apart is worth a look; half apart wants an explanation.
      */
      render: (row) => {
        const value = row.revenueDifferencePercent
        if (value === null) return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
        const magnitude = Math.abs(value)
        const tone =
          magnitude >= 50
            ? 'var(--status-critical)'
            : magnitude >= 25
              ? 'var(--status-warning)'
              : 'var(--ink-secondary)'
        return <span style={{ color: tone }}>{percent(value)}</span>
      },
    },
    {
      key: 'sold',
      header: 'Sotuv (R / B)',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: 'var(--ink-secondary)' }}>
          {row.roistat ? formatNumber(row.roistat.sold) : NO_VALUE} /{' '}
          {row.bitrix ? formatNumber(row.bitrix.sold) : NO_VALUE}
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-3">
      {cuts.length > 1 && (
        <SegmentedControl<VerifyCut>
          ariaLabel="Solishtirish kesimi"
          value={active?.cut ?? 'day'}
          options={cuts.map((c) => ({ value: c.cut, label: CUT_LABELS[c.cut] }))}
          onChange={setCut}
        />
      )}

      {active && status === 'ready' && (
        <div
          className="flex flex-wrap gap-x-6 gap-y-1 text-[11px]"
          style={{ color: 'var(--ink-muted)' }}
        >
          <span className="tabular">
            Jami — Roistat: {money(amountOf(active.roistatTotal.revenue))} · Bitrix24:{' '}
            {money(amountOf(active.bitrixTotal.revenue))}
          </span>
          {active.unmatchedRoistat.length > 0 && (
            <span>
              Faqat Roistatda: {active.unmatchedRoistat.slice(0, 6).join(', ')}
              {active.unmatchedRoistat.length > 6 &&
                ` +${formatNumber(active.unmatchedRoistat.length - 6)}`}
            </span>
          )}
          {active.unmatchedBitrix.length > 0 && (
            <span>
              Faqat Bitrix24da: {active.unmatchedBitrix.slice(0, 6).join(', ')}
              {active.unmatchedBitrix.length > 6 &&
                ` +${formatNumber(active.unmatchedBitrix.length - 6)}`}
            </span>
          )}
        </div>
      )}

      <DataTable<VerifyRowDto>
        columns={columns}
        rows={active?.rows ?? []}
        rowKey={(row) => row.key}
        status={status}
        errorMessage="Solishtirishni olib boʻlmadi."
        onRetry={onRetry}
        emptyTitle="Solishtirish uchun maʼlumot yoʻq"
        emptyBody="Tanlangan davrda ikkala tizimda ham mos qatorlar topilmadi."
        initialRows={15}
        moreLabel={(hidden) => `Yana ${formatNumber(hidden)} ta qatorni koʻrsatish`}
        maxHeight={560}
      />
    </div>
  )
}

/** UZS, compact. Null is an em dash — one side having no row is a fact. */
function money(amount: number | null): string {
  return amount === null ? NO_VALUE : `${formatCompactUzs(amount)} soʻm`
}
