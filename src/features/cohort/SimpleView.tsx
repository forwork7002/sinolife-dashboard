'use client'

import { type AveragableCohortRow } from '@/components/charts/Heatmap'
import { InfoTip } from '@/components/ui/Tooltip'
import { ArrivalBars } from '@/features/cohort/ArrivalBars'
import { ReturnAnswer } from '@/features/cohort/ReturnAnswer'
import { formatPercent, formatUzs } from '@/lib/format'

/**
 * The manager's reading of the cohort screen — three questions, in the order
 * they are asked out loud.
 *
 *   1. «Qancha yangi mijoz keladi?»  — ArrivalBars
 *   2. «Ular qaytadimi?»             — ReturnAnswer
 *   3. «Pul qayerdan keladi?»        — two sentences, below
 *
 * NOTHING HERE IS A SECOND QUESTION. Every figure on this view is already on
 * the `/insights/cohorts` response the matrix is drawn from, and the rows are
 * the GRID'S OWN rows, mapped once in `CohortPage` and handed to both
 * renderings. A parallel construction of them would be two views of one
 * payload free to disagree about the same customers — which is the one thing
 * the «Oddiy» / «Batafsil» toggle must never allow, and the reason it costs no
 * request.
 *
 * IT STATES ITS CLOCK, ONCE, AT THE BOTTOM. This screen prints two honest
 * customer totals that are not the same number: «har 100 ta yangi mijozdan…»
 * stands on every cohort there has ever been, while the bars above it are the
 * eighteen months the page asked for. Unlabelled, the smaller of the two reads
 * as broken — and the manager is the reader most likely to meet them side by
 * side and least equipped to reconcile them. The word that settles it is the
 * CLOCK: a customer joins the month their order was DELIVERED, which is the
 * same basis the matrix, the tiles and Logistika's Успешно column all use, and
 * is 20-25 days later than the day the order was taken.
 */

/**
 * Exactly what this view reads off a cohort row.
 *
 * `AveragableCohortRow` is the five fields `columnAverage` needs, plus the
 * cohort month the bars are drawn along. `CohortMatrixRow` satisfies it, which
 * is the point: the page maps ONCE and the same array reaches the grid, the
 * bars and the return curve.
 */
type SimpleCohortRow = AveragableCohortRow & { readonly cohort: string }

export interface SimpleViewData {
  readonly rows: readonly SimpleCohortRow[]
  readonly repeatCustomers: number
  readonly totalCustomers: number
  /** 0-100, or null when no revenue-bearing win is linked to a customer at all. */
  readonly repeatRevenueShare: number | null
  /**
   * The month the calendar ends on, from the server, in `APP_TIMEZONE`.
   * Never `new Date()` — see `CohortSummaryDto.currentMonth`.
   */
  readonly currentMonth: string
  /** Whole-history revenue per customer. Major units, for display only. */
  readonly revenuePerCustomerAll: { readonly amount: number }
}

export function SimpleView({ data }: { readonly data: SimpleViewData }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="card px-4 py-3.5">
        <ArrivalBars rows={data.rows} currentMonth={data.currentMonth} />
      </div>

      <div className="card px-4 py-3.5">
        <ReturnAnswer
          data={{
            repeatCustomers: data.repeatCustomers,
            totalCustomers: data.totalCustomers,
            rows: data.rows,
          }}
        />
      </div>

      <div className="card px-4 py-3.5">
        <MoneyAnswer
          repeatRevenueShare={data.repeatRevenueShare}
          revenuePerCustomerAll={data.revenuePerCustomerAll}
        />
      </div>

      {/*
        THE CLOCK, IN WORDS, ON THE SCREEN — not only in a tooltip.

        A tooltip is read by whoever suspects there is something to read. The
        two customer totals above are read by everybody, and their difference
        is the kind of thing that gets reported as a defect before anybody
        hovers anything.
      */}
      <p className="px-1 text-[11px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
        Barcha raqamlar yetkazilgan sana boʻyicha hisoblanadi — mijoz buyurtmasi yetkazilgan
        oyda hisobga olinadi, buyurtma qabul qilingan kuni emas.
      </p>
    </div>
  )
}

/**
 * «Pul qayerdan keladi?» — two sentences, and neither of them is a gauge.
 *
 * The repeat share used to be one ring among four tiles, where it was a
 * magnitude with no subject. It has a subject: it says how much of the
 * company's money is made after the customer was already won, which is the
 * number that decides whether keeping customers is worth paying for. Written
 * out, it needs no legend.
 *
 * «HOZIRGACHA» IS LOAD-BEARING, and it is the only defence this sentence has.
 * Whole-history revenue over whole-history customers is an honest number and a
 * dangerous label: read as a settled lifetime value it invites «so we can
 * spend up to this much to win one», when every customer counted in it is
 * still free to buy again tomorrow. The figure is money TO DATE — the same
 * caveat the matrix's own «1 mijozga hozirgacha» heading carries, said the
 * same way, because it is the same arithmetic one row wider.
 */
function MoneyAnswer({
  repeatRevenueShare,
  revenuePerCustomerAll,
}: {
  readonly repeatRevenueShare: number | null
  readonly revenuePerCustomerAll: { readonly amount: number }
}) {
  return (
    <section>
      <h3 className="flex items-center gap-1 text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        Pul qayerdan keladi?{' '}
        <InfoTip
          label="Izoh: pul"
          content={
            <span className="block max-w-[280px]">
              Ikkala raqam ham butun tarix boʻyicha. Birinchisi — birinchi xariddan keyingi
              savdolarning jami tushumdagi ulushi. Ikkinchisi — shu jami tushumning barcha
              mijozlarga boʻlingani; biznes davom etayotgani uchun bu «hozirgacha» yigʻilgan
              pul, yakuniy raqam emas.
            </span>
          }
        />
      </h3>

      <div className="mt-2 space-y-1.5">
        {repeatRevenueShare === null ? (
          /* Null is «nothing was measured», never 0% — see
             `CohortSummaryDto.repeatRevenueShare`. A 0 here would claim that
             nobody in the company's history has ever bought twice. */
          <p className="text-sm leading-snug" style={{ color: 'var(--ink-secondary)' }}>
            Takroriy tushum ulushi oʻlchanmadi — yopilgan savdolar mijozga bogʻlanmagan
            boʻlishi mumkin.
          </p>
        ) : (
          <p className="text-sm leading-snug" style={{ color: 'var(--ink-primary)' }}>
            Tushumning{' '}
            <strong className="figure text-base font-semibold">
              {formatPercent(repeatRevenueShare)}
            </strong>{' '}
            i — mijozning birinchi emas, keyingi xaridlaridan.
          </p>
        )}

        <p className="text-sm leading-snug" style={{ color: 'var(--ink-primary)' }}>
          Bir mijoz <strong>hozirgacha</strong> oʻrtacha{' '}
          <strong className="figure text-base font-semibold">
            {formatUzs(revenuePerCustomerAll.amount)}
          </strong>{' '}
          olib kelgan.
        </p>
      </div>
    </section>
  )
}
