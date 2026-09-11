import { describe, expect, it } from 'vitest'

import {
  LOGISTICS_BUCKETS,
  LOGISTICS_BUCKET_KEYS,
  UNMAPPED_BUCKET,
  bucketColour,
  bucketForRole,
  bucketLabel,
} from '@/lib/logisticsBuckets'
import { DELIVERY_STAGE_ROLES } from '@/server/integrations/crm/bitrix24/mapping'

/**
 * THE TEST THAT PINS THE CLIENT'S OWN REPORT.
 *
 * The six columns of Logistika are a business definition the client approved
 * stage by stage on 2026-09-10: ТАСТИКЛАНГАН, не собран, В пути, Ожидание/нд,
 * Отказ, Успешно. Everything downstream — the SQL's CASE, the composition bar,
 * the daily table, the reconciliation block — is generated from
 * `LOGISTICS_BUCKETS`, so this file is the one place the mapping itself is
 * checked against the portal's real stage list.
 *
 * A stage added to the Доставка funnel in Bitrix24, or a role renamed, fails
 * HERE rather than turning up on screen as a column that quietly stops adding
 * up to ЗАКАЗ.
 */

/** Every stage of the Доставка funnel, by its Bitrix24 STATUS_ID. */
const C6_STAGES = Object.entries(DELIVERY_STAGE_ROLES).filter(([id]) => id.startsWith('C6:'))

describe('the client-approved logistics columns', () => {
  it('covers the whole Доставка funnel, with nothing left over', () => {
    /*
      NINETEEN SINCE 2026-09-10, and the nineteenth is why this file exists.

      The client added «Ожидание / нд» to the portal — the header from their
      own sheet, made into a kanban column — while this screen was being
      built around a column of that name. It arrived with no logistics role,
      so it fell to OTHER and the screen’s own diagnostic reported it. It
      held 0 deals and 0 history rows at the time; had it been found a week
      later it would have been found as a column quietly failing to add up.
    */
    expect(C6_STAGES).toHaveLength(19)

    const unmapped = C6_STAGES.filter(([, role]) => bucketForRole(role) === UNMAPPED_BUCKET)
    expect(unmapped).toEqual([])
  })

  it('puts every stage in exactly one column', () => {
    for (const [stageId, role] of C6_STAGES) {
      const owners = LOGISTICS_BUCKETS.filter((bucket) =>
        (bucket.roles as readonly string[]).includes(role),
      )
      expect(owners, `${stageId} (${role})`).toHaveLength(1)
    }
  })

  it('never names one role in two columns', () => {
    const roles = LOGISTICS_BUCKETS.flatMap((bucket) => bucket.roles)
    expect(new Set(roles).size).toBe(roles.length)
  })

  /*
    The mapping the client read out and agreed to, written back as a literal.

    Not derived from LOGISTICS_BUCKETS — a test that computes its expectation
    from the thing it is testing asserts nothing. These are the stage names
    from their kanban and the column each one was placed in.
  */
  it('groups the eighteen stages the way the client placed them', () => {
    const placed = Object.fromEntries(
      C6_STAGES.map(([stageId, role]) => [stageId, bucketForRole(role)]),
    )

    expect(placed).toEqual({
      'C6:NEW': 'PREPARING', // Подготовка товара
      'C6:EXECUTING': 'PREPARING', // Обработка заказов
      'C6:UC_IAU4Q5': 'WAREHOUSE', // Заказ в мой склад
      'C6:UC_4UD7I9': 'IN_TRANSIT', // В пути
      'C6:PREPARATION': 'WAITING', // TOSHKENT-1
      'C6:UC_32AOK8': 'WAITING', // NAVOIY
      'C6:UC_KW44HQ': 'WAITING', // VODIY
      'C6:UC_EUPVYN': 'WAITING', // QASHQADARYO
      'C6:UC_PH8HGF': 'WAITING', // SURXONDARYO
      'C6:PREPAYMENT_INVOICE': 'WAITING', // CARAVAN — a post office, NOT a refusal
      'C6:UC_GTQXY7': 'WAITING', // OSON POCHTA
      'C6:UC_3OK02F': 'WAITING', // BEK POCHTA
      'C6:UC_06YLAO': 'WAITING', // Юрист смс — the «нд» half of the header
      'C6:UC_AL40O1': 'WAITING', // Пропущенный
      'C6:UC_IXGHDH': 'WAITING', // Ожидание / нд — the client's own column, as a stage
      'C6:UC_YUKVF1': 'DONE', // Успешно заказ
      'C6:WON': 'DONE', // Доставлено
      'C6:UC_3U7025': 'REFUSED', // Отказ (renamed from Отказ предварительно)
      'C6:LOSE': 'REFUSED', // Возврат получен (renamed from Отказ)
    })
  })

  /*
    The headers are the client's, verbatim and in Russian.

    Translating them is the one change that would break what this screen is
    for: it is read beside obey.bitrix24.kz and beside their own Google Sheet,
    and a column called «Yetkazildi» cannot be reconciled against either.
  */
  it('keeps the sheet headers verbatim, in the sheet order', () => {
    expect(LOGISTICS_BUCKETS.map((bucket) => bucket.label)).toEqual([
      'ТАСТИКЛАНГАН',
      'не собран',
      'В пути',
      'Ожидание / нд',
      'Отказ',
      'Успешно',
    ])
    expect(LOGISTICS_BUCKET_KEYS).toEqual([
      'PREPARING',
      'WAREHOUSE',
      'IN_TRANSIT',
      'WAITING',
      'REFUSED',
      'DONE',
    ])
  })

  it('gives every column its own colour, and Отказ the red one', () => {
    const colours = LOGISTICS_BUCKETS.map((bucket) => bucket.colour)
    expect(new Set(colours).size).toBe(colours.length)
    // No tile on this screen uses tone="critical", so red means one thing here.
    expect(bucketColour('REFUSED')).toBe('var(--series-8)')
  })

  it('falls back rather than throwing on a role it has never seen', () => {
    expect(bucketForRole('PENDING_CONFIRM')).toBe(UNMAPPED_BUCKET)
    expect(bucketForRole(null)).toBe(UNMAPPED_BUCKET)
    expect(bucketLabel(UNMAPPED_BUCKET)).toBe(UNMAPPED_BUCKET)
    expect(bucketColour(UNMAPPED_BUCKET)).toBe('var(--axis)')
  })
})
