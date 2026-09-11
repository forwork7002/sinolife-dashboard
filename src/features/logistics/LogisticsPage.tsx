'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { CategoryBarList, type CategoryBarRow } from '@/components/charts/CategoryBarList'
import { StatusCompositionBar } from '@/components/charts/StatusCompositionBar'
import { ErrorState } from '@/components/states/States'
import { ChartCard } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/Controls'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Meter, RingGauge } from '@/components/ui/Stat'
import { Tooltip } from '@/components/ui/Tooltip'
import { DailySection } from '@/features/logistics/DailySection'
import { FaktBasisNote, FaktFigure } from '@/features/shared/faktVocabulary'
import { PageShell } from '@/features/shared/PageShell'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import {
  type LogisticsBucketDto,
  type LogisticsDto,
  type LogisticsPointDto,
  type LogisticsStageDto,
  type LogisticsWaitBandDto,
  apiGet,
} from '@/lib/api'
import { NO_VALUE, formatCompactUzs, formatFullUzs, formatNumber, formatPercent } from '@/lib/format'
import { LOGISTICS_BUCKETS, bucketColour, bucketLabel } from '@/lib/logisticsBuckets'
import { t } from '@/lib/messages'

/**
 * The client's own logistics report — their Google Sheet, on our data.
 *
 * WHAT THIS SCREEN IS. The floor runs delivery off a sheet exported from the
 * Доставка kanban: ЗАКАЗ, ТАСТИКЛАНГАН, не собран, В пути, Ожидание/нд, Отказ,
 * Успешно, %покрытия. Every one of those columns is here, under its own
 * Russian header, because the whole value of the page is that it reconciles
 * against the two screens they already read — obey.bitrix24.kz and that sheet.
 *
 * ONE CLOCK, AND IT IS THE ONE FAKT 1 AND FAKT 2 ARE ON. Everything here is
 * cohorted on the order's arrival in Тасдиклаш (C4:NEW), not on its creation
 * date, because that is the cohort the client's own numbers turned out to be
 * on: their ЗАКАЗ sits 98.6% on FAKT 1 and their Успешно 100.4% on FAKT 2,
 * against 88.3% for the creation cohort the old version of this screen used.
 * So ЗАКАЗ IS FAKT 1, Успешно IS FAKT 2, and %покрытия is one over the other —
 * which is why the client asked for both names to appear here too.
 *
 * THE SHEET SPECIFIED THE COLUMNS; BITRIX24 SUPPLIES THE NUMBERS.
 *
 * Settled with the client on 2026-09-11, in their words: «bitrix24dagi
 * malumot to'g'ri… google sheet ni ko'rsatganim sababi shu malumotlar
 * dashboardda bo'lishi mumkin… undagi malumotlarga tayanma». So the sheet is
 * read as a SPECIFICATION — these six columns, under these names — and never
 * as a second source of figures. Where the two differ, the portal wins and
 * nothing here needs changing.
 *
 * WHAT THE LAST BLOCK IS FOR. It prints every Доставка stage verbatim with
 * the column it feeds, and it is the only place a reader can check that the
 * six columns above really are the portal’s own stages grouped. That is an
 * audit trail, not a dispute: it is what makes every figure above it
 * checkable against obey.bitrix24.kz rather than trusted.
 *
 * FOUR OF THE FIVE CHARTS ARE HAND-DRAWN. Six columns and eight post offices
 * are fixed comparisons; a chart library for those is an axis nobody reads and
 * a hover that hides the numbers. Only the daily trend earns Recharts, and it
 * is loaded separately — see `DailySection`.
 */
