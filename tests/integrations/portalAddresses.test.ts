import { createServer } from 'node:http'
import { connect as dial } from 'node:net'
import type { AddressInfo } from 'node:net'

import { describe, expect, it } from 'vitest'

import {
  AddressBook,
  createPortalFetch,
  failoverConnector,
  relayHost,
} from '@/server/integrations/crm/bitrix24/portalAddresses'

/**
 * 2026-10-20 07:20 UTC, measured inside the deployed worker: TLS completed on
 * two of the portal's four fronts and hung on the other two. fetch took one
 * address per connection, so one connection in two failed and the sync stopped
 * while half the portal was answering. These tests stand in for the network
 * with exactly that split.
 */

const GOOD = ['46.235.53.58', '195.208.185.4']
const DNS_ORDER = ['46.235.53.67', '46.235.53.69', '46.235.53.58', '195.208.185.4']

function failure(code: string): Error {
  return Object.assign(new Error(code), { code })
}

function harness(opts: {
  answers?: (address: string) => boolean
  fail?: (address: string) => Error
  resolve?: () => Promise<string[]>
  throwFor?: string
} = {}) {
  let answers = opts.answers ?? ((a: string) => GOOD.includes(a))
  const tried: { hostname: string; servername?: string }[] = []
  const reports: string[] = []
  let clock = Date.parse('2026-10-20T07:20:00Z')
  const connect = failoverConnector({
    base: (options, callback) => {
      tried.push({ hostname: options.hostname, servername: options.servername })
      if (options.hostname === opts.throwFor) throw new Error('sync throw from base')
      if (answers(options.hostname)) callback(null, { address: options.hostname } as never)
      else callback((opts.fail ?? (() => failure('UND_ERR_CONNECT_TIMEOUT')))(options.hostname), null)
    },
    resolve: opts.resolve ?? (async () => DNS_ORDER),
    book: new AddressBook(),
    report: (message) => reports.push(message),
    now: () => clock,
  })
  const open = (hostname = 'obey.bitrix24.kz', protocol = 'https:') =>
    new Promise<{ error: Error | null; socket: unknown; calls: number }>((resolve) => {
      let calls = 0
      // The real Client always hands the connector a servername.
      connect({ hostname, host: hostname, protocol, port: '', servername: hostname }, (error, socket) => {
        calls += 1
        // Give a second, wrongful call the chance to land before resolving.
        setTimeout(() => resolve({ error, socket, calls }), 5)
      })
    })
  return {
    tried,
    reports,
    open,
    advance: (ms: number) => (clock += ms),
    setAnswers: (fn: (address: string) => boolean) => (answers = fn),
  }
}

describe('a portal front that drops the handshake', () => {
  it('is skipped for the next address instead of failing the call', async () => {
    const { tried, open } = harness()

    const { error, socket, calls } = await open()

    expect(error).toBeNull()
    expect(socket).toEqual({ address: '46.235.53.58' })
    expect(calls).toBe(1)
    expect(tried.map((t) => t.hostname)).toEqual(['46.235.53.67', '46.235.53.69', '46.235.53.58'])
  })

  it('checks the certificate against the portal NAME while dialling the address', async () => {
    const { tried, open } = harness()
    await open()
    expect(tried.every((t) => t.servername === 'obey.bitrix24.kz')).toBe(true)
  })

  it('is tried last on the next connection, so that one costs nothing', async () => {
    const { tried, open } = harness()
    await open()
    tried.length = 0

    await open()

    expect(tried.map((t) => t.hostname)).toEqual(['46.235.53.58'])
  })

  it('is reported once when it drops us and once when it answers again', async () => {
    const { reports, open, advance, setAnswers } = harness()
    await open()
    await open()
    expect(reports).toEqual([
      'portal manzili 46.235.53.67 javob bermadi (UND_ERR_CONNECT_TIMEOUT) — boshqa manzil sinaladi',
      'portal manzili 46.235.53.69 javob bermadi (UND_ERR_CONNECT_TIMEOUT) — boshqa manzil sinaladi',
    ])

    // Fifteen minutes on, the dark pair is tried first again — and answers.
    setAnswers(() => true)
    advance(15 * 60_000 + 1)
    await open()
    expect(reports.at(-1)).toBe('portal manzili 46.235.53.67 yana javob beryapti')
  })

  /**
   * 2026-09-16: every front dropped the server at once. Nothing here can fix
   * that, and the error has to stay one the gate and the chip already read.
   */
  it('hands back the last front\'s own error when no address answers at all', async () => {
    const { tried, open } = harness({ answers: () => false })

    const { error, socket, calls } = await open()

    expect(socket).toBeNull()
    expect(calls).toBe(1)
    expect((error as { code?: string }).code).toBe('UND_ERR_CONNECT_TIMEOUT')
    expect(tried).toHaveLength(4)
  })

  it('names a refused certificate as such, not as a network drop', async () => {
    const { reports, open } = harness({
      fail: (address) =>
        address === '46.235.53.67' ? failure('ERR_TLS_CERT_ALTNAME_INVALID') : failure('UND_ERR_CONNECT_TIMEOUT'),
    })
    await open()
    expect(reports[0]).toBe(
      'portal manzili 46.235.53.67 notoʻgʻri sertifikat berdi (ERR_TLS_CERT_ALTNAME_INVALID) — oʻtkazib yuborildi, soʻrov yuborilmadi',
    )
  })
})

