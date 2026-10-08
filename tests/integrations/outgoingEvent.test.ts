import { describe, expect, it } from 'vitest'

import {
  parseOutgoingDealEvent,
  portalHost,
  tokenMatches,
} from '@/server/integrations/crm/bitrix24/outgoingEvent'

/**
 * A Bitrix24 outgoing webhook, as the portal POSTs it — form-encoded, with
 * the deal id under `data[FIELDS][ID]` and the application token under
 * `auth[application_token]`. The handler deletes or re-reads whatever these
 * name, so the parse has to be strict about the id and the event.
 */

const body = (over: Record<string, string> = {}) =>
  new URLSearchParams({
    event: 'ONCRMDEALDELETE',
    event_handler_id: '12',
    'data[FIELDS][ID]': '1050732',
    ts: '1759900000',
    'auth[domain]': 'obey.bitrix24.kz',
    'auth[client_endpoint]': 'https://obey.bitrix24.kz/rest/',
    'auth[server_endpoint]': 'https://oauth.bitrix.info/rest/',
    'auth[member_id]': 'abc',
    'auth[application_token]': 'tok123',
    ...over,
  }).toString()

describe('parseOutgoingDealEvent', () => {
  it('reads a deal deletion', () => {
    expect(parseOutgoingDealEvent(body())).toEqual({
      event: 'ONCRMDEALDELETE',
      externalId: '1050732',
      applicationToken: 'tok123',
      domain: 'obey.bitrix24.kz',
    })
  })

  it('accepts add and update, whatever the case the portal spells them in', () => {
    expect(parseOutgoingDealEvent(body({ event: 'ONCRMDEALADD' }))?.event).toBe('ONCRMDEALADD')
    expect(parseOutgoingDealEvent(body({ event: 'onCrmDealUpdate' }))?.event).toBe('ONCRMDEALUPDATE')
  })

  it('drops events about other entities', () => {
    expect(parseOutgoingDealEvent(body({ event: 'ONCRMCONTACTUPDATE' }))).toBeNull()
    expect(parseOutgoingDealEvent(body({ event: 'ONCRMLEADDELETE' }))).toBeNull()
  })

  it('drops a body without a digit-only deal id', () => {
    expect(parseOutgoingDealEvent(body({ 'data[FIELDS][ID]': '' }))).toBeNull()
    expect(parseOutgoingDealEvent(body({ 'data[FIELDS][ID]': '12abc' }))).toBeNull()
    expect(parseOutgoingDealEvent(body({ 'data[FIELDS][ID]': "1' OR 1=1" }))).toBeNull()
    expect(parseOutgoingDealEvent('event=ONCRMDEALDELETE&auth[application_token]=t')).toBeNull()
  })

  it('drops a body without a token', () => {
    expect(parseOutgoingDealEvent(body({ 'auth[application_token]': '' }))).toBeNull()
  })

  it('survives garbage', () => {
    expect(parseOutgoingDealEvent('')).toBeNull()
    expect(parseOutgoingDealEvent('{"event":"ONCRMDEALDELETE"}')).toBeNull()
  })
})

describe('tokenMatches', () => {
  it('matches only the exact token', () => {
    expect(tokenMatches('tok123', 'tok123')).toBe(true)
    expect(tokenMatches('tok124', 'tok123')).toBe(false)
    expect(tokenMatches('tok12', 'tok123')).toBe(false)
    expect(tokenMatches('', '')).toBe(false)
  })
})

describe('portalHost', () => {
  it('is the host of the incoming webhook URL', () => {
    expect(portalHost('https://obey.bitrix24.kz/rest/1/abc/')).toBe('obey.bitrix24.kz')
    expect(portalHost('not a url')).toBeNull()
  })
})
