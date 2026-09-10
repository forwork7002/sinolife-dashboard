import { confirmationOrdersQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { ANALYTICS_READ } from '@/server/http/permissions'
import { insightsService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * The РЕГИОН column filter's options, for the Тасдиклаш board.
 *
 * A SIBLING OF `/orders` RATHER THAN A FIELD ON IT. The board reloads every
 * one minute on a screen the floor keeps open all day, and this answer
 * changes about as often as the portal grows a region — so the popover fetches
 * it once, on first open, and the client caches it from there. See
 * `InsightsRepository.confirmationRegions` for the cost argument in full.
 *
 * IT REUSES THE BOARD'S OWN SCHEMA, unchanged, so the two cannot disagree
 * about which window is on screen: the popover sends the address bar it is
 * already sitting in. Everything in that schema except the period, the search
 * box and the mode is simply not read — a list narrowed by the selection made
 * in it could not be un-narrowed.
 */
export const GET = getHandler(
  // The same gate as the board this filters. A caller who may not read the
  // queue may not enumerate its regions either.
  { permission: ANALYTICS_READ, section: 'confirmation' },
  confirmationOrdersQuerySchema,
  async (ctx) => {
    const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)

    const data = await insightsService.confirmationRegionOptions(
      period,
      { q: ctx.query.q },
      // Scope is spread last everywhere on this API; here it is the only thing
      // besides the window, so it is simply the argument.
      ctx.scope,
      ctx.query.queue,
    )

    return { data }
  },
)
