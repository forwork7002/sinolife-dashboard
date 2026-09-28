import { Suspense } from 'react'

import { RnpPage } from '@/features/rnp/RnpPage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * «RNP jadvali» — opened on 2026-09-28: the client's «СентябрРНП» sheet, every
 * row from Bitrix24 and Meta. See `features/rnp/RnpPage.tsx`.
 */
export default async function Page() {
  // Which accounts may open this screen at all. See pageGuard.ts.
  await requireSection('rnp')

  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <RnpPage />
    </Suspense>
  )
}
