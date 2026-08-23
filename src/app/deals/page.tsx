import { DealsPage } from '@/features/deals/DealsPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return <DealsPage />
}
