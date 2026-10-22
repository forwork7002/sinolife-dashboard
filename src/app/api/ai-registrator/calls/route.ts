/**
 * The AI registrator — the Sinolife voice agent on the Eskiz server — reports
 * each finished call here. See `integrations/aiRegistrator/ingest.ts` for the
 * body and `domain/aiRegistrator/aiRegistrator.ts` for what is read from it.
 *
 * UNAUTHENTICATED BY SESSION, ON PURPOSE, like `/api/bitrix24/events`: the
 * caller is a service, not a person. The gate is a bearer token compared in
 * constant time, AI_REGISTRATOR_INGEST_TOKEN on both sides. Nothing is read
 * back out of this endpoint; the one write is the call's own row, upserted by
 * its id, so a forged call with a valid token could at most put one wrong
 * line on «Lidlar → AI registrator».
 *
 * OUTSIDE `/api/v1`: that tree is the people-facing API, every route of which
 * `tests/http/routeAccess.test.ts` requires to go through `getHandler` and
 * name a section. This one has no section to name.
 *
 * 200 for a stored call (a repeat included — the agent retries until it gets
 * one), 400 for a body that is not a call (the agent should not retry it),
 * 401 for a bad token, 404 while no token is configured, 503 when the
 * database is down (the agent retries).
 */

import { NextResponse } from 'next/server'

import { env } from '@/server/config/env'
import { aiCallSchema, bearerToken, tokenMatches } from '@/server/integrations/aiRegistrator/ingest'
import { childLogger } from '@/server/logging/logger'
import { aiRegistratorRepository } from '@/server/services/container'

const log = childLogger('ai-registrator-ingest')

export const dynamic = 'force-dynamic'

/** A call is a few hundred bytes plus what the agent wrote down; anything past this is not a call. */
const MAX_BODY_BYTES = 64 * 1024

function reply(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request): Promise<NextResponse> {
  const expected = env.AI_REGISTRATOR_INGEST_TOKEN
  if (!expected) return reply(404, { error: 'not configured' })

  // The token is checked before the body is read at all.
  if (!tokenMatches(bearerToken(request.headers.get('authorization')), expected)) {
    log.warn('ai registrator call rejected: bad token')
    return reply(401, { error: 'unauthorized' })
  }

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return reply(413, { error: 'too large' })
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return reply(413, { error: 'too large' })

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return reply(400, { error: 'not json' })
  }
  const parsed = aiCallSchema.safeParse(json)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    log.warn({ issues }, 'ai registrator call rejected: invalid body')
    return reply(400, { error: 'invalid', issues })
  }

  try {
    await aiRegistratorRepository.upsert(parsed.data)
  } catch (error) {
    log.error({ err: error, callId: parsed.data.callId }, 'ai registrator call not stored')
    return reply(503, { error: 'unavailable' })
  }
  return reply(200, { ok: true })
}
