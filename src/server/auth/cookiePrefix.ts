/**
 * The session cookie prefix.
 *
 * Declared in its own module because it is needed in two places that cannot
 * share code: the auth configuration (which pulls in Prisma) and the edge
 * middleware (which must not). Writing the literal twice is exactly how they
 * drifted — the middleware looked for better-auth's default prefix, never
 * found the cookie, and redirected every signed-in user back to /login while
 * the API happily accepted the same session.
 *
 * This file must stay free of imports so the edge runtime can load it.
 */
export const AUTH_COOKIE_PREFIX = 'sinolife'
