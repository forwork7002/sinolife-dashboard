import { describe, expect, it } from 'vitest'

import { syncFailureScope } from '@/lib/format'

/**
 * A STOPPED SYNC IS A CLAIM ABOUT HOW MUCH OF THE SCREEN IS STALE.
 *
 * On 2026-09-15 Bitrix24 answered every REST call `401 INVALID_CREDENTIALS`
 * for an hour — twelve entities, every number on every screen frozen at 10:47.
 * The header's tooltip said «(INVALID_CREDENTIALS, stage_history)», because
 * the entity it names is whichever pass happened to fail LAST. Stage history
 * is the narrowest thing on the portal; a reader who knows what it is would
 * have concluded the deal figures were current, and they were an hour old.
 *
 * The scope is the fact a person needs to decide whether to phone somebody.
 * The name of the last importer is not.
 */
describe('how wide the header says a stopped sync is', () => {
  it('counts the entities when more than one is down', () => {
    expect(syncFailureScope({ entity: 'STAGE_HISTORY', entities: 12 })).toBe('12 ta boʻlim')
  })

  /*
    One really is one: naming it is more useful than «1 ta boʻlim», and this is
    the ordinary case — a single importer failing while the rest of the
    dashboard is being fed normally.
  */
  it('names the entity when only that entity is down', () => {
    expect(syncFailureScope({ entity: 'CALLS', entities: 1 })).toBe('calls')
  })

  /*
    Null is "not counted", NOT "narrow". It happens when there is no last
    success to bound the count against, and inventing a scope there would be
    the same error in the other direction.
  */
  it('falls back to the entity when the count could not be bounded', () => {
    expect(syncFailureScope({ entity: 'DEALS', entities: null })).toBe('deals')
  })

  it('says nothing at all when the sync is healthy', () => {
    expect(syncFailureScope(null)).toBe('')
    expect(syncFailureScope(undefined)).toBe('')
  })
})
