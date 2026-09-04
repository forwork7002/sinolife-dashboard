'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { ChartCard, Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/Stat'
import { EmptyState, ErrorState } from '@/components/states/States'
import { Shell } from '@/components/layout/Shell'
import { apiGet } from '@/lib/api'

import {
  DIMENSION_LABELS,
  MARKETING_DIMENSIONS,
  type MarketingBreakdownDto,
  type MarketingDimension,
  type MarketingOverviewDto,
  type MarketingVerifyDto,
} from './marketingApi'
import {
  CurrencyToggle,
  FormulaHint,
  FeedGapWarning,
  FreshnessWarning,
  MarketingPeriodControl,
  Note,
  ProvenanceLine,
  resolveWindow,
  type MarketingPeriod,
} from './MarketingControls'
import { MarketingDynamics } from './MarketingDynamics'
import { MarketingFunnel } from './MarketingFunnel'
import { MarketingHero } from './MarketingHero'
import { MarketingKpiBand, MarketingRateRings } from './MarketingKpiBand'
import { MarketingTable, defaultSort, type TableSort } from './MarketingTable'
import { MarketingVerify } from './MarketingVerify'
import type { CurrencyMode } from './marketingFormat'
import { t } from '@/lib/messages'

/**
 * The Marketing screen — the client's Roistat dashboard, rebuilt on our stack.
 *
 * THE ONE FACT THAT SHAPES EVERY DECISION HERE: this is not Bitrix24 data. A
 * live probe of the portal found no Roistat integration at all, and Bitrix's
 * own UTM capture died in February 2026 at a 0.05% fill rate. These figures
 * come from the client's Google Sheets plus Meta Ads, published on their own
 * page and imported by `npm run roistat:import`. So the screen renders its own
 * provenance line, refuses the Bitrix24 badge, keeps its own period control
 * (the ledger covers weeks, not the years the CRM covers), and ends with a
 * side-by-side comparison against Bitrix24 rather than pretending the two
 * agree.
 *
 * The layout follows the source page because the reader already knows it:
 * KPI band, tabs, table, funnel and dynamics. What changed is the finishing —
 * our tokens, our states, our tables — and one correction: their spend/ROAS
 * chart is dual-axis, which this design system forbids, so it renders as two
 * stacked panels sharing an x axis (see MarketingDynamics).
 */
