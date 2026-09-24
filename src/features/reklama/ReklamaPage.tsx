'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ErrorState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { SectionHeader, StatTile } from '@/components/ui/Stat'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { usd } from '@/features/target/targetTheme'
import { apiGet } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

import { CampaignSection } from './CampaignSection'
import { DmSection } from './DmSection'
import { FormSection } from './FormSection'
import { LeadCohortSection } from './LeadCohortSection'
import { QualitySection } from './QualitySection'
import { SalesTeamSection } from './SalesTeamSection'
import type { ReklamaOverviewDto } from './reklamaApi'
import { type Status, UsdTile } from './reklamaUi'

/**
 * «Reklama samarasi» — the client's own ad sheets, without anybody typing them.
 *
 * Asked for on 2026-09-23 with five screenshots of the Google Sheets the
 * client analysed ads in: «shu jadvallar orqali men analysis qilar edim endi
 * sen menga shuni reklama samarasi boʻlimiga chiqarishing kerak». This is the
 * three ad sheets — «DM», «Отчёт Т» and lead quality — each as a table of
 * totals and a table of days, the way the sheets read, then every campaign.
 * The other two, the ROP sheets, are the «Sotuv · ROP» tab
 * (`SalesTeamSection`). «Lid kogortasi» (2026-09-24) is the third tab: a
 * lead's arrival day against the day it was handed to a seller
 * (`LeadCohortSection`), on its own fourteen-day window.
 *
 * ONE REQUEST PER TAB. Every ad table is built from the same Meta rows and
 * the same lead scan, so the tiles, the page totals and the day rows sum to
 * each other.
 */
type Tab = 'ads' | 'sales' | 'leads'

export function ReklamaPage() {
  const { apiParams } = useDashboardFilters()
  /*
    TWO SHEETS OF SHEETS. «Reklama» is the ad side (DM, «Отчёт Т», lead
    quality, campaigns) on the dashboard period; «Sotuv · ROP» is the ROP
    side on its own calendar month. The ad request does not go out while the
    sales tab is open, and the other way round.
  */
  const [tab, setTab] = useState<Tab>('ads')

  const params = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const overview = useQuery({
    queryKey: ['reklama-overview', params],
    queryFn: ({ signal }) => apiGet<ReklamaOverviewDto>('/reklama/overview', params, signal),
    enabled: tab === 'ads',
  })

  const status: Status = overview.isPending ? 'loading' : overview.isError ? 'error' : 'ready'
  const data = overview.data?.data

  return (
    <PageShell
      title={t.modules.reklama.title}
      description={t.modules.reklama.lead}
      accent="var(--series-7)"
      meta={tab === 'ads' ? overview.data?.meta : undefined}
      stale={tab === 'ads' && overview.isPlaceholderData}
      period={tab === 'ads'}
      toolbar={
        <SegmentedControl<Tab>
          ariaLabel="Qaysi jadvallar"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'ads', label: 'Reklama' },
            { value: 'sales', label: 'Sotuv · ROP' },
            { value: 'leads', label: 'Lid kogortasi' },
          ]}
        />
      }
    >
      <div className="flex min-w-0 flex-col gap-6">
        {tab === 'sales' ? (
          <SalesTeamSection />
        ) : tab === 'leads' ? (
          <LeadCohortSection />
        ) : status === 'error' ? (
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
            <CampaignSection campaigns={data?.campaigns} status={status} />
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
