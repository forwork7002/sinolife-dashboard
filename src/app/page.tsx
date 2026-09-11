import { redirect } from 'next/navigation'

import { firstSectionFor } from '@/server/auth/pageGuard'
import { LANDING_ROUTE } from '@/lib/sections'

// Authenticated and account-dependent: never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * The root is a SIGNPOST and nothing else.
 *
 * «Boshqaruv markazi» used to render here. It was removed on the client's
 * instruction (2026-09-10, «boshqaruv markazi boʻlimini toʻliq olib tashla»),
 * and with it went the only reason this address ever drew a screen of its own.
 * What is left is the job it always also did: `/` is what a bookmark, the logo
 * and the post-login redirect all point at, and those requests arrive from
 * every kind of account.
 *
 * `LANDING_ROUTE` — «Sotuvchilar reytingi» — is where an account that holds it
 * lands, because it is the one screen every role is meant to read and it is
 * company-wide by decision rather than by accident. An account that does NOT
 * hold it falls through to the first section it does, so an operator granted
 * only Tasdiqlash is never bounced off a page they cannot open.
 *
 * `requireSection` is deliberately NOT used: it redirects to a refusal, which
 * is the right answer for a page someone navigated to on purpose and the wrong
 * one for the address every login lands on.
 *
 * THE LAST FALLBACK IS `/account`, never a section route. Anyone who holds
 * nothing still has an account screen, and that is a destination rather than a
 * loop.
 */
export default async function Page() {
  const section = await firstSectionFor(LANDING_ROUTE)

  redirect(section ? section.route : '/account')
}
