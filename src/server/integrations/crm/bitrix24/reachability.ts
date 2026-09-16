/**
 * Can THIS MACHINE open a TCP connection to the portal — address by address?
 *
 * WRITTEN 2026-09-16, when the deployed worker logged
 * `fetch failed [UND_ERR_CONNECT_TIMEOUT]` for hours while the same webhook
 * answered in 0.45 s from an office laptop on every one of the portal's four
 * addresses. A failed `fetch` says only that ONE connection did not open; it
 * cannot say whether our egress is broken, whether Bitrix24 drops our address,
 * or whether one of its addresses is unreachable from this route while the
 * others are fine. Those need three different people, so this asks all three
 * questions at once: every A record of the portal, and a control host that has
 * nothing to do with Bitrix24.
 *
 * A bare TCP handshake to port 443 — no TLS, no HTTP, no webhook. The portal's
 * REST layer never sees it, so it costs nothing against any Bitrix24 limit.
 */
import { resolve4 } from 'node:dns/promises'
import { request } from 'node:https'
import { connect } from 'node:net'
import { connect as tlsConnect } from 'node:tls'

export interface AddressProbe {
  readonly address: string
  readonly ms: number | null
  readonly error: string | null
}

export interface Reachability {
  readonly host: string
  readonly portal: readonly AddressProbe[]
  readonly control: AddressProbe
  /** TLS handshake per portal address — TCP opening proves nothing past SYN. */
  readonly tls: readonly AddressProbe[]
  /** One `profile` through node:https rather than fetch, when a webhook is given. */
  readonly https: AddressProbe | null
  /**
   * The same handshake with a SMALL ClientHello: classical curves only, and
   * TLS 1.2. Node 24's default offers a post-quantum key share that makes the
   * hello ~1.5 KB, and middleboxes on some routes drop exactly that shape.
   */
  readonly tlsSmall: AddressProbe | null
  readonly tls12: AddressProbe | null
  /**
   * TLS to hosts that are NOT this portal: a Russian site with no Bitrix24 in
   * it, Bitrix24's own public site on another network, and its OAuth server in
   * Ireland. Which of these complete is what says who is dropping us — the
   * portal's network, the route into Russia, or nothing past our own egress.
   */
  readonly tlsControls: readonly AddressProbe[]
  /**
   * The address the portal sees us as. On App Platform without a dedicated
   * egress IP it is shared and can change on a redeploy, so it is read, not
   * configured — and it is the one fact Bitrix24 support needs to lift a block.
   */
  readonly egressIp: string | null
}

async function egressAddress(): Promise<string | null> {
  try {
    const response = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(5_000) })
    const text = (await response.text()).trim()
    return /^[\d.]{7,15}$/.test(text) ? text : null
  } catch {
    return null
  }
}

/** Cloudflare's resolver: answers 443 everywhere, belongs to nobody involved. */
const CONTROL_ADDRESS = '1.1.1.1'
const CONNECT_TIMEOUT_MS = 5_000

export function tcpProbe(address: string, port = 443, timeoutMs = CONNECT_TIMEOUT_MS): Promise<AddressProbe> {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = connect({ host: address, port })
    const done = (error: string | null) => {
      socket.destroy()
      resolve({ address, ms: error ? null : Date.now() - started, error })
    }
    socket.setTimeout(timeoutMs, () => done('TIMEOUT'))
    socket.once('connect', () => done(null))
    socket.once('error', (e: NodeJS.ErrnoException) => done(e.code ?? 'ERROR'))
  })
}

/*
  WHY TLS AND HTTPS TOO. On production 2026-09-16 11:26 UTC every portal
  address opened TCP in 44 ms from the worker while `fetch` kept failing with
  UND_ERR_CONNECT_TIMEOUT — and undici's «connect» includes the TLS handshake.
  So the question moved one layer up, and these two answer it: does the
  handshake finish, and does a request that does NOT go through undici work.
*/
export function tlsProbe(
  address: string,
  servername: string,
  timeoutMs = 10_000,
  shape: { ecdhCurve?: string; maxVersion?: 'TLSv1.2' | 'TLSv1.3' } = {},
): Promise<AddressProbe> {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = tlsConnect({ host: address, port: 443, servername, ...shape })
    const done = (error: string | null) => {
      socket.destroy()
      resolve({ address, ms: error ? null : Date.now() - started, error })
    }
    socket.setTimeout(timeoutMs, () => done('TIMEOUT'))
    socket.once('secureConnect', () => done(null))
    socket.once('error', (e: NodeJS.ErrnoException) => done(e.code ?? 'ERROR'))
  })
}

