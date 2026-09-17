import { toPeriodDto } from '@/server/domain/period/period'
import { getHandler, periodFrom } from '@/server/http/handler'
import { periodQuerySchema } from '@/server/http/queryParams'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/** Who reaches this endpoint: the capability, then the screen it feeds. */
const ACCESS = { permission: 'analytics:read:all', section: 'customers' } as const

/**
 * «Qoʻngʻiroqlar» — who spoke to customers, for how long.
 *
 * THE ADDRESS IS REUSED AND THE ENDPOINT IS NOT. A `/insights/calls` existed
 * until the 2026-09-10 callerless cull took it with the screen it fed. That one
 * answered response-speed questions — time to first call, attempts to connect,
 * revenue per talk-hour — and all of them need a call joined to a deal.
 * `call_record."dealId"` is set on 1 row of 366 300 (the portal answers
 * `CRM_ENTITY_TYPE = 'CONTACT'` for effectively every call), so none of that is
 * restorable and none of it is attempted. What is on this payload joins a call
 * to a CUSTOMER (99.3%) and to an EMPLOYEE (100%).
 *
 * `periodQuerySchema`, NOT `analyticsQuerySchema`. The filter half carries
 * employee, stage, product, source and `filial` — and `filial` has a non-empty
 * default, so the combined schema would hand this endpoint a branch narrowing
 * no column of `call_record` can honour. Savdo dinamikasi dropped two filters
 * for the same reason: a control that changes nothing is worse than none.
 *
 * IT HONOURS THE DASHBOARD WINDOW, AND «Bugun» IS A GOOD QUESTION HERE.
 * `/insights/customers` resolves its own ninety days because its
 * sibling `/insights/concentration` once inherited «Bugun» and reported twelve
 * customers under a critical-red gauge. Nothing about a day of telephony is
 * degenerate — «who spoke to customers today» is the floor's own question — so
 * this one takes the control.
 *
 * The window is clamped to `CALL_DATA_FLOOR` inside the repository and the
 * clamp is reported as `data.floorApplied`, so the screen can say why it shows
 * less than was asked for. `meta.period` carries the window the caller asked.
 */
export const GET = getHandler(ACCESS, periodQuerySchema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  const data = await insightsService.callActivity(period)
  return { data, meta: { period: toPeriodDto(period) } }
})
