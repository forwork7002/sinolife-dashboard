'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { ErrorState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { SectionHeader, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { usd } from '@/features/target/targetTheme'
import { apiGet } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

import { DmSection } from './DmSection'
import { FormSection } from './FormSection'
import { QualitySection } from './QualitySection'
import type { ReklamaOverviewDto } from './reklamaApi'
import { type Status, UsdTile } from './reklamaUi'

/**
 * «Reklama samarasi» — the client's own ad sheets, without anybody typing them.
 *
 * Asked for on 2026-09-23 with five screenshots of the Google Sheets the
 * client analysed ads in: «shu jadvallar orqali men analysis qilar edim endi
 * sen menga shuni reklama samarasi boʻlimiga chiqarishing kerak». This is the
 * first three — «DM», «Отчёт Т» and lead quality — in that order, each as a
 * table of totals and a table of days, the way the sheets read.
 *
 * ONE REQUEST. Every table is built from the same Meta rows and the same lead
 * scan, so the tiles, the page totals and the day rows sum to each other.
 */
export function ReklamaPage() {
  const { apiParams } = useDashboardFilters()

  const params = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const overview = useQuery({
    queryKey: ['reklama-overview', params],
    queryFn: ({ signal }) => apiGet<ReklamaOverviewDto>('/reklama/overview', params, signal),
  })

  const status: Status = overview.isPending ? 'loading' : overview.isError ? 'error' : 'ready'
  const data = overview.data?.data

  return (
    <PageShell
      title={t.modules.reklama.title}
      description={t.modules.reklama.lead}
      accent="var(--series-7)"
      meta={overview.data?.meta}
      stale={overview.isPlaceholderData}
    >
      <div className="flex min-w-0 flex-col gap-6">
        {status === 'error' ? (
          <Card className="p-5">
            <ErrorState
              message={overview.error instanceof Error ? overview.error.message : undefined}
              onRetry={() => void overview.refetch()}
            />
          </Card>
        ) : (
          <>
            <Tiles data={data} status={status} />
            <DmSection dm={data?.dm} status={status} />
            <FormSection form={data?.form} status={status} />
            <QualitySection quality={data?.quality} status={status} />
          </>
        )}
      </div>
    </PageShell>
  )
}

function Tiles({ data, status }: { data: ReklamaOverviewDto | undefined; status: Status }) {
  if (status === 'ready' && data && data.importedAt === null) {
    return (
      <Card className="p-5">
        <SectionHeader
          title="Meta maʼlumoti hali olinmagan"
          hint="Kampaniyalar kesimidagi maʼlumot birinchi soatlik yangilanishda yigʻiladi. Lid va lid sifati jadvallari Bitrix24 dan hozir ham koʻrinadi."
        />
      </Card>
    )
  }

  const spend = data?.spend
  const outside = spend ? spend.hiringUsd + spend.otherUsd : 0
  /*
    Over the pages that CARRY the DM money only: a page with no DM spend
    (sinolife_otziv, the Telegram pages) would add its qualified leads to the
    denominator and make every DM lead look cheaper than it was. The sheet's
    «Итог» does the same — its «Цена за квал» is sinolifeuz's.
  */
  const dmPages = data?.dm.pages.filter((p) => p.carriesDmSpend) ?? []
  const dmQualified = dmPages.reduce((n, p) => n + p.total.qualified, 0)
  const dmPageSpend = dmPages.reduce((n, p) => n + p.total.spendUsd, 0)
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <UsdTile
          status={status}
          label="Jami reklama sarfi"
          value={spend?.totalUsd ?? null}
          hint={
            spend && outside > 0
              ? `shundan ${[
                  spend.hiringUsd > 0 ? `${usd(spend.hiringUsd)} vakansiya` : null,
                  spend.otherUsd > 0 ? `${usd(spend.otherUsd)} boshqa maqsad` : null,
                ]
                  .filter(Boolean)
                  .join(', ')} — jadvallarga kirmaydi`
              : 'Meta, barcha akkauntlar'
          }
        />
        <UsdTile status={status} label="Lid-forma sarfi" value={spend?.formUsd ?? null} hint="«Отчёт Т»" />
        <UsdTile status={status} label="DM sarfi" value={spend?.dmUsd ?? null} hint="«DM», vakansiyasiz" />
        <UsdTile
          status={status}
          label="DM kval narxi"
          value={dmQualified > 0 ? dmPageSpend / dmQualified : null}
          hint={
            data
              ? `${dmPages.map((p) => p.name).join(', ')}: ${formatNumber(dmQualified)} kval · ${formatNumber(data.dm.total.conversations)} murojat`
              : undefined
          }
        />
        <StatTile
          status={status}
          label="Lid → kval"
          value={data?.quality.total.successPercent ?? null}
          unit="percent"
          hint={data ? `${formatNumber(data.quality.total.leads)} liddan ${formatNumber(data.quality.total.success)} kval` : undefined}
        />
      </div>
      {data?.importedAt && (
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Meta Ads Manager’dan har soatda. Oxirgi yangilanish: {formatDateTime(data.importedAt)}.
        </p>
      )}
    </section>
  )
}
