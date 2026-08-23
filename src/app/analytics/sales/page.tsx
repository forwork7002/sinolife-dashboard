import { SalesPage } from '@/features/sales/SalesPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return <SalesPage />
}