export function LogisticsPage() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['logistics', apiParams],
    queryFn: ({ signal }) => apiGet<LogisticsDto>('/insights/logistics', apiParams, signal),
  })

  /**
   * ONE DERIVATION, so no block can disagree with its own page.
   *
   * The tables each rebuilt this ternary inline, which is one place per block
   * for a loading state to fall out of step with the hero above it.
   */
  const viewStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready'
  const errorMessage = (query.error as Error | null)?.message
  const retry = () => void query.refetch()

  const data = query.data?.data
  const summary = data?.summary
  const buckets = summary?.buckets ?? []

  /*
    The disclosure is COMPONENT state, not URL state.

    `/logistics` joins SHALLOW_ROUTES below so the period picker stops paying
    an RSC round trip, which is the write this page actually makes. The open
    table is a reading posture rather than a question — nobody sends anyone a
    link to a table that happens to be unfolded — and every key added to
    `useDashboardFilters` is paid for by the dozen components sharing it.
  */
  const [dailyOpen, setDailyOpen] = useState(false)

  /*
    WHICH «standing now» THE READER IS LOOKING AT.

    Both are true and neither is the whole answer. 'cohort' is the selected
    window and reconciles with everything above it; on «Shu oy» it finds 234
    parcels of which 20 are past seven days, because nothing ordered this
    month has had time to get stuck. 'all' drops the window and finds 888 —
    659 of them past seven days, worth a billion soʻm — including the ones
    that have been standing since before the window opened, which are exactly
    the ones worth a phone call. The default is the unbounded one for that
    reason; the switch is there because the windowed figure is the one that
    adds up with the rest of the page.
  */
  const [standingScope, setStandingScope] = useState<'all' | 'cohort'>('all')

  /*
    A post office with nothing standing at it is dropped from THIS table and
    kept in the one above, and the difference is what each table is for. The
    Pochtalar table answers «how does each office perform» and an office with
    no traffic is still an answer; this one is a work list, and a row reading
    zero is a line to skip past on the way to the ones that matter.
  */
  const standingRows = (
    standingScope === 'all' ? (data?.standing.all ?? []) : (data?.standing.cohort ?? [])
  ).filter((row) => row.waitingOrders > 0)

  const standingTotal = standingRows.reduce(
    (sum, row) => ({
      orders: sum.orders + row.waitingOrders,
      amount: sum.amount + row.waitingAmount.amount,
      agedOrders: sum.agedOrders + row.agedOrders,
      agedAmount: sum.agedAmount + row.agedAmount.amount,
    }),
    { orders: 0, amount: 0, agedOrders: 0, agedAmount: 0 },
  )

  return (
    <PageShell
      title={t.modules.logistics.title}
      description={t.modules.logistics.lead}
      accent="var(--series-3)"
      meta={query.data?.meta}
      stale={query.isPlaceholderData}
    >
      {/*
        THE LEAD INSTRUMENT — the page's one hero, and the only panel wearing
        the registration brackets.

        Three figures, and they are the three the floor argues about: what came
        out of the queue as an order, what a courier actually delivered, and
        the ratio between them. The two sums are printed to the last digit
        because this is where they are reconciled against Bitrix24, and the
        ring carries the rate with its own fraction beneath it — a rate without
        its denominator is an opinion.
      */}
      <section className="card-hero brackets reveal px-5 py-5 sm:px-6" aria-label="Qamrov">
        {query.isError ? (
          <ErrorState message={errorMessage ?? 'Olinmadi'} onRetry={retry} />
        ) : (
          <div className="grid items-center gap-5 sm:grid-cols-[1fr_1fr_auto]">
            <FaktFigure
              label={`${t.chart.fakt1} · ЗАКАЗ`}
              value={summary?.ordered.amount ?? null}
              hint={
                summary ? `${formatNumber(summary.orderedOrders)} ta buyurtma` : undefined
              }
              status={viewStatus}
            />
            <FaktFigure
              label={`${t.chart.fakt2} · Успешно`}
              value={summary?.won.amount ?? null}
              hint={summary ? `${formatNumber(summary.wonOrders)} ta buyurtma` : undefined}
              status={viewStatus}
            />

            <div className="flex items-center gap-4">
              <RingGauge
                value={summary?.coveragePercent ?? null}
                size={112}
                thickness={9}
                /*
                  NEUTRAL, NOT GRADED. On a young window — «bugun», the first
                  days of a month — nothing has been delivered yet and a
                  critical-red 0% would be reporting a failure where the
                  honest reading is a date. The caption below says so in words.
                */
                tone="neutral"
                label="Qamrov"
              />
              <div className="min-w-0">
                {viewStatus === 'loading' ? (
                  <div className="skeleton h-9 w-40" role="status">
                    <span className="sr-only">Yuklanmoqda</span>
                  </div>
                ) : summary && summary.wonOrders === 0 ? (
                  <p className="text-[11.5px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
                    Hali yetkazilgan buyurtma yoʻq — yetkazish odatda 1–2 kun keyin boshlanadi.
                  </p>
                ) : (
                  <>
                    <p
                      className="tabular text-[12px] leading-snug"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      {summary ? formatFullUzs(summary.won.amount) : NO_VALUE}
                      <span style={{ color: 'var(--ink-muted)' }}> / </span>
                      {summary ? formatFullUzs(summary.ordered.amount) : NO_VALUE}
                    </p>
                    <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      Median yetkazish{' '}
                      {summary?.medianDays === null || summary === undefined
                        ? NO_VALUE
                        : `${summary.medianDays} kun`}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* The one thing that stops a Qamrov above 100% reading as a bug. */}
      <FaktBasisNote />

      {/*
        THE SIX COLUMNS — the report itself.

        The bar and the table are literally the same six numbers, in the same
        order and the same colours, so a picture and a total cannot disagree
        here. The last row is the SERVER's ЗАКАЗ, never a client-side sum of
        the rows above it.
      */}
      <ChartCard
        title="Buyurtmalar holati · davr yigʻmasi"
        hint="Тасдиклаш navbatiga tushgan buyurtmalar Доставка voronkasida hozir qayerda. ЗАКАЗ = FAKT 1, Успешно = FAKT 2."
      >
        <StatusCompositionBar
          segments={buckets.map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            colour: bucketColour(bucket.key),
            amount: bucket.amount.amount,
            orders: bucket.orders,
            sharePercent: bucket.sharePercent,
          }))}
          total={summary?.ordered.amount ?? 0}
          status={viewStatus}
        />

        <div className="mt-4">
          <DataTable<LogisticsBucketDto>
            columns={BUCKET_COLUMNS}
            rows={buckets}
            rowKey={(row) => row.key}
            status={viewStatus}
            errorMessage={errorMessage}
            onRetry={retry}
            emptyTitle="Buyurtma yoʻq"
            emptyBody="Tanlangan oynada tasdiqlash navbatiga tushgan buyurtma topilmadi."
            minWidth={560}
            maxHeight="none"
          />
        </div>

        {summary && summary.unbucketedOrders > 0 && (
          /*
            The six columns claim to be the whole of ЗАКАЗ. When they are not,
            the screen says so rather than letting the arithmetic quietly fail
            to add up — a confirmed order moved into another funnel is a real
            event, not an error to swallow.
          */
          <p className="mt-3 text-[11px]" style={{ color: 'var(--status-warning)' }}>
            {formatNumber(summary.unbucketedOrders)} ta buyurtma Доставка voronkasidan tashqarida —
            ustunlar yigʻindisi ЗАКАЗ dan shuncha kam.
          </p>
        )}
        {summary && summary.offRevenueOrders > 0 && (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--status-critical)' }}>
            {formatNumber(summary.offRevenueOrders)} ta buyurtma daromad voronkasida emas — bu
            raqam 0 boʻlishi kerak, tekshirish talab qilinadi.
          </p>
        )}

        {/*
          WHERE THE MISSING TWO COLUMNS WOULD HAVE BEEN. Their sheet carries
          «касса» and «Остаток»; the portal keeps no payment sum at all — deals
          expose only OPPORTUNITY, `crm.invoice.list` returns nothing and
          payment appears solely as a stage NAME. Printing two columns of
          zeroes would be a measurement; this is the truth.
        */}
        {summary && summary.revivedOrders > 0 && (
          /*
            WHAT «Отказ» OVERSTATES. An order refused and then delivered anyway
            is money already counted inside Успешно; printing the number bounds
            how much of the loss column is not a loss. Decided against the LAST
            refusal, so a parcel delivered, bounced and then refused does not
            count as a recovery.
          */
          <p className="mt-3 text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
            Отказ koʻrsatgan yoʻqotishdan{' '}
            <strong>{formatNumber(summary.revivedOrders)} tasi</strong> ({formatFullUzs(summary.revived.amount)}{' '}
            soʻm) keyinchalik baribir yetkazilgan — bu pul allaqachon Успешно ichida sanalgan.
          </p>
        )}

        {/*
          WHY THERE IS NO REASONS TABLE. The portal has a refusal-reason field
          and it is empty: 830 refusals in sixty days, one of them with a
          reason. Two cards used to draw that single value as a chart. Saying
          it once in a sentence is the honest rendering of an empty field.
        */}
        <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Rad etish sababi Bitrix24da toʻldirilmaydi — 60 kunda 830 ta raddan faqat bittasida
          sabab bor, shuning uchun sabablar jadvali chiqarilmaydi.
        </p>

        <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          «Касса» va «Остаток» ustunlari yoʻq: Bitrix24 toʻlov summasini saqlamaydi — toʻlov faqat
          bosqich nomida koʻrinadi («Оплаченно с click»), hisob-fakturalar esa umuman yuritilmaydi.
        </p>
      </ChartCard>

      <DailySection
        days={data?.days ?? []}
        status={viewStatus}
        errorMessage={errorMessage}
        onRetry={retry}
        open={dailyOpen}
        onToggle={setDailyOpen}
      />

      {/*
        POCHTALAR — TWO PANELS, STACKED, IN THE SAME ROW ORDER.

        This is the dual-axis ban implemented rather than worked around: volume
        and delivery rate read straight down one column of labels, and no
        second axis can be rescaled to imply a relationship between them. The
        second panel is deliberately NOT re-sorted by rate — the whole
        mechanism is that the eye runs down one list.
      */}
      <ChartCard
        title="Pochtalar boʻyicha"
        hint="Buyurtma qaysi pochtaga yoʻnaltirilgani tarixdan olinadi — hozirgi bosqichdan emas, chunki yetkazilgan buyurtma allaqachon «Доставлено» da turadi. Har bir buyurtma aynan bitta pochtaga tegishli."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h3 className="mb-3 text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Qaysi pochtaga qancha yoʻnaltirilgan
            </h3>
            <CategoryBarList
              rows={(data?.posts ?? []).map(volumeRow)}
              mode="magnitude"
              status={viewStatus}
              emptyBody="Bu davrda hech qaysi pochtaga buyurtma yoʻnaltirilmagan."
            />
          </section>

          <section>
            <h3 className="mb-3 text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Har bir pochta qanday ishlayapti — yetkazish %
            </h3>
            <CategoryBarList
              rows={(data?.posts ?? []).map(rateRow)}
              mode="rate"
              status={viewStatus}
              emptyBody="Yetkazish foizini hisoblash uchun maʼlumot yetarli emas."
            />
            <p className="mt-3 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Tartib yuqoridagi panel bilan bir xil — foiz boʻyicha qayta saralanmaydi. Maxraj —
              yakunlangan buyurtmalar (yetkazilgan + qaytgan + bekor); yoʻldagilar hisobga
              olinmaydi, ular alohida koʻrsatilgan. Median kun — navbatga tushgandan
              «Доставлено» gacha, pochtada turgan vaqt emas.
            </p>
          </section>
        </div>

        {summary && summary.unroutedOrders > 0 && (
          <p className="mt-4 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {formatNumber(summary.unroutedOrders)} ta buyurtma hech qaysi pochtaga tegmagan —
            hali yoʻlda yoki joʻnatilmasdan bekor qilingan.
          </p>
        )}
      </ChartCard>

      {/*
        THE WORK LIST, AND THE REASON IT IS URGENT, SIDE BY SIDE.

        Left: what is standing at each post office right now and how much of
        it has been standing past seven days. Right: why seven days is the
        line — measured over sixty days of production, a parcel collected
        inside two days is delivered 95.1% of the time and one still standing
        after seven only 62.5%, and that gradient holds inside every single
        post office. Neither half means much alone: the list without the
        curve is a pile of numbers, the curve without the list is a fact
        nobody can act on.
      */}
      <ChartCard
        title="Pochtada kutayotgan pul"
        hint="Joʻnatma pochtaga yetib bordi, lekin hali olib ketilmagan. Yosh — shu pochtaga kirgan vaqtdan hisoblanadi."
        action={
          <SegmentedControl<"all" | "cohort">
            value={standingScope}
            options={[
              { value: 'all', label: 'Hozirgi holat' },
              { value: 'cohort', label: 'Tanlangan davr' },
            ]}
            onChange={setStandingScope}
            ariaLabel="Qamrov"
          />
        }
      >
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <section>
            <DataTable<LogisticsPointDto>
              columns={STANDING_COLUMNS}
              rows={standingRows}
              rowKey={(row) => row.label}
              status={viewStatus}
              errorMessage={errorMessage}
              onRetry={retry}
              emptyTitle="Pochtada turgan joʻnatma yoʻq"
              emptyBody="Hamma joʻnatma yo yetkazilgan, yo hali yoʻlda."
              minWidth={620}
              maxHeight="none"
            />
            {standingTotal.orders > 0 && (
              <p className="mt-3 text-[12px]" style={{ color: "var(--ink-secondary)" }}>
                Jami <strong>{formatNumber(standingTotal.orders)}</strong> ta joʻnatma —{" "}
                <strong>{formatFullUzs(standingTotal.amount)}</strong> soʻm. Shundan{" "}
                <strong style={{ color: "var(--status-critical)" }}>
                  {formatNumber(standingTotal.agedOrders)} ta
                </strong>{" "}
                7 kundan ortiq turibdi —{" "}
                <strong style={{ color: "var(--status-critical)" }}>
                  {formatFullUzs(standingTotal.agedAmount)}
                </strong>{" "}
                soʻm.
              </p>
            )}
            {/*
              THE CLOCK WARNING. Everything else on this page is dated by the
              order's arrival in Тасдиклаш; this block is dated by now().
              Without the sentence the two readings look like a contradiction.
            */}
            <p className="mt-2 text-[11px]" style={{ color: "var(--ink-muted)" }}>
              {standingScope === 'all'
                ? "«Hozirgi holat» — davr tanlovidan qatʼi nazar, pochtada turgan BARCHA joʻnatmalar. Sahifaning qolgan qismi tanlangan davr boʻyicha, shuning uchun bu raqamlar yuqoridagilarga qoʻshilmaydi."
                : "«Tanlangan davr» — faqat shu oynada navbatga tushgan buyurtmalar. Oyna ochilishidan oldin tiqilib qolgan joʻnatmalar bu yerda koʻrinmaydi."}
            </p>
          </section>

          <section>
            <h3 className="mb-1 text-[12.5px] font-medium" style={{ color: "var(--ink-secondary)" }}>
              Qancha kutgani natijani qanday oʻzgartiradi
            </h3>
            <p className="mb-3 text-[11px]" style={{ color: "var(--ink-muted)" }}>
              Tanlangan davrdagi yakunlangan joʻnatmalar, pochtada qancha turganiga qarab.
            </p>
            <CategoryBarList
              rows={(data?.waits ?? []).map(waitRow)}
              mode="rate"
              status={viewStatus}
              emptyBody="Yakunlangan joʻnatma yetarli emas."
            />
            <p className="mt-3 text-[11px]" style={{ color: "var(--ink-muted)" }}>
              Faqat pochtadan chiqib ketgan va yakunlangan joʻnatmalar. Hali turganlar bu
              yerda emas — ular chapdagi jadvalda. Qoida har bir pochtada takrorlanadi,
              yaʼni gap tashuvchida emas, kutish vaqtida.
            </p>
          </section>
        </div>
      </ChartCard>

      <ChartCard
        title="Hududlar boʻyicha"
        hint="Hudud — bitimdagi «Регион» maydonidan. Bir hududning buyurtmasi istalgan pochtadan oʻtishi mumkin, shuning uchun bu jadval yuqoridagisining boshqacha kesimi."
      >
        <DataTable<LogisticsPointDto>
          columns={POINT_COLUMNS}
          rows={data?.regions ?? []}
          rowKey={(row) => row.label}
          status={viewStatus}
          errorMessage={errorMessage}
          onRetry={retry}
          emptyTitle="Hudud topilmadi"
          emptyBody="Tanlangan oynada buyurtma yoʻq."
          minWidth={820}
          initialRows={10}
          moreLabel={(hidden) => `Yana ${hidden} ta hudud`}
          maxHeight={480}
        />
      </ChartCard>

      {/*
        THE AUDIT TRAIL, AND THE LAST BLOCK ON PURPOSE.

        Eighteen rows, the portal's own Russian, the portal's own order, and
        the column each one feeds. Everything above this card is trusted; this
        card is where it becomes checkable. `bucket` arrives on the payload —
        re-deriving the eighteen-into-six mapping in the browser would be a
        second definition of a partition the client approved stage by stage.

        NOT the portal's live kanban: Savdo dinamikasi carries that board and
        it has no window at all. This is these six columns opened out, over
        THIS window's cohort.
      */}
      <ChartCard
        title="Доставка bosqichlari · Bitrix24 bilan solishtirish"
        hint="Доставка voronkasining har bir bosqichi — portaldagi nomi va tartibida, har biri qaysi ustunga kirgani bilan. Bu jadvalni obey.bitrix24.kz yonida ochib, olti ustun haqiqatan shu bosqichlardan yigʻilganini tekshirish mumkin."
      >
        <DataTable<LogisticsStageDto>
          columns={STAGE_COLUMNS}
          rows={data?.reconciliation ?? []}
          rowKey={(row) => row.stage}
          status={viewStatus}
          errorMessage={errorMessage}
          onRetry={retry}
          emptyTitle="Bosqich topilmadi"
          emptyBody="Доставка voronkasining bosqichlari oʻqilmadi."
          minWidth={640}
          maxHeight={520}
        />
      </ChartCard>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// Columns — module scope, so a re-render does not rebuild them
