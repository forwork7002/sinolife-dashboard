'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { EmptyState, ErrorState } from '@/components/states/States'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card } from '@/components/ui/Card'
import { useDashboardFilters } from '@/features/shared/useDashboardFilters'
import { apiGet, type DeliveryBoardDto, type DeliveryStageDto } from '@/lib/api'
import { formatFullUzs, formatNumber } from '@/lib/format'

/**
 * Доставка, column by column — the portal's own kanban, on the dashboard.
 *
 * THE CLIENT ASKED FOR THIS BLOCK BY NAME on 2026-09-10, twice over: the
 * Доставка funnel's figures are what stays («shu yerdagi Dostavka
 * varonkasidagi malumotlar shu yerda turadi»), and every column is to be
 * written the way the portal writes it («barcha boʻlimlardagi malumotlar
 * hammasi qanday nomlangan boʻlsa shunday yozishingni istardim, chunki biz
 * bitrix24da shunaqa oʻqishga oʻrgangan edik»).
 *
 * SO NOTHING HERE IS TRANSLATED. «В пути», «TOSHKENT-1», «Заказ в мой склад»
 * are printed exactly as they arrive, in the portal's own `sortOrder`. This is
 * the ONE block on the dashboard where the Russian is load-bearing: the whole
 * point is that a manager can hold this beside the Bitrix24 screen and read
 * the same two numbers off the same column. A translated label breaks that
 * before any number is wrong.
 *
 * IT IS DATELESS, AND THE CAPTION SAYS SO OUT LOUD. Every other figure on this
 * page is cohorted by the order's arrival in C4:NEW inside the selected
 * window; a kanban column is where orders are STANDING, now, whenever they
 * arrived. Unsaid, a reader switches to «Bugun», watches this block not move,
 * and reports it broken — so the period control's non-effect is stated rather
 * than discovered.
 *
 * TWO FIGURES PER COLUMN AND NO THIRD. The portal shows a count and a sum; a
 * share, a rate or a delta computed here would be a number nobody can check
 * against the screen this block exists to mirror.
 */
export function DeliveryBoardSection() {
  const { apiParams } = useDashboardFilters()

  const query = useQuery({
    queryKey: ['delivery', apiParams],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiGet<DeliveryBoardDto>('/insights/delivery', apiParams, signal),
    placeholderData: keepPreviousData,
  })

  const board = query.data?.data
  const stages = board?.stages ?? []
  /* The funnel names itself, so a renamed воронка renames the heading with it
     rather than leaving a hard-coded «Доставка» over somebody else's columns.
     The literal is only the fallback for the frame before the answer lands. */
  const funnelName = board?.pipelineName ?? 'Доставка'

  return (
    <section
      aria-labelledby="delivery-heading"
      className="space-y-3"
      style={{
        opacity: query.isPlaceholderData ? 0.6 : 1,
        transition: 'opacity 150ms var(--ease-out)',
      }}
      aria-busy={query.isPlaceholderData || undefined}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="delivery-heading" className="eyebrow">
          {funnelName} voronkasi · bosqichlar
        </h2>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Hozirgi holat — davr tanlovi bu blokka taʼsir qilmaydi · bosqich nomlari Bitrix24
          dagidek
        </p>
      </div>

      <Card className="px-4 py-4">
        {/*
          THE TOTAL FIRST, because it is the one figure a manager wants without
          reading fifteen columns: how much money is standing in the delivery
          funnel right now. It is summed from the very rows below it — see
          `deliveryBoard` — so the columns and the total cannot be two answers.

          AND IT IS NOT DRAWN OVER AN ABSENT FUNNEL. With no Доставка pipeline
          in the database the sum is a truthful zero of nothing, and «0 soʻm»
          standing over an empty-state card reads as "the delivery pipe is
          clear" — the opposite of what the card underneath then says.
        */}
        {(query.isPending || stages.length > 0) && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-[12.5px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
            Voronkada turgan buyurtmalar
          </p>
          {query.isPending ? (
            <span className="skeleton inline-block h-6 w-44" role="status">
              <span className="sr-only">Yuklanmoqda</span>
            </span>
          ) : board ? (
            <span
              className="figure figure-sum figure-wrap inline-block"
              style={{ color: 'var(--ink-primary)' }}
            >
              <AnimatedNumber
                value={board.totals.openValue.amount}
                format={formatFullUzs}
                duration={900}
              />
              <span className="ml-1.5 text-sm font-normal" style={{ color: 'var(--ink-muted)' }}>
                soʻm
              </span>
              <span className="ml-2 text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
                · {formatNumber(board.totals.openCount)} ta
              </span>
            </span>
          ) : null}
        </div>
        )}

        <div className="mt-3">
          {query.isError ? (
            <ErrorState
              message={(query.error as Error | null)?.message}
              onRetry={() => void query.refetch()}
            />
          ) : query.isPending ? (
            /* Twelve boxes at the height a column renders to, so the block does
               not grow by 90px when the answer lands. */
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {Array.from({ length: 12 }, (_, index) => (
                <div key={index} className="skeleton h-[86px] rounded-lg" role="status">
                  <span className="sr-only">Yuklanmoqda</span>
                </div>
              ))}
            </div>
          ) : stages.length === 0 ? (
            /* Two different nothings, and the reader is told which. An empty
               board on a database that HAS the funnel would mean the delivery
               pipe is clear; here it means the funnel is not in this database
               at all, which is true of the demo seed and of nothing else. */
            <EmptyState
              title="Доставка voronkasi topilmadi"
              body="Bu bazada Доставка voronkasi yoʻq — bosqichlar import qilinmagan."
            />
          ) : (
            <DeliveryColumns stages={stages} />
          )}
        </div>

        {/*
          WHY «Доставлено» AND «Отказ» ARE NOT HERE. Both are closing columns:
          no OPEN order can be in one, so each could only print a permanent
          zero. Said rather than left as a gap somebody counts twice against
          the portal.
        */}
        {stages.length > 0 && (
          <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            Yakuniy bosqichlar — <strong style={{ color: 'var(--ink-secondary)' }}>Доставлено</strong>{' '}
            va <strong style={{ color: 'var(--ink-secondary)' }}>Отказ</strong> — bu yerda yoʻq:
            ularda ochiq buyurtma boʻlmaydi. Yetkazilgan pul yuqoridagi{' '}
            <strong style={{ color: 'var(--ink-secondary)' }}>FAKT 2</strong> da.
          </p>
        )}
      </Card>
    </section>
  )
}

