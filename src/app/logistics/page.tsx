import { Suspense } from 'react'

import { LogisticsPage } from '@/features/logistics/LogisticsPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <LogisticsPage />
    </Suspense>
  )
}
