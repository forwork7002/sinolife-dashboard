// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { DeliveryStageDto } from '@/lib/api'
import { formatFullUzs } from '@/lib/format'

/**
 * The Доставка board's columns, as the client reads them in Bitrix24.
 *
 * This block exists to be held BESIDE the portal — «biz bitrix24da shunaqa
 * oʻqishga oʻrgangan edik» — so two of its rules are about words rather than
 * arithmetic, and both fail silently:
 *
 *   · the stage name is the portal's own string, printed whole. A translation,
 *     a truncation or a title-case pass makes the column unmatchable against
 *     the screen it was copied from, and nothing about the number looks wrong.
 *   · a column standing at zero is still a column. «Подготовка товара 0» is
 *     the first thing on the client's own screenshot of this board; dropping
 *     empty columns renumbers a board somebody reads positionally.
 *
 * Neither is checkable on a developer machine: the demo database has no
 * delivery funnel, and the Bitrix24 reference database has the stages but no
 * deals, so the populated board cannot be rendered against either.
 */

afterEach(cleanup)

const { DeliveryColumns } = await import('@/features/sales/DeliveryBoardSection')

function stage(over: Partial<DeliveryStageDto> & { stageName: string }): DeliveryStageDto {
  return {
    stageId: over.stageName,
    category: 'IN_PROGRESS',
    sortOrder: 6030,
    openCount: 0,
    openValue: { amountMinor: '0', currency: 'UZS', amount: 0 },
    ...over,
  }
}

/** Measured on the portal on 2026-09-10, in the portal's own sortOrder. */
const BOARD: DeliveryStageDto[] = [
  stage({ stageName: 'Подготовка товара', sortOrder: 6010, category: 'NEW' }),
  stage({ stageName: 'Заказ в мой склад', sortOrder: 6020 }),
  stage({
    stageName: 'В пути',
    sortOrder: 6030,
    openCount: 178,
    openValue: { amountMinor: '26932000000', currency: 'UZS', amount: 269_320_000 },
  }),
  stage({
    stageName: 'TOSHKENT-1',
    sortOrder: 6040,
    openCount: 66,
    openValue: { amountMinor: '10055000000', currency: 'UZS', amount: 100_550_000 },
  }),
]

describe('the Доставка board columns', () => {
  it("prints the portal's own stage names, untranslated and whole", () => {
    render(<DeliveryColumns stages={BOARD} />)

    for (const name of ['Подготовка товара', 'Заказ в мой склад', 'В пути', 'TOSHKENT-1']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('draws a column nobody is standing in, rather than dropping it', () => {
    render(<DeliveryColumns stages={BOARD} />)

    // Four columns for four stages — two of them empty.
    expect(screen.getAllByText(/^(0|178|66)$/)).toHaveLength(4)
    expect(screen.getByText('Подготовка товара')).toBeTruthy()
  })

  it('prints every soʻm figure in full, so it reconciles against the portal', () => {
    render(<DeliveryColumns stages={BOARD} />)

    /* Through the app's own formatter rather than a literal: the group
       separator is one constant in `format.ts` and the client asked for the
       LAST DIGIT, which is the half this asserts. */
    expect(screen.getByText(`${formatFullUzs(269_320_000)} soʻm`)).toBeTruthy()
    expect(screen.getByText(`${formatFullUzs(100_550_000)} soʻm`)).toBeTruthy()
    // Not «269 mln» — the compact form is what this block may never print.
    expect(screen.queryByText(/mln|mlrd/)).toBeNull()
  })

  it('says nothing about money in a column that holds none', () => {
    render(<DeliveryColumns stages={[BOARD[0]!]} />)

    // «0 soʻm» is a figure to read and there is nothing there to read.
    expect(screen.queryByText(/soʻm/)).toBeNull()
  })

  it('keeps the portal order the server sent, and never re-sorts', () => {
    const { container } = render(<DeliveryColumns stages={BOARD} />)

    const names = [...container.querySelectorAll('[title]')].map((el) => el.getAttribute('title'))
    expect(names).toEqual(BOARD.map((s) => s.stageName))
  })
})
