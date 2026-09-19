'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { SectionHeader } from '@/components/ui/Stat'
import { apiGet } from '@/lib/api'
import { NO_VALUE, formatNumber, formatPercent } from '@/lib/format'
import {
  CurrencyToggle,
  FeedGapWarning,
  FreshnessWarning,
  Note,
} from '@/features/marketing/MarketingControls'
import { MarketingTable, defaultSort, type TableSort } from '@/features/marketing/MarketingTable'
import {
  DIMENSION_LABELS,
  type MarketingBreakdownDto,
  type MarketingDimension,
} from '@/features/marketing/marketingApi'
import {
  type CurrencyMode,
  dayLabel,
  exactFromUsd,
  moneyFromUsd,
  moneyFromUzs,
  ratio,
} from '@/features/marketing/marketingFormat'

import type { TargetOverviewDto } from './targetApi'

/**
 * «Reklama kabineti» — what the ads cost and what they bought, from the ad
 * ledger (the client's Google Sheets plus Meta Ads, imported hourly).
 *
 * NOT BITRIX24, AND SAID SO ON THE CARD. Everything above this block is the
 * portal's own deals; everything in it is the Roistat page's numbers over the
 * same calendar days. Their «Lead» is the sheet's count and is printed beside
 * the portal's count rather than instead of it; nothing here divides one
 * ledger's money by the other's leads.
 *
 * The table is «Reklama samarasi»'s own, drill-down included: campaign →
 * adset → creative, then the sheet's targetolog column. `/marketing/breakdown`
 * admits this section for exactly that reason.
 */

const TABS: readonly MarketingDimension[] = ['camp', 'adset', 'creative', 'targetolog']

