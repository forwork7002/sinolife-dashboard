'use client'

import { useQuery } from '@tanstack/react-query'

import { CohortHeatmap } from '@/components/charts/Heatmap'
import { ChartCard } from '@/components/ui/Card'
import { Meter, StatTile } from '@/components/ui/Stat'
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/states/States'
import { PageShell } from '@/features/shared/PageShell'
import { type CohortSummaryDto, apiGet } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

/**
 * Retention, two ways.
 *
 * The matrix answers "do customers come back", and the ladder beside it
 * answers "where are they right now" — the portal runs a follow-up cycle
 * (1 day, 3, 7, 14, 21) whose live headcount is a different and more
 * actionable fact than a historical curve.
 *
 * The headline is second-order revenue share. That is the number that decides
 * whether the retention team is worth funding, and it is not visible anywhere
 * in Bitrix24 itself.
 */
export function CohortPage() {
  const query = useQuery({
    queryKey: ['cohorts'],
    queryFn: ({ signal }) => apiGet<CohortSummaryDto>('/insights/cohorts', { months: 18 }, signal),
  })

  const data = query.data?.data

  return (
    <PageShell
      title={t.modules.cohort.title}
      description={t.modules.cohort.lead}
      accent="var(--series-7)"
      meta={query.data?.meta}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Takroriy tushum ulushi"
          value={data?.repeatRevenueShare ?? null}
          unit="percent"
          hint="Birinchi xariddan keyingi savdolar"
          /*
            Deliberately uncoloured.
            
            There is no benchmark for what repeat share SHOULD be in this
            business, and painting 9% red would be the dashboard asserting a
            judgement it cannot support. The number and its trend are the
            finding; the reader supplies the target.
          */
          context={<Meter value={data?.repeatRevenueShare ?? null} tone="neutral" />}
        />
        <StatTile
          label="Qaytgan mijozlar"
          value={data?.repeatCustomers ?? null}
          unit="count"
          hint={
            data ? `${formatNumber(data.totalCustomers)} ta mijozdan` : undefined
          }
        />
        <StatTile
          label="Jami mijozlar"
          value={data?.totalCustomers ?? null}
          unit="count"
          hint="Kamida bitta yetkazilgan buyurtma"
        />
        <StatTile
          label="Faol bazada"
          value={
            data ? data.stages.reduce((sum, s) => sum + s.customers, 0) : null
          }
          unit="count"
          hint="База voronkasida ishlanmoqda"
        />
      </div>

      <ChartCard
        title="Kogorta matritsasi"
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
        hint="Takroriy aloqa sikli: 1 kun, 3 kun, 7 kun, 14 kun, 21 kun. Bu tarixiy egri chiziq emas, bugungi holat."
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
    </PageShell>
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
          <div className="h-4 flex-1 overflow-hidden rounded" style={{ background: 'var(--grid)' }}>
            <div
              className="h-full rounded"
              style={{
                width: `${(stage.customers / max) * 100}%`,
                background: 'var(--series-7)',
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