// ---------------------------------------------------------------------------

const BUCKET_COLUMNS: Column<LogisticsBucketDto>[] = [
  {
    key: 'label',
    header: 'Holat',
    rowHeader: true,
    render: (row) => (
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ background: bucketColour(row.key) }}
        />
        {row.label}
      </span>
    ),
  },
  {
    key: 'orders',
    header: 'Buyurtma',
    align: 'right',
    numeric: true,
    width: '110px',
    render: (row) => formatNumber(row.orders),
  },
  {
    key: 'amount',
    header: 'Summa',
    align: 'right',
    numeric: true,
    width: '170px',
    /*
      IN FULL, NOT COMPACT. These six figures are what gets compared with the
      client's sheet line by line; «135 mln» cannot be checked against
      «135 849 999» without opening something.
    */
    render: (row) => formatFullUzs(row.amount.amount),
  },
  {
    key: 'share',
    header: 'Ulush',
    align: 'right',
    width: '150px',
    // A share is a magnitude, not a score, so the bar is neutral: 79% of the
    // money sitting in Успешно is good and 79% sitting in Отказ is a disaster,
    // and this column cannot tell which.
    render: (row) => <Meter value={row.sharePercent} tone="neutral" />,
  },
  {
    key: 'detail',
    header: 'Izoh',
    width: '210px',
    render: (row) => <BucketDetail bucket={row} />,
  },
]

