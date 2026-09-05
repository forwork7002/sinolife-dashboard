import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { referenceRepository } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'employees:read', section: null } as const

/** Populates every filter dropdown in one round trip. */
export const GET = getHandler(ACCESS, z.object({}), async (ctx) => {
  const [employees, departments, products, sources, stages, lastSyncedAt] =
    await Promise.all([
      referenceRepository.findEmployees(),
      referenceRepository.findDepartments(),
      referenceRepository.findProducts(),
      referenceRepository.findSources(),
      referenceRepository.findStages(),
      referenceRepository.findLastSuccessfulSync(),
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
      products,
      sources,
      stages,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
      permissions: ctx.principal.role,
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