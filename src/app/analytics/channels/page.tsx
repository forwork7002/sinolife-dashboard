import { Suspense } from 'react'

import { ChannelsPage } from '@/features/channels/ChannelsPage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default async function Page() {
  // Which accounts may open this screen at all. See pageGuard.ts.
  await requireSection('channels')

  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <ChannelsPage />
    </Suspense>
  )
}
