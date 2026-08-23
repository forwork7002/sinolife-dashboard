import { EmployeesPage } from '@/features/employees/EmployeesPage'

// Authenticated and URL-filtered: never statically prerendered.
export const dynamic = 'force-dynamic'

export default function Page() {
  return <EmployeesPage />
}
