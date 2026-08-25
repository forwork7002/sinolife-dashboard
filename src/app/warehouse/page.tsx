import { Suspense } from 'react'

import { WarehousePage } from '@/features/warehouse/WarehousePage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <WarehousePage />
    </Suspense>
  )
}
