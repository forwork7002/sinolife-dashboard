/**
 * Bitrix24 + Postgres MCP server (stdio, JSON-RPC 2.0).
 *
 * WHY THIS EXISTS
 * `mcp-dev.bitrix24.com/mcp` serves Bitrix24's REST *documentation*. It has no
 * access to this portal, so an assistant wired only to it can quote the shape
 * of `crm.deal.list` but cannot read a single deal. This server closes that
 * gap: it speaks to the portal named by BITRIX24_WEBHOOK_URL and to the
 * database the sync engine writes into.
 *
 * Read-only by default. Bitrix24 methods that mutate are refused unless
 * B24_MCP_ALLOW_WRITE=1 is set, and SQL is restricted to a single SELECT/WITH
 * statement run inside a rolled-back transaction. The webhook URL embeds an
 * access token and is never echoed back in a result or an error.
 *
 * Rate limiting mirrors src/server/integrations/crm/bitrix24/rateLimiter.ts —
 * the portal throttles per account, and tripping it blocks the customer's own
 * CRM users, not just us.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import pg from 'pg'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/**
 * Minimal .env reader.
 *
 * The server's working directory is chosen by whoever launches it, so `.env`
 * is resolved against this file rather than against the process. Values
 * already present in the real environment win, which is how a deployment
 * overrides the local file.
 */
