import { Suspense } from 'react'

import { SellersPage } from '@/features/sellers/SellersPage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated and filtered at request time: never statically prerendered.
export const dynamic = 'force-dynamic'

export default async function Page() {
  // Which accounts may open this screen at all. See pageGuard.ts.
  await requireSection('sellers')

  return (
    // The period control reads the URL on the client; Suspense gives prerender
    // a shell to render instead of bailing the whole route out.
    <Suspense fallback={null}>
      <SellersPage />
    </Suspense>
  )
}
