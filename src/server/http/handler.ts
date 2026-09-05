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

import type { SectionValue } from '@/lib/sections'
import { type Permission, type Principal, type RowScope, canSeeSection } from '@/server/auth/rbac'
import { requirePermission } from '@/server/auth/session'
import { TRUSTED_ORIGINS } from '@/server/auth/auth'
import { env } from '@/server/config/env'
import { getCrmProvider } from '@/server/config/providerFactory'
import { scopeService } from '@/server/services/container'
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

/**
 * What an endpoint requires of its caller.
 *
 * TWO GATES, ASKED TOGETHER. `permission` is the capability — whether an
 * account of this kind and scope may perform this sort of read at all.
 * `section` is the reach — whether THIS account was handed the screen this
 * endpoint feeds. Both must pass.
 *
 * The section gate is what makes an administrator's ticks mean something
 * beyond the sidebar. Without it, sections hid links while the API answered
 * anyone who typed the URL, so "give this person Logistika and nothing else"
 * was a presentation choice rather than a boundary.
 *
 * `section: null` is for the handful of endpoints that belong to no screen —
 * the shared filter payload every page loads, and account administration,
 * which is a permission and deliberately not a section (see `pageGuard`). It
 * has to be written out rather than omitted so that adding an endpoint is a
 * decision about who reaches it, never an oversight.
 */
export interface Access {
  readonly permission: Permission | readonly Permission[]
  readonly section: SectionValue | readonly SectionValue[] | null
}

/**
 * Assert the section gate.
 *
 * An endpoint listing several sections is reachable from ANY of them: the
 * sales screen draws its funnel from the same source the command centre does,
 * and an account given one of the two should not be refused because it lacks
 * the other.
 */
export function assertSection(principal: Principal, section: Access['section']): void {
  if (section === null) return

  const wanted = Array.isArray(section) ? section : [section as SectionValue]
  if (wanted.some((id) => canSeeSection(principal, id))) return

  throw ApiError.forbidden('Bu boʻlim sizga berilmagan.')
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
   * Data-scoping filter derived from the caller's data scope. Spread into
   * every repository call so a narrowed account's queries are cut in SQL
   * rather than in the page that renders them.
   *
   * RESOLVED BEFORE THE HANDLER RUNS, including the department subtree a TEAM
   * account needs, so no endpoint can be written that forgets to look it up.
   * `restrictToEmployeeIds: null` is the whole company; anything else is an
   * explicit, non-empty list.
   */
  readonly scope: RowScope
}

/**
 * Build a GET handler.
 *
 * Authentication is NOT optional and not a per-route decision: every handler
 * built here resolves a principal first, asserts `access.permission` and then
 * `access.section`. Making both required arguments means a new endpoint cannot
 * be shipped unprotected by forgetting a middleware line — there is no code
 * path that skips either check.
 *
 * @param access The capability and the section this endpoint requires.
 * @param schema Validates the query string. Rejection becomes a 400 with
 *               field-level detail rather than a 500.
 * @param handle Receives validated input; returns data and optional extra meta.
 */
export function getHandler<Q>(
  access: Access,
  schema: ZodType<Q>,
  handle: (ctx: HandlerContext<Q>) => Promise<{ data: unknown; meta?: Partial<ResponseMeta> }>,
) {
  return async function GET(request: Request): Promise<NextResponse> {
    const correlationId = newCorrelationId()
    const meta = baseMeta(correlationId)

    try {
      const principal = await requirePermission(request, access.permission)
      assertSection(principal, access.section)

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
        scope: await scopeService.resolve(principal),
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

/**
 * Build a POST/PATCH handler.
 *
 * Everything `getHandler` guarantees, plus the two things a WRITE needs.
 *
 * ORIGIN, BECAUSE THIS API IS COOKIE-AUTHENTICATED. A browser attaches the
 * session cookie to a cross-site form post as readily as to our own fetch, so
 * without this check any page the user visits while signed in could create an
 * administrator on their behalf. better-auth applies the same rule to its own
 * endpoints; these are ours, so we apply it here. A request with no Origin at
 * all is refused rather than waved through: every browser sends one on a
 * cross-origin write, so its absence is either a non-browser client — which
 * should be using a token, not a cookie — or an attempt to skip the check.
 *
 * THE BODY IS JSON AND IS VALIDATED. A malformed body is a 400 with field
 * detail, never a 500, and never a partially-applied write.
 */
export function mutationHandler<B>(
  access: Access,
  schema: ZodType<B>,
  handle: (
    ctx: Omit<HandlerContext<never>, 'query'> & { body: B; request: Request },
  ) => Promise<{ data: unknown; meta?: Partial<ResponseMeta> }>,
) {
  return async function POST(request: Request): Promise<NextResponse> {
    const correlationId = newCorrelationId()
    const meta = baseMeta(correlationId)

    try {
      const origin = request.headers.get('origin')
      if (!origin || !TRUSTED_ORIGINS.includes(origin)) {
        log.warn({ correlationId, origin }, 'write rejected: untrusted origin')
        throw ApiError.forbidden('Soʻrov ishonchsiz manzildan keldi.')
      }

      const principal = await requirePermission(request, access.permission)
      assertSection(principal, access.section)

      let raw: unknown
      try {
        raw = await request.json()
      } catch {
        throw ApiError.validation('Soʻrov tanasi JSON boʻlishi kerak.', [])
      }

      let body: B
      try {
        body = schema.parse(raw)
      } catch (error) {
        if (error instanceof ZodError) {
          throw ApiError.validation(
            'Soʻrov maydonlari notoʻgʻri.',
            error.issues.map((issue) => ({
              path: issue.path.join('.') || '(body)',
              message: issue.message,
            })),
          )
        }
        throw error
      }

      const result = await handle({
        body,
        request,
        correlationId,
        currency: env.APP_DEFAULT_CURRENCY,
        timeZone: env.APP_TIMEZONE,
        now: new Date(),
        principal,
        scope: await scopeService.resolve(principal),
      })

      return jsonResponse(success(result.data, { ...meta, ...result.meta }), 200)
    } catch (error) {
      const apiError = toApiError(error)

      if (apiError.status >= 500) {
        log.error(
          { correlationId, code: apiError.code, cause: String(apiError.cause ?? apiError.message) },
          'write failed',
        )
      } else {
        log.warn({ correlationId, code: apiError.code }, 'write rejected')
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
