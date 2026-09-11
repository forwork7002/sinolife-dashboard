'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { ErrorState } from '@/components/states/States'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { GaugeTile, RankBadge, StatTile } from '@/components/ui/Stat'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type SellerBoardDto, type SellerTeamRowDto, apiGet } from '@/lib/api'
import { NO_VALUE, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'
import { FaktBasisNote, FaktFigure, QUEUE_BASIS } from '@/features/shared/faktVocabulary'

/**
 * FAKT 1 / FAKT 2 — the spine of Savdo dinamikasi, and the floor's own
 * vocabulary.
 *
 * These figures, the sentence under them and the bonus ladder used to sit on
 * Sotuvchilar reytingi. They moved here on 2026-09-07 when the client made
 * that screen the television board — «FAKT 1 va FAKT 2 maʼlumotlarini
 * barchasini Savdo dinamikasi boʻlimida koʻrmoqchiman» — and on 2026-09-09
 * the client asked for the rest of the page to be built on them:
 * «eng muhim malumotlar fakt 1 va fakt 2 ustiga quriladi». So the two money
 * figures are no longer a band in the middle of the page: `FaktHeadline`
 * renders them INSIDE the page's one hero, above the chart that already
 * plots them, and what stays here is everything else the same cohort knows —
 * where the rest of FAKT 1 went and which team is carrying the month.
 *
 * THE BONUS LADDER USED TO CLOSE THIS SECTION and does not any more: the
 * client took it off on 2026-09-10 («shu joy umuman kerak emas menga, shu
 * joyni olib tashla»). It was the one block here that was a POLICY rather
 * than a measurement — three rungs, a payout per rung, and the seller nearest
 * each. `totals.bonusPayable` survives as one tile on the band, because what
 * the policy is currently paying is a fact about this cohort; the rungs
 * themselves live in the client's own rules, not on this screen.
 *
 * ONE REQUEST, TWO CALL SITES. `useFaktBoard` is the only place this screen
 * asks for the board, and both the hero and this section call it: TanStack
 * serves one fetch from one cache entry under one key, so the hero figure and
 * the tiles under it cannot disagree, and the page does not pay twice.
 *
 * ONE CLOCK ON THE PAGE NOW, AND THE NOTE STILL NAMES IT. Until 2026-09-10
 * the hero printed closed revenue on the CLOSE date beside these figures on
 * the order's arrival in the confirmation queue (C4:NEW) — two clocks that
 * differ by a wide margin in any month (3.89 bn of intake against 0.98 bn
 * delivered in one July). The revenue is gone, so nothing on this screen
 * disagrees with anything else on it; the basis is still stated because the
 * television board and the portal both count differently, and a reader
 * reconciling against either needs to know which date this is.
 */

/**
 * The board, fetched once for the whole page.
 *
 * `basis: 'queue'` is written out although it is the server's default, because
 * this hook's answer is only FAKT 1 / FAKT 2 while it holds — see the guard on
 * `data.basis` in `FaktHeadline`.
 */
export function useFaktBoard() {
  const { apiParams, filters } = useDashboardFilters()

  /*
    The board honours the employee, department and SOURCE filters
    (`sellerBoardService.boardFilters`) and drops the other two: an order has
    no product until it is itemised, and the queue cohort has no stage of its
    own. Said on the section rather than silently served — with a product
    filter active the hero's revenue area shrinks and these figures do not,
    and that is not a bug the reader should have to diagnose. Named exactly:
    this line once listed «manba» as ignored while the SQL was applying it,
    which told a manager reconciling a per-source total that the tile was
    unfiltered.
  */
  const ignoresFilters = filters.productIds.length > 0 || filters.stageIds.length > 0

  const params = useMemo(() => ({ ...apiParams, basis: 'queue' as const }), [apiParams])

  const query = useQuery({
    queryKey: ['sellers', 'board', params],
    queryFn: ({ signal }) => apiGet<SellerBoardDto>('/analytics/sellers', params, signal),
    placeholderData: (previous) => previous,
  })

  return {
    query,
    data: query.data?.data,
    status: query.isPending ? ('loading' as const) : query.isError ? ('error' as const) : ('ready' as const),
    ignoresFilters,
  }
}

/**
 * FAKT 1 and FAKT 2 as the page's headline pair — two grid items, for the
 * hero card's own row.
 *
 * THEY ARE PEERS ON ONE ROW, NEVER A WHOLE AND ITS PART. On the queue basis
 * FAKT 2 is not a subset of FAKT 1: an order shipped Тасдиқланмай чиқди was
 * never confirmed, and one refused in the queue and revived afterwards
 * delivers real money into FAKT 2 while never entering FAKT 1. The two cross
 * over (57.6 mln confirmed beside 58.8 mln delivered is a state this board
 * reaches), so nothing here stacks them, nests them or subtracts one from the
 * other — the same rule the chart below already follows.
 *
 * A ZERO FAKT 2 IS A DATE, NOT A FAULT — so the figure says which. FAKT 2
 * asks where the cohort stands NOW and the cohort is dated by its arrival in
 * C4:NEW; nothing lands for about two days, and the window opens on «Bugun».
 * Measured 2026-09-04 by arrival day: 04-sen 79 confirmed / 0 delivered,
 * 03-sen 94 / 0, 02-sen 80 / 20, 31-avg 99 / 73. The sub-line names the road;
 * the trend goes with it, because zero against zero explains nothing. Keyed
 * on `wonOrders`, not on the money: an order delivered for nothing is still a
 * delivery.
 *
 * Exported for `tests/features/confirmationFakt.test.tsx`, which pins those
 * three readings — young window, empty window, delivered window. They were
 * written against the tile these figures replace and moved with the
 * behaviour, because the behaviour is what they are about.
 */
export function FaktHeadline({
  data,
  status,
}: {
  data: SellerBoardDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  const totals = data?.totals

  /*
    THE NAMES ARE GUARDED ON THE PAYLOAD'S OWN DECLARATION.

    `/analytics/sellers` also answers `?basis=intake` — the same shapes over a
    cohort dated by Дата создания and credited to the assignee — and it is
    kept reachable as the oracle the queue reading is checked against. The
    words FAKT 1 and FAKT 2 mean nothing over that cohort, so they are printed
    only while the server says which one it sent. The field exists for exactly
    this: «stated in the payload so the screen cannot forget to print it».
  */
  const isQueue = !data || data.basis === 'confirmation_queue'

  return (
    <>
      <FaktFigure
        label={isQueue ? 'FAKT 1 · tasdiqlangan' : 'Olingan buyurtmalar'}
        value={totals ? totals.ordered.amount : null}
        status={status}
        /*
          BOTH COUNTS, because two screens print both and neither used to say
          so. `orders` is the part that left the queue as an order —
          Тасдиқланди plus Тасдиқланмай чиқди, exactly what FAKT 1's money is
          made of — while `cohortOrders` is every order that reached the queue
          in this window, the number Tasdiqlash navbati shows. August: 2 874
          against 3 228, two true figures 354 apart with nothing to reconcile
          them.
        */
        hint={
          totals
            ? totals.cohortOrders > totals.orders
              ? `${formatNumber(totals.orders)} ta navbatdan chiqdi · navbatda jami ${formatNumber(totals.cohortOrders)} ta`
              : `${formatNumber(totals.orders)} ta buyurtma`
            : undefined
        }
      />
      <FaktFigure
        label={isQueue ? 'FAKT 2 · yetkazilgan' : 'Yakunlangan buyurtmalar'}
        value={totals ? totals.won.amount : null}
        status={status}
        hint={
          totals
            ? totals.wonOrders > 0
              ? `${formatNumber(totals.wonOrders)} ta yakunlangan buyurtma`
              : totals.open.amount > 0
                ? `hali yetkazilmagan — ${formatFullUzs(totals.open.amount)} soʻm yoʻlda`
                : 'bu davrda yetkazilgan buyurtma yoʻq'
            : undefined
        }
        context={
          totals && totals.wonOrders > 0 ? <TrendIndicator delta={totals.wonDelta} /> : undefined
        }
      />
    </>
  )
}

/**
 * Everything about the confirmation cohort that is NOT the headline pair.
 *
 * The section reads as one descent — the company (the band), then the teams
 * (the table), then the sellers closest to a rung (the ladder) — which is the
 * order a floor manager narrows in.
 */
export function ConfirmationFaktSection() {
  const { query, data, status, ignoresFilters } = useFaktBoard()

  return (
    <section
      aria-labelledby="fakt-heading"
      className="space-y-3"
      style={{
        opacity: query.isPlaceholderData ? 0.6 : 1,
        transition: 'opacity 150ms var(--ease-out)',
      }}
      aria-busy={query.isPlaceholderData || undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="fakt-heading" className="eyebrow">
          Tasdiqlash navbati · FAKT 1 / FAKT 2
        </h2>
        {/*
          THREE CLAUSES, AND TWO OF THEM WERE NEVER ON THE PAGE.

          The clock was always named. The other two differences between this
          section and every other block on the screen were not, and both are
          bigger than a date:

          WHOSE MONEY. `/analytics/sellers` passes `ctx.query` and never
          `ctx.scope`, and `boardFilters` drops `restrictToEmployeeIds` a
          second time — the client asked for the sellers' figures to be the
          same for everybody on 2026-09-08. Every other endpoint on this page
          spreads `ctx.scope` last. So on a ROP's screen the revenue, the
          tiles and the sources table are their unit's and this section is the
          firm's, and until now the screen said nothing. (The docblock here
          used to claim the opposite — that the route narrowed to the reader's
          own unit via a `data.scoped` field. There is no such field on
          `SellerBoardDto`, and the claim has been false since that decision.)

          WHOSE ORDER. Every figure in this section credits
          COALESCE(operatorEmployeeId, employeeId) — the portal's «Фамилия имя
          ответсвенный» snapshot — while every closedAt figure on the page
          credits the assignee. They are different people often enough to move
          a board: 556 July orders sat on the head of Операцион at 4.2x the
          client's own leader.
        */}
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {QUEUE_BASIS} · butun kompaniya boʻyicha · buyurtma operator boʻyicha hisoblanadi
          {ignoresFilters && ' · mahsulot va bosqich filtrlarisiz'}
        </p>
      </div>

      {status === 'error' ? (
        <ErrorState
          message={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <QueueBand data={data} status={status} />
      )}

      <FaktBasisNote />

      <TeamsTable data={data} status={status} />
    </section>
  )
}

// ---------------------------------------------------------------------------

/**
 * WHERE THE REST OF FAKT 1 WENT — the four facts a manager owes an answer to
 * the moment they have read the headline pair, and none of them was on the
 * page.
 *
 * A floor manager reads FAKT 1 and immediately asks three things: what is
 * still moving, what died after we had already confirmed it, and why the
 * Тасдиқлаш navbati page counts 811 where this counts 669. Every one of those
 * numbers was already riding in this payload and being rendered nowhere.
 *
 * NO «SHUNDAN», NO STACK, NO SUBTRACTION. «Yoʻlda» and «bekor» are both
 * measured columns of the same SQL as FAKT 1, not remainders of it — the
 * arithmetic `FAKT 1 − FAKT 2 − yoʻlda` looks like it would give the last of
 * them and does not, because FAKT 2 is not a subset of FAKT 1 and borrows
 * from the difference every time an order is refused, revived and delivered.
 *
 * Exported for `tests/features/faktQueueBand.test.tsx`.
 */
export function QueueBand({
  data,
  status,
}: {
  data: SellerBoardDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  const totals = data?.totals

  /*
    The denominator the rate was actually computed from — won plus lost, the
    resolved pool. It is a total now rather than a reduction over `rows`: the
    page needed three of these the moment this band existed, and a figure
    summed on the client from an array the server also summarises is a place
    where the two can disagree.
  */
  const resolved = totals ? totals.wonOrders + totals.lostOrders : null

  /*
    THE 142 ORDERS THAT NEVER LEFT THE QUEUE AS AN ORDER, and the partition
    that explains them.

    `cohortOrders − orders` is the one subtraction on this band that IS
    licensed: both counts are over the same five-state partition of one
    cohort, so the difference is exactly «refused» plus «still waiting or not
    picking up». The refusals are the loss pool minus the ones that died after
    confirmation — those are inside FAKT 1, not outside it.
  */
  const outsideFakt1 = totals ? totals.cohortOrders - totals.orders : null
  const rejected = totals ? totals.lostOrders - totals.lostAfterConfirmOrders : null
  const undecided =
    outsideFakt1 !== null && rejected !== null ? Math.max(0, outsideFakt1 - rejected) : null

  return (
    <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
      <StatTile
        label="Yoʻlda — FAKT 1 dan hali yetkazilmagan"
        value={totals ? totals.open.amount : null}
        unit="money"
        money="full"
        status={status}
        hint={
          totals
            ? `${formatNumber(totals.openOrders)} ta buyurtma yoʻlda — tasdiqlangan, hali yetkazilmagan`
            : undefined
        }
      />
      {/*
        A DIFFERENT LOSS FROM A REFUSAL AT THE DOOR, and it used to hide
        inside «yoʻlda»: 102 orders and 176 230 000 soʻm in one July were
        counted as live work a seller was carrying, when the customer had
        already cancelled. The money is measured, not derived — see the band's
        own docblock.
      */}
      <StatTile
        label="Tasdiqlangandan keyin bekor"
        value={totals ? totals.lostAfterConfirm.amount : null}
        unit="money"
        money="full"
        status={status}
        tone={totals && totals.lostAfterConfirmOrders > 0 ? 'warning' : 'neutral'}
        hint={
          totals
            ? `${formatNumber(totals.lostAfterConfirmOrders)} ta buyurtma navbatdan chiqqach bekor boʻldi`
            : undefined
        }
      />
      <StatTile
        label="FAKT 1 ga kirmagan buyurtmalar"
        value={outsideFakt1}
        unit="count"
        status={status}
        hint={
          rejected !== null && undecided !== null
            ? `${formatNumber(rejected)} ta rad etildi · ${formatNumber(undecided)} ta hali navbatda yoki koʻtarmadi`
            : undefined
        }
      />
      {/* The one headline rate takes the gauge, in the neutral hue: a sales
          conversion is a magnitude here, not a judgement against the house
          delivery thresholds. Named «Yetkazish konversiyasi» because the
          closedAt band further down the page prints a different rate under
          the same bare word — 97.4% against 72.4%, both true. */}
      <GaugeTile
        label="Yetkazish konversiyasi"
        value={totals?.conversionPercent ?? null}
        tone="neutral"
        status={status}
        hint="hal boʻlgan buyurtmalardan — ochiqlari hisobga olinmaydi"
        context={
          totals && resolved !== null && resolved > 0 ? (
            <p className="tabular text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
              {formatNumber(totals.wonOrders)} / {formatNumber(resolved)} ta
            </p>
          ) : undefined
        }
      />
      {/*
        THE RUN-RATE, AND IT IS OF THE MONTH RATHER THAN OF THE WINDOW.

        `forecastOf` measured its elapsed fraction against the report window
        until 2026-09-09, and a to-date preset is by construction almost
        entirely elapsed — «Shu oy» on the 9th read 94.4% and projected FAKT 2
        forward by six percent. It now measures against `fullUnitWindow`, the
        same call the revenue forecast has always used, so the two forecasts
        on this page finally answer the same question about the same month.
        Null on a finished period, where a total is not a forecast.
      */}
      <StatTile
        label="FAKT 2 · oy yakuni prognozi"
        /*
          NOTHING TO PROJECT FROM UNTIL SOMETHING HAS LANDED.

          A straight line through zero is zero, and on this measure zero is a
          DATE rather than a result: delivery lags the cohort's own arrival by
          about two days, so «Bugun» and the first morning of a month are
          legitimately empty. Printed, «0 soʻm — shu surʼatda davom etsa» is
          the page telling a floor that is working normally that the month
          ends at nothing. The same `wonOrders` guard the FAKT 2 figure uses
          for its trend indicator, for the same reason.
        */
        value={
          totals && totals.wonOrders > 0 ? (data?.forecast.projected?.amount ?? null) : null
        }
        unit="money"
        money="full"
        status={status}
        hint={
          totals && data
            ? totals.wonOrders === 0
              ? 'hali yetkazilgan buyurtma yoʻq — prognoz uchun erta'
              : data.forecast.projected
                ? `Oyning ${formatPercent(data.forecast.elapsedPercent, 0)} qismi oʻtdi — shu surʼatda davom etsa`
                : 'davr yakunlangan — bu allaqachon natija'
            : undefined
        }
      />
      {/* The one figure on this band that is a POLICY rather than a
          measurement, so it names its own source in the hint. */}
      <StatTile
        label="Bonus jamgʻarmasi"
        value={totals ? totals.bonusPayable.amount : null}
        unit="money"
        money="full"
        status={status}
        hint={
          totals ? `${formatNumber(totals.sellersInBonus)} ta sotuvchi darajani oldi` : undefined
        }
      />
    </div>
  )
}

/**
 * WHICH TEAM IS CARRYING THE MONTH — thirteen rows this page has been
 * fetching and throwing away.
 *
 * `data.teams` rides in every answer this section already receives. With 86
 * sellers across 13 teams the company total answers nothing a manager can act
 * on and the per-seller ladder is too fine to plan from; the ROP's floor is
 * the unit they actually move. The spread is the point: measured live on
 * 2026-09-09, delivery conversion ran from 56.3% to 92.5% across teams whose
 * FAKT 1 was within a third of each other.
 *
 * IN THE SERVER'S OWN ORDER, never re-sorted here. `teamRows` ranks on FAKT 2,
 * then FAKT 1, then the ROP's name — the same rule the television board's
 * podium uses. A second ordering on this page would seat one champion here
 * and another there, for one month, in one company.
 *
 * TWO MONEY COLUMNS SIDE BY SIDE, never a share of one another: FAKT 2 is not
 * part of FAKT 1. «FAKT 2 ulushi» IS a share, and of the company's FAKT 2 —
 * which is what `sharePercent` measures.
 */
function TeamsTable({
  data,
  status,
}: {
  data: SellerBoardDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  const columns: readonly Column<SellerTeamRowDto>[] = [
    {
      key: 'rank',
      header: 'Oʻrin',
      width: '64px',
      render: (row) => <RankBadge rank={row.rank} />,
    },
    { key: 'rop', header: 'ROP', rowHeader: true, render: (row) => row.rop },
    {
      key: 'sellers',
      header: 'Sotuvchi',
      align: 'right',
      numeric: true,
      render: (row) => formatNumber(row.sellers),
    },
    {
      key: 'fakt1',
      header: 'FAKT 1',
      align: 'right',
      numeric: true,
      render: (row) => formatFullUzs(row.ordered.amount),
    },
    {
      key: 'orders',
      header: 'Tasdiqlangan',
      align: 'right',
      numeric: true,
      render: (row) => `${formatNumber(row.orders)} ta`,
    },
    {
      key: 'fakt2',
      header: 'FAKT 2',
      align: 'right',
      numeric: true,
      render: (row) => formatFullUzs(row.won.amount),
    },
    {
      key: 'wonOrders',
      header: 'Yetkazilgan',
      align: 'right',
      numeric: true,
      render: (row) => `${formatNumber(row.wonOrders)} ta`,
    },
    {
      key: 'open',
      header: 'Yoʻlda',
      align: 'right',
      numeric: true,
      render: (row) => formatFullUzs(row.open.amount),
    },
    {
      key: 'conversion',
      header: 'Konversiya',
      align: 'right',
      numeric: true,
      /* Null prints an em dash and never a zero: a team with nothing resolved
         has no conversion, which is not the same as a conversion of none. */
      render: (row) =>
        row.conversionPercent === null ? NO_VALUE : formatPercent(row.conversionPercent),
    },
    {
      key: 'share',
      header: 'FAKT 2 ulushi',
      align: 'right',
      numeric: true,
      render: (row) =>
        row.sharePercent === null ? NO_VALUE : formatPercent(row.sharePercent),
    },
  ]

  const teams = data?.teams ?? []
  const teamless = data?.totals.teamlessSellers ?? 0

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
        Jamoalar boʻyicha · FAKT 1 / FAKT 2
      </h3>
      <DataTable
        columns={columns}
        rows={teams}
        rowKey={(row) => row.rop}
        status={status}
        emptyTitle="Bu davrda jamoa boʻyicha maʼlumot yoʻq"
        /*
          Two full-digit money columns and eight more beside them; below this
          the table scrolls sideways inside its own box rather than crushing
          the digits.
        */
        minWidth={1040}
        /*
          NO VERTICAL CAP. `DataTable` defaults to 60dvh, and a ranked list
          whose whole question is «kim orqada» would answer it inside a scroll
          box with the last teams below the fold. Thirteen rows is the whole
          company.
        */
        maxHeight="none"
      />
      {/*
        A RECONCILIATION, NOT A CAVEAT. `teamRows` drops every seller whose
        `rop` is null, so these columns cannot add up to the figures in the
        hero — and a reader who adds them and finds a gap has found a real
        one. Six sellers and 40.9 mln of intake once sat outside every row on
        a screen that offered no explanation.
      */}
      {teamless > 0 && (
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {formatNumber(teamless)} ta sotuvchi hech qaysi ROP jamoasida emas — ular yuqoridagi
          jamlarda bor, bu jadvalda yoʻq.
        </p>
      )}
    </div>
  )
}

