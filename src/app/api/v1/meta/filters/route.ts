import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { referenceRepository } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'employees:read', section: null } as const

/**
 * Populates every filter dropdown in one round trip.
 *
 * THIS IS THE ENDPOINT EVERY SCREEN LOADS, and on 2026-09-11 it was measured
 * at 595ms p50 and 82 263 bytes — the broadest single cost in the product,
 * paid by screens that render no filter row at all. Three of the six reads it
 * made were feeding nothing:
 *
 *   - `findStages` shipped 12 180 bytes of Доставка stages for a «Bosqich»
 *     control no screen enables, and `findProducts` shipped a list that is
 *     empty on this portal anyway. Both controls were deleted from PageShell
 *     in the same change, so nothing is left offering an empty dropdown.
 *   - `findLastSuccessfulSync` was the ONE query here whose plan grows with
 *     the table, and `lastSyncedAt` had no reader: PageShell's own comment
 *     records that the header fetches freshness from `/meta/alerts` itself.
 *   - `permissions` was not even declared on the client type.
 *
 * What is left is three reads of tables in the tens-to-hundreds of rows, and a
 * roster projected to the two fields a picker actually renders.
 */
export const GET = getHandler(ACCESS, z.object({}), async (ctx) => {
  const [employees, departments, sources] = await Promise.all([
    referenceRepository.findEmployeeChoices(),
    referenceRepository.findDepartments(),
    referenceRepository.findSources(),
  ])

  return {
    data: {
      /*
        A narrowed account only ever filters by what it may read.

        The list drives every employee picker on every screen, so leaving it
        whole would put the company's roster — 289 names — into the dropdown of
        an account whose rows are fifteen. Filtering it here is presentation;
        the SQL scope behind each endpoint is the boundary.
      */
      employees: ctx.scope.restrictToEmployeeIds
        ? employees.filter((e) => ctx.scope.restrictToEmployeeIds!.includes(e.id))
        : employees,
      departments,
      sources,
      /*
        The viewer, so the sidebar can hide what this account was not given.

        It rides THIS response rather than a new endpoint because every page
        already fetches it once per session. Presentation only — the page guard
        and the route permissions are what actually refuse access, and both
        read the database rather than this payload.
      */
      viewer: {
        // The viewer's own id, so the admin screen can refuse to offer an
        // action the server would reject anyway — deleting yourself.
        userId: ctx.principal.userId,
        role: ctx.principal.role,
        sections: ctx.principal.sections,
        dataScope: ctx.principal.dataScope,
        canManageUsers: ctx.principal.role === 'ADMIN',
      },
    },
  }
})