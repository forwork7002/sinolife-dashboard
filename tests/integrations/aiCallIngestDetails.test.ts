import { describe, expect, it } from 'vitest'

import { aiCallSchema } from '@/server/integrations/aiRegistrator/ingest'

/** A finished call's 2026-11-02 fields (ai_registrator ca9c52a): optional, each falling back to null alone. Fake data only. */

const base = {
  callId: 'c-1',
  dealId: 1001,
  startedAt: '2026-11-02T05:00:00+00:00',
  endedAt: '2026-11-02T05:01:00+00:00',
  outcome: 'no_answer',
}

describe('aiCallSchema — line, product, client, lead status, next attempt', () => {
  it('stores them, and never a digit in the client name', () => {
    const call = aiCallSchema.parse({ ...base, extension: '290', product: 'Collagen', client: 'Aziz +998 90', leadStatus: 'queued', nextAttemptAt: '2026-11-02T07:00:00+00:00' })
    expect(call).toMatchObject({ extension: '290', product: 'Collagen', client: 'Aziz', leadStatus: 'queued', nextAttemptAt: '2026-11-02T07:00:00+00:00' })
  })

  it('takes a push without them, or with one wrong, as before', () => {
    expect(aiCallSchema.parse(base)).toMatchObject({ extension: null, product: null, client: null, leadStatus: null, nextAttemptAt: null })
    const wrong = aiCallSchema.parse({ ...base, leadStatus: 'In Queue!', nextAttemptAt: 'later', outcome: 'ats_rejected' })
    expect(wrong).toMatchObject({ leadStatus: null, nextAttemptAt: null, outcome: 'ats_rejected' })
  })
})
