import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAiControlAccount } from '@/server/auth/aiControl'
import type { Principal } from '@/server/auth/rbac'

process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const envState = {
  AI_REGISTRATOR_INGEST_TOKEN: 'tok123' as string | undefined,
  LOG_LEVEL: 'error',
  NODE_ENV: 'test',
  APP_DEFAULT_CURRENCY: 'UZS',
  APP_TIMEZONE: 'Asia/Tashkent',
}
vi.mock('@/server/config/env', () => ({ env: envState }))

const OWNER_18 = ['122', '120', '128', '123', '131', '127', '111', '112', '108', '109', '107', '114', '115', '117', '134', '136', '135', '141']
const saved = {
  version: 1,
  sellers: OWNER_18,
  maxCalls: 4,
  maxNew: 4,
  maxRetry: 0,
  saleHandoff: 'refer',
  updatedAt: '2026-10-30T09:45:00.000Z',
  updatedBy: 'boshlangʻich (egasi, 30.10)',
}

const state = vi.hoisted(() => ({
  config: null as unknown,
  statuses: [] as unknown[],
  saves: [] as unknown[],
  savers: [] as unknown[],
  fail: false,
  principal: null as unknown,
}))

vi.mock('@/server/services/container', () => ({
  aiRegistratorControlService: {
    agentConfig: async () => {
      if (state.fail) throw new Error('db down')
      return state.config
    },
    putStatus: async (status: unknown) => {
      if (state.fail) throw new Error('db down')
      state.statuses.push(status)
    },
    panel: async () => ({ config: state.config }),
    live: async () => ({ status: null, staleAfterSec: 90 }),
    save: async (body: unknown, by: unknown) => {
      state.saves.push(body)
      state.savers.push(by)
      return state.config
    },
  },
  scopeService: { resolve: async () => ({ restrictToEmployeeIds: null }) },
}))

vi.mock('@/server/auth/session', async () => {
  const { can } = await import('@/server/auth/rbac')
  const { ApiError } = await import('@/server/http/errors')
  return {
    requirePrincipal: async () => {
      if (!state.principal) throw ApiError.unauthenticated()
      return state.principal
    },
    assertPermission: (p: Principal, permission: Parameters<typeof can>[1]) => {
      if (!can(p, permission)) throw ApiError.forbidden()
    },
  }
})
vi.mock('@/server/auth/auth', () => ({ TRUSTED_ORIGINS: ['http://localhost:3000'] }))
vi.mock('@/server/config/providerFactory', () => ({ getCrmProvider: () => ({ source: 'bitrix24', capabilities: {} }) }))
vi.mock('@/server/db/prisma', () => ({ poolStats: () => ({ total: 0, idle: 0, waiting: 0 }) }))

const config = await import('@/app/api/ai-registrator/config/route')
const status = await import('@/app/api/ai-registrator/status/route')
const control = await import('@/app/api/v1/leads/ai-registrator/control/route')

const principal = (over: Partial<Principal> = {}): Principal => ({
  userId: 'u-1',
  role: 'ADMIN',
  isActive: true,
  employeeId: null,
  dataScope: 'ALL',
  sections: ['airegistrator', 'leads'],
  ...over,
})

const report = (over: Record<string, unknown> = {}) => ({
  at: '2026-10-30T14:50:00.123456+00:00',
  appliedVersion: 1,
  applyError: null,
  limits: { calls: 4, maxNew: 4, maxRetry: 0, saleHandoff: 'refer', maxSipLegs: 10, fused: false },
  lines: { '178': 'free', '290': 'call', '291': 'seller_talk', '292': 'not_registered' },
  sellers: [{ ext: '122', name: '122 Dilnoza', state: 'free', inList: true, transfersToday: 3 }],
  today: { calls: 40, answered: 22, transferred: 7, transferFailed: 2, atsRejected: 1 },
  ...over,
})

const get = (token: string | null = 'tok123') =>
  config.GET(new Request('http://localhost/api/ai-registrator/config', { headers: token === null ? {} : { authorization: `Bearer ${token}` } }))

const push = (body: string, token: string | null = 'tok123') =>
  status.POST(
    new Request('http://localhost/api/ai-registrator/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
      body,
    }),
  )

beforeEach(() => {
  envState.AI_REGISTRATOR_INGEST_TOKEN = 'tok123'
  state.config = saved
  state.statuses.length = 0
  state.saves.length = 0
  state.savers.length = 0
  state.fail = false
  state.principal = null
})

describe('GET /api/ai-registrator/config — what the agent reads', () => {
  it('answers the bare contract object, no envelope, the owner\'s eighteen', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['maxCalls', 'maxNew', 'maxRetry', 'saleHandoff', 'sellers', 'updatedAt', 'updatedBy', 'version'])
    expect(body.sellers).toEqual(OWNER_18)
    expect(body.sellers).not.toContain('125')
    expect(body.sellers).not.toContain('129')
  })

  it('is 404 before anything is saved and while no token is configured', async () => {
    state.config = null
    expect((await get()).status).toBe(404)
    state.config = saved
    envState.AI_REGISTRATOR_INGEST_TOKEN = undefined
    expect((await get()).status).toBe(404)
  })

  it('refuses a wrong or missing token, and is 503 with the database down', async () => {
    expect((await get('nope')).status).toBe(401)
    expect((await get(null)).status).toBe(401)
    state.fail = true
    expect((await get()).status).toBe(503)
  })
})

