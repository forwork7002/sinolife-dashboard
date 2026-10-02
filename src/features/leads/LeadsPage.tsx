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
 *
 * «Sotuv · ROP» was removed on 2026-10-01 at the user's request.
 *
 * «Registratsiya» was folded into «Lid manbalari» on 2026-10-02: the split
 * card, the seven-day grid and «ROP otchet» sit among its blocks on their own
 * shared day (`LeadSplitCards.tsx`), while everything else keeps the period.
 *
 * «Reklama samarasi» kept the Meta side — spend, campaigns, the client's
 * «DM» / «Отчёт Т» sheets.
 *
 * ONE REQUEST PER TAB: the sources request does not go out while the cohort
 * tab is open, and the cohort tab fetches inside its own section.
 */
type Tab = 'sources' | 'cohort'

export function LeadsPage() {
  const { apiParams } = useDashboardFilters()
  const [tab, setTab] = useState<Tab>('sources')
  // The ROP cards' day — one, so the split, the grid and «ROP otchet» always show the same day.
  const [day, setDay] = useState(today)
  const { colors } = useLeadSplit(day, tab === 'sources')

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
          ]}
        />
      }
    >
      <div className="flex min-w-0 flex-col gap-6">
        {tab === 'cohort' ? (
          <LeadCohortSection />
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
              afterForms: <RopReport day={day} onDay={setDay} colors={colors} />,
            }}
          />
        )}
      </div>
    </PageShell>
  )
}
