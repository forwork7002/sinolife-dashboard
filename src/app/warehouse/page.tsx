import { SectionPending } from '@/features/shared/SectionPending'
import { requireSection } from '@/server/auth/pageGuard'
import { t } from '@/lib/messages'

// Authenticated: never statically prerendered.
export const dynamic = 'force-dynamic'

/**
 * PAUSED ON 2026-09-10, ON INSTRUCTION — «hozircha api qilmay tur».
 *
 * The screen and its endpoint are both intact: `features/warehouse/WarehousePage`
 * still exists and `/api/v1/insights/dispatch` still answers. What is switched
 * off is this page mounting them, which is the only thing that made a request.
 *
 * TO SWITCH IT BACK ON: import `WarehousePage`, wrap it in `<Suspense>` (it
 * reads URL filters on the client) and render it in place of `SectionPending`.
 * Nothing else has to be undone — the section, the nav entry and every grant
 * stayed where they were, which is why pausing it was a one-file change.
 *
 * The feature file is NOT dead code waiting to be swept: it is a screen the
 * client asked to hold, and this comment is the record of that.
 */
export default async function Page() {
  // Which accounts may open this screen at all. See pageGuard.ts.
  await requireSection('warehouse')

  return <SectionPending title={t.nav.warehouse} />
}
