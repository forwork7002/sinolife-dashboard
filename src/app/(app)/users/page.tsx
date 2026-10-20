import { Suspense } from 'react'

import { UsersPage } from '@/features/users/UsersPage'
import { requireUserAdmin } from '@/server/auth/pageGuard'

// Authenticated and permission-gated: never statically prerendered.
export const dynamic = 'force-dynamic'

export default async function Page() {
  // Not a section — account administration is a permission. See pageGuard.ts.
  await requireUserAdmin()

  return (
    <Suspense fallback={null}>
      <UsersPage />
    </Suspense>
  )
}
