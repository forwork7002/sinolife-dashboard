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

import { FormSection } from './FormSection'
import { LeadFormSection } from './LeadFormSection'
import { QualitySection } from './QualitySection'
import type { ReklamaOverviewDto } from './reklamaApi'
import type { Status } from './reklamaUi'

/**
 * «Reklama samarasi» — the client's own ad sheets, without anybody typing them.
 *
 * Asked for on 2026-09-23 with five screenshots of the Google Sheets the
 * client analysed ads in: «shu jadvallar orqali men analysis qilar edim endi
 * sen menga shuni reklama samarasi boʻlimiga chiqarishing kerak». This is the
 * three ad sheets — «DM», «Отчёт Т» and lead quality — each as a table of
 * totals and a table of days, the way the sheets read, then every lead form
 * (2026-10-10). The campaigns' table under it was replaced by the forms on
 * 2026-10-13 (the user: «shuni formalarga oʻzgartirish»).
 *
 * THE TWO OTHER TABS MOVED ON 2026-09-25 to their own section, «Lidlar»
 * (`features/leads`): «Sotuv · ROP» (removed 2026-10-01) and «Lid
 * kogortasi». «Targetologlar · kunlik» (here from 2026-10-05) followed them
 * on 2026-10-08 as a tab of «Lidlar» (the user: «shu joyini olib lidlar
 * bo'limiga o'tkazamiz»). This page is the Meta side alone, one request.
 *
 * The «DM» tables (davr + «Kunlik — sahifalar yonma-yon») live on «Target
 * tahlili» alone since 2026-10-13 (the user: «ikkinchisi bo'lsa yo'qot
 * dashbordan faqat target tahlilida qolsin»); the DM tiles here still read
 * the same `dm` block.
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
      // No corner mark on this screen (the client, 2026-10-07).
      devMark={false}
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
            <FormSection form={data?.form} status={status} />
            <QualitySection quality={data?.quality} status={status} />
            <LeadFormSection forms={data?.leadForms} status={status} />
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
  // «DM lid» / «DM kval» and «DM lid narxi» on the same DM-money pages, so the four DM tiles divide alike.
  const dmLeads = dmPages.reduce((n, p) => n + p.total.leads, 0)
  const dmPagesSpend = dmPages.reduce((n, p) => n + p.total.spendUsd, 0)
  const dmPageNames = dmPages.map((p) => p.name).join(', ')
  /*
    Three rows since 2026-10-17 (the user: «Жами реклама / Жами лид (ДМ+ГЕНЛИД)
    / Жами лид нархи / Жами квал лидлар», then «Ген лид» and «ДМ» each as
    реклама / сони / квал). «Ген лид» сони / квал are «Отчёт Т»'s «Jami» row —
    `form.formLeads` (the CRM-form fills, «Lidlar»'s «Bitrix24 lid») and
    `form.qualified` — so the tiles equal the table under them; null when the
    route could not read «Lidlar»'s forms block, and every «Жами» built on it
    is then «—» too rather than a DM-only total under a «Жами» label. «Жами
    реклама» is Ген + ДМ: the vacancy / other-goal money is named under it and
    left out, or «Жами лид нархи» would price leads with money that bought none.
  */
  const genLeads = data?.form.formLeads ?? null
  const genQualified = data?.form.qualified ?? null
  const totalSpend = spend ? spend.formUsd + spend.dmUsd : null
  const totalLeads = data && genLeads !== null ? genLeads + dmLeads : null
  const totalQualified = data && genQualified !== null ? genQualified + dmQualified : null
  const unread = 'Bitrix24 lid-forma hisobi oʻqilmadi'
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          status={status}
          unit="usd"
          label="Жами реклама"
          value={totalSpend}
          hint={
            spend && outside > 0
              ? `Ген лид + ДМ; ${[
                  spend.hiringUsd > 0 ? `${usd(spend.hiringUsd)} vakansiya` : null,
                  spend.otherUsd > 0 ? `${usd(spend.otherUsd)} boshqa maqsad` : null,
                ]
                  .filter(Boolean)
                  .join(', ')} kirmaydi`
              : brand === 'all'
                ? 'Ген лид + ДМ, Meta barcha akkauntlar'
                : brand === 'none'
                  ? 'Ген лид + ДМ, brendsiz akkauntlar'
                  : `Ген лид + ДМ, ${brand} reklama byudjeti`
          }
        />
        <StatTile
          status={status}
          unit="count"
          label="Жами лид"
          value={totalLeads}
          hint={data ? (genLeads === null ? unread : `${formatNumber(genLeads)} ген + ${formatNumber(dmLeads)} ДМ`) : undefined}
        />
        <StatTile
          status={status}
          unit="usd"
          label="Жами лид нархи"
          value={totalSpend !== null && totalLeads ? totalSpend / totalLeads : null}
          hint={data && totalLeads !== null ? `Жами реклама ÷ ${formatNumber(totalLeads)} лид` : undefined}
        />
        <StatTile
          status={status}
          unit="count"
          label="Жами квал лидлар"
          value={totalQualified}
          hint={
            data
              ? genQualified === null
                ? unread
                : `${formatNumber(genQualified)} ген + ${formatNumber(dmQualified)} ДМ`
              : undefined
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile status={status} unit="usd" label="Ген лид реклама" value={spend?.formUsd ?? null} hint="«Отчёт Т», lid-forma kampaniyalari" />
        <StatTile
          status={status}
          unit="count"
          label="Ген лид сони"
          value={genLeads}
          hint={data ? (genLeads === null ? unread : 'CRM-forma toʻldirishlari, Bitrix24') : undefined}
        />
        <StatTile
          status={status}
          unit="count"
          label="Ген лид квал"
          value={genQualified}
          hint={
            data
              ? genQualified === null || genLeads === null
                ? unread
                : `${formatNumber(genLeads)} liddan, «Сделка успешна»`
              : undefined
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile status={status} unit="usd" label="ДМ лид реклама" value={spend?.dmUsd ?? null} hint="«DM», vakansiyasiz" />
        <StatTile
          status={status}
          unit="count"
          label="ДМ лид сони"
          value={data ? dmLeads : null}
          hint={data ? `${dmPageNames}: Регистрация lidlari` : undefined}
        />
        <StatTile
          status={status}
          unit="count"
          label="ДМ квал"
          value={data ? dmQualified : null}
          hint={data ? `${formatNumber(dmLeads)} liddan, «Сделка успешна»` : undefined}
        />
        <StatTile
          status={status}
          unit="usd"
          label="ДМ лид нархи"
          value={data && dmLeads > 0 ? dmPagesSpend / dmLeads : null}
          hint={data ? `DM sarfi ÷ ${formatNumber(dmLeads)} lid` : undefined}
        />
        <StatTile
          status={status}
          unit="usd"
          label="ДМ квал нархи"
          value={data?.dm.total.costPerQualifiedUsd ?? null}
          hint={
            data
              ? `${dmPageNames}: ${formatNumber(dmQualified)} kval · ${formatNumber(data.dm.total.conversations)} murojat`
              : undefined
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
