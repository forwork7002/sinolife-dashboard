'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { apiGet, type ApiSuccess } from '@/lib/api'
import { LEAD_WATCH_SETTINGS } from '@/lib/leadWatchSettings'

import type { LeadWatchDto, LeadWatchSummaryDto } from './leadWatchApi'
import { watchTitle } from './leadWatchLogic'

/**
 * «Лид назорати» — its two requests, and the tab title that follows them.
 *
 * ON ITS OWN CLOCK, AND THAT IS AN EXCEPTION. `providers.tsx` sets one
 * cadence for every screen and per-page intervals were removed on purpose;
 * this block asks every `refreshEveryMs` because the worker refreshes calls
 * and chats on that same clock (`leadWatchSettings.ts`) — asking sooner
 * re-reads an answer that cannot have changed. `staleTime` equals the
 * interval for the reason `Shell`'s alerts query records: the Shell remounts
 * on every navigation, and anything shorter refetches on every page change.
 */
const WATCH_KEY = ['leads', 'watch'] as const
const SUMMARY_KEY = ['leads', 'watch', 'summary'] as const

const CLOCK = {
  refetchInterval: LEAD_WATCH_SETTINGS.refreshEveryMs,
  refetchIntervalInBackground: false,
  staleTime: LEAD_WATCH_SETTINGS.refreshEveryMs,
} as const

/** The whole block. Asked only while it is on screen. */
export function useLeadWatch(enabled: boolean) {
  const client = useQueryClient()
  return useQuery({
    queryKey: WATCH_KEY,
    queryFn: async ({ signal }) => {
      const answer = await apiGet<LeadWatchDto>('/leads/watch', {}, signal)
      /*
        The sidebar badge and the tab title read the summary; the block has
        just read the same number with everything under it. Handing it over
        keeps the three from disagreeing for up to two minutes — the chip
        saying 3 beside a badge still saying 2. A summary still in flight was
        asked before this answer was computed, so it is dropped rather than
        left to land on top of the newer number.
      */
      await client.cancelQueries({ queryKey: SUMMARY_KEY, exact: true })
      client.setQueryData<ApiSuccess<LeadWatchSummaryDto>>(SUMMARY_KEY, {
        data: { critical: answer.data.critical },
        meta: answer.meta,
      })
      return answer
    },
    enabled,
    ...CLOCK,
  })
}

/**
 * How many problems are critical — for the «Lidlar» badge in the sidebar and
 * the tab title. One key, so the Shell and the page share one request.
 * `enabled` is whether this account has the section at all: an account
 * without it must not ask (the endpoint would refuse, every two minutes).
 */
export function useLeadWatchCritical(enabled: boolean): number {
  const summary = useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: ({ signal }) => apiGet<LeadWatchSummaryDto>('/leads/watch/summary', {}, signal),
    enabled,
    ...CLOCK,
  })
  const critical = summary.data?.data.critical
  return enabled && typeof critical === 'number' && critical > 0 ? critical : 0
}

/**
 * «(3) Lidlar» in the browser tab while something is critical.
 *
 * `document.title`, not a `<title>` and not `metadata`: the title is the root
 * layout's static metadata, which Next writes once per navigation and does not
 * touch between them — so an effect that sets it and puts back exactly what
 * it found never competes with the framework. A rendered `<title>` would be a
 * second one in the head beside Next's.
 */
export function useCriticalTitle(base: string, critical: number): void {
  useEffect(() => {
    if (critical <= 0) return
    const previous = document.title
    document.title = watchTitle(base, critical)
    return () => {
      document.title = previous
    }
  }, [base, critical])
}
