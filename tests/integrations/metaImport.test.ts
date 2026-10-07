import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'

import {
  adInsightRow,
  dateSlices,
  grainStarts,
  importMetaSpend,
  metaConversations,
  metaLeads,
  microUsd,
} from '@/server/integrations/meta/metaImport'

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

describe('metaConversations — people who wrote to the page from the ad', () => {
  it('reads the conversation-started action and ignores replies and depth', () => {
    expect(
      metaConversations({
        date_start: '2026-09-01',
        actions: [
          { action_type: 'onsite_conversion.messaging_conversation_replied_7d', value: '10392' },
          { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '10623' },
          { action_type: 'onsite_conversion.messaging_user_depth_2_message_send', value: '10007' },
        ],
      }),
    ).toBe(10623)
  })

  it('is zero on a lead-form campaign', () => {
    expect(metaConversations({ date_start: '2026-09-01', actions: [{ action_type: 'lead', value: '5' }] })).toBe(0)
  })
})

describe('dateSlices — the campaign backfill, a month at a time', () => {
  it('covers every day once, the last slice cut short at the end', () => {
    expect(dateSlices('2026-07-01', '2026-09-23', 31)).toEqual([
      { since: '2026-07-01', until: '2026-07-31' },
      { since: '2026-08-01', until: '2026-08-31' },
      { since: '2026-09-01', until: '2026-09-23' },
    ])
  })

  it('is one slice for the weekly refresh', () => {
    expect(dateSlices('2026-09-16', '2026-09-23', 31)).toEqual([{ since: '2026-09-16', until: '2026-09-23' }])
  })
})

