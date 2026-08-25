import { Suspense } from 'react'

import { StructurePage } from '@/features/structure/StructurePage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <StructurePage />
    </Suspense>
  )
}
