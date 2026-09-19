import { describe, expect, it } from 'vitest'

import { metaLeads, microUsd } from '@/server/integrations/meta/metaImport'

describe('microUsd — Meta\'s dollar strings, without a float in between', () => {
  it('keeps every cent and every sub-cent Meta sends', () => {
    expect(microUsd('80.36')).toBe(80_360_000n)
    expect(microUsd('398.33')).toBe(398_330_000n)
    expect(microUsd('0.5')).toBe(500_000n)
    expect(microUsd('12')).toBe(12_000_000n)
    expect(microUsd('1.1234567')).toBe(1_123_456n)
  })

  it('reads a missing spend as nothing spent', () => {
    expect(microUsd(undefined)).toBe(0n)
  })
})

describe('metaLeads — Meta\'s own lead count', () => {
  it('reads the `lead` action and ignores the rest', () => {
    expect(
      metaLeads({
        date_start: '2026-08-01',
        actions: [
          { action_type: 'link_click', value: '500' },
          { action_type: 'lead', value: '86' },
          { action_type: 'onsite_conversion.lead_grouped', value: '86' },
        ],
      }),
    ).toBe(86)
  })

  it('is zero on a day with no leads', () => {
    expect(metaLeads({ date_start: '2026-08-01' })).toBe(0)
  })
})
