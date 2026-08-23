import { Suspense } from 'react'
import { LeaderboardPage } from '@/features/leaderboard/LeaderboardPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    // URL filtrlari klientda o'qiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <LeaderboardPage />
    </Suspense>
  )
}
