import { z } from 'zod'

import { analyticsQuerySchema } from '@/server/http/queryParams'
import { getHandler, periodFrom } from '@/server/http/handler'
import { AnalyticsService } from '@/server/services/analyticsService'
import { SELLER_BOARD_BASES } from '@/server/services/sellerBoardService'
import { sellerBoardService } from '@/server/services/container'

export const dynamic = 'force-dynamic'

/**
 * Who reaches this endpoint: the capability, then the screens it feeds.
 *
 * TWO SECTIONS since 2026-09-07. The board itself is the sellers' television;
 * its totals — FAKT 1 / FAKT 2, conversion, the bonus fund and ladder — are
 * read on Savdo dinamikasi (`ConfirmationFaktSection`), so an account that
 * holds that screen and not the board must still be answered. Any-of, the
 * same shape as `/analytics/employees`. The scope below narrows either
 * caller the same way.
 *
 * WHAT THE SECOND SECTION GRANTS, STATED SO AN ADMINISTRATOR KNOWS: the whole
 * board, not a totals-only shape. An account ticked «sales» and not «sellers»
 * receives every seller row — name, FAKT 1, FAKT 2, bonus position — within
 * its data scope. Deliberate, for two reasons. The section's own tiles are
 * built FROM those rows (the conversion denominator, the ladder's counts and
 * its «Eng yaqini»), so a stripped payload would blank the very screen the
 * widening exists to serve. And this is the board `ROLE_NAV` already hands
 * to every salesperson by default, on the stated ground that it exposes only
 * aggregate per-seller figures — no deals, no costs, no headcount. Un-ticking
 * «sellers» therefore hides the television and its link; it does not withhold
 * the floor's standings from an account that holds Savdo dinamikasi.
 */
const ACCESS = { permission: 'leaderboard:read', section: ['sellers', 'sales'] } as const

const schema = analyticsQuerySchema.and(
  z.object({
    /**
     * One seller's daily rows instead of the whole board.
     *
     * A separate parameter rather than a separate route because the two reads
     * share every filter and the same period resolution; splitting them would
     * duplicate that surface for one extra query.
     */
    employeeId: z.string().min(1).optional(),
    /**
     * Which clock the board reads — see `SellerBoardDto.basis`.
     *
     * Defaults to 'queue', the floor's own FAKT 1 / FAKT 2 definitions. The
     * original 'intake' reading stays reachable rather than deleted: it is
     * the one figure measured against the client's own published dashboard
     * (see `sellerBoardRepository`), so it is the oracle a 'queue' regression
     * gets checked against, not a screen anyone is meant to keep reading.
     */
    basis: z.enum(SELLER_BOARD_BASES).default('queue'),
    /*
      THE RECORD WALL, ASKED FOR SEPARATELY AND ON ITS OWN CLOCK.

      A query parameter rather than a second route, for the reason `/users`
      takes `?include=heads`: it is the same capability, the same section and
      the same scope, and `routeAccess.test.ts` pins the ungated list — a new
      path would have to be argued into that array while having nothing new to
      say under it.

      OPT-IN because it is not free and not wanted on the board's cadence. The
      wall spans every month since `RECORDS_FROM`, so its cohort is the widest
      read on this screen, while the answer changes when a month closes. The
      television polls the board once a minute and the wall once every ten;
      folding the two into one response would put the expensive half on the
      fast clock.

      IT REPLACES the board in the response rather than riding beside it. The
      caller that wants records is a second react-query key with its own
      staleTime, and it has no use for a board it already holds — building one
      anyway would be two full cohort constructions thrown away every ten
      minutes, per reader.
    */
    /*
      'faktTrend' — the FAKT 1 / FAKT 2 lines the hero chart on Savdo
      dinamikasi draws over its revenue area. Opt-in and replacing, for the
      same two reasons 'records' is: the caller is a second react-query key
      that already holds a board, and building one anyway would be a second
      cohort construction thrown away on every poll.

      It is the SAME cohort as the tiles below that chart, so the line and the
      totals cannot disagree — which is the whole reason it is served from
      this route rather than bolted onto `/analytics/sales`, whose window is
      the close date and whose payload the chart's area already comes from.
    */
    include: z.enum(['records', 'faktTrend']).optional(),
  }),
)

