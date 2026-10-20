import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { Agent, buildConnector, fetch as undiciFetch } from 'undici'

/**
 * WHICH OF THE PORTAL'S ADDRESSES ANSWERS US — and why fetch alone could not ask.
 *
 * `obey.bitrix24.kz` resolves to four front addresses in Moscow (Corp Soft,
 * AS39337). Measured from INSIDE the deployed worker on 2026-10-20 07:20 UTC,
 * during an outage the header called «sinx xatosi»: TCP opened to all four in
 * ~45 ms; the TLS handshake completed on 46.235.53.58 (100 ms) and
 * 195.208.185.4 (118 ms) and never completed on 46.235.53.67 and 46.235.53.69.
 * ya.ru, 1c-bitrix.ru and google answered from the same container, and 38
 * datacentres elsewhere (check-host.net) completed TLS to all four — so two of
 * the portal's fronts were silently dropping OUR address (DigitalOcean fra,
 * 164.90.174.139 that day).
 *
 * fetch takes ONE address per connection and never tries another: TCP opens,
 * TLS hangs, ten seconds later `UND_ERR_CONNECT_TIMEOUT`. One connection in two
 * failed, three in a row shut `PortalGate`, and the whole sync stopped while
 * half the portal was answering. `sync_log` holds seven such outages in thirty
 * days, 8–30 minutes each. The same failure on all four fronts at once was
 * 2026-09-16; this file cannot help with that one, and does not pretend to.
 *
 * So the connection is opened here: every address in turn, each with its own
 * short handshake budget, and an address that dropped us is tried LAST for a
 * while, so the next connection starts with one that answered. When every
 * address fails the callback gets the LAST address's error — undici's own
 * `ConnectTimeoutError` for a dropped handshake, `ECONNREFUSED`/`ECONNRESET` for
 * a refused one — and fetch wraps it as it always did (`fetch failed
 * [UND_ERR_CONNECT_TIMEOUT]`); `isNetworkFailure` matches every one of those,
 * so the gate, the chip and `sync_log` read it exactly as before.
 */

/**
 * The handshake budget for ONE address. A healthy front answers fra in ~0.1 s;
 * five seconds is fifty times that, and four fronts stay inside 20 s — under the
 * 30 s the worker gives a single call. Only the first connection after a front
 * goes dark pays it: the book then dials that front last.
 */
const ADDRESS_TIMEOUT_MS = 5_000

/**
 * How long an address that dropped us is tried last. The 2026-10-20 pair stayed
 * dark for over an hour, so retrying it first every few minutes would cost five
 * seconds a connection for nothing; it is still tried when nothing else answers.
 */
const DOWN_FOR_MS = 15 * 60_000

type Connector = buildConnector.connector
type ConnectOptions = buildConnector.Options

/** The portal's addresses, healthy first. Pure, so the order is testable. */
export class AddressBook {
  private readonly downUntil = new Map<string, number>()

  /** Addresses that did not drop us, in the resolver's order; then the rest, soonest-back first. */
  order(addresses: readonly string[], now: number): string[] {
    const up: string[] = []
    const down: string[] = []
    for (const address of addresses) (this.isDown(address, now) ? down : up).push(address)
    down.sort((a, b) => this.downUntil.get(a)! - this.downUntil.get(b)!)
    return [...up, ...down]
  }

  /** True when this is news — the address was answering until now. */
  markDown(address: string, now: number): boolean {
    const news = !this.isDown(address, now)
    this.downUntil.set(address, now + DOWN_FOR_MS)
    return news
  }

  /** True when this is news — the address had dropped us before. */
  markUp(address: string): boolean {
    return this.downUntil.delete(address)
  }

  private isDown(address: string, now: number): boolean {
    return (this.downUntil.get(address) ?? 0) > now
  }
}

function errorCode(error: Error): string {
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code) ? code : error.name
}

/**
 * A front that ANSWERED with a certificate we refuse is not a network drop, and
 * must not read like one: it is either a misissued certificate or somebody in
 * the middle. Either way the call is skipped to the next front and nothing is
 * sent — Node closes the socket before `secureConnect` — but the log says so.
 */
function isCertificateError(code: string): boolean {
  return /^ERR_TLS_|^CERT_|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)/.test(code)
}