const POINT_COLUMNS: Column<LogisticsPointDto>[] = [
  { key: 'label', header: 'Hudud', rowHeader: true, render: (row) => row.label },
  {
    key: 'orders',
    header: 'Buyurtma',
    align: 'right',
    numeric: true,
    width: '100px',
    render: (row) => formatNumber(row.orders),
  },
  {
    key: 'amount',
    header: 'ЗАКАЗ',
    align: 'right',
    numeric: true,
    width: '140px',
    render: (row) => formatCompactUzs(row.amount.amount),
  },
  {
    key: 'delivered',
    header: 'Успешно',
    align: 'right',
    numeric: true,
    width: '140px',
    render: (row) => formatCompactUzs(row.deliveredAmount.amount),
  },
  {
    key: 'rate',
    header: 'Yetkazish %',
    align: 'right',
    width: '150px',
    render: (row) => <Meter value={row.deliveryRate} tone="auto" />,
  },
  {
    key: 'lost',
    header: 'Отказ',
    align: 'right',
    numeric: true,
    width: '100px',
    render: (row) => formatNumber(row.refused + row.cancelledEarly),
  },
]

/**
 * The work list: one row per post office, ordered by what is standing there.
 *
 * The aged column wears the critical tone and nothing else on the row does —
 * it is the only number here that says «act», and giving it company would
 * make the table read as a wall of alarm.
 */
