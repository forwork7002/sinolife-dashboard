import { SectionPending } from '@/features/shared/SectionPending'
import { requireSection } from '@/server/auth/pageGuard'
import { t } from '@/lib/messages'

// Authenticated: never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * PAUSED ON 2026-09-10, ON INSTRUCTION — «hozircha api qilmay tur».
 *
 * The screen and its three endpoints are both intact: `features/marketing/*`
 * still exists and `/api/v1/marketing/{overview,breakdown,verify}` still
 * answer. What is switched off is this page mounting them, which is the only
 * thing that made a request.
 *
 * TO SWITCH IT BACK ON: import `MarketingPage`, wrap it in `<Suspense>` (its
 * shell reads the URL for the command palette) and render it in place of
 * `SectionPending`. Nothing else has to be undone — the section, the nav entry
 * and every grant stayed where they were.
 *
 * The feature files are NOT dead code waiting to be swept: this is the Roistat
 * ledger, a second source the client is still reconciling, and this comment is
 * the record of it being held rather than abandoned.
 */
export default async function Page() {
  // Which accounts may open this screen at all. See pageGuard.ts.
  await requireSection('marketing')

  return <SectionPending title={t.nav.marketing} />
}