export function MarketingPage() {
  const [period, setPeriod] = useState<MarketingPeriod>({ choice: 'all' })
  const [mode, setMode] = useState<CurrencyMode>('uzs')
  const [dimension, setDimension] = useState<MarketingDimension>('camp')
  const [sort, setSort] = useState<TableSort>(() => defaultSort('camp'))

  /**
   * The drill-down chain, camp → adset → creative.
   *
   * Two slots rather than a stack: the source has exactly three levels and
   * `goDim()` in their logic.js clears both when you return to campaigns. A
   * general stack would model a depth this data does not have.
   */
  const [drill, setDrill] = useState<{ camp?: string; adset?: string }>({})

  const overview = useQuery({
    queryKey: ['marketing', 'overview', period],
    // No snapshot in this key on purpose: the overview request is what FETCHES
    // the snapshot. It sends a bare window and lets the service resolve the
    // choice; every other request can then be explicit.
    queryFn: ({ signal }) =>
      apiGet<MarketingOverviewDto>('/marketing/overview', bareWindow(period), signal),
    placeholderData: (previous) => previous,
  })

  const snapshot = overview.data?.data.snapshot ?? null

  // The parent the table filters by, and the one the API is asked for. Only
  // the two dimensions that HAVE a level above carry it.
  const parent =
    dimension === 'adset' ? drill.camp : dimension === 'creative' ? drill.adset : undefined

  const breakdown = useQuery({
    queryKey: ['marketing', 'breakdown', dimension, parent ?? null, period],
    queryFn: ({ signal }) =>
      apiGet<MarketingBreakdownDto>(
        '/marketing/breakdown',
        { ...bareWindow(period), dimension, ...(parent ? { parent } : {}) },
        signal,
      ),
    placeholderData: (previous) => previous,
    enabled: snapshot !== null,
  })

  const verify = useQuery({
    queryKey: ['marketing', 'verify', period],
    queryFn: ({ signal }) =>
      apiGet<MarketingVerifyDto>('/marketing/verify', bareWindow(period), signal),
    placeholderData: (previous) => previous,
    enabled: snapshot !== null,
  })

  const window = useMemo(
    () => (snapshot ? resolveWindow(period, snapshot) : null),
    [period, snapshot],
  )

  const status = overview.isError ? 'error' : overview.isPending ? 'loading' : 'ready'

  /** Switching tabs resets sorting and the drill, exactly like `goDim()`. */
  const goDimension = (next: MarketingDimension) => {
    setDimension(next)
    setSort(defaultSort(next))
    if (next === 'camp') setDrill({})
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

  return (
    <Shell>
      <div className="page-container flex flex-col gap-5">
        <header>
          <div className="accent-rule" aria-hidden="true" />
          <h1 className="display mt-2.5 text-2xl font-semibold" style={{ color: 'var(--ink-primary)' }}>
            {/* One name per section: the heading reads exactly as the menu. */}
            {t.nav.marketing}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-secondary)' }}>
            Reklama xarajati, lidlar va ROAS — kampaniyadan sotuvchigacha.
            {window && (
              <span className="tabular" style={{ color: 'var(--ink-muted)' }}>
                {' '}
                · {window.from} – {window.to}
              </span>
            )}
          </p>
        </header>

        {status === 'error' ? (
          <Card className="p-5">
            <ErrorState
              message="Marketing maʼlumotini olib boʻlmadi."
              onRetry={() => void overview.refetch()}
            />
          </Card>
        ) : snapshot === null && status === 'ready' ? (
          /*
            Empty is not zero. The tables being empty means the importer has
            never run — a wall of "0 soʻm" would state that the company spent
            nothing and sold nothing, which is a claim nobody made.
          */
          <Card className="p-5">
            <EmptyState
              title="Marketing maʼlumoti hali import qilinmagan"
              body="Roistat sahifasidagi raqamlar bazaga koʻchirilmagan."
              hint="Terminalda: npm run roistat:import"
            />
          </Card>
        ) : (
          <>
            {snapshot && <ProvenanceLine snapshot={snapshot} />}

            {snapshot && (
              <div className="flex flex-wrap items-end justify-between gap-3">
                <MarketingPeriodControl period={period} snapshot={snapshot} onChange={setPeriod} />
                <CurrencyToggle mode={mode} onChange={setMode} snapshot={snapshot} />
              </div>
            )}

            {/*
              The feed gap first: it explains a distortion that is already in
              the numbers on screen, while the freshness note below explains
              rows that are still arriving. Shown only when the window
              actually reaches past where the ad feed stops — inside that span
              the two feeds agree and there is nothing to warn about.
            */}
            {(() => {
              const feed = overview.data?.data.feedCoverage
              if (!window || !feed?.adsThrough || !feed.salesThrough) return null
              if (feed.salesThrough <= feed.adsThrough) return null
              if (window.to <= feed.adsThrough) return null
              return (
                <FeedGapWarning adsThrough={feed.adsThrough} salesThrough={feed.salesThrough} />
              )
            })()}

            {snapshot && window && window.to >= snapshot.freshFrom && (
              <FreshnessWarning snapshot={snapshot} />
            )}

            <MarketingKpiBand
              current={overview.data?.data.current}
              previous={overview.data?.data.previous}
              daily={overview.data?.data.daily ?? []}
              mode={mode}
              rate={snapshot?.usdRate ?? 1}
              status={status}
            />

            {/* The twelfth stop of the band, grown into the page's lead
                instrument: revenue above its own daily series. Still last in
                the reading order — the money still comes back at the end. */}
            <MarketingHero
              current={overview.data?.data.current}
              previous={overview.data?.data.previous}
              daily={overview.data?.data.daily ?? []}
              previousWindow={overview.data?.data.previousWindow}
              dailyFrom={snapshot?.dailyFrom ?? ''}
              mode={mode}
              rate={snapshot?.usdRate ?? 1}
              status={status}
            />

            {/* The client's own four graded rates, as rings — their 80/60 and
                30/15 thresholds, our instrument. */}
            <MarketingRateRings
              current={overview.data?.data.current}
              previous={overview.data?.data.previous}
              mode={mode}
              rate={snapshot?.usdRate ?? 1}
              status={status}
            />

            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard
                title="Voronka"
                hint="Lidlardan sotuvgacha — davr boʻyicha jami"
                className="lg:col-span-1"
              >
                <MarketingFunnel steps={overview.data?.data.funnel ?? []} />
              </ChartCard>

              <ChartCard
                title="Dinamika"
                hint="Kunlik xarajat va ROAS — ikki panel, bitta vaqt oʻqi"
                className="lg:col-span-2"
              >
                <MarketingDynamics
                  days={overview.data?.data.daily ?? []}
                  mode={mode}
                  rate={snapshot?.usdRate ?? 1}
                  dailyFrom={snapshot?.dailyFrom ?? ''}
                />
              </ChartCard>
            </div>

            <section className="flex flex-col gap-3">
              <SectionHeader
                title="Kesimlar"
                hint="Har bir kesim bir xil davr boʻyicha hisoblanadi"
              />

              {/* The twelve tabs, scrollable on narrow screens. */}
              <div className="relative -mx-1 overflow-x-auto px-1 pb-1">
                <div className="flex gap-1.5">
                  {MARKETING_DIMENSIONS.map((id) => {
                    const active = id === dimension
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => goDimension(id)}
                        aria-pressed={active}
                        className="focusable rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors"
                        style={{
                          background: active ? 'var(--surface-raised)' : 'transparent',
                          color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                          boxShadow: active ? 'var(--shadow-card)' : 'none',
                          border: `1px solid ${active ? 'var(--border-strong)' : 'transparent'}`,
                        }}
                      >
                        {DIMENSION_LABELS[id]}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Breadcrumb: only the drill-down chain has one. */}
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
                        className="focusable rounded px-1 underline-offset-2 hover:underline"
                        onClick={() => goDimension('adset')}
                        style={{ color: 'var(--ink-secondary)' }}
                      >
                        {drill.camp}
                      </button>
                    </>
                  )}
                  {dimension === 'creative' && drill.adset && (
                    <>
                      <span aria-hidden="true">/</span>
                      <span style={{ color: 'var(--ink-primary)' }}>{drill.adset}</span>
                    </>
                  )}
                </nav>
              )}

              <Card className="p-0">
                <MarketingTable
                  dimension={dimension}
                  rows={breakdown.data?.data.rows ?? []}
                  total={breakdown.data?.data.total}
                  mode={mode}
                  rate={snapshot?.usdRate ?? 1}
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
                  onDrill={
                    dimension === 'camp' || dimension === 'adset' ? drillInto : undefined
                  }
                  status={
                    breakdown.isError ? 'error' : breakdown.isPending ? 'loading' : 'ready'
                  }
                  errorMessage="Kesim maʼlumotini olib boʻlmadi."
                  onRetry={() => void breakdown.refetch()}
                />
              </Card>

              {/* Where each dimension's rows actually stop — the slices do not
                  all reach the same date, and a reader comparing two tabs must
                  know that before blaming the numbers. */}
              {overview.data && overview.data.data.coverage.length > 0 && (
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                  Qamrov:{' '}
                  {overview.data.data.coverage
                    .map((c) => `${DIMENSION_LABELS[c.dimension]} ${c.to}`)
                    .join(' · ')}
                </p>
              )}

              {snapshot && <FormulaHint snapshot={snapshot} />}
            </section>

            <section className="flex flex-col gap-3">
              <SectionHeader
                title="Bitrix24 bilan solishtirish"
                hint="Ikkala tizim raqamlari yonma-yon — farq yashirilmaydi"
              />
              <Note tone="neutral">
                <p>
                  Farq boʻlishi <strong style={{ color: 'var(--ink-primary)' }}>normal</strong>:
                  Roistat tushumni <em>lid sanasiga</em> bogʻlaydi va faqat pullik trafikni
                  qamraydi, Bitrix24 esa bitim <em>yopilgan sanada</em> hisoblaydi va barcha
                  voronkalarni koʻradi (База dublikati <code>countsAsRevenue</code> bilan
                  chiqarib tashlanadi). Bu yerda raqamlar moslashtirilmaydi — ikkalasi ham
                  aytiladi.
                </p>
              </Note>
              <MarketingVerify
                data={verify.data?.data}
                status={verify.isError ? 'error' : verify.isPending ? 'loading' : 'ready'}
                onRetry={() => void verify.refetch()}
              />
            </section>
          </>
        )}
      </div>
    </Shell>
  )
}

/**
 * The module's own window, as query params.
 *
 * Only a CUSTOM range is sent: "Bugun" and "Barchasi" are resolved by the
 * service against the snapshot it just read, which is the only place that
 * knows today's date in the source's terms and the real min/max of the data.
 * Resolving them here would race the import — the client's idea of "today"
 * comes from a page that may have been open since yesterday.
 */
/**
 * What the overview asks for before a snapshot exists.
 *
 * A custom range is the reader's own dates and needs no snapshot to be stated;
 * the two presets carry no dates at all and are resolved server-side.
 */
function bareWindow(period: MarketingPeriod): Record<string, string> {
  if (period.choice === 'custom' && period.from && period.to) {
    return { from: period.from, to: period.to }
  }
  // "Bugun" is a flag the service resolves against its own snapshot; "Barchasi"
  // is the absence of any bound.
  return period.choice === 'today' ? { today: '1' } : {}
}