const STANDING_COLUMNS: Column<LogisticsPointDto>[] = [
  { key: 'post', header: 'Pochta', rowHeader: true, render: (row) => row.label },
  {
    key: 'orders',
    header: 'Turibdi',
    align: 'right',
    numeric: true,
    width: '100px',
    render: (row) => formatNumber(row.waitingOrders),
  },
  {
    key: 'amount',
    header: 'Summa',
    align: 'right',
    numeric: true,
    width: '170px',
    render: (row) => formatFullUzs(row.waitingAmount.amount),
  },
  {
    key: 'median',
    header: 'Median kun',
    align: 'right',
    numeric: true,
    width: '110px',
    render: (row) => (row.medianWaitingDays === null ? NO_VALUE : row.medianWaitingDays),
  },
  {
    key: 'aged',
    header: '7 kundan ortiq',
    align: 'right',
    numeric: true,
    width: '210px',
    render: (row) =>
      row.agedOrders === 0 ? (
        <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
      ) : (
        <span style={{ color: 'var(--status-critical)' }}>
          {formatNumber(row.agedOrders)} ta · {formatFullUzs(row.agedAmount.amount)}
        </span>
      ),
  },
]

const STAGE_COLUMNS: Column<LogisticsStageDto>[] = [
  {
    key: 'stage',
    header: 'Bosqich',
    rowHeader: true,
    render: (row) => (
      <Tooltip content={<span className="block max-w-72">Доставка · {row.stage}</span>}>
        <span className="truncate">{row.stage}</span>
      </Tooltip>
    ),
  },
  {
    key: 'bucket',
    header: 'Ustun',
    width: '170px',
    render: (row) => (
      <span className="inline-flex items-center gap-2 text-[12px]">
        <span
          aria-hidden
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ background: bucketColour(row.bucket) }}
        />
        <span style={{ color: 'var(--ink-secondary)' }}>{bucketLabel(row.bucket)}</span>
      </span>
    ),
  },
  {
    key: 'orders',
    header: 'Buyurtma',
    align: 'right',
    numeric: true,
    width: '110px',
    render: (row) => formatNumber(row.orders),
  },
  {
    key: 'amount',
    header: 'Summa',
    align: 'right',
    numeric: true,
    width: '170px',
    render: (row) => formatFullUzs(row.amount.amount),
  },
]