export function httpsProbe(url: string, timeoutMs = 15_000): Promise<AddressProbe> {
  return new Promise((resolve) => {
    const started = Date.now()
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      res.resume()
      res.once('end', () => resolve({ address: `https ${res.statusCode}`, ms: Date.now() - started, error: null }))
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve({ address: 'https', ms: null, error: 'TIMEOUT' })
    })
    req.once('error', (e: NodeJS.ErrnoException) => resolve({ address: 'https', ms: null, error: e.code ?? 'ERROR' }))
    req.end('{}')
  })
}

export async function checkReachability(webhookUrl: string): Promise<Reachability> {
  const host = new URL(webhookUrl).hostname
  const addresses = await resolve4(host).catch(() => [] as string[])
  const [control, ...portal] = await Promise.all([
    tcpProbe(CONTROL_ADDRESS),
    ...addresses.map((a) => tcpProbe(a)),
  ])
  const tls = await Promise.all(addresses.map((a) => tlsProbe(a, host)))
  const first = addresses[0]
  const tlsSmall = first ? await tlsProbe(first, host, 10_000, { ecdhCurve: 'X25519:P-256' }) : null
  const tls12 = first ? await tlsProbe(first, host, 10_000, { maxVersion: 'TLSv1.2' }) : null
  const tlsControls = await Promise.all(
    ['ya.ru', 'www.bitrix24.kz', 'oauth.bitrix.info'].map(async (name) => {
      const [address] = await resolve4(name).catch(() => [] as string[])
      if (!address) return { address: name, ms: null, error: 'DNS' }
      const probe = await tlsProbe(address, name)
      return { ...probe, address: name }
    }),
  )
  const https = /\/rest\//.test(webhookUrl) ? await httpsProbe(`${webhookUrl}profile.json`) : null
  const egressIp = await egressAddress()
  return { host, portal, control: control!, tls, https, tlsSmall, tls12, tlsControls, egressIp }
}

/** One log line a person can act on. */
export function describeReachability(r: Reachability): string {
  const cell = (p: AddressProbe) => `${p.address} ${p.ms !== null ? `✓${p.ms}ms` : `✗${p.error}`}`
  const open = r.portal.filter((p) => p.ms !== null).length
  const verdict =
    r.control.ms === null
      ? 'serverning internet chiqishi ishlamayapti (DigitalOcean tomoni)'
      : r.portal.length === 0
        ? `${r.host} DNS da topilmadi`
        : open === 0
          ? 'internet bor, lekin Bitrix24 bu server manzilini qabul qilmayapti'
          : open < r.portal.length
            ? 'Bitrix24 manzillarining bir qismi bu serverdan ochilmayapti'
            : 'TCP hamma manzilga ochiladi — muammo ulanishdan keyin'
  const tlsOpen = r.tls.filter((p) => p.ms !== null).length
  return (
    `tarmoq: ${verdict} | chiqish IP ${r.egressIp ?? '?'} | nazorat ${cell(r.control)} | TCP ${r.portal.map(cell).join(', ')}` +
    ` | TLS ${tlsOpen}/${r.tls.length} ${r.tls.map(cell).join(', ')}` +
    (r.tlsSmall ? ` | kichik-hello ${r.tlsSmall.ms !== null ? `✓${r.tlsSmall.ms}ms` : `✗${r.tlsSmall.error}`}` : '') +
    (r.tls12 ? ` | TLS1.2 ${r.tls12.ms !== null ? `✓${r.tls12.ms}ms` : `✗${r.tls12.error}`}` : '') +
    (r.tlsControls.length ? ` | TLS nazorat ${r.tlsControls.map(cell).join(', ')}` : '') +
    (r.https ? ` | node:https ${r.https.ms !== null ? `${r.https.address} ${r.https.ms}ms` : `✗${r.https.error}`}` : '')
  )
}
