/**
 * Where to send someone after they sign in — `?next=`, or home.
 *
 * THE LOGIN PAGE MUST NOT BE AN OPEN REDIRECT. The middleware writes `?next=`
 * as a bare pathname, but anybody can hand a victim a /login link with their
 * own value, and the victim then signs in on the genuine page — password and
 * TOTP — and is sent wherever that value points.
 *
 * The old guard was a regex, `^\/(?!\/)`: "starts with one slash". It is not
 * enough, because the router resolves the string with the WHATWG URL parser
 * (`new URL(href, location.href)` in Next's app router), and that parser
 * treats `\` as `/` and silently drops TAB, LF and CR anywhere in the input.
 * So `/\evil.example` and `/<TAB>/evil.example` both passed the regex and both
 * resolve to `https://evil.example/` — a cross-origin `location.assign`.
 *
 * So the decision is made the way the browser will make it: parse the value
 * against our own origin and keep it only if it lands there. The character
 * screen in front of that is belt and braces — a value carrying a backslash or
 * a control character is never a path the middleware wrote, so it is refused
 * outright rather than trusted to the parser's normalisation.
 *
 * Returns a path (pathname + search + hash), never an absolute URL, so the
 * caller cannot leak the origin choice back into a navigation.
 */
export function safeNext(next: string | null | undefined, origin: string): string {
  if (!next) return '/'
  if (!next.startsWith('/') || next.startsWith('//')) return '/'
  // Backslash, C0 controls (TAB/LF/CR included) and DEL: the parser rewrites
  // or drops these, which is exactly how a path turns into a host.
  for (let i = 0; i < next.length; i++) {
    const code = next.charCodeAt(i)
    if (code === 0x5c || code < 0x20 || code === 0x7f) return '/'
  }

  let base: URL
  let target: URL
  try {
    base = new URL(origin)
    target = new URL(next, base)
  } catch {
    return '/'
  }
  if (target.origin !== base.origin) return '/'

  // The parser removes dot-segments, so «/.//evil.example» passes the origin
  // check as a path on OUR host and comes out as «//evil.example» — which the
  // router then reads as protocol-relative and leaves the site. Check the
  // result, not only the input.
  const path = `${target.pathname}${target.search}${target.hash}`
  return path.startsWith('//') ? '/' : path
}
