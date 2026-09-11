/**
 * The Доставка kanban, orchestrated.
 *
 * Thin, like `InsightsService`: the aggregation lives in `PulseRepository` and
 * this layer crosses the result into a transport DTO — money via `toMoneyDto`,
 * nothing computed on top.
 *
 * WHAT THIS FILE USED TO BE. «Savdo pulsi» and «Bosqichlar qamrovi» — a
 * velocity/forecast/composition/cycle/win-rate band and a stage funnel with an
 * ageing block — were the whole of it, and both were stripped from Savdo
 * dinamikasi on 2026-09-10 («menga bu boʻlim fakt 1 va fakt 2 va bitrix24dan»).
 * `pulse()` and `flow()` outlived their screens by a few hours; they and their
 * eleven DTOs were deleted with the rest of the callerless code. The name
 * stays because `pulseRepository` is where the delivery board's SQL lives.
 *
 * It takes `AnalyticsContext` rather than a bare period because it respects
 * the dashboard filters and the caller's authorisation scope — see the note on
 * `PulseDealFilters` for exactly which filters apply (employees, departments,
 * sources, scope; NOT products/stages/free text). The board itself has no
 * reporting window at all: a kanban column is where orders are standing now.
 */

import { stripPipelinePrefix } from '@/server/domain/analytics/stageNames'
import { type MoneyDto, money, toMoneyDto } from '@/server/domain/money/money'
import type { PulseDealFilters, PulseRepository } from '@/server/repositories/pulseRepository'
import type { AnalyticsContext } from './analyticsService'

/**
 * One column of the Доставка kanban.
 *
 * `stageName` IS THE PORTAL'S STRING, untranslated. «В пути», «TOSHKENT-1»,
 * «Отказ предварительно» — the client reads this board in Bitrix24 and asked
 * for the same words here, so this field is passed through and no UI may
 * localise it.
 */
export interface DeliveryStageDto {
  readonly stageId: string
  readonly stageName: string
  readonly category: string
  readonly sortOrder: number
  /** Orders standing in this column right now — no reporting window. */
  readonly openCount: number
  readonly openValue: MoneyDto
}

export interface DeliveryBoardDto {
  /**
   * The funnel's own name, from the portal. Null when this database holds no
   * Доставка pipeline at all — the demo seed, which has nine generic stages
   * and no delivery ladder — so a screen can say «not in this database»
   * rather than draw an empty board and imply the funnel is idle.
   */
  readonly pipelineName: string | null
  readonly stages: readonly DeliveryStageDto[]
  readonly totals: {
    readonly openCount: number
    readonly openValue: MoneyDto
  }
}

// ---------------------------------------------------------------------------

/**

/** Keep only the filters the pulse SQL can honestly honour. */
function pulseFilters(ctx: AnalyticsContext): PulseDealFilters {
  return {
    employeeIds: ctx.filters.employeeIds,
    departmentIds: ctx.filters.departmentIds,
    sourceIds: ctx.filters.sourceIds,
    restrictToEmployeeIds: ctx.filters.restrictToEmployeeIds,
  }
}

export class PulseService {
  constructor(private readonly repo: PulseRepository) {}

  /**
   * The Доставка funnel's kanban columns — what is standing where, right now.
   *
   * IT KEPT ITS OWN METHOD WHILE `flow` EXISTED, and the reason it did is the
   * reason it survived: it answers a different question on a different clock.
   * `flow` was period-bound on both halves — cohorting the deals CREATED in
   * the window, then measuring dwell against `ctx.now` — while this is a
   * snapshot with no window at all, which is exactly what a kanban column is.
   * Folding the two together would have made one payload carry two clocks; it
   * would also have taken this board down with `flow` when Savdo dinamikasi
   * stopped reading it.
   *
   * NO ROUNDING, NO DERIVED RATE, NO SHARE. The board's whole value is that a
   * manager can put it beside the portal and read the same two numbers per
   * column; anything computed on top is a number the portal does not show.
   */
  async deliveryBoard(ctx: AnalyticsContext): Promise<DeliveryBoardDto> {
    const rows = await this.repo.deliveryBoard(pulseFilters(ctx))
    const pipelineName = rows[0]?.pipelineName ?? null

    const stages = rows.map<DeliveryStageDto>((row) => ({
      stageId: row.stageId,
      /* Stripped here and not on the client: the board IS one funnel and its
         heading already names it, so the prefix is thirteen characters
         repeated down fifteen rows. See `stripPipelinePrefix`. */
      stageName: stripPipelinePrefix(row.stageName, row.pipelineName),
      category: row.category,
      sortOrder: row.sortOrder,
      openCount: row.openCount,
      openValue: toMoneyDto(money(row.openValueMinor, ctx.currency)),
    }))

    /*
      Summed from the SAME rows the board draws, so the total is the columns
      and cannot be a second answer. Reduced over minor units — adding the
      lossy `amount` fields would drift by a tiyin per column.
    */
    const openValueMinor = rows.reduce((sum, row) => sum + row.openValueMinor, 0n)

    return {
      pipelineName,
      stages,
      totals: {
        openCount: rows.reduce((sum, row) => sum + row.openCount, 0),
        openValue: toMoneyDto(money(openValueMinor, ctx.currency)),
      },
    }
  }
}
