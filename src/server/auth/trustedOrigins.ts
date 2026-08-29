/**
 * Which origins may post to the auth endpoints.
 *
 * better-auth rejects a sign-in whose `Origin` header is not on this list.
 * That check is what stops another site from posting to our endpoints with the
 * visitor's cookies attached, so it is not something to switch off.
 *
 * It also trusts `baseURL` implicitly — and ONLY that. Which is why a locally
 * run instance works when opened at exactly the address in BETTER_AUTH_URL and
 * nowhere else: the same server reached at `127.0.0.1:3000` or at the
 * machine's own LAN address answers 403 INVALID_ORIGIN, sets no cookie, and
 * the page middleware then bounces every section back to /login. It presents
 * as a password that has stopped working.
 *
 * In its own module, free of Prisma, so it can be unit tested — the previous
 * version of this logic lived inline in the auth config and could only be
 * exercised by starting the whole application.
 */

import { networkInterfaces } from 'node:os'

/**
 * Loopback and this machine's own addresses, on the configured port.
 *
 * The list is CONCRETE — read from the real network interfaces at boot. It is
 * never derived from the incoming request: echoing back whatever origin a
 * caller claims would accept every origin and defeat the check entirely.
 *
 * Returns nothing for an https deployment. That instance is reached by domain
 * name, and widening it would trade a real protection for no benefit.
 */
export function selfOrigins(baseUrl: string, interfaces = networkInterfaces): string[] {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return []
  }

  if (url.protocol !== 'http:') return []

  const port = url.port ? `:${url.port}` : ''
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', url.hostname])

  for (const addresses of Object.values(interfaces())) {
    for (const address of addresses ?? []) {
      /**
       * IPv4 only.
       *
       * An IPv6 literal in an Origin header needs bracketing that differs
       * between clients, and every machine this runs on is reachable over v4.
       * Loopback v6 is covered by the `[::1]` literal above.
       */
      if (!address.internal && address.family === 'IPv4') hosts.add(address.address)
    }
  }

  return [...hosts].map((host) => `http://${host}${port}`)
}

/**
 * Extra origins for a reverse proxy or a second domain.
 *
 * Comma-separated. Trusted verbatim, so it belongs in a deployment's
 * configuration rather than in a default.
 */
export function configuredOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

/**
 * The deployment's OWN origin, which must always be trusted.
 *
 * better-auth trusts `baseURL` implicitly, so sign-in worked on the deployed
 * app while every WRITE was refused — `mutationHandler` checks this list and
 * this list alone, and for an https deployment `selfOrigins` returns nothing
 * by design. With no APP_TRUSTED_ORIGINS set, the list was empty and the app
 * rejected requests from its own pages: creating an account, changing a
 * password, arming 2FA and editing a user all answered 403 "Soʻrov ishonchsiz
 * manzildan keldi", from the address the browser was actually on.
 *
 * It presents as the product being broken rather than as a misconfiguration,
 * which is why the base URL is no longer something a deployment has to
 * remember to repeat into a second variable. Nothing is widened: this is the
 * one origin better-auth already trusted.
 */
function baseOrigin(baseUrl: string): string[] {
  try {
    return [new URL(baseUrl).origin]
  } catch {
    // A malformed BETTER_AUTH_URL is env.ts's problem to report, not a reason
    // to throw from a list builder that runs at module load.
    return []
  }
}

export function resolveTrustedOrigins(
  baseUrl: string,
  extra: string | undefined,
  interfaces = networkInterfaces,
): string[] {
  // A Set because better-auth logs the list on a rejection, and a duplicate
  // entry there sends whoever is debugging looking for a second cause.
  return [
    ...new Set([
      ...baseOrigin(baseUrl),
      ...selfOrigins(baseUrl, interfaces),
      ...configuredOrigins(extra),
    ]),
  ]
}
