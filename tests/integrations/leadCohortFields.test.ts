import { describe, expect, it } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { UF, calendarDate, portalUserId, repeatLeadKind } from '@/server/integrations/crm/bitrix24/mapping'

/**
 * «Lid kogortasi» — the five routing fields, from the portal's spelling to
 * the deal row. The client named the field codes and the two «Такрор лид»
 * item ids (744, 746); the formats below are the ones Bitrix24 REST sends
 * for datetime, date, employee and enumeration fields.
 */

describe('calendarDate — «Лид таркатилган сана» is a day, never an instant', () => {
  it('takes the date part as written, whatever the zone says', () => {
    // Moscow midnight is 02:00 in Tashkent and 21:00 UTC the day before —
    // neither may move the day.
    expect(calendarDate('2026-09-24T00:00:00+03:00')).toBe('2026-09-24')
    expect(calendarDate('2026-09-24')).toBe('2026-09-24')
  })

  it('reads the portal display format too, and refuses to guess anything else', () => {
    expect(calendarDate('24.09.2026')).toBe('2026-09-24')
    expect(calendarDate('')).toBeUndefined()
    expect(calendarDate(null)).toBeUndefined()
    expect(calendarDate('вчера')).toBeUndefined()
  })
})

describe('portalUserId — «РОП (Первичка)»', () => {
  it('accepts a bare id, a string id and the user_ prefix', () => {
    expect(portalUserId(8868)).toBe('8868')
    expect(portalUserId('8868')).toBe('8868')
    expect(portalUserId('user_8868')).toBe('8868')
    expect(portalUserId(['8868'])).toBe('8868')
  })

  it('treats empty and zero as nobody', () => {
    expect(portalUserId('')).toBeUndefined()
    expect(portalUserId(null)).toBeUndefined()
    expect(portalUserId('0')).toBeUndefined()
  })
})

describe('repeatLeadKind — «Такрор лид»', () => {
  it('reads the label first', () => {
    expect(repeatLeadKind('9', 'Такрор - харид қилган')).toBe('BOUGHT')
    expect(repeatLeadKind('9', 'Такрор - обработка')).toBe('PROCESSING')
  })

  it('falls back to the two ids the client named', () => {
    expect(repeatLeadKind('744', undefined)).toBe('BOUGHT')
    expect(repeatLeadKind(746, undefined)).toBe('PROCESSING')
  })

  it('keeps an unknown item as a repeat, and empty as a new lead', () => {
    expect(repeatLeadKind('999', 'Бошқа')).toBe('OTHER')
    expect(repeatLeadKind('', undefined)).toBeUndefined()
    expect(repeatLeadKind(null, undefined)).toBeUndefined()
    expect(repeatLeadKind(false, undefined)).toBeUndefined()
  })
})

describe('fetchDeals carries the five fields', () => {
  it('maps one Первичный отдел deal as the portal sends it', async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const body = `${String(url)} ${String(init?.body ?? '')}`
      const payload = body.includes('crm.deal.fields')
        ? {
            result: {
              [UF.REPEAT_LEAD]: {
                type: 'enumeration',
                items: [
                  { ID: '744', VALUE: 'Такрор - харид қилган' },
                  { ID: '746', VALUE: 'Такрор - обработка' },
                ],
              },
            },
          }
        : {
            result: {
              result: {
                c0: [
                  {
                    ID: '1001',
                    TITLE: 'Lid',
                    CATEGORY_ID: '12',
                    STAGE_ID: 'C12:NEW',
                    STAGE_SEMANTIC_ID: 'P',
                    ASSIGNED_BY_ID: '5',
                    CONTACT_ID: '77',
                    OPPORTUNITY: '0',
                    DATE_CREATE: '2026-09-22T21:40:00+03:00',
                    [UF.LEAD_ARRIVED_AT]: '2026-09-22T21:30:00+03:00',
                    [UF.LEAD_DISTRIBUTED_ON]: '2026-09-23T00:00:00+03:00',
                    [UF.AI_QUALIFIED_AT]: '2026-09-22T23:35:00+03:00',
                    [UF.LEAD_ROP]: '8868',
                    [UF.REPEAT_LEAD]: '746',
                  },
                ],
              },
              result_error: {},
            },
          }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch

    const provider = new Bitrix24CrmProvider({ webhookUrl: 'https://portal/rest/1/tok/', fetchImpl, maxRetries: 0 })
    const page = await provider.fetchDeals()
    const deal = page.items.find((d) => d.externalId === '1001')!

    // 21:30 Moscow is 23:30 Tashkent — the instant is kept exactly.
    expect(deal.leadArrivedAt?.toISOString()).toBe('2026-09-22T18:30:00.000Z')
    expect(deal.leadDistributedOn).toBe('2026-09-23')
    expect(deal.aiQualifiedAt?.toISOString()).toBe('2026-09-22T20:35:00.000Z')
    expect(deal.leadRopExternalId).toBe('8868')
    expect(deal.repeatLead).toBe('PROCESSING')
  })
})
