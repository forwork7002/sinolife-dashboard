import { Suspense } from 'react'

import { AiControlPage } from '@/features/aiRegistrator/AiControlPage'
import { requireAiControl } from '@/server/auth/pageGuard'

// Authenticated: never statically prerendered.
export const dynamic = 'force-dynamic'

/** «AI registrator → Boshqaruv» (2026-10-30) — the owner's own account only (`auth/aiControl.ts`). */
export default async function Page() {
  await requireAiControl()

  return (
    <Suspense fallback={null}>
      <AiControlPage />
    </Suspense>
  )
}
