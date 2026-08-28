'use client'

import { useQuery } from '@tanstack/react-query'

import { ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { GaugeTile, Meter, StatTile, StatusChip } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  type ChannelDto,
  type ConcentrationDto,
  type HhiBand,
  type HhiCutDto,
  apiGet,
} from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Where the business comes from.
 *
 * The portal records the source of every deal across all nine pipelines, so
 * "leads" here is the honest top of the funnel — every enquiry the channel
 * produced, including the ones that never reached a sales pipeline. Revenue
 * counts only what a revenue pipeline actually won.
 *
 * ROI columns appear per row only where someone has entered that month's ad
 * spend. A channel with no spend recorded shows a dash, never a zero cost and
 * never an infinite return.
 */
export function ChannelsPage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['channels', apiParams],
    queryFn: ({ signal }) =>
      apiGet<ChannelDto[]>('/insights/channels', apiParams, signal),
  })

  /*
   * How lopsided the mix is — the same endpoint the cohort page reads, under
   * the same cache key, so the two pages share one fetch per window. The
   * endpoint honours the period and ignores people/source filters
   * server-side (insights style); apiParams still keys the cache honestly.
   */
  const concentration = useQuery({
    queryKey: ['concentration', apiParams],
    queryFn: ({ signal }) =>
      apiGet<ConcentrationDto>('/insights/concentration', apiParams, signal),
  })

  /** One derivation, so no tile can disagree with its own page. */

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'

  const concStatus = concentration.isPending
    ? 'loading'
    : concentration.isError
      ? 'error'
      : 'ready'
  const hhi = concentration.data?.data.hhi

  const rows = query.data?.data ?? []
  const totalLeads = rows.reduce((sum, r) => sum + r.leads, 0)
  const totalWon = rows.reduce((sum, r) => sum + r.won, 0)
  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue.amount, 0)
  const withSpend = rows.filter((r) => r.spend !== null)

  const columns: Column<ChannelDto>[] = [
    {
      key: 'name',
      header: 'Manba',
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.sourceName}
        </span>
      ),
    },
    {
      key: 'leads',
      header: 'Murojaat',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.leads),
    },
    {
      key: 'deals',
      header: 'Savdo voronkasida',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.deals),
    },
    {
      key: 'won',
      header: 'Sotildi',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.won),
    },
    {
      /*
        Two rates, each naming its own fraction in the header.
    
        "Konversiya" alone sat between three visible count columns and could
        have meant any of three fractions. It meant won/murojaat — a number
        the AI-triage bucket used to drown: one source read 0.6% while closing
        44.7% of the orders that actually reached it. Now both are printed and
        the header says which pair each one came from.
      */
      key: 'conversion',
      header: 'Murojaat → sotuv',
      width: '132px',
      render: (row) => <Meter value={row.conversion} tone="neutral" label={row.sourceName} />,
    },
    {
      key: 'funnelRate',
      header: 'Voronka → sotuv',
      width: '132px',
      render: (row) => <Meter value={row.funnelRate} tone="neutral" label={row.sourceName} />,
    },
    {
      key: 'revenue',
      header: 'Tushum',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: 'var(--ink-primary)' }}>{formatCompactUzs(row.revenue.amount)}</span>
      ),
    },
    {
      key: 'cheque',
      header: 'Oʻrtacha chek',
      align: 'right',
      numeric: true,
      // Null when the channel won nothing: there is no average over an empty
      // set, and a dash says that where "0 soʻm" would price orders it never had.
      render: (row) =>
        row.averageCheque === null ? NO_VALUE : formatCompactUzs(row.averageCheque.amount),
    },
    {
      key: 'spend',
      header: 'Reklama xarajati',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.spend === null ? (
          <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
        ) : (
          formatCompactUzs(row.spend.amount)
        ),
    },
    {
      key: 'roas',
      header: 'ROI',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.roas === null ? (
          <span style={{ color: 'var(--ink-muted)' }} title="Xarajat kiritilmagan">
            {NO_VALUE}
          </span>
        ) : (
          <span
            style={{
              color: row.roas >= 1 ? 'var(--delta-up)' : 'var(--delta-down)',
              fontWeight: 500,
            }}
          >
            {formatNumber(row.roas)}×
          </span>
        ),
    },
  ]

  return (
    <PageShell
      title={t.modules.channels.title}
      description={t.modules.channels.lead}
      accent="var(--series-5)"
      meta={query.data?.meta}
    >
      {/*
        Six tiles, two rows of three: volume and outcome on the first row,
        the judgement pieces — the conversion gauge and the two HHI verdicts
        — together on the second, so "how healthy is the mix" reads as one
        line instead of being split across a fold.
      */}
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile status={tileStatus} label="Murojaatlar" value={totalLeads || null} unit="count" />
        <StatTile status={tileStatus} label="Sotuvlar" value={totalWon || null} unit="count" />
        <StatTile status={tileStatus} label="Tushum" value={totalRevenue || null} unit="money" />
        <GaugeTile
          status={tileStatus}
          label="Murojaatdan sotuvgacha"
          value={totalLeads === 0 ? null : Math.round((totalWon / totalLeads) * 1000) / 10}
          tone="neutral"
          hint={`${formatNumber(totalWon)} savdo / ${formatNumber(totalLeads)} murojaat · sunʼiy intellekt saralash buketi hisobga olinmaydi`}
        />
        <HhiTile
          status={concStatus}
          label="Manbalar kontsentratsiyasi"
          cut={hhi?.bySource}
          nullNote="manba kiritilmagan"
        />
        <HhiTile
          status={concStatus}
          label="Hududlar kontsentratsiyasi"
          cut={hhi?.byRegion}
          nullNote="hudud kiritilmagan"
        />
      </div>

      {rows.length > 0 && withSpend.length === 0 && (
        <div
          className="rounded-[var(--radius-panel)] border px-4 py-3 text-xs"
          style={{
            /*
              A rule down the edge, not a wash across the panel.
              
              8% of a saturated amber mixed into a near-black surface is a
              muddy brown at 1.12:1 — it neither reads as a warning nor stays
              out of the way. A full-strength bar on the leading edge is
              unambiguous at any surface lightness, and the panel itself keeps
              the ordinary card colour.
            */
            background: 'var(--surface-raised)',
            borderColor: 'var(--border)',
            borderInlineStartWidth: 3,
            borderInlineStartColor: 'var(--status-warning)',
            color: 'var(--ink-secondary)',
          }}
        >
          <strong style={{ color: 'var(--ink-primary)' }}>ROI hisoblanmadi.</strong> Bitrix24 bitim
          qayerdan kelganini yozadi, lekin uni olish qancha turganini yozmaydi. Har oy kanal boʻyicha
          reklama xarajatini kiritsangiz — CPO, CAC va ROI avtomatik chiqadi. Xarajatsiz faqat hajm va
          konversiya koʻrsatiladi, chunki nolga boʻlingan daromad «cheksiz foyda» boʻlib koʻrinadi.
        </div>
      )}

      {/*
        The lead instrument. This table IS the channels page — every tile
        above it is a summary of a column in it — so it wears the hero
        surface and the registration brackets: once per page, and only here.
        The share bars below stay an ordinary card on purpose; the treatment
        ranks the panel because nothing else wears it.
      */}
      <ChartCard
        title="Kanallar"
        className="card-hero brackets"
        hint="Davr ichida YARATILGAN bitimlar boʻyicha — kanal shu oyda nima olib kelganini koʻrsatadi. Bosh sahifadagi tushum esa yopilgan sana boʻyicha, shuning uchun ikki raqam bir xil boʻlmaydi."
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.sourceId}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
          emptyTitle="Bu davrda murojaat yoʻq"
          minWidth={1040}
        />
      </ChartCard>

      <ChartCard title="Tushum ulushi" hint="Har bir kanal umumiy tushumning qancha qismini bergani.">
        <ShareBars
          rows={rows
            .filter((r) => r.revenue.amount > 0)
            .slice(0, 12)
            .map((r) => ({ label: r.sourceName, value: r.revenue.amount }))}
          total={totalRevenue}
        />
      </ChartCard>
    </PageShell>
  )
}

