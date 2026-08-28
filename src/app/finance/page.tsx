import { Suspense } from 'react'
import { FinancePage } from '@/features/finance/FinancePage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default async function Page() {
  // Which accounts may open this screen at all. See pageGuard.ts.
  await requireSection('finance')

  return (
    // URL filtrlari klientda o'qiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <FinancePage />
    </Suspense>
  )
}
