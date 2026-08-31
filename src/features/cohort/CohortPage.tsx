'use client'

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import { CohortHeatmap } from '@/components/charts/Heatmap'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { ChartCard } from '@/components/ui/Card'
import { GaugeTile, Meter, SectionHeader, StatTile } from '@/components/ui/Stat'
import { InfoTip } from '@/components/ui/Tooltip'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  type CohortSummaryDto,
  type ConcentrationDto,
  type ConcentrationRepeatDto,
  apiGet,
} from '@/lib/api'
import { NO_VALUE, formatNumber, formatPercent } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Retention, two ways — then who the money actually stands on.
 *
 * The matrix answers "do customers come back", and the ladder beside it
 * answers "where are they right now" — the portal runs a follow-up cycle
 * (1 day, 3, 10, 20, 30) whose live headcount is a different and more
 * actionable fact than a historical curve.
 *
 * The headline is second-order revenue share. That is the number that decides
 * whether the retention team is worth funding, and it is not visible anywhere
 * in Bitrix24 itself.
 *
 * The concentration band at the bottom closes the loop: retention says the
 * customers return, concentration says how few of them the period's revenue
 * would survive losing — and how fast a first buyer becomes a second one.
 */
export function CohortPage() {
  const query = useQuery({
    queryKey: ['cohorts'],
    queryFn: ({ signal }) => apiGet<CohortSummaryDto>('/insights/cohorts', { months: 18 }, signal),
  })

  const { apiParams } = useDashboardFilters()

  /*
   * Period-scoped where the cohort read deliberately is not: the matrix needs
   * 18 months of history to be a matrix, but "whose money is this period
   * standing on" is a question about the selected window. Keyed on apiParams
   * so the cache follows the period control (and matches the channels page's
   * key — two pages, one fetch); the endpoint ignores the people/source
   * filters server-side, insights-style, but the key stays honest if that
   * ever changes.
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

  const data = query.data?.data
  const conc = concentration.data?.data

  /*
   * Concentration grades the WRONG way round for the gauge's `auto` tone,
   * which was built for delivery-style rates where high is good. Here a high
   * top-10 share means the period's revenue stands on a handful of customers,
   * and losing one of them is an event, not a statistic — so the judgement is
   * made where the domain reading lives and stated explicitly:
   *
   *   <25%    good     — no short list of customers can sink the period
   *   25–40%  warning  — dependence worth watching
   *   >40%    critical — the revenue line is a client list
   */
  const top10 = conc?.pareto.top10SharePercent ?? null
  const top10Tone =
    top10 === null ? 'neutral' : top10 < 25 ? 'good' : top10 <= 40 ? 'warning' : 'critical'

  /*
   * The band's honesty caption. Pareto shares can only count revenue that HAS
   * a customer attached — whatever share does not is the blind spot, and it
   * is printed in the section header rather than footnoted, so the shares are
   * never read as covering everything.
   */
  const nullCustomerShare = conc?.pareto.nullCustomerSharePercent ?? null
  const concentrationCaption =
    nullCustomerShare !== null && nullCustomerShare > 0
      ? `Davrda yutilgan bitimlar boʻyicha. Tushumning ${formatPercent(nullCustomerShare)} qismi mijozga bogʻlanmagan — ulushlar faqat aniqlangan mijozlarni hisoblaydi.`
      : 'Davrda yutilgan bitimlar boʻyicha.'

  /* p90 beside the median, and the honest denominator: percentile claims on
     a dozen pairs and on a thousand read very differently. */
  const repeatIntervalHint = conc
    ? [
        conc.repeat.p90Days !== null
          ? `p90: ${formatNumber(Math.round(conc.repeat.p90Days * 10) / 10)} kun`
          : null,
        `${formatNumber(conc.repeat.pairsMeasured)} ta ikkinchi xarid asosida`,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined

  return (
    <PageShell
      title={t.modules.cohort.title}
      description={t.modules.cohort.lead}
      accent="var(--series-7)"
      meta={query.data?.meta}
    >
      <div className="stagger grid grid-cols-2 gap-3 xl:grid-cols-4">
        <GaugeTile
          status={tileStatus}
          label="Takroriy tushum ulushi"
          value={data?.repeatRevenueShare ?? null}
          /*
            Deliberately uncoloured.
            
            There is no benchmark for what repeat share SHOULD be in this
            business, and painting 9% red would be the dashboard asserting a
            judgement it cannot support. The number and its trend are the
            finding; the reader supplies the target.
          */
          tone="neutral"
          hint="Birinchi xariddan keyingi savdolar"
        />
        <StatTile
          status={tileStatus}
          label="Qaytgan mijozlar"
          value={data?.repeatCustomers ?? null}
          unit="count"
          hint={
            data ? `${formatNumber(data.totalCustomers)} ta mijozdan` : undefined
          }
        />
        <StatTile
          status={tileStatus}
          label="Jami mijozlar"
          value={data?.totalCustomers ?? null}
          unit="count"
          hint="Kamida bitta yetkazilgan buyurtma"
        />
        <StatTile
          status={tileStatus}
          label="Faol bazada"
          value={
            data ? data.stages.reduce((sum, s) => sum + s.customers, 0) : null
          }
          unit="count"
          hint="База voronkasida ishlanmoqda"
        />
      </div>

      {/*
        The lead instrument. The matrix is the one thing this page exists to
        show that nothing else in the product can, so it wears the hero
        surface and the registration brackets — once per page, and only here.
        The tiles above and the band below stay ordinary cards on purpose:
        the treatment ranks the panel because nothing else wears it.
      */}
      <ChartCard
        title="Kogorta matritsasi"
        className="card-hero brackets"
        hint="Qator — birinchi xarid oyi. Ustun — oʻshandan keyingi oylar. Katakdagi son — oʻsha oyda yana xarid qilgan mijozlar ulushi, %."
      >
        {query.isPending && <ChartSkeleton height={320} />}
        {query.isError && (
          <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />
        )}
        {data && data.rows.length === 0 && (
          <EmptyState
            title="Kogorta uchun maʼlumot yoʻq"
            body="Yetkazilgan buyurtmalar mijozga bogʻlanmagan boʻlishi mumkin."
          />
        )}
        {data && data.rows.length > 0 && <CohortHeatmap rows={data.rows} />}
      </ChartCard>

      <ChartCard
        title="База — mijozlar hozir qayerda"
        // The stage names in the data are 1/3/10/20/30 kun — the copy used to
        // promise a 7/14/21 cycle the portal does not run.
        hint="Takroriy aloqa sikli: 1 kun, 3 kun, 10 kun, 20 kun, 30 kun. Bu tarixiy egri chiziq emas, bugungi holat."
      >
        {query.isPending && <ChartSkeleton height={200} />}
        {data && data.stages.length === 0 && (
          <EmptyState
            title="Retention voronkasi boʻsh"
            body="База voronkasidagi bitimlar mijozga bogʻlanmagan."
          />
        )}
        {data && data.stages.length > 0 && <StageLadder stages={data.stages} />}
      </ChartCard>

      {/*
        The dependency chapter — /insights/concentration.

        Everything above says whether customers come back; this band says how
        much of the period's money would leave with a handful of them, and
        what the second purchase actually looks like when it happens. Its own
        query, so a failure here degrades these five cards to honest error
        states without touching the matrix.
      */}
      <SectionHeader title="Mijozlar kontsentratsiyasi" hint={concentrationCaption} />

      <div className="stagger grid grid-cols-2 gap-3 xl:grid-cols-4">
        <GaugeTile
          status={concStatus}
          label="Top-10 mijoz ulushi"
          value={top10}
          tone={top10Tone}
          hint={
            conc
              ? `10 ta eng yirik mijoz davr tushumida · Top-5: ${formatPercent(conc.pareto.top5SharePercent)}`
              : undefined
          }
        />

        <FigureTile
          status={concStatus}
          label="80% tushumni beruvchilar"
          hint={
            conc
              ? `Jami ${formatNumber(conc.pareto.totalCustomers)} mijozdan shunchasi davr tushumining 80 foizini beradi`
              : undefined
          }
        >
          {conc && conc.pareto.customersFor80Percent !== null ? (
            <>
              <AnimatedNumber
                value={conc.pareto.customersFor80Percent}
                format={(v) => formatNumber(Math.round(v))}
              />
              {/* The denominator rides along muted, soʻm-suffix style:
                  "12 / 480" IS the finding — a wide base carried by a short
                  list — and neither number means much alone. */}
              <span className="ml-1.5 text-base font-normal" style={{ color: 'var(--ink-muted)' }}>
                / {formatNumber(conc.pareto.totalCustomers)}
              </span>
            </>
          ) : (
            NO_VALUE
          )}
        </FigureTile>

        <FigureTile
          status={concStatus}
          label="Takroriy xarid oraligʻi"
          hint={repeatIntervalHint}
        >
          {conc && conc.repeat.medianDaysBetweenFirstAndSecond !== null ? (
            <>
              <AnimatedNumber
                value={conc.repeat.medianDaysBetweenFirstAndSecond}
                format={(v) => formatNumber(Math.round(v * 10) / 10)}
              />
              <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                kun
              </span>
            </>
          ) : (
            NO_VALUE
          )}
        </FigureTile>

        <GaugeTile
          status={concStatus}
          label="90 kunda qaytish"
          value={conc?.repeat.repurchaseWithin90Percent ?? null}
          /*
            Neutral like the repeat-share gauge at the top of the page, and
            for the same reason: there is no benchmark for how fast THIS
            business's buyers should return, so the ring states the magnitude
            and the reader supplies the target. The cohort in the hint is the
            part that must be said: only first buyers old enough to have had
            a full 90 days are counted, or the rate would flatter itself.
          */
          tone="neutral"
          hint={
            conc
              ? `Kohorta: ${formatNumber(conc.repeat.cohortSize)} ta birinchi xaridor, har biriga toʻliq 90 kunlik ufq berilgan`
              : undefined
          }
        />
      </div>

      <RepeatShareCard status={concStatus} repeat={conc?.repeat} />
    </PageShell>
  )
}

/**
 * A band tile for figures StatTile has no unit for — a "12 / 480" fraction,
 * a day interval. Deliberately the same voice as StatTile (12.5px sentence-
 * case label, 30px `.figure`, skeleton sized to the ready figure so ready
 * never reflows loading, error as a word in critical ink): a fourth tile
 * dialect would cost more than these two value shapes are worth.
 */
function FigureTile({
  label,
  status,
  hint,
  children,
}: {
  readonly label: string
  readonly status: 'loading' | 'error' | 'ready'
  readonly hint?: string
  /** The ready-state figure markup. Render NO_VALUE for a genuine null. */
  readonly children: ReactNode
}) {
  return (
    <div className="card flex flex-col px-4 py-3.5">
      <p className="truncate text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </p>

      {status === 'loading' ? (
        <div className="skeleton mt-2 h-[30px] w-2/3" role="status">
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' ? (
        <p
          className="figure mt-2 text-[30px] leading-none font-semibold"
          style={{ color: 'var(--status-critical)' }}
          // Decorative title — it only repeats the visible word (Stat.tsx
          // precedent); data-carrying titles ride the Tooltip primitive.
          title="Maʼlumot olinmadi"
        >
          <span className="text-base font-medium">Olinmadi</span>
        </p>
      ) : (
        <p
          className="figure mt-2 text-[30px] leading-none font-semibold"
          style={{ color: 'var(--ink-primary)' }}
        >
          {children}
        </p>
      )}

      {hint && (
        <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

/**
 * The same claim from two instruments, deliberately unreconciled.
 *
 * Both rows answer "what share of the period's revenue is repeat business".
 * The first is computed from deal history — every win after a customer's
 * first counts. The second is Bitrix24's own hand-set «takroriy mijoz» flag.
 * If the portal's data were clean the two bars would sit on top of each
 * other, so the GAP between them is itself a measurement: of how reliable
 * the flag is and how many deals are missing their customer link. Averaging
 * or picking one would destroy exactly the signal being shown.
 *
 * Two neutral meters on the same scale, because the divergence must be
 * readable as a length difference, not recomputed from two printed numbers.
 */
function RepeatShareCard({
  status,
  repeat,
}: {
  readonly status: 'loading' | 'error' | 'ready'
  readonly repeat: ConcentrationRepeatDto | undefined
}) {
  const computed = repeat?.repeatRevenueSharePercent ?? null
  const flagged = repeat?.bitrixFlagSharePercent ?? null
  const gap = computed !== null && flagged !== null ? Math.abs(computed - flagged) : null

  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center gap-1">
        <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
          Takroriy tushum ulushi — ikki oʻlchov
        </p>
        <InfoTip
          label="Nega ikkita raqam"
          content={
            <span className="block max-w-[280px]">
              Ikkala qator bir savolga javob beradi: davr tushumining qancha qismi takroriy
              xariddan. Birinchisi bitimlar tarixidan hisoblanadi, ikkinchisi — Bitrix24ning oʻz
              «takroriy mijoz» belgisidan. Farqning oʻzi maʼlumot sifati signali: belgi qoʻlda
              qoʻyiladi, mijozga bogʻlanmagan bitim esa ikkala oʻlchovni ham buzadi. Farqni
              yaqinlashtirish emas, kuzatib borish kerak.
            </span>
          }
        />
      </div>

      {status === 'loading' ? (
        <div className="mt-3 space-y-2.5" role="status">
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
          <span className="sr-only">Yuklanmoqda</span>
        </div>
      ) : status === 'error' ? (
        <p className="mt-3 text-base font-medium" style={{ color: 'var(--status-critical)' }}>
          Olinmadi
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-2.5">
            <MeasureRow label="Bitimlar tarixidan" value={computed} />
            <MeasureRow label="Bitrix24 belgisidan" value={flagged} />
          </div>
          {gap !== null && (
            <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Farq: {formatNumber(Math.round(gap * 10) / 10)} foiz punkti
            </p>
          )}
        </>
      )}
    </div>
  )
}

function MeasureRow({ label, value }: { readonly label: string; readonly value: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-44 shrink-0 truncate text-xs"
        style={{ color: 'var(--ink-secondary)' }}
        title={label}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <Meter value={value} tone="neutral" label={label} />
      </div>
    </div>
  )
}

/**
 * The follow-up ladder as a bar list.
 *
 * Bars are proportional to the largest stage rather than to the total: the
 * stages are not parts of a whole — a customer sits in exactly one, but the
 * list is not exhaustive of the customer base — so a stacked or percentage
 * treatment would state something untrue.
 */
function StageLadder({
  stages,
}: {
  readonly stages: readonly { readonly stage: string; readonly customers: number }[]
}) {
  const max = Math.max(...stages.map((s) => s.customers), 1)

  return (
    <ul className="space-y-1.5">
      {stages.map((stage) => (
        <li key={stage.stage} className="flex items-center gap-3">
          <span
            className="w-44 shrink-0 truncate text-xs"
            style={{ color: 'var(--ink-secondary)' }}
            title={stage.stage}
          >
            {stage.stage.replace(/^.*·\s*/, '')}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--track)' }}>
            <div
              className="grow-x h-full rounded-full"
              style={{
                width: `${(stage.customers / max) * 100}%`,
                /*
                  Sequential, not series-7.
                  
                  This is one quantitative measure, so it takes the magnitude
                  hue every other single-measure bar uses. series-7 also
                  happens to be THIS page's accent — so the bars were wearing
                  what looked exactly like page identity, the one thing a
                  value-encoding mark must never do, even by coincidence.
                */
                background: 'var(--seq-450)',
              }}
            />
          </div>
          <span
            className="tabular w-16 shrink-0 text-right text-xs font-medium"
            style={{ color: 'var(--ink-primary)' }}
          >
            {formatNumber(stage.customers)}
          </span>
        </li>
      ))}
    </ul>
  )
}
