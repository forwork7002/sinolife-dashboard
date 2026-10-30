/**
 * The AI registrator reports what it runs here, every 30 s — the lines, the
 * sellers' phones, the limits it applied, the day's numbers and which settings
 * `version` it took (or why it refused one). «AI registrator → Boshqaruv»
 * shows the last report; only the last is kept. Body: `aiStatusSchema` in
 * `integrations/aiRegistrator/control.ts`.
 *
 * Same gate as `/api/ai-registrator/calls` (bearer, constant time, outside
 * `/api/v1`). A forged report with a valid token could at most draw one wrong
 * picture on a panel only the owner opens, until the next real one.
 *
 * 200 stored, 400 not a report (the agent should not retry it), 401 bad token,
 * 404 while no token is configured, 413 too large, 503 database down.
 */

import { NextResponse } from 'next/server'

import { env } from '@/server/config/env'
import { tokenMatches } from '@/server/http/token'
import { aiStatusSchema } from '@/server/integrations/aiRegistrator/control'
import { bearerToken } from '@/server/integrations/aiRegistrator/ingest'
import { childLogger } from '@/server/logging/logger'
import { aiRegistratorControlService } from '@/server/services/container'

const log = childLogger('ai-registrator-status')

export const dynamic = 'force-dynamic'

/** Twenty-odd lines and sixty sellers come to a few kilobytes; past this it is not a report. */
const MAX_BODY_BYTES = 64 * 1024

function reply(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request): Promise<NextResponse> {
  const expected = env.AI_REGISTRATOR_INGEST_TOKEN
  if (!expected) return reply(404, { error: 'not configured' })

  // The token is checked before the body is read at all.
  if (!tokenMatches(bearerToken(request.headers.get('authorization')), expected)) {
    log.warn('ai registrator status rejected: bad token')
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
  const parsed = aiStatusSchema.safeParse(json)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }))
    log.warn({ issues }, 'ai registrator status rejected: invalid body')
    return reply(400, { error: 'invalid', issues })
  }

  try {
    await aiRegistratorControlService.putStatus(parsed.data, new Date())
  } catch (error) {
    log.error({ err: error }, 'ai registrator status not stored')
    return reply(503, { error: 'unavailable' })
  }
  return reply(200, { ok: true })
}