describe('POST /api/ai-registrator/status — what the agent reports', () => {
  it('stores a report, unknown line states included', async () => {
    const res = await push(JSON.stringify(report()))
    expect(res.status).toBe(200)
    expect(state.statuses).toHaveLength(1)
  })

  it('takes a report with no version applied yet and an apply error', async () => {
    expect((await push(JSON.stringify(report({ appliedVersion: null, applyError: 'sotuvchilar roʻyxati boʻsh' })))).status).toBe(200)
  })

  it('refuses a bad token before reading, a non-report, garbage and a flood', async () => {
    expect((await push(JSON.stringify(report()), 'nope')).status).toBe(401)
    expect((await push('{', 'tok123')).status).toBe(400)
    expect((await push(JSON.stringify(report({ at: 'yesterday' })))).status).toBe(400)
    expect((await push(JSON.stringify(report({ lines: { '178': 'Free Line!' } })))).status).toBe(400)
    expect((await push(JSON.stringify({ ...report(), pad: 'x'.repeat(70_000) }))).status).toBe(413)
    expect(state.statuses).toHaveLength(0)
  })

  it('is 503 with the database down, so the agent retries', async () => {
    state.fail = true
    expect((await push(JSON.stringify(report()))).status).toBe(503)
  })

  /* 2026-10-31: the live part is the newest — one wrong element of it is dropped, never the report. */
  it('stores a report whose live part is partly wrong, and one with no live part at all', async () => {
    const since = '2026-10-31T05:42:00+00:00'
    const live = {
      lines: [
        { line: '291', deal: 1001, product: 'Kollagen', client: 'Aziz', test: false, state: 'talking', since, seller: null },
        { line: '292', deal: 'x', state: 'talking', since },
      ],
      recent: [{ at: since, line: '293', deal: 1002, product: 'Zekstra', client: 'Bobur', test: true, what: 'connected', seller: '120' }],
    }
    expect((await push(JSON.stringify(report({ live })))).status).toBe(200)
    expect((await push(JSON.stringify(report({ live: 'garbage' })))).status).toBe(200)
    expect((await push(JSON.stringify(report()))).status).toBe(200)
    const [first, second, third] = state.statuses as { live: { lines: { line: string }[]; recent: unknown[] } | null }[]
    expect(first?.live?.lines.map((l) => l.line)).toEqual(['291'])
    expect(first?.live?.recent).toHaveLength(1)
    expect(second?.live).toBeNull()
    expect(third?.live).toBeNull()
  })
})

describe('/api/v1/leads/ai-registrator/control — the owner\'s account only', () => {
  const read = () => control.GET(new Request('http://localhost:3000/api/v1/leads/ai-registrator/control'))
  const write = (body: unknown) =>
    control.POST(
      new Request('http://localhost:3000/api/v1/leads/ai-registrator/control', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  const body = { baseVersion: 1, sellers: [...OWNER_18, '143'], parked: [], maxCalls: 4, maxNew: 4, maxRetry: 0, saleHandoff: 'refer' }

  it('is 403 for an administrator who is not it, and for a seller', async () => {
    state.principal = principal()
    expect((await read()).status).toBe(403)
    expect((await write(body)).status).toBe(403)
    state.principal = principal({ role: 'SALES', dataScope: 'OWN', sections: ['airegistrator'] })
    expect((await read()).status).toBe(403)
    expect((await write(body)).status).toBe(403)
    expect(state.saves).toHaveLength(0)
  })

  it('is 403 for it without the section, and 401 signed out', async () => {
    state.principal = principal({ aiControl: true, sections: ['leads'] })
    expect((await read()).status).toBe(403)
    expect((await control.GET(new Request('http://localhost:3000/api/v1/leads/ai-registrator/control?part=live'))).status).toBe(403)
    state.principal = null
    expect((await read()).status).toBe(401)
  })

  it('opens and saves for it', async () => {
    state.principal = principal({ aiControl: true, login: 'adminjon' })
    expect((await read()).status).toBe(200)
    // The page's 5 s poll: the last report alone, behind the same door.
    const live = await control.GET(new Request('http://localhost:3000/api/v1/leads/ai-registrator/control?part=live'))
    expect(live.status).toBe(200)
    expect((await live.json()).data).toEqual({ status: null, staleAfterSec: 90 })
    expect((await control.GET(new Request('http://localhost:3000/api/v1/leads/ai-registrator/control?part=all'))).status).toBe(400)
    expect((await write(body)).status).toBe(200)
    expect(state.saves).toHaveLength(1)
    expect(state.savers).toEqual([{ label: 'adminjon', userId: 'u-1' }])
  })

  /*
    The owner, 30.10 16:3x: «umida akkauntida ham koʻrinishi kerak … u ham
    boshqara oʻzgartira kira olishi kerak». Her account as prod holds it — a
    SALES login read company-wide, «AI registrator» ticked — with aiControl
    worked out the way `requirePrincipal` does; a seller held the same way
    under another login stays out.
  */
  const asProd = (login: string): Principal =>
    principal({
      userId: `u-${login}`,
      role: 'SALES',
      dataScope: 'ALL',
      sections: ['leads', 'sellers', 'airegistrator', 'rnp'],
      aiControl: isAiControlAccount({ username: login, email: `${login}@sinolife.local` }, 'owner@example.com'),
      login,
    })

  it('opens and saves for umida, and records her as the saver', async () => {
    state.principal = asProd('umida')
    expect((await read()).status).toBe(200)
    expect((await write(body)).status).toBe(200)
    expect(state.saves).toHaveLength(1)
    expect(state.savers).toEqual([{ label: 'umida', userId: 'u-umida' }])
  })

  it('is 403 for another account held exactly like hers', async () => {
    state.principal = asProd('dilnoza')
    expect((await read()).status).toBe(403)
    expect((await write(body)).status).toBe(403)
    expect(state.saves).toHaveLength(0)
  })

  it('refuses a deactivated it', async () => {
    state.principal = principal({ aiControl: true, isActive: false })
    expect((await read()).status).toBe(403)
  })
})
