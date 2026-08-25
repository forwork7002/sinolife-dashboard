import { Suspense } from 'react'

import { CallsPage } from '@/features/calls/CallsPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <CallsPage />
    </Suspense>
  )
}
