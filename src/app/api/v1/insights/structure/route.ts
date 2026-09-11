import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler } from '@/server/http/handler'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'employees:read', section: 'structure' } as const

/**
 * The company tree. NO WINDOW, NO MONEY, NO GATE BEYOND THE SECTION.
 *
 * This used to resolve a reporting window and then withhold the money half of
 * its answer from an account without `analytics:read:all`. Both are gone: the
 * screen prints who reports to whom and nothing else, so there is nothing on it
 * left to withhold and nothing a date could change. Money was to be stated in
 * one place — «Boshqaruv markazi» — and when that screen was removed on
 * 2026-09-10 the instruction stood: this one still states none.
 *
 * The schema still accepts the period parameters, and ignores them. The page
 * sends none — its request is `apiGet('/insights/structure', {})` — so nothing
 * depends on them; the shared schema is simply permissive, accepting them costs
 * nothing, and a hand-typed `?preset=` must not turn into a 400. `meta` carries
 * no period, so nothing downstream can mistake this answer for a dated one.
 */
export const GET = getHandler(ACCESS, analyticsQuerySchema, async (ctx) => {
  const data = await insightsService.structure(
    {},
    { viewerEmployeeId: ctx.principal.employeeId },
  )

  return { data }
})
