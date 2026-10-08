/**
 * The portal's outgoing webhook lands here — see
 * `src/server/integrations/crm/bitrix24/outgoingEvent.ts` for the whole of
 * why, and `sync/crmEvents.ts` for what the worker does with a row.
 *
 * UNAUTHENTICATED BY SESSION, ON PURPOSE: the caller is Bitrix24, not a
 * person. The gate is the webhook's own application token, compared in
 * constant time, plus the portal domain. Nothing is read back out of this
 * endpoint and nothing is written but a queue row naming a deal id — the
 * worker then asks the portal itself what that deal is now, so a forged
 * event with a valid token could at most cost one by-id read.
 *
 * OUTSIDE `/api/v1`: that tree is the people-facing API, every route of which
 * `tests/http/routeAccess.test.ts` requires to go through `getHandler` and
 * name a section. This one has no section to name, like `/api/health`.
 *
 * ALWAYS 200 FOR A WELL-FORMED, AUTHENTICATED EVENT, even one we drop (a
 * contact's event, an unknown deal id shape). Bitrix24 retries a non-2xx
 * answer and switches a handler off after enough of them; an event we do not
 * want is not a failure of ours. A bad token is 401 and a missing
 * configuration is 404, because those ARE ours to notice.
 */

import { NextResponse } from 'next/server'

import { env } from '@/server/config/env'
import {
  parseOutgoingDealEvent,
  portalHost,
  tokenMatches,
} from '@/server/integrations/crm/bitrix24/outgoingEvent'
import { childLogger } from '@/server/logging/logger'
import { crmEventRepository } from '@/server/services/container'

const log = childLogger('bitrix24-events')

export const dynamic = 'force-dynamic'

/** Bitrix24 sends a few hundred bytes; anything past this is not the portal. */
const MAX_BODY_BYTES = 16 * 1024

/**
 * The body, or null once it passes `max` bytes — BEFORE the token is checked,
 * so a caller without the token cannot make the server buffer more than this.
 * A declared Content-Length past the cap is refused without reading at all;
 * a chunked or lying one is cut off at the cap while it streams.
 */
async function readBounded(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > max) return null
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function reply(status: number, body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request): Promise<NextResponse> {
  const expected = env.BITRIX24_APP_TOKEN
  if (!expected) return reply(404, { error: 'not configured' })

  const body = await readBounded(request, MAX_BODY_BYTES)
  if (body === null) return reply(413, { error: 'too large' })

  const event = parseOutgoingDealEvent(body)
  // The token is checked FIRST on whatever carried one, so an unauthenticated
  // caller learns nothing about which shapes are accepted.
  const sentToken = event?.applicationToken ?? new URLSearchParams(body).get('auth[application_token]') ?? ''
  if (!tokenMatches(sentToken, expected)) {
    log.warn({ hasToken: sentToken !== '' }, 'bitrix24 event rejected: bad application token')
    return reply(401, { error: 'unauthorized' })
  }

  if (event === null) return reply(200, { ok: true, dropped: 'not a deal event' })

  const host = env.BITRIX24_WEBHOOK_URL ? portalHost(env.BITRIX24_WEBHOOK_URL) : null
  if (host !== null && event.domain.toLowerCase() !== host) {
    log.warn({ domain: event.domain }, 'bitrix24 event rejected: another portal')
    return reply(401, { error: 'unauthorized' })
  }

  try {
    await crmEventRepository.record('BITRIX24', event.event, event.externalId)
  } catch (error) {
    // 503, not 500: Bitrix24 retries either, but a database that is down is
    // an outage to name, not a bug in this handler.
    log.error({ err: error, event: event.event, externalId: event.externalId }, 'bitrix24 event not queued')
    return reply(503, { error: 'unavailable' })
  }
  return reply(200, { ok: true })
}
