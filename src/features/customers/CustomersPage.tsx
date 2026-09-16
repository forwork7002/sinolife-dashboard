'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { CallActivitySection } from '@/features/customers/CallActivitySection'
import { CustomerFlowSection } from '@/features/customers/CustomerFlowSection'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type CallActivityDto, type CustomerFlowDto, apiGet } from '@/lib/api'
import { t } from '@/lib/messages'

/**
 * «Mijozlar va qoʻngʻiroqlar» — a section of its own, 2026-09-16.
 *
 * The client's words: «sotuvda mijoz soniyam kerak, pritok ottoklar kerak,
 * baza ne baza mijozlarga call duration». Customer count, arrivals, customers
 * going quiet, and call duration split by whether the customer is in «База».
 *
 * TWO BLOCKS, TWO WINDOWS, AND EACH STATES ITS OWN IN ITS OWN HEADING. That is
 * the discipline this codebase demands of any screen carrying two clocks, and
 * it is why «Savdo dinamikasi» was refused as a home: that screen was stripped
 * to one clock on 2026-09-10 precisely so nothing on it could disagree with
 * anything else on it. They share a screen because the client asked for one,
 * and they may never be summed — the call block counts legs in a chosen
 * window, the flow block counts PEOPLE over a fixed ninety days on the order
 * clock.
 *
 * THE CALL QUERY SENDS THE WINDOW AND NOTHING ELSE. `apiParams` also carries
 * any employee, stage or source filter left in the URL by another screen;
 * `/insights/calls` honours none of them, so sending them would only mint
 * cache entries that all hold the same answer.
 *
 * THE FLOW QUERY TAKES NO PARAMS AND ITS KEY IS CONSTANT. `/insights/customers`
 * resolves its own trailing ninety days. A key carrying the dashboard window
 * would make every preset press a miss for an identical answer — and would
 * suggest the control reaches it. Five minutes, the cohort screen's cadence: a
 * ninety-day shape does not move in a minute.
 */
export function CustomersPage() {
  const { apiParams } = useDashboardFilters()

  const windowParams = useMemo(() => {
    const out: Record<string, string | number> = { preset: apiParams.preset }
    if (apiParams.from !== undefined) out.from = apiParams.from
    if (apiParams.to !== undefined) out.to = apiParams.to
    return out
  }, [apiParams.preset, apiParams.from, apiParams.to])

  const calls = useQuery({
    queryKey: ['insights-calls', windowParams],
    queryFn: ({ signal }) => apiGet<CallActivityDto>('/insights/calls', windowParams, signal),
  })

  const flow = useQuery({
    queryKey: ['insights-customers', 'trailing-90'],
    queryFn: ({ signal }) => apiGet<CustomerFlowDto>('/insights/customers', {}, signal),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })

  const callStatus = calls.isPending ? 'loading' : calls.isError ? 'error' : 'ready'
  const flowStatus = flow.isPending ? 'loading' : flow.isError ? 'error' : 'ready'

  return (
    <PageShell
      title={t.modules.customers.title}
      description={t.modules.customers.lead}
      accent="var(--series-1)"
      meta={calls.data?.meta}
      stale={calls.isPlaceholderData}
    >
      <div className="flex flex-col gap-8">
        <CallActivitySection
          data={calls.data?.data}
          status={callStatus}
          errorMessage={calls.error instanceof Error ? calls.error.message : undefined}
          onRetry={() => void calls.refetch()}
        />
        <CustomerFlowSection
          data={flow.data?.data}
          resolvedWindow={flow.data?.meta.period}
          status={flowStatus}
          errorMessage={flow.error instanceof Error ? flow.error.message : undefined}
          onRetry={() => void flow.refetch()}
        />
      </div>
    </PageShell>
  )
}