/**
 * The sellers' board — who brought in what during the period.
 *
 * COMPANY-WIDE FOR EVERY CALLER, WHATEVER THEIR DATA SCOPE. This endpoint is
 * the one deliberate hole in team scoping and the client asked for it in as
 * many words on 2026-09-08: «sotuvchilar reytingi bo'limi hammaga bir xil
 * ko'rinishi kerak… hamma bir-birini natijasini ko'ra olishi uchun». Every
 * other screen still narrows — an account set to «faqat o'z bo'limi» reads its
 * own confirmation queue, its own bell, its own everything — and this one does
 * not, because a leaderboard whose readers each see a different league is not
 * a leaderboard. It is the floor's television: the instrument exists so a
 * seller can find their own row among all the others and know what the number
 * ahead of them is.
 *
 * It was narrowed for six weeks and that was a defensible reading of a
 * different question — `leaderboard:read` is held by every active account, so
 * the scope was the only thing standing between a salesperson and the firm's
 * figures. What it costs is the screen's whole purpose, so the trade is made
 * the other way and stated here rather than left implicit.
 *
 * WHAT IS ACTUALLY DISCLOSED, so the decision can be judged: per-seller and
 * per-team FAKT 1 / FAKT 2 money, order counts, conversion and rank. No deal
 * rows, no customers, no phone numbers, no costs, no salaries. It is the same
 * standing every seller already reads off the wall the client hangs this on.
 *
 * ALL THREE READERS OF THIS ROUTE MOVE TOGETHER, and they have to. The board
 * on `/sellers`, the record ticker in its header, and the FAKT 1 / FAKT 2 band
 * on Savdo dinamikasi are one answer rendered three ways — the band's tiles
 * are built FROM these rows. Narrowing one and not the others would have a
 * single endpoint reporting two different floors on two screens.
 *
 * `tests/http/routeAccess.test.ts` records the exemption by name: every other
 * route that admits a narrowed caller must be seen reading `ctx.scope`, and
 * this one is listed as company-wide on purpose so the absence is a decision
 * in a diff rather than an oversight.
 *
 * TWO CLOCKS, PICKED BY `?basis=`. The default, 'queue', dates every figure
 * by the order's own arrival in the confirmation queue (C4:NEW) — FAKT 1 is
 * Тасдиқланди plus Тасдиқланмай чиқди (everything that left the queue as an
 * order), FAKT 2 is Доставланди, the floor's own vocabulary. 'intake'
 * dates by the day the order was TAKEN instead, which is how the client's
 * published dashboard originally scored the floor. `/analytics/leaderboard`
 * answers a third, related question (delivered revenue on `closedAt`) and its
 * total differs from either of these by a wide margin in a typical month, so
 * `data.basis` travels with the payload and the screen prints it.
 */
export const GET = getHandler(ACCESS, schema, async (ctx) => {
  const period = periodFrom(ctx.query, ctx.timeZone, ctx.now)
  /*
    `ctx.query` AND NOT `ctx.scope` — the one place in this API where that is
    deliberate. See the block above for why, and `routeAccess.test.ts` for
    where the exemption is recorded.

    The caller's own `?employeeIds=` still applies. It can only ever narrow
    what is shown, so a reader filtering the board to one team is doing on
    screen what the scope used to do underneath — the difference is that they
    chose it and can undo it.
  */
  const context = AnalyticsService.context(period, ctx.currency, ctx.query, ctx.now)

  if (ctx.query.include === 'records') {
    return {
      data: await sellerBoardService.records(context),
      meta: AnalyticsService.periodMeta(context),
    }
  }

  if (ctx.query.include === 'faktTrend') {
    return {
      data: await sellerBoardService.faktTrend(context),
      meta: AnalyticsService.periodMeta(context),
    }
  }

  if (ctx.query.employeeId) {
    return {
      data: await sellerBoardService.sellerDays(context, ctx.query.employeeId, ctx.query.basis),
      meta: AnalyticsService.periodMeta(context),
    }
  }

  return {
    data: await sellerBoardService.board(context, ctx.query.basis),
    meta: AnalyticsService.periodMeta(context),
  }
})
