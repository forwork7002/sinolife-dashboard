import { OverviewPage } from '@/features/overview/OverviewPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return <OverviewPage />
}
