import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'

import {
  campaignStarts,
  dateSlices,
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
        aggregate: async () => ({ _max: { date: new Date('2026-09-20T00:00:00Z') } }),
        groupBy: async () => [],
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

  it('still fails loudly when no account at all could be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(refusal), { status: 400 })))
    const { prisma } = fakePrisma()
    await expect(importMetaSpend(prisma, 'token', '2026-09-23')).rejects.toThrow(/hech bir akkaunt/)
  })
})

describe('campaignStarts — every account gets its whole campaign history, even after an interrupted run', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
  const adMin = new Map([
    ['full', d('2026-07-01')],
    ['cut', d('2026-07-01')],
    ['new', d('2026-07-01')],
    ['young', d('2026-08-15')],
  ])
  const from = campaignStarts(
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
    const f = campaignStarts(
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