describe('importMetaSpend — one refused account does not stop the rest', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** A Prisma that records writes and knows two accounts from earlier runs. */
  function fakePrisma() {
    const written: string[] = []
    const prisma = {
      metaAdDaily: {
        // Two accounts that have spent before — the ad grain only asks those (and any spending now).
        groupBy: async () => [
          { accountId: '990016692137088', _min: { date: new Date('2026-07-01T00:00:00Z') }, _max: { date: new Date('2026-09-20T00:00:00Z') } },
          { accountId: '1356045995688768', _min: { date: new Date('2026-07-01T00:00:00Z') }, _max: { date: new Date('2026-09-20T00:00:00Z') } },
        ],
        findMany: async () => [
          { accountId: '990016692137088', accountName: 'Umar - 64' },
          { accountId: '440073592484616', accountName: 'Zextra Umar' },
        ],
        deleteMany: (args: { where: { accountId: string } }) => `delete ${args.where.accountId}`,
        createMany: () => 'create',
      },
      metaCampaignDaily: {
        groupBy: async () => [],
        deleteMany: (args: { where: { accountId: string } }) => `delete ${args.where.accountId}`,
        createMany: () => 'create',
      },
      metaAdInsightDaily: {
        groupBy: async () => [],
        deleteMany: (args: { where: { accountId: string } }) => `delete-ads ${args.where.accountId}`,
        createMany: () => 'create',
      },
      $transaction: async (ops: string[]) => {
        written.push(...ops.filter((op) => op.startsWith('delete')))
        return []
      },
    } as unknown as PrismaClient
    return { prisma, written }
  }

  const refusal = { error: { message: 'There have been too many calls to this ad-account.', code: 80004 } }

  it('falls back to the known accounts when Meta refuses to list them — 2026-09-23', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/me/adaccounts')) return new Response(JSON.stringify(refusal), { status: 400 })
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }),
    )
    const { prisma, written } = fakePrisma()
    const r = await importMetaSpend(prisma, 'token', '2026-09-23')

    // The two known accounts plus every mapped one, each read.
    expect(r.accounts).toBeGreaterThanOrEqual(14)
    expect(r.failed).toEqual([])
    expect(written).toContain('delete 990016692137088')
    expect(written).toContain('delete 926218346480236') // Zextra Kamron 1, mapped only
  })

  it('skips an account Meta refuses and writes the others', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/me/adaccounts')) {
          return new Response(
            JSON.stringify({
              data: [
                { account_id: '990016692137088', name: 'Umar - 64' },
                { account_id: '1356045995688768', name: 'Zextra Kamron 3' },
              ],
            }),
          )
        }
        if (url.includes('act_1356045995688768')) return new Response(JSON.stringify(refusal), { status: 400 })
        return new Response(JSON.stringify({ data: [] }))
      }),
    )
    const { prisma, written } = fakePrisma()
    const r = await importMetaSpend(prisma, 'token', '2026-09-23')

    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]).toContain('Zextra Kamron 3')
    expect(written).toContain('delete 990016692137088')
    expect(written).not.toContain('delete 1356045995688768')
  })

  it('keeps an account\'s spend and campaign rows when only its ad grain is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/me/adaccounts')) {
          return new Response(
            JSON.stringify({
              data: [
                { account_id: '990016692137088', name: 'Umar - 64' },
                { account_id: '1356045995688768', name: 'Zextra Kamron 3' },
              ],
            }),
          )
        }
        if (url.includes('act_1356045995688768') && url.includes('level=ad&')) {
          return new Response(JSON.stringify(refusal), { status: 400 })
        }
        return new Response(JSON.stringify({ data: [] }))
      }),
    )
    const { prisma, written } = fakePrisma()
    const r = await importMetaSpend(prisma, 'token', '2026-09-23')

    // Account and campaign grains of the refused account were written…
    expect(written.filter((op) => op === 'delete 1356045995688768')).toHaveLength(2)
    // …its ad window was left alone, the other account's was replaced…
    expect(written).not.toContain('delete-ads 1356045995688768')
    expect(written).toContain('delete-ads 990016692137088')
    // …and the refusal is still reported, named as the ad grain's.
    expect(r.failed).toEqual([expect.stringContaining('Zextra Kamron 3 · eʼlon darajasi')])
  })

  it('does not call the run a total failure when only the ad grain is refused everywhere', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/me/adaccounts')) {
          return new Response(JSON.stringify({ data: [{ account_id: '990016692137088', name: 'Umar - 64' }] }))
        }
        if (url.includes('level=ad&')) return new Response(JSON.stringify(refusal), { status: 400 })
        return new Response(JSON.stringify({ data: [] }))
      }),
    )
    const { prisma } = fakePrisma()
    const r = await importMetaSpend(prisma, 'token', '2026-09-23')
    expect(r.failed).toHaveLength(1)
    expect(r.adRows).toBe(0)
  })

  it('does not ask an account that has never spent for its ads — it would re-read July every hour', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/me/adaccounts')) {
        return new Response(
          JSON.stringify({
            data: [
              { account_id: '4016900891780426', name: 'Zapas Collagen' }, // no history, no spend now
              { account_id: '1592588735796463', name: 'Zextra Umar 3' }, // no history, spends today
            ],
          }),
        )
      }
      if (url.includes('act_1592588735796463') && url.includes('level=account')) {
        return new Response(JSON.stringify({ data: [{ date_start: '2026-09-23', spend: '4.0' }] }))
      }
      return new Response(JSON.stringify({ data: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { prisma } = fakePrisma()
    await importMetaSpend(prisma, 'token', '2026-09-23')

    const adAccounts = fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .filter((u) => u.searchParams.get('level') === 'ad')
      .map((u) => u.pathname.split('/').find((part) => part.startsWith('act_')))
    expect(new Set(adAccounts)).toEqual(new Set(['act_1592588735796463']))
  })

  it('reads the ad grain from the history start in fourteen-day slices, GET only', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/me/adaccounts')) {
        return new Response(JSON.stringify({ data: [{ account_id: '990016692137088', name: 'Umar - 64' }] }))
      }
      if (url.includes('level=ad&')) {
        return new Response(
          JSON.stringify({
            data: [
              { date_start: '2026-09-22', ad_id: '120001', adset_id: '110001', campaign_id: '100001', spend: '1.5' },
              { date_start: '2026-09-22', campaign_id: '100001', spend: '9.0' }, // no ad_id: skipped
            ],
          }),
        )
      }
      return new Response(JSON.stringify({ data: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { prisma } = fakePrisma()
    const r = await importMetaSpend(prisma, 'token', '2026-10-05')

    const adCalls = fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .filter((u) => u.searchParams.get('level') === 'ad')
    const ranges = adCalls.map((u) => JSON.parse(u.searchParams.get('time_range')!) as { since: string; until: string })
    // An empty table: 2026-07-01 → 2026-10-05 is 97 days, seven slices.
    expect(ranges).toHaveLength(7)
    expect(ranges[0]).toEqual({ since: '2026-07-01', until: '2026-07-14' })
    expect(ranges.at(-1)).toEqual({ since: '2026-09-23', until: '2026-10-05' })
    expect(adCalls[0]!.searchParams.get('fields')).toBe(
      'campaign_id,campaign_name,objective,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,actions',
    )
    expect(adCalls[0]!.searchParams.get('time_increment')).toBe('1')
    // Every request of the pass is a plain GET — no init, no method.
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true)
    // One row per slice answered, the ad_id-less one dropped each time.
    expect(r.adRows).toBe(7)
  })

  it('still fails loudly when no account at all could be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(refusal), { status: 400 })))
    const { prisma } = fakePrisma()
    await expect(importMetaSpend(prisma, 'token', '2026-09-23')).rejects.toThrow(/hech bir akkaunt/)
  })
})

