/**
 * MoySklad customer orders («Заказ покупателя») into `moysklad_order` and
 * `moysklad_order_item` — the warehouse half of «Sverka».
 *
 * READ-ONLY BY CONSTRUCTION. `get()` is the only function that touches the
 * network and it issues GET requests and nothing else: the token the client
 * handed over can create and edit documents, and nothing here may.
 *
 * HOW AN ORDER MEETS ITS DEAL. The client's Bitrix24 → MoySklad integration
 * stamps the deal id twice: the «ID сделки в BX» attribute («1071642») and the
 * document code («bx1071642»). The attribute wins; the code is the fallback.
 * Measured 2026-10-06: every one of 9 777 orders carried the attribute.
 *
 * WHICH ORDERS. An empty table reads every order (≈100 pages of 100, the
 * first on 2026-06-15). After that, the orders MoySklad changed since the
 * newest `updated` we hold, less `SETTLE_MS` — a write landing in the same
 * second as our read is otherwise missed for good, the trap
 * `SETTLE_LOOKBACK_MS` closes on the Bitrix24 side.
 *
 * DELETIONS. An incremental read cannot see an order that was deleted, so
 * `sweepDeleted` lists every order id (≈10 requests, no expand) and removes
 * the rows MoySklad no longer has — refusing when the listing came back short
 * or when too many would go at once.
 */

import type { PrismaClient } from '@/generated/prisma/client'

const API = 'https://api.moysklad.ru/api/remap/1.2'
/** MoySklad caps a page at 100 rows whenever `expand` is used. */
const PAGE = 100
/** Ids only, no expand: the API's own maximum page. */
const ID_PAGE = 1000
const REQUEST_TIMEOUT_MS = 30_000
const MAX_ATTEMPTS = 4
/** Re-read this much before the newest `updated` we hold. */
const SETTLE_MS = 10 * 60_000
/** The sweep refuses to delete more than this many orders in one pass … */
const SWEEP_GONE_FLOOR = 50
/** … or more than this share of the table, whichever is larger. */
const SWEEP_GONE_SHARE = 0.05

/** The attribute the client's integration writes the deal id into. */
export const DEAL_ID_ATTRIBUTE = 'ID сделки в BX'
const SELLER_ATTRIBUTE = 'Продавцы (new)'
const LOGISTICS_ATTRIBUTE = 'Логистика'
const REGION_ATTRIBUTE = 'Регион'

interface Meta {
  readonly href?: string
  readonly size?: number
}

interface RawAttribute {
  readonly name?: string
  readonly value?: unknown
}

interface RawPosition {
  readonly id: string
  readonly quantity?: number
  readonly price?: number
  readonly discount?: number
  readonly assortment?: { readonly name?: string; readonly externalCode?: string; readonly code?: string }
}

export interface RawOrder {
  readonly id: string
  readonly name?: string
  readonly code?: string
  readonly moment?: string
  readonly updated?: string
  readonly applicable?: boolean
  readonly sum?: number
  readonly payedSum?: number
  readonly shippedSum?: number
  readonly state?: { readonly name?: string }
  readonly project?: { readonly name?: string }
  readonly attributes?: readonly RawAttribute[]
  readonly positions?: { readonly rows?: readonly RawPosition[]; readonly meta?: Meta }
}

interface ListBody<T> {
  readonly meta?: Meta
  readonly rows?: T[]
  readonly errors?: readonly { readonly error?: string; readonly code?: number }[]
}

/**
 * MoySklad's dates are Moscow wall-clock time with no offset
 * («2026-10-05 19:04:00.000»). Checked against the portal on 2026-10-06: an
 * order MoySklad stamped `updated` 22:26:44 belongs to a deal Bitrix24 moved
 * at 22:26:48+03:00. Moscow keeps no daylight saving, so +03:00 is exact.
 */
export function parseMoscow(text: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d{1,3})?$/.exec(text.trim())
  if (!match) throw new Error(`MoySklad sanasi tushunilmadi: «${text}»`)
  return new Date(`${match[1]}T${match[2]}${match[3] ?? ''}+03:00`)
}

/** The inverse, for a filter value: `yyyy-MM-dd HH:mm:ss` in Moscow time. */
export function formatMoscow(date: Date): string {
  return new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')
}

