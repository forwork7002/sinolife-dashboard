'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ErrorState } from '@/components/states/States'
import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import type { Status } from '@/features/reklama/reklamaUi'
import { apiGet } from '@/lib/api'
import { t } from '@/lib/messages'

import { GroupPlanCard } from './GroupPlanCard'
import { LeadCohortSection } from './LeadCohortSection'
import { LeadSplitCard, LeadWeekCard, today, useLeadSplit } from './LeadSplitCards'
import { LeadSourcesSection } from './LeadSourcesSection'
import { RopReport } from './RopReport'
import type { LeadSourcesOverviewDto } from './leadSourcesApi'

/**
 * «Lidlar» — everything about a lead once Bitrix24 has it, in one section.
 *
 * Asked for on 2026-09-25 («yangi bir boʻlim ochamiz lidlar deb, oʻsha yerga
 * koʻchiramiz lid kogortasini ham … Sotuv ROP ni ham»). Two tabs, each on
 * its own clock:
 *
 *   «Lid manbalari» — every Регистрация lead by source, the lead forms per
 *     targetolog against Meta, the DM pages' conversations. The dashboard
 *     period (`LeadSourcesSection`).
 *   «Lid kogortasi» — arrival day × distribution day, on its own fourteen-day
 *     window (`LeadCohortSection`, moved from «Reklama samarasi»).
 *   «ROP otchet» — the client's group sheet (`RopReport`), on the ROP cards'
 *     day. Its own tab since 2026-10-02 («ROP otchet degan narsani yangi
 *     boʻlimcha qilasan»); it sat below «Targetologlar» before.
 *   «Guruhlar» — the client's seller sheet (`GroupPlanCard`): kval leads,
 *     500 000 a lead, Факт-1 and the debt, from the first of the same day's
 *     month. Its own tab from the start (2026-10-02); it held the «безквал /
 *     квал» group report until 2026-10-03.
 *
 * «Sotuv · ROP» was removed on 2026-10-01 at the user's request.
 *
 * «Registratsiya» was folded into «Lid manbalari» on 2026-10-02: the split
 * card and the seven-day grid sit among its blocks on their own day, shared
 * with «ROP otchet» and «Guruhlar» (`LeadSplitCards.tsx`), while everything else keeps the
 * period.
 *
 * «Reklama samarasi» kept the Meta side — spend, campaigns, the client's
 * «DM» / «Отчёт Т» sheets.
 *
 * NOTHING ON A HIDDEN TAB ASKS: the sources tab's requests (`/leads/overview`
 * and the split cards' `/registration/overview`) do not go out while another
 * tab is open; the cohort tab fetches inside its own section, «ROP otchet»
 * asks `/registration/report` plus the split for its team colours, «Guruhlar»
 * asks `/registration/groups`.
 */
type Tab = 'sources' | 'cohort' | 'rop' | 'groups'

export function LeadsPage() {
  const { apiParams } = useDashboardFilters()
  const [tab, setTab] = useState<Tab>('sources')
  // The ROP cards' day — one, so the split, the grid, «ROP otchet» and «Guruhlar» always show the same day.
  const [day, setDay] = useState(today)
  // «ROP otchet» paints its teams in the split's colours.
  const { colors } = useLeadSplit(day, tab === 'rop')

  const params = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const overview = useQuery({
    queryKey: ['leads-overview', params],
    queryFn: ({ signal }) => apiGet<LeadSourcesOverviewDto>('/leads/overview', params, signal),
    enabled: tab === 'sources',
  })

  const status: Status = overview.isPending ? 'loading' : overview.isError ? 'error' : 'ready'

  return (
    <PageShell
      title={t.modules.leads.title}
      description={t.modules.leads.lead}
      accent="var(--series-7)"
      meta={tab === 'sources' ? overview.data?.meta : undefined}
      stale={tab === 'sources' && overview.isPlaceholderData}
      period={tab === 'sources'}
      toolbar={
        <SegmentedControl<Tab>
          ariaLabel="Qaysi jadvallar"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'sources', label: 'Lid manbalari' },
            { value: 'cohort', label: 'Lid kogortasi' },
            { value: 'rop', label: 'ROP otchet' },
            { value: 'groups', label: 'Guruhlar' },
          ]}
        />
      }
    >
      <div className="flex min-w-0 flex-col gap-6">
        {tab === 'cohort' ? (
          <LeadCohortSection />
        ) : tab === 'rop' ? (
          <RopReport day={day} onDay={setDay} colors={colors} />
        ) : tab === 'groups' ? (
          <GroupPlanCard day={day} onDay={setDay} />
        ) : status === 'error' ? (
          <Card className="p-5">
            <ErrorState
              message={overview.error instanceof Error ? overview.error.message : undefined}
              onRetry={() => void overview.refetch()}
            />
          </Card>
        ) : (
          <LeadSourcesSection
            data={overview.data?.data}
            status={status}
            slots={{
              afterChannels: <LeadSplitCard day={day} onDay={setDay} />,
              beforeForms: <LeadWeekCard day={day} />,
            }}
          />
        )}
      </div>
    </PageShell>
  )
}
