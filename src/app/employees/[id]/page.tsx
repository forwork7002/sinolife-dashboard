import { EmployeeDetailPage } from '@/features/employees/EmployeeDetailPage'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <EmployeeDetailPage employeeId={id} />
}
