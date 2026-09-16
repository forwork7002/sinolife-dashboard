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
import { connect } from 'node:net'

export interface AddressProbe {
  readonly address: string
  readonly ms: number | null
  readonly error: string | null
}

export interface Reachability {
  readonly host: string
  readonly portal: readonly AddressProbe[]
  readonly control: AddressProbe
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

export async function checkReachability(webhookUrl: string): Promise<Reachability> {
  const host = new URL(webhookUrl).hostname
  const addresses = await resolve4(host).catch(() => [] as string[])
  const [control, ...portal] = await Promise.all([
    tcpProbe(CONTROL_ADDRESS),
    ...addresses.map((a) => tcpProbe(a)),
  ])
  return { host, portal, control: control! }
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
  return `tarmoq: ${verdict} | nazorat ${cell(r.control)} | ${r.portal.map(cell).join(', ')}`
}