describe('importMetaSpend — the account grain starts per account, never at the table\'s latest day', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads a new account from the history start and a long-refused one from its own last week', async () => {
    const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
    const deleted = new Map<string, string>()
    const prisma = {
      metaAdDaily: {
        // The table runs to 05.10; Kamron 3 was refused from 11.09; Kamron 2 is new to the token.
        groupBy: async () => [
          { accountId: '990016692137088', _min: { date: day('2026-07-01') }, _max: { date: day('2026-10-05') } },
          { accountId: '1356045995688768', _min: { date: day('2026-07-01') }, _max: { date: day('2026-09-10') } },
        ],
        deleteMany: (args: { where: { accountId: string; date: { gte: Date } } }) => {
          deleted.set(args.where.accountId, args.where.date.gte.toISOString().slice(0, 10))
          return 'delete'
        },
        createMany: () => 'create',
      },
      metaCampaignDaily: { groupBy: async () => [], deleteMany: () => 'delete', createMany: () => 'create' },
      metaAdInsightDaily: { groupBy: async () => [], deleteMany: () => 'delete', createMany: () => 'create' },
      $transaction: async () => [],
    } as unknown as PrismaClient
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/me/adaccounts')) {
        return new Response(
          JSON.stringify({
            data: [
              { account_id: '990016692137088', name: 'Umar - 64' },
              { account_id: '1356045995688768', name: 'Zextra Kamron 3' },
              { account_id: '1075542260705572', name: 'Zextra Kamron 2' },
            ],
          }),
        )
      }
      return new Response(JSON.stringify({ data: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await importMetaSpend(prisma, 'token', '2026-10-06')

    const accountGrainSince = new Map(
      fetchMock.mock.calls
        .map(([url]) => new URL(url))
        .filter((u) => u.searchParams.get('level') === 'account')
        .map((u) => [
          u.pathname.split('/').find((part) => part.startsWith('act_'))!,
          (JSON.parse(u.searchParams.get('time_range')!) as { since: string }).since,
        ]),
    )
    expect(accountGrainSince).toEqual(
      new Map([
        ['act_990016692137088', '2026-09-28'], // its own last week
        ['act_1356045995688768', '2026-09-03'], // a week before its own last day, not the table's
        ['act_1075542260705572', '2026-07-01'], // no rows yet: the whole history
      ]),
    )
    // Each account's window is the one replaced.
    expect(deleted).toEqual(
      new Map([
        ['990016692137088', '2026-09-28'],
        ['1356045995688768', '2026-09-03'],
        ['1075542260705572', '2026-07-01'],
      ]),
    )
    // The log's window is the refresh of the accounts that have rows: Kamron 2's July backfill does not pin it there.
    expect(r.since).toBe('2026-09-03')
  })

  it('logs the history start as the window on the first run, when no account has rows yet', async () => {
    const prisma = {
      metaAdDaily: { groupBy: async () => [], deleteMany: () => 'delete', createMany: () => 'create' },
      metaCampaignDaily: { groupBy: async () => [], deleteMany: () => 'delete', createMany: () => 'create' },
      metaAdInsightDaily: { groupBy: async () => [], deleteMany: () => 'delete', createMany: () => 'create' },
      $transaction: async () => [],
    } as unknown as PrismaClient
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/me/adaccounts')
          ? new Response(JSON.stringify({ data: [{ account_id: '990016692137088', name: 'Umar - 64' }] }))
          : new Response(JSON.stringify({ data: [] })),
      ),
    )
    const r = await importMetaSpend(prisma, 'token', '2026-10-06')
    expect(r.since).toBe('2026-07-01')
  })
})

describe('grainStarts — every account gets its whole campaign history, even after an interrupted run', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
  const adMin = new Map([
    ['full', d('2026-07-01')],
    ['cut', d('2026-07-01')],
    ['new', d('2026-07-01')],
    ['young', d('2026-08-15')],
  ])
  const from = grainStarts(
    adMin,
    new Map([
      // Backfilled before the 07:08 deploy killed the worker.
      ['full', { min: d('2026-07-01'), max: d('2026-09-23') }],
      // Only the week the next pass read.
      ['cut', { min: d('2026-09-16'), max: d('2026-09-23') }],
      ['young', { min: d('2026-08-15'), max: d('2026-09-23') }],
    ]),
  )

  it('refreshes one week for an account that already has its history', () => {
    expect(from('full')).toBe('2026-09-16')
    expect(from('young')).toBe('2026-09-16')
  })

  it('reads from the history start an account whose campaign rows start late — the 2026-09-23 gap', () => {
    expect(from('cut')).toBe('2026-07-01')
  })

  it('does not re-read forever an account whose early campaigns Meta no longer reports', () => {
    const f = grainStarts(
      new Map([['old', d('2026-07-01')]]),
      // Backfilled once; Meta returned nothing before 10 August.
      new Map([['old', { min: d('2026-08-10'), max: d('2026-09-23') }]]),
    )
    expect(f('old')).toBe('2026-09-16')
  })

  it('reads an account with no campaign rows from the history start', () => {
    expect(from('new')).toBe('2026-07-01')
    expect(from('never-seen')).toBe('2026-07-01')
  })
})

