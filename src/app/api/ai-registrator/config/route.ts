/**
 * The AI registrator reads the owner's settings here — «AI registrator →
 * Boshqaruv», see `domain/aiRegistrator/control.ts`. The agent asks on its own
 * cadence and applies a `version` it has not applied yet, without a restart.
 *
 * Same gate as `/api/ai-registrator/calls`: a bearer token compared in
 * constant time, AI_REGISTRATOR_INGEST_TOKEN on both sides; outside `/api/v1`
 * for the same reason (a service, not a person — no section to name).
 *
 * 200 with the contract's bare object — `{ version, enabled, sellers, maxCalls,
 * maxNew, maxRetry, saleHandoff, hours?, updatedAt, updatedBy }`, NO envelope: the
 * agent reads the body as the settings. `enabled` is always a real boolean
 * (false = «Toʻxtatish» on the panel): the agent refuses the whole config over
 * one that is not. `hours` (`{ start, end, lunchStart, lunchEnd }`, «Ish
 * vaqti») only once saved on the panel — left out, the agent keeps its own
 * .env hours; `days` in it (ISO weekdays, 1 = Mon) only when not every day.
 * The fields of 2026-11-04 (T144) are each left out while not set, so the
 * agent keeps its own: `pauseUntil` (Tashkent with the offset) only while it
 * is ahead, `linesOff` only when any line is off, `tuning` (all seven) only
 * once saved, `actions` (`{ id, kind, line?, at, by }`) only while a press is
 * open — not answered, asked under ten minutes ago. 404 when nothing is saved yet (and while no token
 * is configured — the agent reads both as «no settings, keep your own»), 401
 * for a bad token, 503 when the database is down (the agent keeps its last).
 */

import { NextResponse } from 'next/server'

import { env } from '@/server/config/env'
import { tokenMatches } from '@/server/http/token'
import { bearerToken } from '@/server/integrations/aiRegistrator/ingest'
import { childLogger } from '@/server/logging/logger'
import { aiRegistratorControlService } from '@/server/services/container'

const log = childLogger('ai-registrator-config')

export const dynamic = 'force-dynamic'

function reply(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

export async function GET(request: Request): Promise<NextResponse> {
  const expected = env.AI_REGISTRATOR_INGEST_TOKEN
  if (!expected) return reply(404, { error: 'not configured' })
  if (!tokenMatches(bearerToken(request.headers.get('authorization')), expected)) {
    log.warn('ai registrator config read rejected: bad token')
    return reply(401, { error: 'unauthorized' })
  }

  try {
    const config = await aiRegistratorControlService.agentConfig(new Date())
    return config ? reply(200, config) : reply(404, { error: 'not saved' })
  } catch (error) {
    log.error({ err: error }, 'ai registrator config not read')
    return reply(503, { error: 'unavailable' })
  }
}
