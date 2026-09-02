import { describe, expect, it } from 'vitest'

import {
  ApiError,
  statusForCode,
  toApiError,
} from '@/server/http/errors'
import {
  buildPagination,
  failure,
  isSuccess,
  serialise,
  success,
  type ResponseMeta,
} from '@/server/http/envelope'
import {
  analyticsQuerySchema,
  dealsQuerySchema,
  periodQuerySchema,
  searchParamsToObject,
} from '@/server/http/queryParams'

const meta: ResponseMeta = {
  dataSource: 'DEMO',
  generatedAt: '2026-08-23T09:30:00.000Z',
}

describe('error taxonomy', () => {
  it('maps codes to the right status', () => {
    expect(statusForCode('VALIDATION_ERROR')).toBe(400)
    expect(statusForCode('UNAUTHENTICATED')).toBe(401)
    expect(statusForCode('FORBIDDEN')).toBe(403)
    expect(statusForCode('NOT_FOUND')).toBe(404)
    expect(statusForCode('INTERNAL_ERROR')).toBe(500)
  })

  it('distinguishes a pending integration from a real failure', () => {
    // 501, not 500: the feature works, its data source just is not connected.
    const error = ApiError.integrationPending('Toʻlovlar')
    expect(error.status).toBe(501)
    expect(error.code).toBe('INTEGRATION_PENDING')
    expect(error.message).toContain('BITRIX24_INTEGRATION_PENDING')
  })

  it('wraps an unknown throw without losing the cause', () => {
    const original = new Error('connect ECONNREFUSED 127.0.0.1:5432')
    const wrapped = toApiError(original)
    expect(wrapped.code).toBe('INTERNAL_ERROR')
    expect(wrapped.cause).toBe(original)
  })

  it('passes an ApiError through unchanged', () => {
    const original = ApiError.notFound()
    expect(toApiError(original)).toBe(original)
  })

  it('keeps a generic message for internal errors', () => {
    const wrapped = toApiError(new Error('SELECT * FROM user WHERE password = ...'))
    expect(wrapped.message).not.toContain('SELECT')
  })
})

describe('response envelope', () => {
  it('wraps success data with meta', () => {
    const envelope = success({ revenue: 42 }, meta)
    expect(isSuccess(envelope)).toBe(true)
    expect(envelope.meta.dataSource).toBe('DEMO')
  })

  it('never serialises the internal cause of an error', () => {
    // A stack trace on the wire tells an attacker the schema and file layout.
    const error = ApiError.internal(new Error('password=hunter2 at /src/db.ts:14'))
    const envelope = failure(error, meta)
    const json = serialise(envelope)

    expect(json).not.toContain('hunter2')
    expect(json).not.toContain('/src/db.ts')
    expect(isSuccess(envelope)).toBe(false)
  })

  it('carries validation details to the client', () => {
    const envelope = failure(
      ApiError.validation('Invalid query', [{ path: 'pageSize', message: 'Too large' }]),
      meta,
    )
    expect(envelope.error.details).toEqual([{ path: 'pageSize', message: 'Too large' }])
  })

  it('serialises BigInt money exactly, as a string', () => {
    // Number() would silently lose precision on large so'm figures.
    const json = serialise(success({ amountMinor: 34_000_000_000n }, meta))
    expect(json).toContain('"34000000000"')
  })

  it('states provenance on every response', () => {
    expect(success(null, meta).meta.dataSource).toBe('DEMO')
    expect(failure(ApiError.notFound(), meta).meta.dataSource).toBe('DEMO')
  })
})

describe('pagination meta', () => {
  it('computes page counts', () => {
    const page = buildPagination(2, 25, 130)
    expect(page.totalPages).toBe(6)
    expect(page.hasNextPage).toBe(true)
    expect(page.hasPreviousPage).toBe(true)
  })

  it('treats an empty result as one empty page', () => {
    const page = buildPagination(1, 25, 0)
    expect(page.totalPages).toBe(1)
    expect(page.hasNextPage).toBe(false)
    expect(page.hasPreviousPage).toBe(false)
  })

  it('marks the final page correctly', () => {
    expect(buildPagination(6, 25, 130).hasNextPage).toBe(false)
  })
})

