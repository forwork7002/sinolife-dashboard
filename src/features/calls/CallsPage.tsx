'use client'

import { useQuery } from '@tanstack/react-query'

import { BarList } from '@/components/charts/BarList'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { ChartCard } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { GaugeTile, Meter, RankBadge, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  type CallActivityDto,
  type CallsDto,
  type ResponseDto,
  type ResponseOutcomeDto,
  apiGet,
} from '@/lib/api'
import { NO_VALUE, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Who actually spoke to customers — and how fast anyone picks up a new deal.
 *
 * Ranked by talk time, not by call count. Dialling a hundred numbers and
 * reaching none of them is not work with customers, and a leaderboard sorted
 * by attempts rewards exactly that.
 *
 * The page's lead instrument is REACTION SPEED, not volume: the median wait
 * between a deal appearing and the first outbound dial is the one number on
 * this screen a manager can move tomorrow morning, so it wears the hero
 * treatment and everything else sits under it.
 *
 * The recordings behind these calls are stored but not scored. A quality
 * rating would need a rubric nobody has agreed yet; the data is here for the
 * day one exists.
 */
export function CallsPage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['calls', apiParams],
    queryFn: ({ signal }) =>
      apiGet<CallsDto>('/insights/calls', apiParams, signal),
  })

  /*
    A second fetch, not a second page. Reaction speed comes from deal-to-call
    joins the calls endpoint has no business computing, and the two requests
    fail independently — a broken join must not take the volume tiles down
    with it, so each band renders its own status.
  */
  const responseQuery = useQuery({
    queryKey: ['response', apiParams],
    queryFn: ({ signal }) =>
      apiGet<ResponseDto>('/insights/response', apiParams, signal),
  })

  /** One derivation per query, so no tile can disagree with its own band. */

  const tileStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'
  const respStatus = responseQuery.isPending
    ? 'loading'
    : responseQuery.isError
      ? 'error'
      : 'ready'

  const resp = responseQuery.data?.data
  const firstTouch = resp?.firstTouch
  const attempts = resp?.attempts
  const efficiency = resp?.efficiency

  const rows = query.data?.data.rows ?? []
  const outbound = query.data?.data.outbound
  const inbound = query.data?.data.inbound
  const totalTalk = rows.reduce((sum, r) => sum + r.talkSeconds, 0)

  const rate = (part: number, whole: number) =>
    whole === 0 ? null : Math.round((part / whole) * 1000) / 10

  /*
    Grading the 15-minute contact rate at 60/35, not the house 85/60.

    The house thresholds were calibrated on delivery rates, where 85% is
    ordinary and 60% is failure. Speed-to-lead is a different distribution:
    reaching six new deals in ten within fifteen minutes of their creation is
    genuinely strong performance for a manual dialling floor, and demanding
    85% would paint every real week red — a gauge that is always critical
    grades nothing. Below 35%, most leads wait, and waiting is the one thing
    this metric exists to catch.
  */
  const within15 = firstTouch?.calledWithin15MinPercent ?? null
  const within15Tone =
    within15 === null
      ? 'neutral'
      : within15 >= 60
        ? 'good'
        : within15 >= 35
          ? 'warning'
          : 'critical'

  const noCallShare = firstTouch?.noCallSharePercent ?? null

  /*
    Top five, not ten: this is a headline strip, and the full per-employee
    picture already lives in the table below. The talk-hours meta keeps the
    ratio honest — a spectacular soʻm/soat built on seventy minutes of talk
    is a different fact from one built on sixty hours.
  */
  const topByTalkRevenue = (efficiency?.topEmployees ?? []).slice(0, 5).map((e) => ({
    id: e.employeeId,
    label: e.fullName,
    value: e.revenuePerTalkHour.amount,
    meta: (
      <span className="tabular text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {formatHours1(e.talkHours)} soat
      </span>
    ),
  }))

  const columns: Column<CallActivityDto & { rank: number }>[] = [
    {
      key: 'rank',
      header: '#',
      width: '48px',
      render: (row) => <RankBadge rank={row.rank} />,
    },
    {
      key: 'name',
      // The row's name: what a screen reader announces the row BY.
      rowHeader: true,
      header: 'Xodim',
      render: (row) => (
        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
          {row.employeeName}
        </span>
      ),
    },
    {
      key: 'talk',
      header: 'Gaplashgan vaqt',
      align: 'right',
      numeric: true,
      render: (row) => (
        <span style={{ color: 'var(--ink-primary)' }}>{formatDuration(row.talkSeconds)}</span>
      ),
    },
    {
      key: 'calls',
      header: 'Qoʻngʻiroq',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.calls),
    },
    {
      key: 'connected',
      header: 'Ulandi',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.connected),
    },
    {
      key: 'connectRate',
      header: 'Ulanish %',
      width: '150px',
      render: (row) => (
        <Meter value={row.connectRateBp / 100} tone="neutral" label={row.employeeName} />
      ),
    },
    {
      key: 'avg',
      header: 'Oʻrtacha suhbat',
      align: 'right',
      numeric: true,
      render: (row) => formatDuration(row.averageTalkSeconds),
    },
  ]

  return (
    <PageShell
      title={t.modules.calls.title}
      description={t.modules.calls.lead}
      // Not series-1: that is the app default AND the colour --seq-450 sits
      // next to, so page identity, rank and every rate bar were the same blue.
      accent="var(--series-7)"
      meta={query.data?.meta}
    >
      {/* =================================================================
          Reaksiya tezligi — the /insights/response band.

          Period-aware but blind to the people/source filters (the endpoint
          is insights-style); this page mounts no filter row, so nothing on
          screen promises a narrowing the band would silently ignore.
          ================================================================= */}
      <section aria-labelledby="response-band" className="space-y-3">
        <h2 id="response-band" className="eyebrow">
          Reaksiya tezligi
        </h2>

        <div className="stagger grid gap-3 lg:grid-cols-[1.6fr_1fr_1fr]">
          {/*
            The lead instrument — the page's ONE hero.

            Hand-built rather than a StatTile because the hero wears classes
            a tile cannot: .card-hero for the gradient hairline and raised
            shadow, .brackets for the registration marks, .figure-hero for
            the 34-40px figure. Same three-state discipline as every tile:
            loading, error and a genuine null are different facts and render
            differently.
          */}
          <article className="card-hero brackets flex flex-col px-5 py-4">
            <p
              className="text-[12.5px] font-medium"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Birinchi qoʻngʻiroqqacha
            </p>

            {respStatus === 'loading' ? (
              // Sized to the hero figure below, so ready never reflows loading.
              <div className="skeleton mt-2.5 h-10 w-2/3" role="status">
                <span className="sr-only">Yuklanmoqda</span>
              </div>
            ) : respStatus === 'error' ? (
              <p
                className="mt-2.5 text-base font-medium"
                style={{ color: 'var(--status-critical)' }}
                // Decorative — it only repeats the visible word.
                title="Maʼlumot olinmadi"
              >
                Olinmadi
              </p>
            ) : firstTouch === undefined || firstTouch.p50Minutes === null ? (
              // Genuine null: no revenue deal in the window was ever called.
              // An em dash, never a zero — "instant response" is the one
              // thing this must not accidentally claim.
              <p className="figure-hero mt-2.5" style={{ color: 'var(--ink-primary)' }}>
                {NO_VALUE}
              </p>
            ) : (
              <p className="figure-hero mt-2.5" style={{ color: 'var(--ink-primary)' }}>
                <AnimatedNumber
                  value={heroMinuteParts(firstTouch.p50Minutes).value}
                  format={heroMinuteParts(firstTouch.p50Minutes).format}
                />
                {/* The unit resets the hero's negative tracking: it is a word,
                    not part of the figure. */}
                <span
                  className="ml-1.5 text-sm font-normal tracking-normal"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {heroMinuteParts(firstTouch.p50Minutes).unit}
                </span>
              </p>
            )}

            <p className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
              Bitim yaratilishidan birinchi chiquvchi qoʻngʻiroqqacha — mediana
              {firstTouch?.p90Minutes != null && (
                <> · p90: {formatMinutes(firstTouch.p90Minutes)}</>
              )}
            </p>

            {/*
              The honesty caption. The percentiles above cover only deals
              that WERE called — "never" is not a large number of minutes —
              so the share that was never dialled must stand right under the
              figure, or the hero flatters the floor by ignoring its misses.
            */}
            {respStatus === 'ready' && firstTouch && noCallShare !== null && (
              <div className="mt-3">
                <Meter
                  value={100 - noCallShare}
                  tone="neutral"
                  label="Qoʻngʻiroq qilingan bitimlar ulushi"
                />
                <p
                  className="mt-1.5 text-[11px] leading-snug"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  Davrda yaratilgan {formatNumber(firstTouch.deals)} bitimning{' '}
                  {formatPercent(noCallShare)} qismiga umuman qoʻngʻiroq qilinmagan —
                  mediana faqat qoʻngʻiroq qilinganlar boʻyicha.
                </p>
              </div>
            )}
          </article>

          <GaugeTile
            status={respStatus}
            label="15 daqiqada aloqa"
            value={within15}
            tone={within15Tone}
            hint={
              firstTouch
                ? `Barcha ${formatNumber(firstTouch.deals)} bitimga nisbatan · 60 daqiqada: ${formatPercent(firstTouch.calledWithin60MinPercent)}`
                : 'Yangi bitimning qanchasi 15 daqiqa ichida terilgani'
            }
          />

          {/*
            Hand-built because the median lands between integers (percentile
            over attempt counts), and StatTile's count unit would round
            1,5 urinish up to 2 — a different claim.
          */}
          <article className="card flex flex-col px-4 py-3.5">
            <p
              className="truncate text-[12.5px] font-medium"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Urinishlar soni
            </p>

            {respStatus === 'loading' ? (
              <div className="skeleton mt-2 h-[30px] w-2/3" role="status">
                <span className="sr-only">Yuklanmoqda</span>
              </div>
            ) : respStatus === 'error' ? (
              <p
                className="mt-2 text-base font-medium"
                style={{ color: 'var(--status-critical)' }}
                title="Maʼlumot olinmadi"
              >
                Olinmadi
              </p>
            ) : (
              <p
                className="figure mt-2 text-[30px] leading-none font-semibold"
                style={{ color: 'var(--ink-primary)' }}
              >
                {attempts === undefined || attempts.medianAttemptsToConnect === null ? (
                  NO_VALUE
                ) : (
                  <>
                    <AnimatedNumber
                      value={attempts.medianAttemptsToConnect}
                      format={format1}
                    />
                    <span
                      className="ml-1 text-xs font-normal"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      urinish
                    </span>
                  </>
                )}
              </p>
            )}

            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Birinchi ulanishgacha terilgan raqamlar — mediana
            </p>

            {respStatus === 'ready' &&
              attempts &&
              attempts.neverConnectedAfter5Percent !== null && (
                <p
                  className="mt-2.5 text-[11px] leading-snug"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {formatNumber(attempts.groups)} nishondan{' '}
                  {formatPercent(attempts.neverConnectedAfter5Percent)} qismi 5+ urinishda
                  ham ulanmagan.
                </p>
              )}
          </article>
        </div>

        {/*
          The efficiency strip: what a closed deal costs in phone effort, and
          what an hour of real conversation returns. WON and LOST sit side by
          side because either column alone invites the wrong reading — heavy
          effort on winners looks like diligence until the losers show the
          same hours going nowhere.
        */}
        <div className="stagger grid gap-3 lg:grid-cols-2">
          <article className="card px-5 py-4">
            <p
              className="text-[12.5px] font-medium"
              style={{ color: 'var(--ink-secondary)' }}
            >
              Bir bitimga ketgan mehnat
            </p>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Davrda yopilgan bitimlar boʻyicha oʻrtacha — qoʻngʻiroqlar mijoz orqali
              bogʻlangan (portal bitimga bogʻlamaydi), bitim ochilishidan yopilishigacha;
              suhbat vaqti faqat ulanganlari
            </p>

            {respStatus === 'loading' ? (
              <div className="skeleton mt-3 h-[76px] w-full" role="status">
                <span className="sr-only">Yuklanmoqda</span>
              </div>
            ) : respStatus === 'error' ? (
              <p
                className="mt-3 text-base font-medium"
                style={{ color: 'var(--status-critical)' }}
                title="Maʼlumot olinmadi"
              >
                Olinmadi
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-2">
                <EffortColumn label="Yutilgan" outcome={efficiency?.won} />
                <EffortColumn label="Yutqazilgan" outcome={efficiency?.lost} divided />
              </div>
            )}
          </article>

          <StatTile
            status={respStatus}
            label="Suhbat soatiga daromad"
            value={efficiency?.revenuePerTalkHour?.amount ?? null}
            unit="money"
            // Null below one connected talk-hour: a ratio over minutes of
            // conversation is noise wearing a currency, so the API withholds
            // it and the tile shows the em dash.
            hint="Davr tushumi ÷ ulangan suhbat vaqti (kamida 1 soat)"
            context={
              respStatus === 'ready' && topByTalkRevenue.length > 0 ? (
                <div>
                  <p className="mb-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    Top 5 xodim · soʻm / suhbat soati
                  </p>
                  <BarList items={topByTalkRevenue} />
                </div>
              ) : undefined
            }
          />
        </div>
      </section>

      {/* =================================================================
          Qoʻngʻiroqlar hajmi — the original /insights/calls band.
          ================================================================= */}
      <section aria-labelledby="volume-band" className="space-y-3">
        <h2 id="volume-band" className="eyebrow">
          Qoʻngʻiroqlar hajmi
        </h2>

        {/*
          Two directions, two tiles, because they are two different questions.

          A single blended "connection rate" read 31.5% on a log that is 92%
          inbound, under a hint about dialled numbers — so it described outbound
          performance using, almost entirely, inbound data. The missed-call count
          below is the most actionable number in this dataset and it appeared
          nowhere at all.
        */}
        <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <GaugeTile
            status={tileStatus}
            label="Chiquvchi — ulandi"
            value={outbound ? rate(outbound.connected, outbound.calls) : null}
            /*
              Neutral, not graded. Two thirds of dials connecting is ordinary for
              this kind of calling and nobody has set a target; painting it red
              would be the dashboard asserting a standard that does not exist.
            */
            tone="neutral"
            hint={
              outbound
                ? `${formatNumber(outbound.connected)} / ${formatNumber(outbound.calls)} terilgan`
                : undefined
            }
          />
          <GaugeTile
            status={tileStatus}
            label="Kiruvchi — javob berildi"
            value={inbound ? rate(inbound.connected, inbound.calls) : null}
            /*
              Graded, unlike outbound — with the page's own 80/50 thresholds
              rather than the house 85/60. A customer who called and got no
              answer is a loss in a way an unanswered dial is not, so this one
              HAS an agreed direction even without a target.
            */
            tone={
              inbound === undefined
                ? 'neutral'
                : (rate(inbound.connected, inbound.calls) ?? 0) >= 80
                  ? 'good'
                  : (rate(inbound.connected, inbound.calls) ?? 0) >= 50
                    ? 'warning'
                    : 'critical'
            }
            hint={
              inbound
                ? `${formatNumber(inbound.calls - inbound.connected)} ta javobsiz qoldi`
                : undefined
            }
          />
          <StatTile
            status={tileStatus}
            label="Qoʻngʻiroqlar"
            value={outbound && inbound ? outbound.calls + inbound.calls || null : null}
            unit="count"
            hint={
              outbound && inbound
                ? `${formatNumber(inbound.calls)} kiruvchi · ${formatNumber(outbound.calls)} chiquvchi`
                : undefined
            }
          />
          <StatTile
            status={tileStatus}
            label="Jami suhbat"
            value={totalTalk === 0 ? null : Math.round(totalTalk / 3600)}
            unit="hours"
            hint="Barcha xodimlar boʻyicha"
          />
        </div>

        <ChartCard
          title="Xodimlar"
          hint="Gaplashgan vaqt boʻyicha tartiblangan — urinishlar soni boʻyicha emas. Yuz raqamni terib hech kimga ulanmaslik mijoz bilan ishlash emas."
        >
          <DataTable
            columns={columns}
            rows={rows.map((row, index) => ({ ...row, rank: index + 1 }))}
            rowKey={(row) => row.employeeId}
            // 144 and 92 rows made these pages 6,919px and 4,457px tall.
            initialRows={25}
            moreLabel={(hidden) => `Yana ${hidden} ta xodimni koʻrsatish`}
            status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
            errorMessage={(query.error as Error | null)?.message}
            onRetry={() => void query.refetch()}
            emptyTitle="Bu davrda qoʻngʻiroq yoʻq"
            emptyBody="Telefoniya maʼlumoti oxirgi oy uchun import qilinadi."
            minWidth={900}
          />
        </ChartCard>
      </section>
    </PageShell>
  )
}

