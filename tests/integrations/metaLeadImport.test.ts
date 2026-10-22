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

  it('never keeps a card or passport number, whatever the question calls it', () => {
    expect(
      leadPhoneKeys({
        id: '1',
        field_data: [
          { name: 'karta_raqamingiz?', values: ['8600 1234 5678 9012'] },
          { name: 'pasport nomeri', values: ['AB 123456789'] },
          { name: 'phone_number', values: ['+998901234567'] },
        ],
      }),
    ).toEqual(['901234567'])
  })

  it('reads a question asked in Cyrillic, and takes neither a Telegram name nor a hotel for a phone', () => {
    expect(
      leadPhoneKeys({
        id: '1',
        field_data: [
          { name: 'Телефон', values: ['+998 93 111-22-33'] },
          { name: 'telegram_username', values: ['@aziza998901234567'] },
          { name: 'hotel', values: ['998901234567'] },
        ],
      }),
    ).toEqual(['931112233'])
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

  /** The form list's writes: an upsert is collected as built, `$transaction` resolves them. */
  const formTable = (listed: Record<string, unknown>[] = [], dropped: unknown[] = []) => ({
    $transaction: async (ops: unknown[]) => ops,
    metaLeadForm: {
      deleteMany: (args: unknown) => {
        dropped.push(args)
        return args
      },
      upsert: ({ create }: { create: Record<string, unknown> }) => {
        listed.push(create)
        return create
      },
    },
  })

  function fakePrisma(newest: { formId: string; at: string; count?: number }[] = []) {
    const written: { id: string }[] = []
    const listed: Record<string, unknown>[] = []
    const dropped: unknown[] = []
    const prisma = {
      ...formTable(listed, dropped),
      metaLead: {
        groupBy: async () =>
          newest.map((n) => ({ formId: n.formId, _max: { createdTime: new Date(n.at) }, _count: { _all: n.count ?? 1 } })),
        createMany: async ({ data, skipDuplicates }: { data: { id: string }[]; skipDuplicates: boolean }) => {
          expect(skipDuplicates).toBe(true)
          written.push(...data)
          return { count: data.length }
        },
      },
    } as unknown as PrismaClient
    return { prisma, written, listed, dropped }
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
        // No Business Manager behind the token: the pages are `me/accounts`' alone (ec97f232).
        if (url.pathname.endsWith('/me/businesses')) return json({ data: [] })
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
              { id: 'f-new', name: 'New form', status: 'ACTIVE', created_time: '2026-10-08T03:12:00+0000', leads_count: 25 },
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

    // «Listed only» has no token of its own, so since ec97f232 it is not counted as a page at all.
    expect(r).toEqual({ pages: 1, forms: 2, leads: 2, failed: [] })
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

  it('writes every form the page lists — quiet and archived ones too — with Meta\'s status, date and lead count', async () => {
    const asked = stubGraph((form) => [lead(`${form}-1`)])
    const { prisma, listed, dropped } = fakePrisma([{ formId: 'f-old', at: '2026-09-01T00:00:00Z' }])
    await importMetaLeads(prisma, 'user-token')

    const list = asked.find((u) => u.pathname.endsWith('/p1/leadgen_forms'))!
    expect(list.searchParams.get('fields')).toBe('id,name,status,created_time,leads_count')
    expect(listed.map((f) => f.id)).toEqual(['f-new', 'f-seen', 'f-old'])
    expect(listed[0]).toMatchObject({
      pageId: 'p1',
      pageName: 'Collagen.marine',
      name: 'New form',
      status: 'ACTIVE',
      createdTime: new Date('2026-10-08T03:12:00Z'),
      leadsCount: 25,
    })
    // Meta left the two out: no date, no count — never a zero.
    expect(listed[2]).toMatchObject({ status: 'ARCHIVED', createdTime: null, leadsCount: null })
    // A form gone from the page's whole list is gone from the table — that page's alone.
    expect(dropped).toEqual([{ where: { pageId: 'p1', id: { notIn: ['f-new', 'f-seen', 'f-old'] } } }])
  })

  it('reads the leads even when the form list cannot be written', async () => {
    stubGraph((form) => [lead(`${form}-1`)])
    const { prisma, written } = fakePrisma()
    ;(prisma as unknown as { $transaction: () => Promise<never> }).$transaction = async () => {
      throw Object.assign(new Error('relation "meta_lead_form" does not exist'), { name: 'PrismaClientKnownRequestError' })
    }
    const r = await importMetaLeads(prisma, 'user-token')
    expect(written).toHaveLength(3)
    expect(r.failed).toEqual(['Collagen.marine: formalar roʻyxati yozilmadi (PrismaClientKnownRequestError)'])
  })

  it('names a form Meta refused and still writes the others', async () => {
    stubGraph((form) => (form === 'f-new' ? new Error('(#200) Requires leads_retrieval') : [lead('ok-1')]))
    const { prisma, written } = fakePrisma()
    const r = await importMetaLeads(prisma, 'user-token')

    expect(r.leads).toBe(2)
    expect(written.map((w) => w.id)).toEqual(['ok-1', 'ok-1'])
    expect(r.failed).toEqual(['Collagen.marine · New form: Meta API 400: (#200) Requires leads_retrieval'])
  })

  it('reads an archived form on the first run only — after it, one with nothing stored is not asked again', async () => {
    const first = stubGraph((form) => (form === 'f-old' ? [] : [lead(`${form}-1`)]))
    await importMetaLeads(fakePrisma().prisma, 'user-token')
    expect(first.filter((u) => u.pathname.endsWith('/leads')).map((u) => u.pathname.split('/').at(-2))).toEqual(['f-new', 'f-seen', 'f-old'])

    const later = stubGraph((form) => [lead(`${form}-1`)])
    await importMetaLeads(fakePrisma([{ formId: 'f-seen', at: '2026-10-08T04:00:00Z' }]).prisma, 'user-token')
    expect(later.filter((u) => u.pathname.endsWith('/leads')).map((u) => u.pathname.split('/').at(-2))).toEqual(['f-new', 'f-seen'])
  })

  it('re-reads a week of every form behind Meta\'s count at night, the archived one too — 2026-10-22', async () => {
    const asked = stubGraph((form) => [lead(`${form}-1`)])
    const { prisma } = fakePrisma([
      { formId: 'f-new', at: '2026-10-08T04:00:00Z', count: 25 }, // caught up: 25 of 25, but ACTIVE
      { formId: 'f-seen', at: '2026-10-08T04:00:00Z' },
      { formId: 'f-old', at: '2026-09-01T00:00:00Z' }, // archived, Meta's count unknown: not behind
    ])
    await importMetaLeads(prisma, 'user-token', undefined, { deep: true })
    const leadCalls = asked.filter((u) => u.pathname.endsWith('/leads'))
    expect(leadCalls.map((u) => u.pathname.split('/').at(-2))).toEqual(['f-new', 'f-seen'])
    expect(JSON.parse(leadCalls[1]!.searchParams.get('filtering')!)).toEqual([
      { field: 'time_created', operator: 'GREATER_THAN', value: Date.parse('2026-10-01T04:00:00Z') / 1000 },
    ])
  })

  it('asks an archived form at night when Meta counts more leads than are stored', async () => {
    const asked = stubGraph((form) => [lead(`${form}-1`)])
    vi.stubGlobal(
      'fetch',
      vi.fn(async (raw: string) => {
        const url = new URL(raw)
        asked.push(url)
        const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
        if (url.pathname.endsWith('/me/businesses')) return json({ data: [] })
        if (url.pathname.endsWith('/me/accounts')) return json({ data: [{ id: 'p1', name: 'P', access_token: 't' }] })
        if (url.pathname.endsWith('/leadgen_forms')) return json({ data: [{ id: 'f-old', name: 'Old', status: 'ARCHIVED', leads_count: 9 }] })
        return json({ data: [lead('f-old-2')] })
      }),
    )
    const { prisma, written } = fakePrisma([{ formId: 'f-old', at: '2026-09-01T00:00:00Z', count: 7 }])
    await importMetaLeads(prisma, 'user-token')
    expect(written).toEqual([])
    await importMetaLeads(prisma, 'user-token', undefined, { deep: true })
    expect(written.map((w) => w.id)).toEqual(['f-old-2'])
  })

  it('stops asking when its time is up, says so, and leaves the rest to the next run', async () => {
    const asked = stubGraph((form) => [lead(`${form}-1`)])
    const { prisma, written } = fakePrisma()
    const r = await importMetaLeads(prisma, 'user-token', 0)

    expect(written).toEqual([])
    expect(asked.some((u) => u.pathname.endsWith('/leads'))).toBe(false)
    expect(r.failed).toEqual(['vaqt tugadi — qolgan formalar keyingi oʻqishda'])
  })

  it('names a failed write by its kind alone — a database error can quote the row, phone keys and all', async () => {
    stubGraph((form) => [lead(`${form}-1`)])
    const prisma = {
      ...formTable(),
      metaLead: {
        groupBy: async () => [],
        createMany: async () => {
          throw Object.assign(new Error('Invalid value: phoneKeys ["901234567"]'), { name: 'PrismaClientValidationError' })
        },
      },
    } as unknown as PrismaClient
    const r = await importMetaLeads(prisma, 'user-token')
    expect(r.failed[0]).toBe('Collagen.marine · New form: yozilmadi (PrismaClientValidationError)')
    expect(r.failed.join(' ')).not.toContain('901234567')
  })
})
