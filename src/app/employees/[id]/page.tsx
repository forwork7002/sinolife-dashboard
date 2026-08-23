import { Suspense } from 'react'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { EmployeeDetailPage } from '@/features/employees/EmployeeDetailPage'

/**
 * Which employee pages to pre-render.
 *
 * Only needed by the static demo build: without a server there is nothing to
 * render `/employees/<id>` on demand, so every id must be known up front. The
 * list comes from the same snapshot the pages read at runtime, so a page can
 * never exist without its data or the other way round.
 *
 * For the normal server build this returns nothing and every id is rendered on
 * request, as before.
 */
export async function generateStaticParams(): Promise<{ id: string }[]> {
  if (process.env.STATIC_EXPORT !== '1') return []

  try {
    const file = resolve(process.cwd(), 'public', 'demo-api', 'meta_filters.json')
    const snapshot = JSON.parse(readFileSync(file, 'utf8')) as {
      data?: { employees?: { id: string }[] }
    }
    return (snapshot.data?.employees ?? []).map((e) => ({ id: e.id }))
  } catch {
    return []
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // The page reads its filters from the URL, and `useSearchParams()` cannot be
  // resolved while prerendering — a Suspense boundary lets the shell render
  // and the filtered content fill in on the client.
  return (
    <Suspense fallback={null}>
      <EmployeeDetailPage employeeId={id} />
    </Suspense>
  )
}
