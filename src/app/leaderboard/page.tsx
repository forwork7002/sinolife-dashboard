import { LeaderboardPage } from '@/features/leaderboard/LeaderboardPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return <LeaderboardPage />
}
