import { allTime, toPeriodDto } from '@/server/domain/period/period'
import { buildPagination } from '@/server/http/envelope'
import { getHandler, periodFrom } from '@/server/http/handler'
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
export const GET = getHandler(
  { permission: 'analytics:read:all', section: 'confirmation' },
  confirmationOrdersQuerySchema,
  async (ctx) => {
    /*
      A SEARCH IS A LOOKUP, NOT A REPORT — so it spans every date.

      Everything the box searches names ONE order: the Bitrix id, the order
      code, the customer, their phone, the amount, the address. Nobody types a
      phone number to find out what happened in August; they type it because a
      customer is on the line. And the person on the line does not know which
      day their order arrived in Тасдиклаш — that is the fact they are calling
      to establish.

      The board opens on «Bugun», so before this every such search answered
      «Buyurtma topilmadi» for any order older than this morning, with nothing
      on screen naming the window as the reason. The operator's next move was
      to widen the period by hand, preset by preset, until the row appeared —
      or to conclude the order was not in the system at all.

      Dropping the window here rather than in the repository keeps `meta.period`
      honest: the page is told the span it was actually answered for, and hides
      the date line rather than printing one the rows do not obey. The ROP
      breakdown and the five tiles ride the same window, so the band above the
      table still describes the rows under it.

      The cost USED to be the all-time cohort — the shape «Shu yil» runs, one
      statement building every arrival since the epoch, about five seconds.
      It is not any more: `insightsService.confirmationQueue` resolves the term
      to a bounded set of deal ids first and the cohort is built from those
      (see `InsightsRepository.confirmationSearchScope`). The span is still
      all of time, so `meta.period` still says so; only the work is smaller.
      A term too broad to be a lookup falls back to the unbounded shape, which
      is slow and complete. The search box is debounced either way, so this
      fires on a pause in typing, not on a keystroke.
    */
    /*
      «ЖАМИ» asks the same thing without a term to narrow it by: every order
      that ever reached Тасдиклаш. It is the windowed cohort over an unbounded
      span — and it is now the EXPENSIVE half of this branch, not the equal
      one this comment used to claim. A search names orders, so the service can
      resolve it to a bounded set of ids before building the cohort; «Жами»
      names all of them, so there is nothing to bound it by and it builds the
      whole thing. That is what it means, and the reader asked for it.
    */
    const period =
      ctx.query.q || ctx.query.queue === 'all'
        ? allTime(ctx.timeZone)
        : periodFrom(ctx.query, ctx.timeZone, ctx.now)

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
      {},
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
