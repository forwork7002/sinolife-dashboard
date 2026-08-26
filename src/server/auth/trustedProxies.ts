/**
 * Which forwarding hops to believe.
 *
 * THE PROBLEM
 * Rate limiting is only worth something if the attacker cannot choose their
 * own bucket. better-auth keys its limits on the client IP, and behind a proxy
 * the only source of that is `X-Forwarded-For` — a header the client writes.
 * With no proxy list configured, a single-value header is taken at face value,
 * so `X-Forwarded-For: 1.2.3.4` picks a fresh bucket and a different value on
 * the next request picks another. Unlimited password attempts, one per bucket.
 *
 * THE FIX
 * Name the proxies. better-auth then walks the chain from the RIGHT — the end
 * the infrastructure appends to and the client cannot reach — skips the hops
 * it recognises, and takes the first address it does not. Anything the client
 * prepended sits to the left of the real address and is ignored.
 *
 * THE DEFAULT
 * Private ranges. On App Platform (and on any container behind a managed load
 * balancer) the app is reachable only through that balancer, which connects
 * from private address space, so "private hop" and "our proxy" mean the same
 * thing here. That equivalence is what makes a broad range safe — it would NOT
 * be on a host clients can reach directly, which is why `APP_TRUSTED_PROXIES`
 * exists to narrow it.
 *
 * Getting this wrong fails closed, not open: an unrecognised chain resolves to
 * no IP at all and every request shares one bucket.
 */

/** Private and loopback space — where a managed load balancer connects from. */
const PRIVATE_RANGES = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '100.64.0.0/10', // carrier-grade NAT; DigitalOcean's internal network uses it
  '::1/128',
  'fc00::/7',
] as const

export function resolveTrustedProxies(configured: string | undefined): string[] {
  const explicit = (configured ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  return explicit.length > 0 ? explicit : [...PRIVATE_RANGES]
}