function loadEnv(file) {
  let text
  try {
    text = readFileSync(resolve(ROOT, file), 'utf8')
  } catch {
    return
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnv('.env')
loadEnv('.env.local')

const WEBHOOK = (process.env.BITRIX24_WEBHOOK_URL ?? '').replace(/\/*$/, '/')
const RPS = Number(process.env.BITRIX24_RATE_LIMIT_RPS ?? 2) || 2
const TIMEOUT_MS = Number(process.env.BITRIX24_REQUEST_TIMEOUT_MS ?? 30_000) || 30_000
const MAX_RETRIES = Number(process.env.BITRIX24_MAX_RETRIES ?? 3) || 3
const ALLOW_WRITE = process.env.B24_MCP_ALLOW_WRITE === '1'
/**
 * The database this server reads, which is NOT necessarily the app's.
 *
 * `DATABASE_URL` is the application's own connection — on a developer machine
 * it points at a local cluster that may be empty, stopped, or several
 * migrations behind. `B24_MCP_DATABASE_URL` lets this server be aimed at a
 * populated copy without moving the app onto it, so `npm run dev` cannot end
 * up writing wherever the analysis happens to be reading.
 *
 * Whatever it points at, `db_sql` still refuses anything but a single
 * SELECT/WITH and runs it inside a transaction it rolls back — so a read-only
 * role is a second lock, not the only one.
 */
const DATABASE_URL = process.env.B24_MCP_DATABASE_URL ?? process.env.DATABASE_URL ?? ''
const CA_CERT = process.env.DATABASE_CA_CERT

/** Maximum characters returned in one tool result, to protect the context. */
const MAX_RESULT_CHARS = 120_000

// ---------------------------------------------------------------------------
// Bitrix24 transport
// ---------------------------------------------------------------------------

/** Token bucket. Same contract as the app's RateLimiter, minus the DI seams. */
class RateLimiter {
  constructor(ratePerSecond) {
    this.rate = ratePerSecond
    this.burst = Math.max(1, Math.ceil(ratePerSecond))
    this.tokens = this.burst
    this.last = Date.now()
    this.queue = []
    this.draining = false
  }

  acquire() {
    return new Promise((res) => {
      this.queue.push(res)
      void this.drain()
    })
  }

  async drain() {
    if (this.draining) return
    this.draining = true
    while (this.queue.length > 0) {
      const elapsed = (Date.now() - this.last) / 1000
      if (elapsed > 0) {
        this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate)
        this.last = Date.now()
      }
      if (this.tokens < 1) {
        const waitMs = Math.ceil(((1 - this.tokens) / this.rate) * 1000)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      this.tokens -= 1
      this.queue.shift()()
    }
    this.draining = false
  }
}

const limiter = new RateLimiter(RPS)

/** Methods that change the portal. Refused unless writes are explicitly on. */
const MUTATING = /\.(add|update|delete|set|import|register|unregister|bind|unbind|move|start|finish|pause)$/i

/**
 * One REST call.
 *
 * Retries on 503 and on Bitrix24's own overload errors, which arrive as HTTP
 * 200 with an `error` field. Anything else is surfaced as-is: a wrong method
 * name should fail on the first attempt, not three seconds later.
 */
async function b24(method, params = {}) {
  if (!WEBHOOK) {
    throw new Error('BITRIX24_WEBHOOK_URL is not set — nothing to talk to.')
  }
  if (!ALLOW_WRITE && MUTATING.test(method)) {
    throw new Error(
      `Refused: "${method}" modifies the portal. This server is read-only; ` +
        'set B24_MCP_ALLOW_WRITE=1 to lift that.',
    )
  }

  let lastError
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await limiter.acquire()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await fetch(`${WEBHOOK}${method}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: controller.signal,
      })
      const text = await response.text()
      let body
      try {
        body = JSON.parse(text)
      } catch {
        throw new Error(`${method}: non-JSON reply (HTTP ${response.status})`)
      }
      if (body.error) {
        const message = `${body.error}: ${body.error_description ?? ''}`.trim()
        if (/QUERY_LIMIT|OVERLOAD/i.test(body.error) && attempt < MAX_RETRIES) {
          lastError = new Error(message)
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
          continue
        }
        throw new Error(`${method} → ${message}`)
      }
      if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`)
      return body
    } catch (error) {
      // A token in the URL must never reach a log or a tool result.
      const message = String(error?.message ?? error).split(WEBHOOK).join('<webhook>/')
      lastError = new Error(message)
      if (attempt >= MAX_RETRIES) break
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError
}

/**
 * A `.list` method drained page by page.
 *
 * Bitrix24 returns 50 rows per page and reports the full count in `total`, so
 * the caller's `limit` is the only thing standing between an innocent question
 * and 400 000 rows of telephony.
 */
async function b24List(method, { filter, select, order, limit = 200, start } = {}) {
  const rows = []
  let cursor = start ?? 0
  let total = null
  while (rows.length < limit) {
    const page = await b24(method, {
      ...(filter ? { filter } : {}),
      ...(select ? { select } : {}),
      ...(order ? { order } : {}),
      start: cursor,
    })
    total = page.total ?? total
    const batch = Array.isArray(page.result) ? page.result : (page.result?.items ?? [])
    rows.push(...batch)
    if (page.next === undefined || page.next === null || batch.length === 0) break
    cursor = page.next
  }
  return { total, returned: Math.min(rows.length, limit), rows: rows.slice(0, limit) }
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

let pool = null

/** Lazily built, so a portal-only question never opens a database connection. */
function getPool() {
  if (pool) return pool
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not set.')
  const config = { connectionString: DATABASE_URL, max: 2, statement_timeout: 30_000 }
  const mode = (() => {
    try {
      return new URL(DATABASE_URL).searchParams.get('sslmode')?.toLowerCase()
    } catch {
      return undefined
    }
  })()
  // Same reasoning as src/server/db/poolConfig.ts: `pg` verifies where libpq
  // would not, and a managed cluster's own CA is not in the system store.
  if (mode && ['require', 'prefer', 'allow', 'verify-ca'].includes(mode)) {
    config.connectionString = (() => {
      const url = new URL(DATABASE_URL)
      url.searchParams.delete('sslmode')
      return url.toString()
    })()
    config.ssl = CA_CERT
      ? { ca: CA_CERT.replace(/\\n/g, '\n'), rejectUnauthorized: true }
      : { rejectUnauthorized: false }
  }
  pool = new pg.Pool(config)
  return pool
}

const SQL_ALLOWED = /^\s*(select|with)\b/i
const SQL_FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy)\b/i

/**
 * One read-only statement.
 *
 * Run inside a transaction that is always rolled back and marked READ ONLY, so
 * even a statement that slips past the regexes cannot leave a trace.
 */
async function sql(query, limit = 500) {
  if (!SQL_ALLOWED.test(query)) throw new Error('Only SELECT or WITH queries are allowed.')
  if (SQL_FORBIDDEN.test(query)) throw new Error('Write keywords are not allowed.')
  if (query.includes(';') && query.trim().replace(/;\s*$/, '').includes(';')) {
    throw new Error('One statement at a time.')
  }
  const client = await getPool().connect()
  try {
    await client.query('BEGIN READ ONLY')
    const result = await client.query(query.trim().replace(/;\s*$/, ''))
    return {
      rowCount: result.rowCount,
      returned: Math.min(result.rows.length, limit),
      columns: result.fields.map((f) => f.name),
      rows: result.rows.slice(0, limit),
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'b24_call',
    description:
      'Call any Bitrix24 REST method on THIS portal and return its raw reply. ' +
      'Use for single-record and metadata methods (crm.deal.get, crm.deal.fields, ' +
      'user.get, crm.status.list). For .list methods prefer b24_list, which paginates. ' +
      'Read-only: methods that modify the portal are refused.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'e.g. "crm.deal.fields", "user.get"' },
        params: { type: 'object', description: 'Method parameters, as Bitrix24 documents them.' },
      },
      required: ['method'],
    },
  },
  {
    name: 'b24_list',
    description:
      'Drain a Bitrix24 .list method page by page and return the rows plus the portal-side ' +
      'total. Always pass select and filter — the portal holds ~12 400 calls a day and a ' +
      'bare list is expensive for everyone.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'e.g. "crm.deal.list", "voximplant.statistic.get"' },
        filter: { type: 'object' },
        select: { type: 'array', items: { type: 'string' } },
        order: { type: 'object' },
        limit: { type: 'number', description: 'Maximum rows to return. Default 200.' },
        start: { type: 'number', description: 'Page offset to resume from.' },
      },
      required: ['method'],
    },
  },
  {
    name: 'b24_scope',
    description:
      'What this webhook is allowed to read, and which portal it points at. ' +
      'Start here when a call fails with an access error.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'db_sql',
    description:
      'Run one read-only SELECT against the dashboard database — the synchronised copy of ' +
      'the portal (deals, stage history, calls, payments, employees, KPI results). Faster ' +
      'and joinable, unlike the REST API. Rolled back automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Maximum rows returned. Default 500.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'db_schema',
    description:
      'Tables and columns of the dashboard database. Read this before writing db_sql.',
    inputSchema: {
      type: 'object',
      properties: { table: { type: 'string', description: 'Restrict to one table.' } },
    },
  },
]

