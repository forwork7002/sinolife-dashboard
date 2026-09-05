import { toPeriodDto } from '@/server/domain/period/period'
import { buildPagination } from '@/server/http/envelope'
import { getHandler, periodFrom } from '@/server/http/handler'
import { ANALYTICS_READ } from '@/server/http/permissions'
import { confirmationOrdersQuerySchema } from '@/server/http/queryParams'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * The Тасдиклаш queue, one row per order.
 *
 * A sibling of `/insights/confirmations` rather than a replacement for it:
 * that endpoint answers "how does each operator work their queue", this one
 * answers "what happened to the orders".
 *
 * THE SIBLING NO LONGER FEEDS ANYTHING. This comment used to say it fed the
 * overview tile; the command centre moved to `confirmationOutcomes` for speed
 * and nothing in `src/features` has called `/insights/confirmations` since.
 * The two are also not interchangeable: it counts every order that entered a
 * PENDING_CONFIRM stage during the window (3,210 for one August) while this
 * one counts every order CREATED in the window that reached any confirmation
 * stage (3,049) — two populations, both fielded as `orders`. Nothing on a
 * screen compares them today; if one ever does, that is the first thing to
 * reconcile.
 */
/*
  WHO REACHES IT, AND HOW MUCH OF IT THEY READ — TWO ANSWERS, NOT ONE.

  This used to ask for `analytics:read:all`, which only an ALL-scoped account
  holds, because the board was company-wide by construction and there was no
  honest answer to give anybody else. There is one now: `insightsService`
  threads `ctx.scope` into the cohort's own CTE, so a ROP given «Тасдиклаш»
  reads their own floor and a salesperson reads their own orders — rows, tiles,
  ROP panel and bell alike, all cut by one predicate in one place.

  The any-of pair is what expresses that. An ALL account still holds
  `analytics:read:all` and is still unrestricted; a TEAM or OWN account holds
  `analytics:read:own` and is narrowed in SQL rather than refused at the door.
  The section gate is unchanged and is still what decides who sees the screen
  at all.
*/
export const GET = getHandler(
  { permission: ANALYTICS_READ, section: 'confirmation' },
  confirmationOrdersQuerySchema,
  async (ctx) => {
    const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)

    const { items, totalItems, rops, byRop, totals } = await insightsService.confirmationQueue(
      period,
      {
        outcomes: ctx.query.outcomes,
        rop: ctx.query.rop,
        q: ctx.query.q,
        page: ctx.query.page,
        pageSize: ctx.query.pageSize,
        sort: ctx.query.sort,
        order: ctx.query.order,
      },
      /*
        The caller's scope, spread from the handler rather than written here.

        `{}` used to sit in this position and it was the whole of the reason
        this endpoint could not serve a narrowed account: the service already
        took a scope, threaded it onto the window, and handed it to a
        repository that ignored it. All three now honour it, and this argument
        is where it enters.
      */
      ctx.scope,
      ctx.query.queue,
    )

    return {
      data: {
        items,
        pagination: buildPagination(ctx.query.page, ctx.query.pageSize, totalItems),
        rops,
        byRop,
        totals,
      },
      meta: { period: toPeriodDto(period) },
    }
  },
)
