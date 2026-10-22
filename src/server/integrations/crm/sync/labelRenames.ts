/**
 * A portal dropdown item renamed — «Проект», targetolog, registrar, region —
 * carried onto the deals already stored under its old text (2026-10-22).
 *
 * `label()` stores the item's TEXT on the deal, so a rename reached only the
 * deals modified after it; every older one kept the old name and the screens
 * grouped one targetolog as two. The provider notices the change when it
 * re-reads the labels (`Bitrix24CrmProvider.takeLabelRenames`) and this
 * rewrites the column, in the database, no portal request.
 *
 * Only the columns that hold a label as-is. «Тасдиқлаш» and «Повторный лид»
 * are read into enums (`confirmStatusFromLabel`, `repeatLeadKind`) and a
 * rename there is a mapping change, not a text one.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { UF } from '@/server/integrations/crm/bitrix24/mapping'

import type { LabelRename } from '@/server/integrations/crm/bitrix24/Bitrix24CrmProvider'

/** `UF_CRM_…` key → the deal column its label is stored in. A fixed list: the names go into SQL. */
const COLUMN_OF: Readonly<Record<string, string>> = {
  [UF.REGION]: 'region',
  [UF.FULFILMENT_POINT]: 'fulfilmentPoint',
  [UF.REFUSAL_REASON]: 'refusalReason',
  [UF.PAYMENT_METHOD]: 'paymentMethodRaw',
  [UF.PRODUCT_LINE]: 'productLine',
  [UF.CUSTOMER_GRADE]: 'customerGrade',
  [UF.TARGETOLOG]: 'targetolog',
  [UF.REGISTRAR]: 'registrar',
}

/** Rewrites each rename's old text to the new one; returns the deals changed. */
export async function applyLabelRenames(prisma: PrismaClient, renames: readonly LabelRename[]): Promise<number> {
  let changed = 0
  for (const { field, from, to } of renames) {
    const column = COLUMN_OF[field]
    if (!column) continue
    changed += await prisma.$executeRawUnsafe(
      `UPDATE "deal" SET "${column}" = $1, "updatedAt" = now() WHERE "${column}" = $2`,
      to,
      from,
    )
  }
  return changed
}