describe('period query validation', () => {
  it('defaults to this_month with comparison enabled', () => {
    const parsed = periodQuerySchema.parse({})
    expect(parsed.preset).toBe('this_month')
    expect(parsed.compare).toBe(true)
  })

  it('accepts a custom range', () => {
    const parsed = periodQuerySchema.parse({
      preset: 'custom',
      from: '2026-08-01',
      to: '2026-08-23',
    })
    expect(parsed.from?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('rejects a custom preset with no bounds', () => {
    expect(() => periodQuerySchema.parse({ preset: 'custom' })).toThrow()
  })

  it('rejects an inverted range', () => {
    expect(() =>
      periodQuerySchema.parse({ preset: 'custom', from: '2026-08-23', to: '2026-08-01' }),
    ).toThrow()
  })

  it('rejects a malformed date', () => {
    expect(() =>
      periodQuerySchema.parse({ preset: 'custom', from: '23-08-2026', to: '2026-08-23' }),
    ).toThrow()
  })

  it('rejects an unknown preset', () => {
    expect(() => periodQuerySchema.parse({ preset: 'last_decade' })).toThrow()
  })
})

describe('filter query validation', () => {
  it('splits comma-separated ids', () => {
    const parsed = analyticsQuerySchema.parse({ employeeIds: 'a,b,c' })
    expect(parsed.employeeIds).toEqual(['a', 'b', 'c'])
  })

  it('drops empty entries from a sloppy list', () => {
    const parsed = analyticsQuerySchema.parse({ employeeIds: 'a,,b, ,c' })
    expect(parsed.employeeIds).toEqual(['a', 'b', 'c'])
  })

  it('leaves absent filters undefined rather than empty', () => {
    expect(analyticsQuerySchema.parse({}).employeeIds).toBeUndefined()
  })

  it('rejects an implausibly long id list', () => {
    const tooMany = Array.from({ length: 300 }, (_, i) => `id-${i}`).join(',')
    expect(() => analyticsQuerySchema.parse({ employeeIds: tooMany })).toThrow()
  })

  it('rejects an unknown status', () => {
    expect(() => analyticsQuerySchema.parse({ status: 'MAYBE' })).toThrow()
  })
})

describe('pagination query validation', () => {
  it('applies sensible defaults', () => {
    const parsed = dealsQuerySchema.parse({})
    expect(parsed.page).toBe(1)
    expect(parsed.pageSize).toBe(25)
    expect(parsed.sort).toBe('createdAtSource')
    expect(parsed.order).toBe('desc')
  })

  it('caps page size so one request cannot pull the whole table', () => {
    expect(() => dealsQuerySchema.parse({ pageSize: '1000000' })).toThrow()
  })

  it('rejects a zero or negative page', () => {
    expect(() => dealsQuerySchema.parse({ page: '0' })).toThrow()
    expect(() => dealsQuerySchema.parse({ page: '-3' })).toThrow()
  })

  it('only allows sorting by allowlisted columns', () => {
    expect(() => dealsQuerySchema.parse({ sort: 'passwordHash' })).toThrow()
    expect(dealsQuerySchema.parse({ sort: 'amountMinor' }).sort).toBe('amountMinor')
  })

  it('coerces numeric strings from the query string', () => {
    const parsed = dealsQuerySchema.parse({ page: '3', pageSize: '50' })
    expect(parsed.page).toBe(3)
    expect(parsed.pageSize).toBe(50)
  })
})

describe('searchParamsToObject', () => {
  it('flattens URLSearchParams', () => {
    const params = new URLSearchParams('preset=this_week&employeeIds=a,b&page=2')
    expect(searchParamsToObject(params)).toEqual({
      preset: 'this_week',
      employeeIds: 'a,b',
      page: '2',
    })
  })

  it('parses end to end from a real query string', () => {
    const params = new URLSearchParams('preset=custom&from=2026-08-01&to=2026-08-23&pageSize=10')
    const parsed = dealsQuerySchema.parse(searchParamsToObject(params))
    expect(parsed.preset).toBe('custom')
    expect(parsed.pageSize).toBe(10)
  })
})

/**
 * A custom range is the one window a caller can make arbitrarily large.
 *
 * Every other bound in this schema exists because the value reaches SQL, and
 * this one is no different: an unbounded span asks every analytics endpoint to
 * scan the whole deal table and bucket the result, which arrives as a timeout
 * rather than as the rejection it is.
 */
describe('custom range span', () => {
  it('accepts a range inside the cap', () => {
    const parsed = periodQuerySchema.parse({
      preset: 'custom',
      from: '2020-01-01',
      to: '2026-08-23',
    })
    expect(parsed.preset).toBe('custom')
  })

  it('rejects a range no question needs', () => {
    expect(() =>
      periodQuerySchema.parse({ preset: 'custom', from: '1900-01-01', to: '2100-01-01' }),
    ).toThrow()
  })
})