/**
 * Kopecks — MoySklad's minor unit, ×100 like ours — as a bigint. The API
 * sends floats and a discounted line can carry a fraction of a kopeck
 * (2 600 000.01 soʻm on an order the portal holds at 2 600 000), so it is
 * rounded, never truncated.
 */
export function minorOf(kopecks: number | undefined): bigint {
  if (kopecks === undefined || !Number.isFinite(kopecks)) return 0n
  return BigInt(Math.round(kopecks))
}

/** An attribute's value as text — a reference (custom entity) by its name. */
export function attributeText(attributes: readonly RawAttribute[] | undefined, name: string): string | null {
  const found = attributes?.find((a) => a.name === name)
  if (!found || found.value === null || found.value === undefined) return null
  const value = found.value
  if (typeof value === 'object') {
    const named = (value as { name?: unknown }).name
    return typeof named === 'string' && named.trim() ? named.trim() : null
  }
  const text = String(value).trim()
  return text || null
}

/** The Bitrix24 deal an order belongs to: the attribute, else «bx<digits>». */
export function dealIdOf(order: Pick<RawOrder, 'attributes' | 'code'>): string | null {
  const attribute = attributeText(order.attributes, DEAL_ID_ATTRIBUTE)
  const fromAttribute = attribute?.match(/^\D*(\d+)\D*$/)?.[1]
  if (fromAttribute) return fromAttribute
  return order.code?.trim().match(/^bx(\d+)$/i)?.[1] ?? null
}

/** One position's money after the discount, to the minor unit. */
export function lineTotalMinor(price: number, quantity: number, discountPercent: number): bigint {
  return BigInt(Math.round(price * quantity * (1 - discountPercent / 100)))
}

/** A raw order as the two rows it is stored as. Pure — tested without a network. */
export function orderRows(raw: RawOrder) {
  if (!raw.moment || !raw.updated) throw new Error(`MoySklad buyurtmasi ${raw.id}: sana yoʻq`)
  const order = {
    id: raw.id,
    name: raw.name ?? raw.id,
    bitrixDealId: dealIdOf(raw),
    moment: parseMoscow(raw.moment),
    stateName: raw.state?.name?.trim() || null,
    sumMinor: minorOf(raw.sum),
    payedMinor: minorOf(raw.payedSum),
    shippedMinor: minorOf(raw.shippedSum),
    sellerName: attributeText(raw.attributes, SELLER_ATTRIBUTE),
    projectName: raw.project?.name?.trim() || null,
    logistics: attributeText(raw.attributes, LOGISTICS_ATTRIBUTE),
    region: attributeText(raw.attributes, REGION_ATTRIBUTE),
    applicable: raw.applicable !== false,
    updatedAtSource: parseMoscow(raw.updated),
  }
  const items = (raw.positions?.rows ?? []).map((p) => {
    const quantity = p.quantity ?? 0
    const price = p.price ?? 0
    const discount = p.discount ?? 0
    return {
      id: p.id,
      orderId: raw.id,
      productCode: p.assortment?.externalCode?.trim() || null,
      productName: p.assortment?.name?.trim() || '—',
      quantity,
      priceMinor: minorOf(price),
      discountBp: Math.round(discount * 100),
      totalMinor: lineTotalMinor(price, quantity, discount),
    }
  })
  return { order, items }
}

/**
 * The one network call in this module — a GET, retried on MoySklad's rate
 * limit (429, waiting what `X-Lognex-Retry-TimeInterval` says) and on a 5xx.
 * With `missingIsNull`, a 404 answers `null` — how the sweep confirms that an
 * order is really gone.
 */
