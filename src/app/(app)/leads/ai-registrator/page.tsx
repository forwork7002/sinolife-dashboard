import { Suspense } from 'react'

import { AiRegistratorPage } from '@/features/aiRegistrator/AiRegistratorPage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

/** «AI registrator» — under «Lidlar», on its section: the AI's leads are Регистрация leads. */
export default async function Page() {
  await requireSection('leads')

  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <AiRegistratorPage />
    </Suspense>
  )
}
