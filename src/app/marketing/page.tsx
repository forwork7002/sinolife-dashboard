import { Suspense } from 'react'

import { MarketingPage } from '@/features/marketing/MarketingPage'

// Authenticated and filtered at request time: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    // Shell reads the URL for its command palette; Suspense gives prerender a shell.
    <Suspense fallback={null}>
      <MarketingPage />
    </Suspense>
  )
}
