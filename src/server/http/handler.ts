/**
 * Route handler plumbing.
 *
 * Wraps every endpoint so that validation, error translation, logging and the
 * response envelope are applied uniformly. A route handler's job is reduced to
 * "given validated input, produce data" — it never builds a Response itself,
 * so no endpoint can accidentally leak a stack trace or omit the provenance
 * metadata.
 */

import { NextResponse } from 'next/server'
import { ZodError, type ZodType } from 'zod'

import { type Permission, type Principal, dealScopeFor } from '@/server/auth/rbac'
import { requirePermission } from '@/server/auth/session'
import { env } from '@/server/config/env'
import { getCrmProvider } from '@/server/config/providerFactory'
import { resolvePeriod, type Period } from '@/server/domain/period/period'
import { childLogger, newCorrelationId } from '@/server/logging/logger'
import { ApiError, toApiError } from './errors'
import {
  type ResponseMeta,
  failure,
  serialise,
  success,
} from './envelope'
import { type PeriodQuery, searchParamsToObject } from './queryParams'

const log = childLogger('api')

function jsonResponse(body: unknown, status: number): NextResponse {
  // Serialised manually because the payload contains BigInt, which
  // NextResponse.json cannot handle.
  return new NextResponse(serialise(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Analytics reflect live data; a cached response would show stale
      // revenue after a sync.
      'cache-control': 'no-store',
    },
  })
}

function baseMeta(correlationId: string): ResponseMeta {
  const provider = getCrmProvider()

  return {
    dataSource: provider.source,
    generatedAt: new Date().toISOString(),
    correlationId,
    // Entities this provider cannot supply. The UI renders these as
    // "not connected" rather than as zero.
    unavailable: Object.entries(provider.capabilities)
      .filter(([, supported]) => !supported)
      .map(([entity]) => entity),
  }
}

export interface HandlerContext<Q> {
  readonly query: Q
  readonly correlationId: string
  readonly currency: string
  readonly timeZone: string
  readonly now: Date
  /** The authenticated caller. Always present — handlers cannot opt out. */
  readonly principal: Principal
  /**
   * Data-scoping filter derived from the caller's role. Spread into every
   * repository call so a SALES user's queries are narrowed in SQL.
   */
  readonly scope: { restrictToEmployeeId?: string }
}

/**
 * Build a GET handler.
 *
 * Authentication is NOT optional and not a per-route decision: every handler
 * built here resolves a principal first and asserts `permission`. Making it a
 * required argument means a new endpoint cannot be shipped unprotected by
 * forgetting a middleware line — there is no code path that skips the check.
 *
 * @param permission The capability the caller must hold.
 * @param schema Validates the query string. Rejection becomes a 400 with
 *               field-level detail rather than a 500.
 * @param handle Receives validated input; returns data and optional extra meta.
 */
export function getHandler<Q>(
  permission: Permission | readonly Permission[],
  schema: ZodType<Q>,
  handle: (ctx: HandlerContext<Q>) => Promise<{ data: unknown; meta?: Partial<ResponseMeta> }>,
) {
  return async function GET(request: Request): Promise<NextResponse> {
    const correlationId = newCorrelationId()
    const meta = baseMeta(correlationId)

    try {
      const principal = await requirePermission(request, permission)
      const url = new URL(request.url)
      const raw = searchParamsToObject(url.searchParams)

      let query: Q
      try {
        query = schema.parse(raw)
      } catch (error) {
        if (error instanceof ZodError) {
          throw ApiError.validation(
            'Soʻrov parametrlari notoʻgʻri.',
            error.issues.map((issue) => ({
              path: issue.path.join('.') || '(query)',
              message: issue.message,
            })),
          )
        }
        throw error
      }

      const result = await handle({
        query,
        correlationId,
        currency: env.APP_DEFAULT_CURRENCY,
        timeZone: env.APP_TIMEZONE,
        now: new Date(),
        principal,
        scope: dealScopeFor(principal),
      })

      return jsonResponse(success(result.data, { ...meta, ...result.meta }), 200)
    } catch (error) {
      const apiError = toApiError(error)

      // The full cause goes to the log, keyed by correlation id. Only the safe
      // message crosses the wire.
      if (apiError.status >= 500) {
        log.error(
          { correlationId, code: apiError.code, cause: String(apiError.cause ?? apiError.message) },
          'request failed',
        )
      } else {
        log.warn({ correlationId, code: apiError.code }, 'request rejected')
      }

      return jsonResponse(failure(apiError, meta), apiError.status)
    }
  }
}

/** Resolve a validated period query into a concrete period. */
export function periodFrom(query: PeriodQuery, timeZone: string, now: Date): Period {
  return resolvePeriod(query.preset, {
    timeZone,
    now,
    customStart: query.from,
    customEnd: query.to,
  })
}