async function runTool(name, args = {}) {
  switch (name) {
    case 'b24_call':
      return await b24(args.method, args.params ?? {})
    case 'b24_list':
      return await b24List(args.method, args)
    case 'b24_scope': {
      const [scope, profile] = await Promise.all([b24('scope'), b24('profile')])
      let portal
      try {
        portal = new URL(WEBHOOK).host
      } catch {
        portal = '<unparseable>'
      }
      return {
        portal,
        scopes: scope.result,
        account: profile.result,
        writesAllowed: ALLOW_WRITE,
      }
    }
    case 'db_sql':
      return await sql(args.query, args.limit ?? 500)
    case 'db_schema': {
      const query = args.table
        ? `SELECT table_name, column_name, data_type, is_nullable
             FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = '${String(args.table).replace(/'/g, "''")}'
            ORDER BY ordinal_position`
        : `SELECT table_name, column_name, data_type
             FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position`
      return await sql(query, 5000)
    }
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC over stdio
// ---------------------------------------------------------------------------

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function textResult(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 1)
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n… truncated at ${MAX_RESULT_CHARS} characters. Narrow the query.`
  }
  return { content: [{ type: 'text', text }] }
}

const rl = createInterface({ input: process.stdin })

/**
 * Requests still being served.
 *
 * A client that closes stdin the moment it has written its last request — a
 * shell pipeline, a test — would otherwise lose the reply, because the close
 * event fires long before an awaited REST call comes back.
 */
let inFlight = 0
let closed = false

function maybeExit() {
  if (closed && inFlight === 0) {
    void pool?.end().catch(() => {})
    process.exit(0)
  }
}

rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let request
  try {
    request = JSON.parse(trimmed)
  } catch {
    return
  }

  const { id, method, params } = request
  const isNotification = id === undefined || id === null

  inFlight += 1
  try {
    let result
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'bitrix24-portal', version: '1.0.0' },
        }
        break
      case 'tools/list':
        result = { tools: TOOLS }
        break
      case 'tools/call':
        try {
          result = textResult(await runTool(params?.name, params?.arguments ?? {}))
        } catch (error) {
          // A failed tool is data for the model, not a protocol error.
          result = { ...textResult(`Error: ${error?.message ?? error}`), isError: true }
        }
        break
      case 'ping':
        result = {}
        break
      case 'resources/list':
        result = { resources: [] }
        break
      case 'prompts/list':
        result = { prompts: [] }
        break
      default:
        if (isNotification) return
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
        return
    }
    if (!isNotification) send({ jsonrpc: '2.0', id, result })
  } catch (error) {
    if (!isNotification) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(error?.message ?? error) } })
    }
  } finally {
    inFlight -= 1
    maybeExit()
  }
})

rl.on('close', () => {
  closed = true
  maybeExit()
})