/**
 * One outcome column of the effort card.
 *
 * The count rides in the heading ("· 34 ta") because an average with a hidden
 * denominator is a rumour: four calls per won deal over three deals and over
 * three hundred are different levels of evidence.
 */
function EffortColumn({
  label,
  outcome,
  divided = false,
}: {
  label: string
  outcome?: ResponseOutcomeDto
  divided?: boolean
}) {
  return (
    <div
      className={divided ? 'pl-4' : 'pr-4'}
      style={divided ? { borderLeft: '1px solid var(--border)' } : undefined}
    >
      <p className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
        {label}
        {outcome && outcome.deals > 0 && (
          <span className="tabular font-normal"> · {formatNumber(outcome.deals)} ta</span>
        )}
      </p>
      <p
        className="figure mt-1.5 text-[22px] leading-none font-semibold"
        style={{ color: 'var(--ink-primary)' }}
      >
        {outcome === undefined || outcome.avgCalls === null ? (
          NO_VALUE
        ) : (
          <>
            <AnimatedNumber value={outcome.avgCalls} format={format1} />
            <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
              qoʻngʻiroq
            </span>
          </>
        )}
      </p>
      <p className="tabular mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {outcome === undefined || outcome.avgTalkSeconds === null
          ? NO_VALUE
          : `${formatDuration(Math.round(outcome.avgTalkSeconds))} suhbat`}
      </p>
    </div>
  )
}

