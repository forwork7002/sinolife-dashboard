import { FinancePage } from '@/features/finance/FinancePage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return <FinancePage />
}
