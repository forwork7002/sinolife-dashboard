'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { ErrorState } from '@/components/states/States'
import { GaugeTile, StatTile } from '@/components/ui/Stat'
import { TrendIndicator } from '@/components/ui/TrendIndicator'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { type SellerBoardDto, type SellerBoardRowDto, apiGet } from '@/lib/api'
import { formatFullUzs, formatNumber } from '@/lib/format'

/**
 * FAKT 1 / FAKT 2 on Savdo dinamikasi — the floor's own vocabulary, read by
 * the manager.
 *
 * These four tiles, the sentence under them and the bonus ladder used to sit
 * on Sotuvchilar reytingi. They moved here on 2026-09-07 when the client
 * made that screen the television board — «FAKT 1 va FAKT 2 maʼlumotlarini
 * barchasini Savdo dinamikasi boʻlimida koʻrmoqchiman» — and what moved is
 * the analytical half: the totals a manager reconciles against the Тасдиклаш
 * kanban and the bot's Telegram channel, the conversion the floor is judged
 * on, the bonus fund the policy pays, and the ladder that pays it. The
 * ranking itself stays on the board. The one place this section names a
 * seller is the ladder's «Eng yaqini» — who is about to reach a rung — and
 * it reads the same per-seller rows the board does, which is why the route
 * serves the whole board to this screen rather than a totals-only shape.
 *
 * SAME ENDPOINT, SAME KEY. It reads `/analytics/sellers` on the queue basis
 * under the same query key the board uses, so a reader with both screens
 * open is served one answer for one window, and the totals here cannot
 * disagree with the seats over there.
 *
 * A DIFFERENT CLOCK FROM EVERY OTHER NUMBER ON THIS PAGE, and the eyebrow
 * says so. The hero above is revenue on the CLOSE date; these figures are
 * dated by the order's arrival in the confirmation queue (C4:NEW). The two
 * differ by a wide margin in any month (3.89 bn of intake against 0.98 bn
 * delivered in one July), and a reader who does not see the basis named
 * concludes one of them is broken.
 */
