import { redirect } from 'next/navigation'

import { SECTIONS } from '@/lib/sections'
import { firstSectionFor } from '@/server/auth/pageGuard'

// Authenticated and account-dependent: never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * The root is a signpost, not a screen.
 *
 * There is no overview page any more — the product is the nine sections the
 * client asked for and nothing else. Something still has to answer `/`,
 * because it is what a bookmark, the logo and the post-login redirect all
 * point at, and a 404 there reads as a broken deployment.
 *
 * It sends each account to the first section IT holds rather than to a fixed
 * page: an operator granted only Тасдиклаш would otherwise land on a screen
 * they are not allowed to open and be bounced again.
 */
export default async function Page() {
  const section = await firstSectionFor()
  redirect(section ? section.route : (SECTIONS[0]?.route ?? '/account'))
}