/** Locale-formatted, one decimal at most: 1.5 → "1,5", 4.0 → "4". */
function format1(value: number): string {
  return formatNumber(Math.round(value * 10) / 10)
}

/** Talk-hours meta beside a ratio: one decimal keeps 1,2 and 12 apart. */
function formatHours1(hours: number): string {
  return formatNumber(Math.round(hours * 10) / 10)
}

/**
 * Minutes for running text: below two hours as minutes, above as hours.
 *
 * A p90 of "482 daqiqa" makes the reader do division mid-sentence; "8 soat"
 * is the same fact already digested. The switch point is 120 minutes because
 * "95 daqiqa" still reads at a glance and "1,6 soat" does not.
 */
function formatMinutes(minutes: number): string {
  if (minutes >= 120) return `${format1(minutes / 60)} soat`
  return `${formatNumber(minutes >= 10 ? Math.round(minutes) : Math.round(minutes * 10) / 10)} daqiqa`
}

/**
 * The hero figure split into an animatable number and its unit word,
 * on the same minutes/hours switch as `formatMinutes`.
 */
function heroMinuteParts(minutes: number): {
  value: number
  unit: string
  format: (value: number) => string
} {
  if (minutes >= 120) return { value: minutes / 60, unit: 'soat', format: format1 }
  return {
    value: minutes,
    unit: 'daqiqa',
    format: (v) => formatNumber(v >= 10 ? Math.round(v) : Math.round(v * 10) / 10),
  }
}

/** Seconds as h:mm:ss, or m:ss below an hour. Never a bare second count. */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
