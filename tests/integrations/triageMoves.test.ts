import { describe, expect, it } from 'vitest'

import { Bitrix24CrmProvider } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'
import { rereadClosedTriageDeals } from '@/server/integrations/crm/sync/triageMoves'

/**
 * «ИИ обработка» → Регистрация moves leave DATE_MODIFY alone (deals 1063094,
 * 1064380, 1065836 in October 2026), so the worker re-reads the closed triage
 * deals by id. These pin the by-id read and the re-read's bookkeeping.
 */

type Row = Record<string, string>

/** A portal that answers `crm.deal.fields` and each by-id `crm.deal.list` command. */
function portal(rowOf: (id: string) => Row | null) {
  const batches: Record<string, string>[] = []

  const fetchImpl = (async (url: string, init: { body: string }) => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.includes('crm.deal.fields')) return json({ result: {} })

    const { cmd } = JSON.parse(init.body) as { cmd: Record<string, string> }
    batches.push(cmd)
    const result: Record<string, unknown> = {}
    for (const [key, command] of Object.entries(cmd)) {
      const ids = [...command.matchAll(/filter%5BID%5D%5B\d+%5D=(\d+)|filter\[ID\]\[\d+\]=(\d+)/g)].map(
        (m) => m[1] ?? m[2]!,
      )
      result[key] = ids.map(rowOf).filter((r): r is Row => r !== null)
    }
    return json({ result: { result, result_error: {} } })
  }) as unknown as typeof fetch

  return {
    batches,
    provider: new Bitrix24CrmProvider({ webhookUrl: 'https://portal/rest/1/tok/', fetchImpl, maxRetries: 0 }),
  }
}

const deal = (ID: string, CATEGORY_ID: string, STAGE_ID: string, STAGE_SEMANTIC_ID: string): Row => ({
  ID,
  TITLE: `${ID} - sinolifeuz instagram`,
  CATEGORY_ID,
  STAGE_ID,
  STAGE_SEMANTIC_ID,
  ASSIGNED_BY_ID: '1',
  SOURCE_ID: 'UC_0FMQ5Q',
  DATE_CREATE: '2026-10-04T11:33:20+03:00',
  DATE_MODIFY: '2026-10-04T11:40:52+03:00',
})

describe('fetchDealsByIds', () => {
  it('reads exactly those deals, in full, where the portal has them now', async () => {
    const { provider, batches } = portal((id) =>
      id === '1063094' ? deal(id, '0', 'UC_CJU776', 'P') : id === '1000' ? deal(id, '20', 'C20:WON', 'S') : null,
    )

    const deals = await provider.fetchDealsByIds(['1063094', '1000', '1999'])

    expect(deals.map((d) => [d.externalId, d.pipelineExternalId, d.stageExternalId, d.status])).toEqual([
      ['1063094', '0', 'UC_CJU776', 'OPEN'],
      ['1000', '20', 'C20:WON', 'WON'],
    ])
    expect(deals[0]!.metadata?.pipelineRole).toBe('LEAD')
    expect(deals[1]!.metadata?.pipelineRole).toBe('AI_TRIAGE')
    // One command, the full select (not just ID), the imported pipelines only.
    expect(batches).toHaveLength(1)
    expect(Object.keys(batches[0]!)).toHaveLength(1)
    expect(decodeURIComponent(batches[0]!.c0!)).toContain('select[1]=TITLE')
    expect(batches[0]!.c0).toContain('CATEGORY_ID')
  })

  it('asks 50 ids to a command', async () => {
    const { provider, batches } = portal((id) => deal(id, '20', 'C20:WON', 'S'))
    const ids = Array.from({ length: 120 }, (_, i) => String(5000 + i))
    expect(await provider.fetchDealsByIds(ids)).toHaveLength(120)
    expect(batches.map((b) => Object.keys(b).length)).toEqual([3])
  })
})

describe('rereadClosedTriageDeals', () => {
  const isTriage = (d: { pipeline: string }) => d.pipeline === '20'

  it('writes what came back and counts the ones that left «ИИ обработка»', async () => {
    const written: unknown[] = []
    const r = await rereadClosedTriageDeals(
      ['1', '2', '3'],
      async () => [{ pipeline: '0' }, { pipeline: '20' }],
      async (deals) => {
        written.push(...deals)
        return { failed: 0 }
      },
      isTriage,
    )
    expect(r).toEqual({ checked: 3, moved: 1 })
    expect(written).toHaveLength(2)
  })

  it('asks the portal nothing when there is nothing to check', async () => {
    let asked = false
    const r = await rereadClosedTriageDeals(
      [],
      async () => {
        asked = true
        return []
      },
      async () => ({ failed: 0 }),
      isTriage,
    )
    expect(r).toEqual({ checked: 0, moved: 0 })
    expect(asked).toBe(false)
  })

  it('says so when a deal could not be written', async () => {
    await expect(
      rereadClosedTriageDeals(['1'], async () => [{ pipeline: '0' }], async () => ({ failed: 1 }), isTriage),
    ).rejects.toThrow(/yozilmadi/)
  })
})
