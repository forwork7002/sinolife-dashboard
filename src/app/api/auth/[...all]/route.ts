import { toNextJsHandler } from 'better-auth/next-js'

import { auth } from '@/server/auth/auth'

/**
 * better-auth's own endpoints: sign-in, sign-out, session.
 *
 * Deliberately NOT wrapped in `getHandler` — that wrapper requires an
 * authenticated principal, and these are the routes used to become one.
 */
export const { GET, POST } = toNextJsHandler(auth)
