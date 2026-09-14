import { describe, expect, it } from 'vitest'

import { syncErrorCode } from '@/server/services/alertsService'

/**
 * THE WORD THE HEADER PUTS IN FRONT OF A STOPPED CLOCK.
 *
 * On 2026-09-14 the freshness chip went orange and said «13 daqiqa oldin» and
 * nothing else, for fifteen minutes, while Bitrix24 refused every call with
 * `OVERLOAD_LIMIT`. The client read that as a broken refresh button and spent
 * the time reloading a page that was working perfectly. The code is what turns
 * the chip from "something is wrong" into "wait, it clears itself".
 */
describe('the sync error code shown in the header', () => {
  it('takes the portal’s own code out of the provider’s message', () => {
    expect(
      syncErrorCode(
        'Bitrix24 call "batch" failed after 4 attempts: Bitrix24 responded 401 — OVERLOAD_LIMIT: REST API is blocked due to overload.',
      ),
    ).toBe('OVERLOAD_LIMIT')
    expect(syncErrorCode('Bitrix24 error: QUERY_LIMIT_EXCEEDED')).toBe('QUERY_LIMIT_EXCEEDED')
    expect(syncErrorCode('Bitrix24 responded 401 — NO_AUTH_FOUND')).toBe('NO_AUTH_FOUND')
  })

  /*
    The words in the portal's own sentence are not codes. «REST» and «API» are
    the two that actually appear — in the description of the very error this
    was written for — and a chip reading «REST» explains nothing at all.
  */
  it('does not mistake a word in the description for a code', () => {
    expect(syncErrorCode('Bitrix24 responded 503 — REST API unavailable')).toBe('HTTP 503')
  })

  it('falls back to the status, then to UNKNOWN', () => {
    expect(syncErrorCode('Bitrix24 responded 500')).toBe('HTTP 500')
    expect(syncErrorCode('socket hang up')).toBe('UNKNOWN')
    expect(syncErrorCode(null)).toBe('UNKNOWN')
    expect(syncErrorCode('')).toBe('UNKNOWN')
  })
})