describe('the connector never leaves a connection without an answer', () => {
  it('moves on when dialling one address throws, instead of crashing the worker', async () => {
    const { open, tried } = harness({ throwFor: '46.235.53.67' })

    const { error, socket, calls } = await open()

    expect(error).toBeNull()
    expect(socket).toEqual({ address: '46.235.53.58' })
    expect(calls).toBe(1)
    expect(tried[0]?.hostname).toBe('46.235.53.67')
  })

  it('falls back to the ordinary dial when the resolver fails', async () => {
    const { open, tried } = harness({
      resolve: () => Promise.reject(new Error('EAI_AGAIN')),
      answers: (a) => a === 'obey.bitrix24.kz',
    })

    const { error, calls } = await open()

    expect(error).toBeNull()
    expect(calls).toBe(1)
    expect(tried.map((t) => t.hostname)).toEqual(['obey.bitrix24.kz'])
  })

  it('dials a literal address or a plain-text origin as given', async () => {
    const { open, tried } = harness({ answers: () => true })
    await open('46.235.53.58')
    await open('localhost', 'http:')
    expect(tried.map((t) => t.hostname)).toEqual(['46.235.53.58', 'localhost'])
  })
})

describe('AddressBook', () => {
  it('keeps the resolver order for healthy addresses and puts dropped ones last', () => {
    const book = new AddressBook()
    const t = 1_000_000
    book.markDown('46.235.53.69', t)
    book.markDown('46.235.53.67', t + 1)

    expect(book.order(DNS_ORDER, t + 2)).toEqual([
      '46.235.53.58',
      '195.208.185.4',
      '46.235.53.69',
      '46.235.53.67',
    ])
    expect(book.order(DNS_ORDER, t + 15 * 60_000 + 2)).toEqual(DNS_ORDER)
  })
})

/**
 * The provider reads `status`, `ok`, `json()` and `text()` off what this fetch
 * returns, and sends a JSON body with an abort signal. undici's own fetch is a
 * second copy of those classes; this is the check that the cast holds.
 */
describe('createPortalFetch', () => {
  it('answers like fetch for the calls the provider makes', async () => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ result: JSON.parse(body), version: req.httpVersion }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    try {
      const portalFetch = createPortalFetch(() => {}, '')
      const response = await portalFetch(`http://127.0.0.1:${port}/rest/profile.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 1 }),
        signal: new AbortController().signal,
      })
      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ result: { id: 1 }, version: '1.1' })
    } finally {
      server.close()
    }
  })
})

/**
 * 2026-10-20: the fronts filter the big foreign hosting networks themselves,
 * so the calls can be sent through a relay outside them. It must TUNNEL —
 * the relay may see where a call goes, never what it says.
 */
describe('createPortalFetch through a relay', () => {
  it('tunnels every call with CONNECT and sends the relay its credentials', async () => {
    const target = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ result: JSON.parse(body) }))
      })
    })
    const seen: { method: string; url: string; auth: string | undefined }[] = []
    const relay = createServer((req, res) => {
      // A request forwarded in the clear would land here, not in 'connect'.
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers['proxy-authorization'] })
      res.writeHead(502).end()
    })
    relay.on('connect', (req, client, head) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers['proxy-authorization'] })
      const [host, port] = (req.url ?? '').split(':')
      const upstream = dial(Number(port), host, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        upstream.write(head)
        upstream.pipe(client)
        client.pipe(upstream)
      })
      upstream.on('error', () => client.destroy())
      client.on('error', () => upstream.destroy())
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve))
    const targetPort = (target.address() as AddressInfo).port
    const relayPort = (relay.address() as AddressInfo).port
    try {
      const portalFetch = createPortalFetch(() => {}, `http://ish:s3cret@127.0.0.1:${relayPort}`)
      const response = await portalFetch(`http://127.0.0.1:${targetPort}/rest/profile.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 7 }),
      })

      expect(await response.json()).toEqual({ result: { id: 7 } })
      expect(seen).toEqual([
        {
          method: 'CONNECT',
          url: `127.0.0.1:${targetPort}`,
          auth: `Basic ${Buffer.from('ish:s3cret').toString('base64')}`,
        },
      ])
    } finally {
      relay.close()
      target.close()
    }
  })

  it('names the relay by host only, so a log line never carries its password', () => {
    expect(relayHost('http://ish:s3cret@relay.example:3128')).toBe('relay.example:3128')
    expect(relayHost('  ')).toBeNull()
    expect(relayHost('')).toBeNull()
  })
})