export function TargetAds({
  ads,
  bitrixLeads,
  status,
}: {
  ads: TargetOverviewDto['ads'] | undefined
  /** The portal's own lead count over the same window, for the side-by-side. */
  bitrixLeads: number | null
  status: 'loading' | 'error' | 'ready'
}) {
  const [mode, setMode] = useState<CurrencyMode>('usd')
  const [dimension, setDimension] = useState<MarketingDimension>('camp')
  const [sort, setSort] = useState<TableSort>(() => defaultSort('camp'))
  const [drill, setDrill] = useState<{ camp?: string; adset?: string }>({})

  const window = ads?.window
  const snapshot = ads?.snapshot ?? null
  const parent =
    dimension === 'adset' ? drill.camp : dimension === 'creative' ? drill.adset : undefined

  const breakdown = useQuery({
    queryKey: ['target', 'ads', dimension, parent ?? null, window?.from, window?.to],
    queryFn: ({ signal }) =>
      apiGet<MarketingBreakdownDto>(
        '/marketing/breakdown',
        {
          from: window!.from,
          to: window!.to,
          dimension,
          ...(parent ? { parent } : {}),
        },
        signal,
      ),
    enabled: Boolean(window && snapshot),
  })

  if (status === 'ready' && !ads) {
    return (
      <Card className="p-5">
        <SectionHeader
          title="Reklama kabineti"
          hint="Reklama xarajati hali import qilinmagan — Roistat sahifasi bazaga koʻchirilmagan."
        />
      </Card>
    )
  }

  const rate = snapshot?.usdRate ?? 1
  const current = ads?.current
  const goDimension = (next: MarketingDimension) => {
    setDimension(next)
    setSort(defaultSort(next))
    if (next === 'camp' || next === 'targetolog') setDrill({})
    else if (next === 'adset') setDrill((d) => ({ camp: d.camp }))
  }
  const drillInto = (key: string) => {
    if (dimension === 'camp') {
      setDrill({ camp: key })
      setDimension('adset')
      setSort(defaultSort('adset'))
    } else if (dimension === 'adset') {
      setDrill((d) => ({ ...d, adset: key }))
      setDimension('creative')
      setSort(defaultSort('creative'))
    }
  }

  const feed = ads?.feedCoverage
  /*
    THE SHEET, NOT THE ADS, IS EMPTY. On 2026-09-19 the blob carried 13 million
    September impressions and not one dollar or lead against them — the spend
    columns are filled by hand later. Printed bare, «$0.00» reads as free
    advertising; said out loud, it reads as what it is.
  */
  const noAdSpend =
    current !== undefined &&
    current.spend.amount === 0 &&
    current.leads === 0 &&
    window !== undefined &&
    (feed?.adsThrough ?? '') < window.from
  const showFeedGap =
    window &&
    feed?.adsThrough &&
    feed.salesThrough &&
    feed.salesThrough > feed.adsThrough &&
    window.to > feed.adsThrough

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Reklama kabineti"
        hint={
          window
            ? `Meta Ads va Roistat jadvali, ${dayLabel(window.from)} – ${dayLabel(window.to)}. Bitrix24 emas — oʻz hisobi bilan, yonma-yon koʻrsatiladi.`
            : 'Meta Ads va Roistat jadvali'
        }
        action={
          snapshot ? <CurrencyToggle mode={mode} onChange={setMode} snapshot={snapshot} /> : undefined
        }
      />

      {showFeedGap && feed?.adsThrough && feed.salesThrough && (
        <FeedGapWarning adsThrough={feed.adsThrough} salesThrough={feed.salesThrough} />
      )}
      {noAdSpend && feed?.adsThrough ? (
        <Note tone="warning">
          <strong style={{ color: 'var(--ink-primary)' }}>
            Reklama jadvalida bu davr uchun xarajat va lead yozilmagan.
          </strong>{' '}
          Meta Ads koʻrsatishlari bor, lekin xarajat va leadlar {dayLabel(feed.adsThrough)} gacha
          toʻldirilgan. Shuning uchun «$0» — bu reklama tekin boʻlgani emas, jadval hali
          toʻldirilmagani. Oʻtgan oyni tanlasangiz, toʻliq raqamlar chiqadi.
        </Note>
      ) : (
        snapshot &&
        window &&
        window.to >= snapshot.freshFrom && <FreshnessWarning snapshot={snapshot} />
      )}

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <AdTile
          status={status}
          label="Reklama xarajati"
          value={current ? moneyFromUsd(current.spend.amount, mode, rate, 'compact') : null}
          title={current ? exactFromUsd(current.spend.amount, mode, rate) : undefined}
          hint={current ? `${formatNumber(current.impressions)} koʻrsatish` : undefined}
        />
        <AdTile
          status={status}
          label="Lead narxi (CPL)"
          value={current ? moneyFromUsd(current.cpl?.amount ?? null, mode, rate) : null}
          hint="xarajat ÷ Roistat leadlari"
        />
        <AdTile
          status={status}
          label="Leadlar: Roistat / Bitrix24"
          value={
            current
              ? `${formatNumber(current.leads)} / ${bitrixLeads === null ? NO_VALUE : formatNumber(bitrixLeads)}`
              : null
          }
          hint="ikki hisob turli qoida bilan sanaydi"
        />
        <AdTile
          status={status}
          label="Sifatli lead (QL)"
          value={current ? formatPercent(current.qlPercent) : null}
          hint={
            current ? `${formatNumber(current.kval)} ta · narxi ${moneyFromUsd(current.cpql?.amount ?? null, mode, rate)}` : undefined
          }
        />
        <AdTile
          status={status}
          label="Sotuv narxi (CPO)"
          value={current ? moneyFromUsd(current.cpo?.amount ?? null, mode, rate) : null}
          hint={current ? `${formatNumber(current.sold)} ta sotuv` : undefined}
        />
        <AdTile
          status={status}
          label="ROAS"
          value={current ? (current.roas === null ? NO_VALUE : `${ratio(current.roas)}x`) : null}
          tone={current?.roasGrade ?? null}
          hint={
            current ? `tushum ${moneyFromUzs(current.revenue.amount, mode, rate)}` : undefined
          }
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl<MarketingDimension>
          ariaLabel="Reklama kesimi"
          value={dimension}
          options={TABS.map((id) => ({ value: id, label: DIMENSION_LABELS[id] }))}
          onChange={goDimension}
        />
        {(dimension === 'adset' || dimension === 'creative') && (
          <nav
            className="flex flex-wrap items-center gap-1.5 text-xs"
            aria-label="Ichki kesim yoʻli"
            style={{ color: 'var(--ink-muted)' }}
          >
            <button
              type="button"
              className="focusable rounded px-1 underline-offset-2 hover:underline"
              onClick={() => goDimension('camp')}
              style={{ color: 'var(--ink-secondary)' }}
            >
              {DIMENSION_LABELS.camp}
            </button>
            {drill.camp && (
              <>
                <span aria-hidden="true">/</span>
                <button
                  type="button"
                  className="focusable max-w-[260px] truncate rounded px-1 underline-offset-2 hover:underline"
                  onClick={() => goDimension('adset')}
                  style={{ color: 'var(--ink-secondary)' }}
                  title={drill.camp}
                >
                  {drill.camp}
                </button>
              </>
            )}
            {dimension === 'creative' && drill.adset && (
              <>
                <span aria-hidden="true">/</span>
                <span className="max-w-[260px] truncate" style={{ color: 'var(--ink-primary)' }} title={drill.adset}>
                  {drill.adset}
                </span>
              </>
            )}
          </nav>
        )}
      </div>

      <Card className="p-0">
        <MarketingTable
          dimension={dimension}
          rows={breakdown.data?.data.rows ?? []}
          total={breakdown.data?.data.total}
          mode={mode}
          rate={rate}
          dailyFrom={snapshot?.dailyFrom ?? ''}
          freshFrom={snapshot?.freshFrom ?? ''}
          sort={sort}
          onSort={(key) =>
            setSort((s) =>
              s.key === key
                ? { key, direction: s.direction === 'desc' ? 'asc' : 'desc' }
                : { key, direction: 'desc' },
            )
          }
          onDrill={dimension === 'camp' || dimension === 'adset' ? drillInto : undefined}
          status={
            status === 'loading' || breakdown.isPending
              ? 'loading'
              : breakdown.isError || status === 'error'
                ? 'error'
                : 'ready'
          }
          errorMessage="Reklama kesimini olib boʻlmadi."
          onRetry={() => void breakdown.refetch()}
        />
      </Card>
    </section>
  )
}

/**
 * A tile whose value is already text.
 *
 * `StatTile` formats one number in one unit; these carry a currency the
 * reader toggles and a pair of counts, so they arrive formatted — the same
 * converters the marketing table uses, so a tile and its column agree.
 */
function AdTile({
  label,
  value,
  hint,
  title,
  tone,
  status,
}: {
  label: string
  value: string | null
  hint?: string
  title?: string
  tone?: 'good' | 'warning' | 'critical' | null
  status: 'loading' | 'error' | 'ready'
}) {
  const colour =
    tone === 'good'
      ? 'var(--status-good)'
      : tone === 'warning'
        ? 'var(--status-warning)'
        : tone === 'critical'
          ? 'var(--status-critical)'
          : 'var(--ink-primary)'
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
          style={{ color: status === 'error' ? 'var(--ink-muted)' : colour }}
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
