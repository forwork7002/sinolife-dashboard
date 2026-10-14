import { describe, expect, it } from 'vitest'

import { adFormOf } from '@/server/integrations/meta/metaAdFormImport'

/**
 * Which form an ad points at, off its creative (2026-10-14) — the shapes
 * Meta answered for the token's ads that day.
 */
describe('adFormOf', () => {
  it('reads a link ad\'s call to action and its page', () => {
    const ad = {
      id: '1',
      creative: {
        actor_id: '999',
        object_story_spec: {
          page_id: '468913109633234',
          link_data: { call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: '2052029759508941' } } },
        },
      },
    }
    expect(adFormOf(ad)).toEqual({ formId: '2052029759508941', pageId: '468913109633234' })
  })

  it('reads a dynamic creative\'s asset feed, and the actor as the page when no story names one', () => {
    const ad = {
      id: '2',
      creative: {
        actor_id: '492172130644194',
        asset_feed_spec: { call_to_actions: [{ type: 'SIGN_UP', value: { lead_gen_form_id: '1805583727102331' } }] },
      },
    }
    expect(adFormOf(ad)).toEqual({ formId: '1805583727102331', pageId: '492172130644194' })
  })

  it('names no form for a creative without one, or no creative at all', () => {
    expect(adFormOf({ id: '3', creative: { object_story_spec: { page_id: '1' } } })).toEqual({ formId: '', pageId: '1' })
    expect(adFormOf({ id: '4' })).toEqual({ formId: '', pageId: '' })
  })
})
