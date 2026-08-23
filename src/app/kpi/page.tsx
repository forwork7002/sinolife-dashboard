import { KpiPage } from '@/features/kpi/KpiPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return <KpiPage />
}