/**
 * An undici connector that walks the portal's addresses until one completes
 * the TLS handshake. Dependencies are passed in so a test can stand in for the
 * network; `createPortalFetch` wires the real ones.
 */
export function failoverConnector(deps: {
  readonly base: Connector
  readonly resolve: (hostname: string) => Promise<string[]>
  readonly book: AddressBook
  readonly report: (message: string) => void
  readonly now?: () => number
}): Connector {
  const now = deps.now ?? Date.now

  return (options, callback) => {
    /*
      EXACTLY ONE ANSWER, WHATEVER THROWS. undici's Client wraps the connector
      CALL in try/catch, but the work here runs later, inside a promise and inside
      socket callbacks — a throw there would be an unhandled rejection, which
      kills the worker, with the request left connecting forever.
    */
    let answered = false
    const answer: typeof callback = (...args) => {
      if (answered) return
      answered = true
      callback(...args)
    }
    const report = (message: string) => {
      try {
        deps.report(message)
      } catch {
        // A log line is never worth a connection.
      }
    }
    const direct = () => {
      try {
        deps.base(options, answer)
      } catch (error) {
        answer(error as Error, null)
      }
    }

    // Nothing to choose between: a literal address, or a plain-text origin.
    if (options.protocol !== 'https:' || isIP(options.hostname) !== 0) {
      direct()
      return
    }

    deps
      .resolve(options.hostname)
      .then(
        (addresses) => {
          const order = deps.book.order(addresses, now())
          if (order.length === 0) {
            direct()
            return
          }

          let next = 0
          const attempt = (lastError: Error | null): void => {
            const address = order[next++]
            if (address === undefined) {
              answer(lastError ?? new Error(`no address answered for ${options.hostname}`), null)
              return
            }
            const viaAddress: ConnectOptions = {
              ...options,
              hostname: address,
              // The certificate is checked against the NAME, not the address.
              servername: options.servername || options.hostname,
            }
            const failed = (error: Error) => {
              const code = errorCode(error)
              if (deps.book.markDown(address, now())) {
                report(
                  isCertificateError(code)
                    ? `portal manzili ${address} notoʻgʻri sertifikat berdi (${code}) — oʻtkazib yuborildi, soʻrov yuborilmadi`
                    : `portal manzili ${address} javob bermadi (${code}) — boshqa manzil sinaladi`,
                )
              }
              attempt(error)
            }
            try {
              deps.base(viaAddress, (error, socket) => {
                if (error) {
                  failed(error)
                  return
                }
                if (deps.book.markUp(address)) report(`portal manzili ${address} yana javob beryapti`)
                answer(null, socket)
              })
            } catch (error) {
              failed(error as Error)
            }
          }
          attempt(null)
        },
        // The resolver failed: let the ordinary path fail with its own error.
        () => direct(),
      )
      .catch((error: unknown) => answer(error as Error, null))
  }
}

/**
 * The fetch every Bitrix24 call goes through unless a test injects its own.
 *
 * undici's OWN fetch, not the global one: Node's built-in fetch is undici too,
 * but a different copy (6.x inside Node 22), and handing it a dispatcher built
 * by another major version is not a supported pairing. The cast is the type
 * system meeting two copies of the same classes.
 *
 * HTTP/1.1 ONLY, written out twice. undici 8 offers h2 by default (Node 22's
 * copy did not), and the portal picks it — which would have moved every call
 * onto one multiplexed session, where a front that drops us hangs every request
 * in flight at once and fails with GOAWAY / stream resets the gate has never
 * seen. The transport stays what it was; only the address choice is new.
 */
export function createPortalFetch(report: (message: string) => void): typeof fetch {
  const agent = new Agent({
    allowH2: false,
    connect: failoverConnector({
      base: buildConnector({ timeout: ADDRESS_TIMEOUT_MS, allowH2: false }),
      resolve: async (hostname) => (await lookup(hostname, { all: true })).map((a) => a.address),
      book: new AddressBook(),
      report,
    }),
  })
  const portalFetch = (input: string | URL | Request, init?: RequestInit) =>
    undiciFetch(input as string, { ...(init as object), dispatcher: agent })
  return portalFetch as unknown as typeof fetch
}
