import { Suspense } from 'react'

import { LeadsPage } from '@/features/leads/LeadsPage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * «Lidlar» — opened on 2026-09-25: «Lid manbalari», and the «Lid kogortasi»
 * and «Sotuv · ROP» tabs moved here from «Reklama samarasi». See
 * `features/leads/LeadsPage.tsx`.
 */
export default async function Page() {
  // Which accounts may open this screen at all. See pageGuard.ts.
  await requireSection('leads')

  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <LeadsPage />
    </Suspense>
  )
}
