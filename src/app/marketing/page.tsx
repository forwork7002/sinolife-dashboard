import { Suspense } from 'react'

import { ReklamaPage } from '@/features/reklama/ReklamaPage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * «Reklama samarasi» — switched back on 2026-09-23, as the client's own ad
 * sheets («DM», «Отчёт Т», lead quality) rather than the Roistat ledger it
 * was paused as on 2026-09-10 («hozircha api qilmay tur»).
 *
 * The Roistat screen and its `/api/v1/marketing/*` endpoints were deleted on
 * 2026-09-30; the section id and the URL stay `marketing` because ids are
 * stored on account grants. This page reads `/reklama/overview`. See
 * `features/reklama/ReklamaPage.tsx`.
 */
export default async function Page() {
  // Which accounts may open this screen at all. See pageGuard.ts.
  await requireSection('marketing')

  return (
    // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <ReklamaPage />
    </Suspense>
  )
}