// ---------------------------------------------------------------------------
// Local presentation
// ---------------------------------------------------------------------------

/**
 * What a column is made of, in one line — and for «Отказ», the split that
 * actually means something.
 *
 * THE JOURNEY, NOT THE STAGE. Since June the portal writes every refusal to
 * «Отказ предварительно», so the stage name has stopped carrying the
 * difference between a parcel that travelled and came back and one that was
 * killed before dispatch. Read from the stage the column says «nothing came
 * back»; read from the history it says the opposite, and the history is right.
 * The stage decomposition is not lost — it is the last block on the page.
 */
function BucketDetail({ bucket }: { bucket: LogisticsBucketDto }) {
  if (bucket.key === 'REFUSED' && bucket.orders > 0) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        qaytdi {formatNumber(bucket.returnedOrders)} · joʻnatilmay bekor{' '}
        {formatNumber(bucket.cancelledOrders)}
      </span>
    )
  }

  if (bucket.parts.length > 1) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        {bucket.parts
          .filter((part) => part.orders > 0)
          .map((part) => `${ROLE_LABELS[part.role] ?? part.role} ${formatNumber(part.orders)}`)
          .join(' · ') || NO_VALUE}
      </span>
    )
  }

  return <span style={{ color: 'var(--ink-muted)' }}>{NO_VALUE}</span>
}

