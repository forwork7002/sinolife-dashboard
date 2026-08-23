import { z } from 'zod'

import { getHandler } from '@/server/http/handler'
import { referenceRepository } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Populates every filter dropdown in one round trip. */
export const GET = getHandler('employees:read', z.object({}), async (ctx) => {
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
      // A salesperson only ever filters by themselves.
      employees: ctx.scope.restrictToEmployeeId
        ? employees.filter((e) => e.id === ctx.scope.restrictToEmployeeId)
        : employees,
      departments,
      products,
      sources,
      stages,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
      permissions: ctx.principal.role,
    },
  }
})