/**
 * Who did it and from where, for the audit log.
 *
 * The client address is read from `x-forwarded-for` because every request
 * arrives through App Platform's proxy and the socket address is the proxy's.
 * The LEFT-most entry is the client; the rest are the hops. It is taken as a
 * best-effort label only — a forged header would put a false address in the
 * log, which is why the log's authority is `actorUserId` (resolved from a
 * verified session) and never the IP.
 */
export function auditContext(request: Request): {
  ip: string | null
  userAgent: string | null
} {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : null

  return {
    ip: ip && ip.length > 0 && ip.length <= 64 ? ip : null,
    // Bounded: a header is attacker-controlled and this one is written to a
    // column that gets read back into a table.
    userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
  }
}