describe('grainStarts — the ad grain, on the table it fills', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
  const adMin = new Map([
    ['umar', d('2026-07-01')],
    ['kamron3', d('2026-09-10')],
  ])

  it('backfills every account from its own history start while the table is empty', () => {
    const from = grainStarts(adMin, new Map())
    expect(from('umar')).toBe('2026-07-01')
    expect(from('kamron3')).toBe('2026-09-10')
    expect(from('never-seen')).toBe('2026-07-01')
  })

  it('refreshes the last week once the backfill is in', () => {
    const from = grainStarts(
      adMin,
      new Map([
        ['umar', { min: d('2026-07-01'), max: d('2026-10-05') }],
        ['kamron3', { min: d('2026-09-10'), max: d('2026-10-05') }],
      ]),
    )
    expect(from('umar')).toBe('2026-09-28')
    expect(from('kamron3')).toBe('2026-09-28')
  })

  it('re-reads from the start an account whose first backfill was cut off after a week', () => {
    const from = grainStarts(adMin, new Map([['umar', { min: d('2026-09-28'), max: d('2026-10-05') }]]))
    expect(from('umar')).toBe('2026-07-01')
  })
})

describe('dateSlices — the ad grain, a fortnight at a time', () => {
  it('cuts the backfill into fourteen-day slices with no day lost or repeated', () => {
    const slices = dateSlices('2026-07-01', '2026-10-05', 14)
    expect(slices).toHaveLength(7)
    expect(slices.slice(0, 2)).toEqual([
      { since: '2026-07-01', until: '2026-07-14' },
      { since: '2026-07-15', until: '2026-07-28' },
    ])
    expect(slices.at(-1)).toEqual({ since: '2026-09-23', until: '2026-10-05' })
    const days = (s: { since: string; until: string }) =>
      (Date.parse(`${s.until}T00:00:00Z`) - Date.parse(`${s.since}T00:00:00Z`)) / 86_400_000 + 1
    expect(slices.every((s) => days(s) <= 14)).toBe(true)
    expect(slices.reduce((n, s) => n + days(s), 0)).toBe(97)
  })

  it('is one slice for the hourly refresh', () => {
    expect(dateSlices('2026-09-28', '2026-10-05', 14)).toEqual([{ since: '2026-09-28', until: '2026-10-05' }])
  })
})

describe('adInsightRow — one ad on one day', () => {
  const account = { account_id: '990016692137088', name: 'Umar - 64' }

  it('keeps the ad, its ad set and campaign, and reads reach and the lead action', () => {
    expect(
      adInsightRow(account, {
        date_start: '2026-10-04',
        campaign_id: '100001',
        campaign_name: 'IF-15.01 lead',
        objective: 'OUTCOME_LEADS',
        adset_id: '110001',
        adset_name: 'Toshkent 25-45',
        ad_id: '120001',
        ad_name: 'Video 3',
        spend: '12.34',
        impressions: '5120',
        reach: '3987',
        clicks: '141',
        actions: [
          { action_type: 'link_click', value: '120' },
          { action_type: 'lead', value: '9' },
        ],
      }),
    ).toEqual({
      accountId: '990016692137088',
      accountName: 'Umar - 64',
      campaignId: '100001',
      campaignName: 'IF-15.01 lead',
      objective: 'OUTCOME_LEADS',
      adsetId: '110001',
      adsetName: 'Toshkent 25-45',
      adId: '120001',
      adName: 'Video 3',
      date: new Date('2026-10-04T00:00:00Z'),
      spendMicroUsd: 12_340_000n,
      impressions: 5120n,
      reach: 3987n,
      clicks: 141n,
      leads: 9,
    })
  })

  it('reads a missing or empty count as zero and a missing name as empty', () => {
    const row = adInsightRow(account, { date_start: '2026-10-04', ad_id: '120002', reach: '' })
    expect(row).toMatchObject({
      adId: '120002',
      adName: '',
      adsetId: '',
      campaignName: '',
      reach: 0n,
      impressions: 0n,
      clicks: 0n,
      spendMicroUsd: 0n,
      leads: 0,
    })
  })

  it('skips a row without an ad id', () => {
    expect(adInsightRow(account, { date_start: '2026-10-04', campaign_id: '100001', spend: '3.00' })).toBeNull()
  })
})
