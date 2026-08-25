import { Suspense } from 'react'

import { CohortPage } from '@/features/cohort/CohortPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <CohortPage />
    </Suspense>
  )
}
