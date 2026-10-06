import { beforeEach, describe, expect, it } from 'vitest'

import { resolvePeriod } from '@/server/domain/period/period'
import type {
  ConfirmationOrderRow,
  InsightsRepository,
} from '@/server/repositories/insightsRepository'
import { InsightsService, resetConfirmationRopCache } from '@/server/services/insightsService'

/**
 * THE № IS THE FLOOR'S, OR IT IS NOT PRINTED.
 *
 * The daily number is minted by one `row_number()` over the cohort, and the
 * backlog cohort holds only the orders still waiting. On the window board
 * Sevinch's tenth arrival of the day is «010»; once seven of the ten are
 * confirmed, the backlog board — where the header bell lands — numbered the
 * three left «001», «002», «003», so «003» named two different orders on two
 * boards the floor reads out loud. The service sends no number there.
 */

beforeEach(resetConfirmationRopCache)

const TZ = 'Asia/Tashkent'
const NOW = new Date('2026-10-06T13:00:00+05:00')
const ARRIVED = new Date('2026-10-06T11:40:00+05:00')

/** The tenth arrival of Sevinch's day, still waiting. */
const TENTH = {
  dealId: 'deal-10',
  rop: 'Sevinch',
  dailyNo: 10,
  bitrixId: '1050732',
  orderCode: null,
  title: 'Buyurtma',
  customerName: 'Mijoz',
  customerPhones: [],
  employeeName: 'Sotuvchi',
  products: [],
  region: null,
  deliveryAddress: null,
  sourceName: null,
  amountMinor: 160_000_000n,
  currency: 'UZS',
  stageName: 'Тасдиклаш',
  outcome: 'CONFIRM_NEW',
  createdAt: ARRIVED,
  movedAt: ARRIVED,
  queuedAt: ARRIVED,
  decidedAt: null,
  hoursToDecide: null,
  queueEntries: 1,
  queueReturns: 0,
  previousQueuedAt: null,
  queueHistory: [],
} as unknown as ConfirmationOrderRow

function service() {
  const repository = {
    // The window board: a day is the short shape, two statements.
    confirmationOrders: async () => ({ totalItems: 1, rows: [TENTH] }),
    confirmationByRop: async () => [],
    // The backlog reads all of time, which is the long shape.
    confirmationBoard: async () => ({ totalItems: 1, rows: [TENTH], byRop: [] }),
  } as unknown as InsightsRepository

  const service = new InsightsService(repository)
  return (mode: 'window' | 'backlog') =>
    service.confirmationQueue(
      resolvePeriod('today', { timeZone: TZ, now: NOW }),
      { page: 1, pageSize: 25, sort: 'queuedAt', order: 'desc' },
      { restrictToEmployeeIds: null },
      'UZS',
      mode,
    )
}

describe('the daily № on the two confirmation boards', () => {
  it('is the day’s own number on the window board', async () => {
    const { items } = await service()('window')

    expect(items[0]!.dailyNo).toBe(10)
  })

  it('is withheld on the backlog board, which could only number the leftovers', async () => {
    const { items } = await service()('backlog')

    expect(items[0]!.dailyNo).toBeNull()
  })
})