/**
 * The columns themselves, in the portal's own order.
 *
 * Split out from the fetching section so it can be rendered against a fixture
 * — `tests/features/deliveryBoard.test.tsx` pins the two rules that are
 * invisible when they break: a name is printed VERBATIM, and an empty column
 * is drawn rather than dropped. Neither can be checked on a developer machine,
 * where no database holds a Доставка funnel with orders in it.
 *
 * Six across on a wide screen and two on a phone: fifteen columns is more than
 * a single row can carry legibly at any width, and the grid wraps in
 * `sortOrder`, so the reading order is still the portal's.
 */
export function DeliveryColumns({ stages }: { stages: readonly DeliveryStageDto[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {stages.map((stage) => (
        <StageColumn key={stage.stageId} stage={stage} />
      ))}
    </div>
  )
}

/**
 * One column.
 *
 * AN EMPTY COLUMN IS DRAWN, and drawn quietly. «Подготовка товара 0» is the
 * first thing on the client's own screenshot of this board — a column standing
 * at zero is a fact about the funnel, and dropping it would renumber a board
 * somebody reads positionally. It recedes instead: the count goes to muted ink
 * and the soʻm line is dropped entirely, because "0 soʻm" is a figure to read
 * and there is nothing there to read.
 */
function StageColumn({ stage }: { stage: DeliveryStageDto }) {
  const empty = stage.openCount === 0

  return (
    <div
      className="rounded-lg border px-3 py-2.5"
      style={{
        borderColor: 'var(--border)',
        background: empty ? 'transparent' : 'var(--surface-raised)',
      }}
    >
      {/*
        The portal's own string, wrapping rather than truncating: «Отказ
        предварительно» and «Подготовка товара» do not fit a narrow column, and
        a name cut to «Отказ пред…» is the one thing this block may not do —
        the reader is matching it against the screen it came from.
      */}
      <p
        className="text-[11.5px] leading-snug"
        style={{ color: empty ? 'var(--ink-muted)' : 'var(--ink-secondary)' }}
        title={stage.stageName}
      >
        {stage.stageName}
      </p>
      <p
        className="tabular mt-1 text-lg font-semibold leading-none"
        style={{ color: empty ? 'var(--ink-muted)' : 'var(--ink-primary)' }}
      >
        {formatNumber(stage.openCount)}
        <span className="ml-1 text-[11px] font-normal" style={{ color: 'var(--ink-muted)' }}>
          ta
        </span>
      </p>
      {!empty && (
        /* In full, like every other soʻm on this screen — the client's
           instruction of 2026-09-09, and here it is also what makes the figure
           comparable to the portal's own column total digit for digit. */
        <p className="tabular mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {formatFullUzs(stage.openValue.amount)} soʻm
        </p>
      )}
    </div>
  )
}
