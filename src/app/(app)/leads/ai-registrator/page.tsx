import { Suspense } from 'react'

import { AiRegistratorPage } from '@/features/aiRegistrator/AiRegistratorPage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

/** «AI registrator» — under /leads in the URL, on its own section since 2026-10-23 (the owner: «faqat Umida akkauntiga»). */
export default async function Page() {
  await requireSection('airegistrator')

  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <AiRegistratorPage />
    </Suspense>
  )
}
