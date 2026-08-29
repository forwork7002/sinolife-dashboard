import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import { CommandCentrePage } from '@/features/overview/CommandCentrePage'
import { firstSectionFor } from '@/server/auth/pageGuard'

// Authenticated and account-dependent: never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * The root is the command centre — for the accounts that hold it.
 *
 * It is BOTH a screen and a signpost, because `/` is what a bookmark, the logo
 * and the post-login redirect all point at, and those requests arrive from
 * every kind of account. An operator granted only Tasdiqlash must not land on
 * an overview they cannot open and be bounced again, so this resolves the
 * first section the account actually holds and forwards them there.
 *
 * `requireSection` is deliberately NOT used: it redirects to a refusal, which
 * is the right answer for a page someone navigated to on purpose and the wrong
 * one for the address every login lands on.
 *
 * THE FALLBACK IS `/account`, NOT `SECTIONS[0]`. Overview is now the first
 * entry in SECTIONS and its route is this page, so sending a sectionless
 * account there would bounce it off itself forever. Anyone who holds nothing
 * still has an account screen, and that is a destination rather than a loop.
 */
export default async function Page() {
  const section = await firstSectionFor()

  if (section?.id === 'overview') {
    return (
      // URL filtrlari klientda oʻqiladi; Suspense prerender paytida qobiqni chiqaradi.
      <Suspense fallback={null}>
        <CommandCentrePage />
      </Suspense>
    )
  }

  redirect(section ? section.route : '/account')
}
