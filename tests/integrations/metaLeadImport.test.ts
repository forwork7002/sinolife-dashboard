import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '@/generated/prisma/client'

import { importMetaLeads, leadPhoneKeys, metaLeadRow } from '@/server/integrations/meta/metaLeadImport'

describe('leadPhoneKeys — the numbers a lead is met with the portal by', () => {
  it('keeps the form\'s own phone and the typed one, each as its last nine digits', () => {
    expect(
      leadPhoneKeys({
        id: '1',
        field_data: [
          { name: 'full_name', values: ['Aziza 998901234567'] },
          { name: 'phone_number', values: ['+998 90 123-45-67'] },
          { name: 'telefon_raqamingiz?', values: ['931112233'] },
        ],
      }),
    ).toEqual(['901234567', '931112233'])
  })

  it('folds one number written two ways and drops what is too short to be one', () => {
    expect(
      leadPhoneKeys({
        id: '1',
        field_data: [
          { name: 'phone_number', values: ['+998901234567'] },
          { name: 'Телефон номер', values: ['90 123 45 67', '12345'] },
        ],
      }),
    ).toEqual(['901234567'])
  })

  it('is empty for a lead with no phone question', () => {
    expect(leadPhoneKeys({ id: '1', field_data: [{ name: 'ismingiz?', values: ['Olim'] }] })).toEqual([])
    expect(leadPhoneKeys({ id: '1' })).toEqual([])
  })
})

describe('metaLeadRow', () => {
  const form = { id: 'f1', name: 'Collagen (UMAR)' }

  it('carries the campaign and ad, and no name or answer', () => {
    const row = metaLeadRow({ id: 'p1' }, form, {
      id: 'l1',
      created_time: '2026-10-08T05:14:55+0000',
      campaign_id: 'c1',
      adset_id: 's1',
      ad_id: 'a1',
      field_data: [
        { name: 'full_name', values: ['Aziza'] },
        { name: 'phone_number', values: ['+998901234567'] },
      ],
    })
    expect(row).toEqual({
      id: 'l1',
      pageId: 'p1',
      formId: 'f1',
      formName: 'Collagen (UMAR)',
      campaignId: 'c1',
      adsetId: 's1',
      adId: 'a1',
      phoneKeys: ['901234567'],
      createdTime: new Date('2026-10-08T05:14:55Z'),
    })
  })

  it('keeps an organic lead with an empty campaign, and drops one with no time', () => {
    expect(metaLeadRow({ id: 'p1' }, form, { id: 'l2', created_time: '2026-10-08T05:00:00+0000' })).toMatchObject({
      campaignId: '',
      phoneKeys: [],
    })
    expect(metaLeadRow({ id: 'p1' }, form, { id: 'l3' })).toBeNull()
  })
})

describe('importMetaLeads', () => {
  afterEach(() => vi.unstubAllGlobals())

  function fakePrisma(newest: { formId: string; at: string }[] = []) {
    const written: { id: string }[] = []
    const prisma = {
      metaLead: {
        groupBy: async () => newest.map((n) => ({ formId: n.formId, _max: { createdTime: new Date(n.at) } })),
        createMany: async ({ data, skipDuplicates }: { data: { id: string }[]; skipDuplicates: boolean }) => {
          expect(skipDuplicates).toBe(true)
          written.push(...data)
          return { count: data.length }
        },
      },
    } as unknown as PrismaClient
    return { prisma, written }
  }

  const lead = (id: string) => ({
    id,
    created_time: '2026-10-08T05:00:00+0000',
    campaign_id: 'c1',
    field_data: [{ name: 'phone_number', values: ['+998901234567'] }],
  })

  function stubGraph(leadsOf: (formId: string, url: URL) => unknown) {
    const asked: URL[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (raw: string) => {
        const url = new URL(raw)
        asked.push(url)
        const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body })
        if (url.pathname.endsWith('/me/accounts')) {
          return json({
            data: [
              { id: 'p1', name: 'Collagen.marine', access_token: 'page-token' },
              { id: 'p2', name: 'Listed only' },
            ],
          })
        }
        if (url.pathname.endsWith('/p1/leadgen_forms')) {
          return json({
            data: [
              { id: 'f-new', name: 'New form', status: 'ACTIVE' },
              { id: 'f-seen', name: 'Seen form', status: 'ACTIVE' },
              { id: 'f-old', name: 'Archived form', status: 'ARCHIVED' },
            ],
          })
        }
        const form = /\/(f-[a-z]+)\/leads$/.exec(url.pathname)?.[1]
        if (form) {
          const body = leadsOf(form, url)
          return body instanceof Error ? json({ error: { message: body.message } }, false) : json({ data: body })
        }
        throw new Error(`unexpected ${url.pathname}`)
      }),
    )
    return asked
  }

  it('reads a new form whole, a seen one since its newest lead, and leaves an archived one it has read', async () => {
    const asked = stubGraph((form) => [lead(`${form}-1`)])
    const { prisma, written } = fakePrisma([
      { formId: 'f-seen', at: '2026-10-08T04:00:00Z' },
      { formId: 'f-old', at: '2026-09-01T00:00:00Z' },
    ])
    const r = await importMetaLeads(prisma, 'user-token')

    expect(r).toEqual({ pages: 2, forms: 2, leads: 2, failed: [] })
    expect(written.map((w) => w.id)).toEqual(['f-new-1', 'f-seen-1'])

    const leadCalls = asked.filter((u) => u.pathname.endsWith('/leads'))
    expect(leadCalls.map((u) => u.pathname.split('/').at(-2))).toEqual(['f-new', 'f-seen'])
    // The page's own token, never the user's, and an hour's overlap behind the newest lead.
    expect(leadCalls.every((u) => u.searchParams.get('access_token') === 'page-token')).toBe(true)
    expect(leadCalls[0]!.searchParams.get('filtering')).toBeNull()
    expect(JSON.parse(leadCalls[1]!.searchParams.get('filtering')!)).toEqual([
      { field: 'time_created', operator: 'GREATER_THAN', value: Date.parse('2026-10-08T03:00:00Z') / 1000 },
    ])
    // A page listed without a token of its own is not asked for forms.
    expect(asked.some((u) => u.pathname.includes('/p2/'))).toBe(false)
  })

  it('names a form Meta refused and still writes the others', async () => {
    stubGraph((form) => (form === 'f-new' ? new Error('(#200) Requires leads_retrieval') : [lead('ok-1')]))
    const { prisma, written } = fakePrisma()
    const r = await importMetaLeads(prisma, 'user-token')

    expect(r.leads).toBe(2)
    expect(written.map((w) => w.id)).toEqual(['ok-1', 'ok-1'])
    expect(r.failed).toEqual(['Collagen.marine · New form: Meta API 400: (#200) Requires leads_retrieval'])
  })
})