export function ConfirmationFaktSection() {
  const { apiParams, filters } = useDashboardFilters()

  /*
    The board honours the employee, department and SOURCE filters
    (`sellerBoardService.boardFilters`) and drops the other two: an order has
    no product until it is itemised, and the queue cohort has no stage of its
    own. Said on the section rather than silently served — with a product
    filter active the hero above shrinks and these tiles do not, and that is
    not a bug the reader should have to diagnose. Named exactly: this line
    once listed «manba» as ignored while the SQL was applying it, which told
    a manager reconciling a per-source total that the tile was unfiltered.
  */
  const ignoresFilters = filters.productIds.length > 0 || filters.stageIds.length > 0

  const params = useMemo(() => ({ ...apiParams, basis: 'queue' as const }), [apiParams])

  const board = useQuery({
    queryKey: ['sellers', 'board', params],
    queryFn: ({ signal }) => apiGet<SellerBoardDto>('/analytics/sellers', params, signal),
    placeholderData: (previous) => previous,
  })

  const data = board.data?.data
  const status = board.isPending ? 'loading' : board.isError ? 'error' : 'ready'

  return (
    <section
      aria-labelledby="fakt-heading"
      className="space-y-3"
      style={{
        opacity: board.isPlaceholderData ? 0.6 : 1,
        transition: 'opacity 150ms var(--ease-out)',
      }}
      aria-busy={board.isPlaceholderData || undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="fakt-heading" className="eyebrow">
          Tasdiqlash navbati · FAKT 1 / FAKT 2
        </h2>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Navbatga tushgan sana (C4:NEW) boʻyicha — Sotuvchilar reytingi bilan bir manba
          {ignoresFilters && ' · mahsulot va bosqich filtrlarisiz'}
          {/*
            WHOSE MONEY THIS IS. The route narrows a ROP or a salesperson to
            their own unit (`data.scoped`), so on their screen the bonus fund
            and both FAKTs are the unit's, not the firm's — said here the way
            the board says it, or «Bonus jamgʻarmasi» reads as the company's.
          */}
        </p>
      </div>

      {status === 'error' ? (
        <ErrorState
          message={(board.error as Error | null)?.message}
          onRetry={() => void board.refetch()}
        />
      ) : (
        <TotalsBand data={data} status={status} />
      )}

      <FaktBasisNote />

      <BonusLadder data={data} status={status} />
    </section>
  )
}

// ---------------------------------------------------------------------------

/** Exported for `tests/features/confirmationFakt.test.tsx`. */
export function TotalsBand({
  data,
  status,
}: {
  data: SellerBoardDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  const totals = data?.totals
  /*
    The denominator the rate was actually computed from. The totals DTO does
    not carry a lost count, so the resolved pool — won plus lost — is reduced
    from the rows; a rate that cannot state its fraction has no business on a
    tile.
  */
  const resolved = data
    ? data.rows.reduce((sum, r) => sum + r.wonOrders + r.lostOrders, 0)
    : null

  return (
    <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <StatTile
        label="FAKT 1 · tasdiqlangan"
        value={totals ? totals.ordered.amount : null}
        unit="money"
        /*
          THE SUM, TO THE LAST DIGIT. The floor does not scan these two tiles,
          it reconciles them: against the Тасдиқлаш kanban, against the bot's
          own Telegram totals, against the client's published page. «106 mln»
          cannot be compared with «106 432 000» without opening a tooltip,
          and this is where that comparison is the whole point. `money="full"`
          carries the format, the size and the dropped tooltip together.
        */
        money="full"
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
      {/*
        «FAKT 2», NOT «shundan yutilgani» — on the queue basis FAKT 2 is not a
        subset of FAKT 1: an order shipped Тасдиқланмай чиқди was never
        confirmed, so it is outside FAKT 1 and still delivers real money into
        FAKT 2. The tiles cross over (57.6 mln confirmed beside 58.8 mln
        delivered is a state this board reaches), and «of which» above the
        larger number read as a broken page.

        A ZERO HERE IS A DATE, NOT A FAULT — so the tile says which. FAKT 2
        asks where the cohort stands NOW and the cohort is dated by its
        arrival in C4:NEW; nothing lands for about two days, and the window
        opens on «Bugun». Measured 2026-09-04 by arrival day: 04-sen 79
        confirmed / 0 delivered, 03-sen 94 / 0, 02-sen 80 / 20, 31-avg 99 / 73.
        The hint names the road; the trend goes with it, because zero against
        zero explains nothing. Keyed on `wonOrders`, not the money: an order
        delivered for nothing is still a delivery.
      */}
      <StatTile
        label="FAKT 2 · yetkazilgan"
        value={totals ? totals.won.amount : null}
        unit="money"
        money="full"
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
      {/* The one headline rate takes the gauge, in the neutral hue: a sales
          conversion is a magnitude here, not a judgement against the house
          delivery thresholds. */}
      <GaugeTile
        label="Konversiya"
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
      {/* The one figure on this band that is a POLICY rather than a
          measurement, so it names its own source in the hint. */}
      <StatTile
        label="Bonus jamgʻarmasi"
        value={totals ? totals.bonusPayable.amount : null}
        unit="money"
        money="full"
        status={status}
        hint={
          totals
            ? `${formatNumber(totals.sellersInBonus)} ta sotuvchi darajani oldi`
            : undefined
        }
      />
    </div>
  )
}

/**
 * The basis, stated once. It is the single fact that stops this section and
 * the revenue hero above it — and this section and the television board —
 * from looking like a bug when their totals differ.
 */
function FaktBasisNote() {
  const em = { color: 'var(--ink-secondary)' } as const
  return (
    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
      Bu boʻlimdagi raqamlar <strong style={em}>tasdiqlash navbatiga tushgan sana</strong> (C4:NEW)
      boʻyicha — yuqoridagi tushum esa yopilgan sana boʻyicha, shuning uchun jamlar bir xil
      boʻlmaydi.{' '}
      <strong style={em}>FAKT 1</strong> — <strong style={em}>Тасдиқланди</strong> va{' '}
      <strong style={em}>Тасдиқланмай чиқди</strong>: navbatdan chiqib Доставка ga oʻtgan
      buyurtmalar puli — mijozga yetib tasdiqlanganlari ham, mijozga yetib boʻlmay, lekin baribir
      joʻnatilganlari ham. <strong style={em}>FAKT 2</strong> —{' '}
      <strong style={em}>Доставланди</strong>: yetkazib berilganlari.{' '}
      {/*
        THE TWO ARE SIBLINGS, NOT A WHOLE AND ITS PART, and this sentence is
        the one that has to say so: an order refused in the queue and revived
        afterwards is in FAKT 2 and never in FAKT 1.
      */}
      FAKT 2 — FAKT 1 ning bir qismi emas: navbatda rad etilgan buyurtma keyin tiklanib
      yetkazilsa FAKT 2 ga tushadi-yu, FAKT 1 ga kirmaydi, shuning uchun FAKT 2 baʼzan FAKT 1
      dan katta boʻlishi mumkin. Iyul oyida joʻnatilib avgustda yetkazilgan buyurtma FAKT 2 ga
      avgustda emas, iyulning oʻzida qoʻshiladi — sana buyurtma navbatga TUSHGAN kunni bildiradi,
      YETKAZILGAN kunni emas. Rad etilgan (Тасдиқланмади), hali navbatda turgan va koʻtarmagan
      buyurtmalar FAKT 1 ga kirmaydi.
    </p>
  )
}

/**
 * The ladder itself, printed once so the rule is on the page rather than in
 * somebody's memory — and attributed, because it is the client's policy and
 * not a figure this application measured.
 *
 * ASCENDING, left to right: read upward a ladder is a climb, and the next
 * rung is always the one to the right of where you stand. Each rung wears a
 * rail from the sequential ramp — the MAGNITUDE of its own floor, which is
 * the licensed ordinal encoding — and names the seller closest to reaching
 * it, because "Aziza is 2 mln away from the next rung" is a sentence a floor
 * repeats to itself all afternoon.
 */
export function BonusLadder({
  data,
  status,
}: {
  data: SellerBoardDto | undefined
  status: 'loading' | 'error' | 'ready'
}) {
  const tiers = [
    { floor: 45_000_000, bonus: 1_000_000, rail: 'var(--seq-250)', glyph: '🎯' },
    { floor: 60_000_000, bonus: 1_500_000, rail: 'var(--seq-450)', glyph: '🚀' },
    { floor: 70_000_000, bonus: 2_000_000, rail: 'var(--seq-650)', glyph: '💎' },
  ]

  const ready = status === 'ready' && data

  /*
    ONLY THE PEOPLE THE LADDER PAYS. Every count and every «eng yaqini» on
    these three cards is drawn from the 107–147 band, because the ladder is.
    Counting the whole board would say "nine sellers reached 70 mln" over a
    policy that pays four of them.
  */
  const payable = ready ? data.rows.filter((r) => r.bonus.eligible) : []

  const reached = (floor: number) =>
    ready ? payable.filter((r) => r.won.amount >= floor).length : null

  /** The highest-won seller still below this rung — the one about to arrive. */
  const nearest = (floor: number) => {
    if (!ready) return null
    let best: SellerBoardRowDto | null = null
    for (const r of payable) {
      if (r.won.amount > 0 && r.won.amount < floor && (!best || r.won.amount > best.won.amount)) {
        best = r
      }
    }
    return best
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
          Bonus darajalari
        </h3>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Mijozning oʻz qoidasi — 107–147 raqamli sotuvchilar, yetkazilgan pul boʻyicha
        </p>
      </div>
      <div className="stagger grid gap-3 sm:grid-cols-3">
        {tiers.map((tier) => {
          const count = reached(tier.floor)
          const contender = nearest(tier.floor)
          return (
            <div key={tier.floor} className="card flex flex-col gap-1 overflow-hidden">
              <div className="h-[3px] w-full" style={{ background: tier.rail }} aria-hidden="true" />
              <div className="flex flex-col gap-1 px-4 pt-2.5 pb-3.5">
                <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
                  <span aria-hidden="true" className="mr-1.5">
                    {tier.glyph}
                  </span>
                  {formatFullUzs(tier.floor)} soʻmdan
                </p>
                {/*
                  Plain text, NOT AnimatedNumber: a tier is a POLICY CONSTANT
                  with nothing to count up to — and this is the one number on
                  the page the server renders, where a per-engine formatter
                  once gave Node and the browser different separators and
                  broke hydration.
                */}
                <p className="figure text-[22px] leading-none font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  {formatFullUzs(tier.bonus)}
                  <span className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                    soʻm bonus
                  </span>
                </p>
                <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {count === null
                    ? '…'
                    : count === 0
                      ? 'Bu davrda hech kim yetmadi'
                      : `${formatNumber(count)} ta sotuvchi yetdi`}
                </p>
                {contender && (
                  <p className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                    Eng yaqini: {contender.fullName} —{' '}
                    <span className="tabular font-medium" style={{ color: 'var(--ink-primary)' }}>
                      +{formatFullUzs(tier.floor - contender.won.amount)}
                    </span>{' '}
                    kerak
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        Daraja bir marta toʻlanadi — eng yuqori bosib oʻtilgan chegara boʻyicha, qoʻshilmaydi.
        {ready && (
          <>
            {' '}
            Zinapoya faqat <strong style={{ color: 'var(--ink-secondary)' }}>107–147</strong> raqamli
            sotuvchilarga tegishli — bu davrda{' '}
            {formatNumber(data.totals.sellersEligibleForBonus)} tasi shu doirada,{' '}
            {formatNumber(data.totals.sellers - data.totals.sellersEligibleForBonus)} tasi esa emas.
          </>
        )}
      </p>
    </div>
  )
}
