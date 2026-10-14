'use client'

import { useQueryClient, type Query } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

/**
 * The shell's own questions — the bell, the menu's reference data, the ⌘K
 * search, the rail's «Лид назорати» badge — are not the page's figures.
 * `/meta/alerts` is asked every minute on every screen, so counting it would
 * draw the sync line and announce «new data» on a page whose numbers had not
 * been asked about at all.
 */
const SHELL_KEYS = new Set(['meta', 'filters', 'search'])

export function isPageQuery(query: Pick<Query, 'queryKey'>): boolean {
  const [head, second, third] = query.queryKey
  if (SHELL_KEYS.has(String(head))) return false
  // `useLeadWatchCritical`'s SUMMARY_KEY; the page's own ['leads', 'watch'] is page data.
  return !(head === 'leads' && second === 'watch' && third === 'summary')
}

/** How long «Yangi maʼlumot keldi» stays up. */
export const FRESH_TOAST_MS = 4500

/**
 * The moment a page query was asked AGAIN — the two-minute poll, a return to
 * the tab, the refresh button — and came back with different figures; null
 * once the toast has had its few seconds.
 *
 * «Different» is read off the payload's `data`, which the query client's
 * structural sharing hands back BY REFERENCE when it is deep-equal to the last
 * answer. The envelope's `meta.generatedAt` changes on every response, so the
 * root object is always new; `data` is new only when a figure moved.
 *
 * Never on a first answer: a changed filter is a new key and so a new query,
 * whose first success has nothing to differ from — that moment is the body's
 * blur (`stale`), not this. Never on a `manual` write either: a cell the
 * reader just typed and saved is not news to them.
 */
export function useFreshDataAt(): number | null {
  const queryClient = useQueryClient()
  const [freshAt, setFreshAt] = useState<number | null>(null)

  useEffect(() => {
    const seen = new Map<string, unknown>()
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'removed') {
        seen.delete(event.query.queryHash)
        return
      }
      if (event.type !== 'updated' || event.action.type !== 'success') return
      if (!isPageQuery(event.query)) return
      const next = (event.action.data as { data?: unknown } | undefined)?.data
      const hash = event.query.queryHash
      const had = seen.has(hash)
      const previous = seen.get(hash)
      seen.set(hash, next)
      if (had && !event.action.manual && next !== previous) setFreshAt(Date.now())
    })
  }, [queryClient])

  useEffect(() => {
    if (freshAt === null) return
    const timer = setTimeout(() => setFreshAt(null), FRESH_TOAST_MS)
    return () => clearTimeout(timer)
  }, [freshAt])

  return freshAt
}
