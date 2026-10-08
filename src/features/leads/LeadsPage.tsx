'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ErrorState, statusOf } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { DashboardBrandSwitch } from '@/features/shared/BrandSwitch'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import type { Status } from '@/features/reklama/reklamaUi'
import { TargetologDaySection } from '@/features/reklama/TargetologDaySection'
import { apiGet } from '@/lib/api'
import { t } from '@/lib/messages'

import { GroupPlanCard } from './GroupPlanCard'
import { LeadCohortSection } from './LeadCohortSection'
import { LeadSplitCard, LeadWeekCard, today } from './LeadSplitCards'
import { LeadSourcesSection } from './LeadSourcesSection'
import type { LeadSourcesOverviewDto } from './leadSourcesApi'

/**
 * «Lidlar» — everything about a lead once Bitrix24 has it, in one section.
 *
 * Asked for on 2026-09-25 («yangi bir boʻlim ochamiz lidlar deb, oʻsha yerga
 * koʻchiramiz lid kogortasini ham … Sotuv ROP ni ham»). Four tabs, each on
 * its own clock:
 *
 *   «Lid manbalari» — every Регистрация lead by source, the lead forms per
 *     targetolog against Meta, the DM pages' conversations. The dashboard
 *     period (`LeadSourcesSection`).
 *   «Lid kogortasi» — arrival day × distribution day, on its own fourteen-day
 *     window (`LeadCohortSection`, moved from «Reklama samarasi»).
 *   «Guruhlar» — the client's seller sheet (`GroupPlanCard`): kval leads,
 *     500 000 a lead, Факт-1 and the debt, from the first of the same day's
 *     month. Its own tab from the start (2026-10-02); it held the «безквал /
 *     квал» group report until 2026-10-03.
 *   «Targetologlar» — the client's per-targetolog day sheet
 *     (`TargetologDaySection`, with the hand-typed «Telegram» card and
 *     «HR · Kosmetika»), moved here from «Reklama samarasi» on 2026-10-08
 *     (the user: «shu joyini olib lidlar bo'limiga o'tkazamiz … tugma orqali
 *     kiriladigan»). The dashboard period and brand, one request of its own.
 *
 * «Sotuv · ROP» was removed on 2026-10-01 at the user's request. «ROP otchet»
 * (a tab here since 2026-10-02) moved to «RNP jadvali» on 2026-10-07.
 *
 * «Registratsiya» was folded into «Lid manbalari» on 2026-10-02: the split
 * card and the seven-day grid sit among its blocks on their own day, shared
 * with «Guruhlar» (`LeadSplitCards.tsx`), while everything else keeps the
 * period.
 *
 * «Reklama samarasi» kept the Meta side — spend, campaigns, the client's
 * «DM» / «Отчёт Т» sheets.
 *
 * NOTHING ON A HIDDEN TAB ASKS: the sources tab's requests (`/leads/overview`
 * and the split cards' `/registration/overview`) do not go out while another
 * tab is open; the cohort tab fetches inside its own section, «Guruhlar»
 * asks `/registration/groups`.
 */
type Tab = 'sources' | 'cohort' | 'groups' | 'targetologs'

export function LeadsPage() {
  const { apiParams, filters } = useDashboardFilters()
  const [tab, setTab] = useState<Tab>('sources')
  // The ROP cards' day — one, so the split, the grid and «Guruhlar» always show the same day.
  const [day, setDay] = useState(today)

  const params = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    if (apiParams.brand !== undefined) out.brand = apiParams.brand
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to, apiParams.brand])

  const overview = useQuery({
    queryKey: ['leads-overview', params],
    queryFn: ({ signal }) => apiGet<LeadSourcesOverviewDto>('/leads/overview', params, signal),
    enabled: tab === 'sources',
  })

  const status: Status = statusOf(overview)
  // The ROP cards: their own day and their own request, so a failed overview does not take them down.
  const slots = {
    afterChannels: <LeadSplitCard day={day} onDay={setDay} />,
    beforeForms: <LeadWeekCard day={day} />,
  }

  return (
    <PageShell
      title={t.modules.leads.title}
      description={t.modules.leads.lead}
      accent="var(--series-7)"
      meta={tab === 'sources' ? overview.data?.meta : undefined}
      stale={tab === 'sources' && overview.isPlaceholderData}
      period={tab === 'sources' || tab === 'targetologs'}
      /*
        THE TABS SIT BESIDE THE TITLE, not in the filter row — as Struktura's
        view switch does. In the row they came after the period control, which
        only «Lid manbalari» has, so pressing «Lid kogortasi» slid the tabs
        ~300px left under the pointer (a line up on a phone) and pressing back
        slid them home. Here nothing before them depends on the tab.
      */
      actions={
        // The tabs are wider than a 375px phone: they scroll sideways in
        // their own box (padded so the focus ring is not clipped) rather than
        // running off the page.
        <div className="-m-1 max-w-[calc(100%+0.5rem)] min-w-0 overflow-x-auto p-1">
          <div className="inline-flex">
            <SegmentedControl<Tab>
              ariaLabel="Qaysi jadvallar"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'sources', label: 'Lid manbalari' },
                { value: 'cohort', label: 'Lid kogortasi' },
                { value: 'groups', label: 'Guruhlar' },
                { value: 'targetologs', label: 'Targetologlar' },
              ]}
            />
          </div>
        </div>
      }
      toolbar={
        // Every tab follows it: leads by source and form, the team tables by team (see the services).
        <DashboardBrandSwitch />
      }
    >
      <div className="flex min-w-0 flex-col gap-6">
        {tab === 'cohort' ? (
          <LeadCohortSection />
        ) : tab === 'targetologs' ? (
          <TargetologDaySection params={params} brand={filters.brand} />
        ) : tab === 'groups' ? (
          <GroupPlanCard day={day} onDay={setDay} />
        ) : status === 'error' ? (
          <>
            <Card className="p-5">
              <ErrorState
                message={overview.error instanceof Error ? overview.error.message : undefined}
                onRetry={() => void overview.refetch()}
              />
            </Card>
            {slots.afterChannels}
            {slots.beforeForms}
          </>
        ) : (
          <LeadSourcesSection data={overview.data?.data} status={status} slots={slots} />
        )}
      </div>
    </PageShell>
  )
}
