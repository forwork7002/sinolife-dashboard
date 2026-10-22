import { Suspense } from 'react'

import { InboundAnalysisPage } from '@/features/calls/InboundAnalysisPage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

/** «Kiruvchi tahlil» — under «Qoʻngʻiroqlar», on its section: the same calls, the same accounts. */
export default async function Page() {
  await requireSection('customers')

  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <InboundAnalysisPage />
    </Suspense>
  )
}
