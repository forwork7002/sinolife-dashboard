import { Suspense } from 'react'

import { MarketingPage } from '@/features/marketing/MarketingPage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated and filtered at request time: never statically prerendered.
export const dynamic = 'force-dynamic'

export default async function Page() {
  // Which accounts may open this screen at all. See pageGuard.ts.
  await requireSection('marketing')

  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    // Bu qator ilgari ⌘K palitrasini sabab deb koʻrsatardi. Palitra oʻchirildi,
    // chegara esa qoldi — u koʻz uchun emas, `next build` uchun: uni olib
    // tashlasangiz, butun sahifa prerenderdan chiqib ketadi.
    <Suspense fallback={null}>
      <MarketingPage />
    </Suspense>
  )
}
