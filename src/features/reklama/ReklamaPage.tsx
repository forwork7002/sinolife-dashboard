'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { ErrorState, statusOf } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { SectionHeader, StatTile } from '@/components/ui/Stat'
import { DashboardBrandSwitch } from '@/features/shared/BrandSwitch'
import { PageShell } from '@/features/shared/PageShell'
import { type DashboardBrand, useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { usd } from '@/features/target/targetTheme'
import { apiGet } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { t } from '@/lib/messages'

import { CampaignSection } from './CampaignSection'
import { DmSection } from './DmSection'
import { FormSection } from './FormSection'
import { QualitySection } from './QualitySection'
import type { ReklamaOverviewDto } from './reklamaApi'
import type { Status } from './reklamaUi'
import { SideSection } from './SideSection'
import { TargetologDaySection } from './TargetologDaySection'

/**
 * «Reklama samarasi» — the client's own ad sheets, without anybody typing them.
 *
 * Asked for on 2026-09-23 with five screenshots of the Google Sheets the
 * client analysed ads in: «shu jadvallar orqali men analysis qilar edim endi
 * sen menga shuni reklama samarasi boʻlimiga chiqarishing kerak». This is the
 * three ad sheets — «DM», «Отчёт Т» and lead quality — each as a table of
 * totals and a table of days, the way the sheets read, then every campaign.
 *
 * THE TWO OTHER TABS MOVED ON 2026-09-25 to their own section, «Lidlar»
 * (`features/leads`): «Sotuv · ROP» (removed 2026-10-01) and «Lid
 * kogortasi». This page is the Meta side alone now, and one request —
 * plus «Targetologlar · kunlik» (2026-10-05), which asks for its own.
 *
 * Every ad table is built from the same Meta rows and the same lead scan, so
 * the tiles, the page totals and the day rows sum to each other.
 */

export function ReklamaPage() {
  const { apiParams, filters } = useDashboardFilters()
  const { brand } = filters

  const params = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  // The brand reaches both requests, and each answer is narrowed on the server by the rules «Lidlar» uses.
  const overviewParams = useMemo(() => (brand === 'all' ? params : { ...params, brand }), [params, brand])

  const overview = useQuery({
    queryKey: ['reklama-overview', overviewParams],
    queryFn: ({ signal }) => apiGet<ReklamaOverviewDto>('/reklama/overview', overviewParams, signal),
  })

  const status: Status = statusOf(overview)
  const data = overview.data?.data

  return (
    <PageShell
      title={t.modules.reklama.title}
      description={t.modules.reklama.lead}
      accent="var(--series-7)"
      meta={overview.data?.meta}
      stale={overview.isPlaceholderData}
      period
      toolbar={<DashboardBrandSwitch />}
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
            <Tiles data={data} status={status} brand={brand} />
            {/* The client's per-targetolog day sheet, full width so the targetologs stand side by side. */}
            <TargetologDaySection params={overviewParams} brand={brand} />
            {/* The HR · Kosmetika table sits beside the sheets on a wide screen, above them on a phone. */}
            <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
              <aside className="min-w-0 xl:sticky xl:top-0 xl:col-start-2 xl:row-start-1">
                <SideSection side={data?.side} status={status} brand={brand} />
              </aside>
              <div className="flex min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-1">
                <DmSection dm={data?.dm} status={status} />
                <FormSection form={data?.form} status={status} />
                <QualitySection quality={data?.quality} status={status} />
                <CampaignSection campaigns={data?.campaigns} status={status} />
              </div>
            </div>
          </>
        )}
      </div>
    </PageShell>
  )
}

function Tiles({ data, status, brand }: { data: ReklamaOverviewDto | undefined; status: Status; brand: DashboardBrand }) {
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
    The server prices a DM kval over the pages that CARRY the DM money only
    (`dmTotalCells`): a page with no DM spend (sinolife_otziv,
    collagen.marine, the Telegram pages) would add its qualified leads to the
    denominator and make every DM lead look cheaper than it was. The sheet's
    «Итог» does the same — its «Цена за квал» is sinolifeuz's. The tile reads
    that figure rather than dividing again, so it is the «Jami» row's and the
    day grid's «Итог» to the cent; the pages below only name the hint.
  */
  const dmPages = data?.dm.pages.filter((p) => p.carriesDmSpend) ?? []
  const dmQualified = dmPages.reduce((n, p) => n + p.total.qualified, 0)
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          status={status}
          unit="usd"
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
              : brand === 'all'
                ? 'Meta, barcha akkauntlar'
                : brand === 'none'
                  ? 'Meta: vakansiya, HR, Kosmetika va brendsiz akkauntlar'
                  : `Meta, ${brand} reklama byudjeti`
          }
        />
        <StatTile status={status} unit="usd" label="Lid-forma sarfi" value={spend?.formUsd ?? null} hint="«Отчёт Т»" />
        <StatTile status={status} unit="usd" label="DM sarfi" value={spend?.dmUsd ?? null} hint="«DM», vakansiyasiz" />
        <StatTile
          status={status}
          unit="usd"
          label="DM kval narxi"
          value={data?.dm.total.costPerQualifiedUsd ?? null}
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