/** The roles a column can be made of, in the words the floor uses. */
const ROLE_LABELS: Readonly<Record<string, string>> = {
  REGIONAL_HUB: 'pochta',
  CARRIER: 'tashuvchi',
  CHASING: 'undirilmoqda',
  PREPARING: 'tayyorlanmoqda',
  WAREHOUSE: 'omborda',
  IN_TRANSIT: 'yoʻlda',
  DELIVERED: 'Доставлено',
  SETTLED: 'Успешно заказ',
  REFUSED: 'qaytdi',
  CANCELLED_EARLY: 'joʻnatilmay bekor',
}

function volumeRow(point: LogisticsPointDto): CategoryBarRow {
  return {
    key: point.label,
    label: point.label,
    value: point.amount.amount,
    display: formatCompactUzs(point.amount.amount),
    meta: `${formatNumber(point.orders)} ta`,
  }
}

/**
 * One wait band as a graded bar.
 *
 * The count rides the meta line because a band with four orders in it and a
 * band with two thousand look identical as bars, and the thin one is where a
 * reader would otherwise see a collapse that is really three parcels.
 */
function waitRow(band: LogisticsWaitBandDto): CategoryBarRow {
  return {
    key: band.key,
    label: band.label,
    value: band.deliveryRate,
    display: formatPercent(band.deliveryRate),
    meta: `${formatNumber(band.delivered)} / ${formatNumber(band.orders)} yetkazilgan`,
  }
}

function rateRow(point: LogisticsPointDto): CategoryBarRow {
  const resolved = point.delivered + point.refused + point.cancelledEarly
  return {
    key: point.label,
    label: point.label,
    value: point.deliveryRate,
    display: formatPercent(point.deliveryRate),
    meta:
      resolved === 0
        ? `${formatNumber(point.inFlight)} ta hali yoʻlda`
        : `${formatNumber(point.delivered)} / ${formatNumber(resolved)} yakunlangan · pochtada ${
            point.medianWaitDays === null
              ? NO_VALUE
              : `${point.medianWaitDays} kun (n=${formatNumber(point.waitedOrders)})`
          }`,
  }
}

/** The six columns, in the client's order — exported for the tests that pin it. */
export const LOGISTICS_COLUMN_ORDER = LOGISTICS_BUCKETS.map((bucket) => bucket.key)
