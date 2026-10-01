import { RegistrationPage } from '@/features/registration/RegistrationPage'
import { requireSection } from '@/server/auth/pageGuard'

// Authenticated: never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * «Registratsiya» — opened on 2026-10-01: how the day's new leads are shared
 * among the ROPs. See `features/registration/RegistrationPage.tsx`.
 */
export default async function Page() {
  // Which accounts may open this screen at all. See pageGuard.ts.
  await requireSection('registration')

  return <RegistrationPage />
}
