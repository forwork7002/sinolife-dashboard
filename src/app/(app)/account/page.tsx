import { Suspense } from 'react'

import { AccountPage } from '@/features/account/AccountPage'

// Session-bound and never cacheable.
export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AccountPage />
    </Suspense>
  )
}
