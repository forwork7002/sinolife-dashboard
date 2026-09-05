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
 * It is the same check `getHandler` makes on the endpoints behind them, so a
 * redirect here is a courtesy rather than the boundary — a user who types the
 * URL past this guard still gets nothing back from the API.
 *
 * How much of a granted screen an account then READS is `dataScope`, applied
 * as a WHERE clause by `dealScopeFor`. The screens that only exist
 * company-wide refuse an OWN-scoped account outright rather than drawing
 * themselves blank; see `companyWide` in src/lib/sections.ts.
 *
 * A denied user is redirected to the first section they DO hold rather than
 * shown a wall. Landing on "access denied" after clicking your own bookmark is
 * a dead end; landing on a page you can use is not.
 */

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import {
  SECTIONS,
  type SectionSpec,
  type SectionValue,
  isCompanyWideSection,
  sectionSpec,
} from '@/lib/sections'
import { optionalPrincipal } from './session'
import { can, canSeeSection, type Principal } from './rbac'

/**
 * The first screen this account may open AND be served.
 *
 * TWO CONDITIONS, BECAUSE THE TICKS ARE NOT THE ONLY GATE. A section says the
 * administrator handed over the screen; the account's data scope says whether
 * its endpoint has an answer to give. Six screens aggregate across the whole
 * company and refuse anybody narrower — and `effectiveSections` hands an
 * unconfigured SALES account `overview` by default, which is the first entry
 * in `SECTIONS` and the route `/`.
 *
 * So without this filter the feature's own account walks into a wall: an
 * administrator creates the ROP, ticks nothing (the documented "follow the
 * role" default), and the first thing that person sees after signing in is the
 * command centre refusing them — while the sidebar, which applies exactly this
 * rule, no longer offers the link that would explain it. Landing them on
 * Тасдиклаш instead is the whole point of the account.
 *
 * Presentation and routing only, like `companyWideSections` it reads from:
 * every endpoint still decides for itself.
 */
function firstServableSection(principal: Principal): SectionSpec | undefined {
  const narrowed = principal.dataScope !== 'ALL'
  return (
    SECTIONS.find(
      (spec) => canSeeSection(principal, spec.id) && !(narrowed && isCompanyWideSection(spec.id)),
    ) ??
    // Nothing servable: fall back to anything ticked, so a misconfigured
    // account still lands on a page that can explain itself rather than on a
    // redirect loop.
    SECTIONS.find((spec) => canSeeSection(principal, spec.id))
  )
}

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

  const fallback = firstServableSection(principal)
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

/**
 * The first section this account may open, or null when it holds none.
 *
 * The root page uses it to send someone somewhere they are actually allowed
 * to be. Returns null rather than throwing for a signed-out caller: the
 * middleware has already dealt with that case, and the root page's own
 * fallback is a better answer than an exception on a redirect.
 */
export async function firstSectionFor(): Promise<SectionSpec | null> {
  const principal = await optionalPrincipal(
    new Request('https://guard.invalid/', { headers: await headers() }),
  )
  if (!principal) return null
  return firstServableSection(principal) ?? null
}

/** The label of a section, for a page that wants to name what it is. */
export function sectionLabel(section: SectionValue): string {
  return sectionSpec(section)?.label ?? section
}
