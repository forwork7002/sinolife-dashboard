import { Suspense } from 'react'

import { ChannelsPage } from '@/features/channels/ChannelsPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <ChannelsPage />
    </Suspense>
  )
}