async function get<T>(path: string, token: string, missingIsNull: true): Promise<T | null>
async function get<T>(path: string, token: string): Promise<T>
async function get<T>(path: string, token: string, missingIsNull = false): Promise<T | null> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response
    try {
      response = await fetch(`${API}/${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          // Required: MoySklad refuses a request that does not accept gzip.
          'Accept-Encoding': 'gzip',
        },
        // A redirect would carry the token to wherever it points; refuse it.
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      lastError = error as Error
      await sleep(1_000 * attempt)
      continue
    }
    if (response.status === 429 || response.status >= 500) {
      const waitMs = Number(response.headers.get('X-Lognex-Retry-TimeInterval')) || 1_000 * attempt
      lastError = new Error(`MoySklad ${response.status}`)
      await sleep(Math.min(waitMs, 30_000))
      continue
    }
    if (missingIsNull && response.status === 404) return null
    const body = (await response.json()) as T & ListBody<unknown>
    if (!response.ok || body.errors?.length) {
      // The message only: the request carries the token and must never be logged.
      throw new Error(`MoySklad ${response.status}: ${body.errors?.[0]?.error ?? 'nomaʼlum xato'}`)
    }
    return body
  }
  throw new Error(`MoySklad javob bermadi (${MAX_ATTEMPTS} urinish): ${lastError?.message ?? ''}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface MoyskladImportResult {
  readonly orders: number
  readonly items: number
  /** `null` on the first, whole-table read. */
  readonly since: Date | null
  /** Stopped at `maxPages` with more to read — the next run carries on. */
  readonly partial: boolean
  /** Orders MoySklad sent without a date, left out (and counted) rather than stopping the run. */
  readonly skipped: number
  readonly deleted: number | null
}

/** The whole second an instant falls in — MoySklad's filter has no milliseconds. */
const secondOf = (date: Date) => Math.floor(date.getTime() / 1000)

/**
 * Reads the changed orders (or all of them, on an empty table) and replaces
 * each one's rows. With `sweep`, also removes the orders MoySklad deleted.
 *
 * KEYSET PAGING ON `updated`, NOT OFFSETS. Ordered by `updated` and paged by
 * offset, an order edited mid-read jumps to the end of the list and pushes
 * the row at the next page boundary back onto a page already read — and that
 * row, older than the new watermark, is never asked for again (measured with
 * a mock: 150 orders, one edited after page 1, one never stored). So every
 * page re-asks from the last row's second (`updated>=`), and only a page
 * whose every row shares one second steps an offset inside that second.
 * Re-reading the same second's rows is harmless: each page replaces them.
 *
 * `maxPages` bounds one run — the worker passes it so the first, whole-table
 * read (≈100 pages) is spread over several ticks instead of holding the
 * Bitrix24 sync for minutes. Each page commits on its own, and the watermark
 * is the newest `updated` stored, so the next run carries on where this one
 * stopped.
 */
export async function importMoyskladOrders(
  prisma: PrismaClient,
  token: string,
  options: { readonly sweep?: boolean; readonly maxPages?: number } = {},
): Promise<MoyskladImportResult> {
  const latest = await prisma.moyskladOrder.aggregate({ _max: { updatedAtSource: true } })
  const newest = latest._max.updatedAtSource
  const since = newest ? new Date(newest.getTime() - SETTLE_MS) : null

  let cursor: Date | null = since
  let offset = 0
  let pages = 0
  let partial = false
  let orders = 0
  let items = 0
  let skipped = 0
  for (;;) {
    const filter = cursor ? `&filter=${encodeURIComponent(`updated>=${formatMoscow(cursor)}`)}` : ''
    const body = await get<ListBody<RawOrder>>(
      `entity/customerorder?limit=${PAGE}&offset=${offset}&order=updated,asc` +
        `&expand=state,project,positions.assortment${filter}`,
      token,
    )
    const rows = body.rows ?? []
    const dated = rows.filter((r) => r.moment && r.updated)
    skipped += rows.length - dated.length
    if (dated.length > 0) {
      const parsed = []
      for (const raw of dated) {
        /*
          An expanded position list is itself paged. Every order seen carries
          one to four lines; a longer one has its positions read on their own
          rather than stored short, which would read as a product mismatch.
        */
        const size = raw.positions?.meta?.size ?? 0
        const full =
          size > (raw.positions?.rows?.length ?? 0)
            ? {
                ...raw,
                positions: await get<ListBody<RawPosition>>(
                  `entity/customerorder/${encodeURIComponent(raw.id)}/positions?limit=1000&expand=assortment`,
                  token,
                ),
              }
            : raw
        parsed.push(orderRows(full))
      }
      const ids = parsed.map((p) => p.order.id)
      // Replace, so a position removed in MoySklad does not linger here.
      await prisma.$transaction([
        prisma.moyskladOrder.deleteMany({ where: { id: { in: ids } } }),
        prisma.moyskladOrder.createMany({ data: parsed.map((p) => p.order) }),
        prisma.moyskladOrderItem.createMany({ data: parsed.flatMap((p) => p.items) }),
      ])
      orders += parsed.length
      items += parsed.reduce((n, p) => n + p.items.length, 0)
    }
    if (rows.length < PAGE) break

    pages += 1
    if (options.maxPages !== undefined && pages >= options.maxPages) {
      partial = true
      break
    }
    const lastUpdated = rows.at(-1)?.updated
    const last = lastUpdated ? parseMoscow(lastUpdated) : null
    if (last && (!cursor || secondOf(last) > secondOf(cursor))) {
      cursor = last
      offset = 0
    } else {
      // A whole page inside one second: step through that second by offset.
      offset += PAGE
    }
  }

  const deleted = options.sweep && !partial ? await sweepDeleted(prisma, token) : null
  await prisma.moyskladSync.upsert({
    where: { id: SYNC_ROW },
    create: { id: SYNC_ROW, lastSuccessAt: new Date() },
    update: { lastSuccessAt: new Date(), lastError: null, lastErrorAt: null },
  })
  return { orders, items, since, partial, skipped, deleted }
}

/** The one `moysklad_sync` row. */
const SYNC_ROW = 'orders'

/** Records a failed run, so «Sverka» can say the warehouse figures are stale. */
export async function recordMoyskladFailure(prisma: PrismaClient, error: Error): Promise<void> {
  await prisma.moyskladSync.upsert({
    where: { id: SYNC_ROW },
    create: { id: SYNC_ROW, lastError: error.message.slice(0, 500), lastErrorAt: new Date() },
    update: { lastError: error.message.slice(0, 500), lastErrorAt: new Date() },
  })
}

/**
 * Deletes the orders MoySklad no longer has. Throws — deleting nothing —
 * when the listing is shorter than MoySklad said it would be, or when more
 * than `SWEEP_GONE_FLOOR` / `SWEEP_GONE_SHARE` would go at once.
 *
 * AND EVERY CANDIDATE IS ASKED FOR BY ID FIRST. The listing pages by offset,
 * so an order deleted in MoySklad on a page already read slides a LIVE id
 * past the next boundary — and `meta.size` shrinks with it, so no count can
 * notice (measured with a mock: one live order of 1 500 would have gone).
 * Only a 404 deletes; any other answer stops the sweep.
 */
async function sweepDeleted(prisma: PrismaClient, token: string): Promise<number> {
  const live = new Set<string>()
  let expected = 0
  for (let offset = 0; ; offset += ID_PAGE) {
    const body = await get<ListBody<{ id: string }>>(
      `entity/customerorder?limit=${ID_PAGE}&offset=${offset}&order=created,asc`,
      token,
    )
    expected = body.meta?.size ?? expected
    for (const row of body.rows ?? []) live.add(row.id)
    if ((body.rows ?? []).length < ID_PAGE) break
  }
  if (live.size === 0 || live.size < expected) {
    throw new Error(`MoySklad roʻyxati toʻliq kelmadi (${live.size} / ${expected}) — hech narsa oʻchirilmadi`)
  }

  const stored = await prisma.moyskladOrder.findMany({ select: { id: true } })
  const candidates = stored.filter((s) => !live.has(s.id)).map((s) => s.id)
  if (candidates.length === 0) return 0
  const limit = Math.max(SWEEP_GONE_FLOOR, Math.floor(stored.length * SWEEP_GONE_SHARE))
  if (candidates.length > limit) {
    throw new Error(`MoySklad: ${candidates.length} buyurtma yoʻqolgandek (chegara ${limit}) — hech narsa oʻchirilmadi`)
  }
  const gone: string[] = []
  for (const id of candidates) {
    const order = await get<{ id: string }>(`entity/customerorder/${encodeURIComponent(id)}`, token, true)
    if (order === null) gone.push(id)
  }
  if (gone.length > 0) await prisma.moyskladOrder.deleteMany({ where: { id: { in: gone } } })
  return gone.length
}
