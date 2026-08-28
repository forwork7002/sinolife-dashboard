import { Suspense } from 'react'

import { MarketingPage } from '@/features/marketing/MarketingPage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated and filtered at request time: never statically prerendered.
export const dynamic = 'force-dynamic'

export default async function Page() {
  // Which accounts may open this screen at all. See pageGuard.ts.
  await requireSection('marketing')

  return (
    // Shell reads the URL for its command palette; Suspense gives prerender a shell.
    <Suspense fallback={null}>
      <MarketingPage />
    </Suspense>
  )
}
