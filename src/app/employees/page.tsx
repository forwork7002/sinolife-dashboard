import { Suspense } from 'react'
import { EmployeesPage } from '@/features/employees/EmployeesPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    // URL filtrlari klientda o'qiladi; Suspense prerender paytida qobiqni chiqaradi.
    <Suspense fallback={null}>
      <EmployeesPage />
    </Suspense>
  )
}
