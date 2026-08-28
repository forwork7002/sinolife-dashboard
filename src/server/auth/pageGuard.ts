/**
 * Section access, enforced on the page itself.
 *
 * WHY NOT IN MIDDLEWARE. `src/middleware.ts` runs on the edge with no database
 * access, so it can only look for a session cookie. Which sections an account
 * holds is a database fact, and it changes the moment an administrator ticks a
 * box — so the check has to happen somewhere that can read the row. Every page
 * here is already `force-dynamic` and server-rendered, so that place is the
 * page.
 *
 * WHAT THIS IS AND IS NOT. This decides which SCREENS an account was given.
 * Data authorisation is still the role's job: every API route asserts a
 * permission and narrows rows by `dealScopeFor`, exactly as before. Granting
 * someone the Moliya section therefore cannot hand a salesperson finance
 * figures — their role has no `finance:read`, and the endpoint refuses.
 * Sections narrow a role; they never widen one.
 *
 * A denied user is redirected to the first section they DO hold rather than
 * shown a wall. Landing on "access denied" after clicking your own bookmark is
 * a dead end; landing on a page you can use is not.
 */

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { SECTIONS, type SectionValue, sectionSpec } from '@/lib/sections'
import { optionalPrincipal } from './session'
import { can, canSeeSection } from './rbac'

export async function requireSection(section: SectionValue): Promise<void> {
  const principal = await optionalPrincipal(
    // A Request is what `optionalPrincipal` reads cookies from; the incoming
    // headers are the only part of it that matters here.
    new Request('https://guard.invalid/', { headers: await headers() }),
  )

  // No principal at all is the middleware's job, and it has already run. If it
  // somehow did not, /login is still the right destination.
  if (!principal) redirect('/login')

  if (canSeeSection(principal, section)) return

  const fallback = SECTIONS.find((spec) => canSeeSection(principal, spec.id))
  redirect(fallback ? fallback.route : '/account')
}

/**
 * Account administration, which is a PERMISSION rather than a section.
 *
 * Deliberately not in the section list: sections are the screens an admin
 * hands out, and "who may hand out screens" cannot itself be one of them
 * without letting an administrator give that power away by ticking a box.
 */
export async function requireUserAdmin(): Promise<void> {
  const principal = await optionalPrincipal(
    new Request('https://guard.invalid/', { headers: await headers() }),
  )

  if (!principal) redirect('/login')
  if (!can(principal, 'users:manage')) redirect('/')
}

/** The label of a section, for a page that wants to name what it is. */
export function sectionLabel(section: SectionValue): string {
  return sectionSpec(section)?.label ?? section
}
