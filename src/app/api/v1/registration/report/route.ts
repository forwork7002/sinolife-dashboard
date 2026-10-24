import { zonedDateKey } from '@/server/domain/period/period'
import { ApiError } from '@/server/http/errors'
import { getHandler } from '@/server/http/handler'
import { registrationService } from '@/server/services/container'

import { reportQuerySchema } from '../schema'

export const dynamic = 'force-dynamic'

/**
 * Every ROP team's sellers and their money side by side — for an ALL account
 * and one holding «RNP jadvali» as «Butun kompaniya». A TEAM account holding
 * it as «Oʻz boʻlimi» (2026-10-24, the user, for Malika: «faqat … oʻzini
 * ichidagi xodimlari chiqsin») reads only the people in its scope, each on the
 * group they are a row of, the totals theirs (`keepsSeller`). OWN is refused,
 * as on the sheet the tab sits on.
 * Section `rnp` since 2026-10-07, when «ROP otchet» moved there from «Lidlar».
 */
const ACCESS = { permission: 'analytics:read:own', section: 'rnp' } as const

/** «ROP otchet» — one day, a month or a range, every ROP team seller by seller. See ropReport.ts. */
export const GET = getHandler(ACCESS, reportQuerySchema, async (ctx) => {
  const restrict = ctx.scope.restrictToEmployeeIds
  if (restrict !== null && ctx.principal.dataScope !== 'TEAM') {
    throw ApiError.forbidden('ROP otchet jamoa boʻyicha: shaxsiy hisobga u faqat «Butun kompaniya» sifatida ochiladi.')
  }
  const day = ctx.query.day ?? zonedDateKey(ctx.now, ctx.timeZone)
  const data = await registrationService.report({
    from: ctx.query.from ?? day,
    to: ctx.query.to ?? day,
    timeZone: ctx.timeZone,
    now: ctx.now,
    brand: ctx.query.brand,
    employeeIds: restrict,
  })
  return { data }
})