/**
 * Share of a total, as a ranked bar list.
 *
 * A bar list rather than a pie: twelve channels in a pie is twelve wedges
 * nobody can compare, and the question here is ordinal — which channels are
 * carrying the business — which a sorted list answers directly.
 */
function ShareBars({
  rows,
  total,
}: {
  readonly rows: readonly { label: string; value: number }[]
  total: number
}) {
  if (rows.length === 0 || total === 0) return null

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-3">
          <span
            className="w-44 shrink-0 truncate text-xs"
            style={{ color: 'var(--ink-secondary)' }}
            title={row.label}
          >
            {row.label}
          </span>
          <div
            className="h-2 flex-1 overflow-hidden rounded-full"
            style={{ background: 'var(--track)' }}
          >
            <div
              className="grow-x h-full rounded-full"
              /*
                Share of TOTAL, because that is what the number beside the bar
                states — a max-normalised bar under a share label overstated
                every row below the top one. And the sequential hue, not
                series-5: that slot is this page's accent, and a value-encoding
                mark must not wear page identity even by coincidence. House bar
                geometry while we are here, so one list language exists.
              */
              style={{ width: `${(row.value / total) * 100}%`, background: 'var(--seq-450)' }}
            />
          </div>
          <span
            className="tabular w-24 shrink-0 text-right text-xs font-medium"
            style={{ color: 'var(--ink-primary)' }}
          >
            {formatCompactUzs(row.value)}
          </span>
          <span
            className="tabular w-14 shrink-0 text-right text-xs"
            style={{ color: 'var(--ink-muted)' }}
          >
            {formatPercent((row.value / total) * 100)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/*
 * The Uzbek reading of each HHI band, with its tone.
 *
 * Tone direction is the CHANNEL reading, not the antitrust one: for a merger
 * regulator a concentrated market is someone else's problem, but a business
 * whose enquiries all come from one source is one algorithm change away from
 * silence. So concentrated wears critical, diversified wears good — the
 * inverse of how a monopolist would paint the same number.
 */
const HHI_BANDS: Record<HhiBand, { word: string; tone: 'good' | 'warning' | 'critical' }> = {
  concentrated: { word: 'Kontsentratsiyalangan', tone: 'critical' },
  moderate: { word: 'Oʻrtacha', tone: 'warning' },
  diversified: { word: 'Diversifikatsiyalangan', tone: 'good' },
}

/**
 * Herfindahl–Hirschman concentration, as a verdict with the number behind it.
 *
 * The raw index (0–10000) means nothing to anyone who has not read merger
 * guidelines, so the tile leads with the band WORD and keeps the number in
 * the hint for whoever wants the instrument reading. The thresholds are
 * applied server-side (≥2500 kontsentratsiyalangan, ≥1500 oʻrtacha — the
 * DOJ cutoffs, boundary reading as the more alarming band) and arrive as
 * `band`, so this tile never re-derives the judgement it displays.
 *
 * The word is a StatusChip, not a coloured figure: shape + word + colour is
 * the house rule for a verdict, and the chip's glyph keeps the meaning when
 * colour goes. Revenue with no source/region recorded is EXCLUDED from the
 * index, so its share is disclosed right beside the number it weakens.
 */
function HhiTile({
  label,
  status,
  cut,
  nullNote,
}: {
  readonly label: string
  readonly status: 'loading' | 'error' | 'ready'
  readonly cut: HhiCutDto | undefined
  /** What an unset group means in THIS cut, for the null-share disclosure. */
  readonly nullNote: string
}) {
  const band = cut?.band ?? null

  const hint =
    status === 'ready' && cut && cut.hhi !== null
      ? [
          `HHI: ${formatNumber(cut.hhi)} · ${formatNumber(cut.groups)} ta guruh`,
          cut.nullSharePercent !== null && cut.nullSharePercent > 0
            ? `tushumning ${formatPercent(cut.nullSharePercent)} qismida ${nullNote}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : // The window named even before the data lands — the index is built
        // from the period's won revenue, not from the created-in-period rows
        // the table below counts.
        'Davrda yutilgan tushum ulushlari boʻyicha'

  return (
    <div className="card flex flex-col px-4 py-3.5">
      <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>

      {status === 'loading' ? (
        // Sized to the chip it will become, so ready never reflows loading.
        <div className="skeleton mt-2.5 h-[22px] w-2/3 rounded-full" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' ? (
        <p
          className="mt-2 text-base font-medium"
          style={{ color: 'var(--status-critical)' }}
          // Decorative title — it only repeats the visible word (Stat.tsx
          // precedent); data-carrying titles ride the Tooltip primitive.
          title="Maʼlumot olinmadi"
        >
          Olinmadi
        </p>
      ) : band !== null ? (
        <div className="mt-2.5">
          <StatusChip tone={HHI_BANDS[band].tone}>{HHI_BANDS[band].word}</StatusChip>
        </div>
      ) : (
        // A genuine null — no revenue in the cut — is an em dash, never a
        // reassuring "diversified" or an alarming zero.
        <p
          className="figure mt-2 text-[30px] leading-none font-semibold"
          style={{ color: 'var(--ink-primary)' }}
        >
          {NO_VALUE}
        </p>
      )}

      <p className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
        {hint}
      </p>
    </div>
  )
}
