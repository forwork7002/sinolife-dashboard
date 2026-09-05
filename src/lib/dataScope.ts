/**
 * Client-side data-scope vocabulary.
 *
 * Mirrors `@/server/domain/types` — client code may not import from
 * `@/server/*`, so the union is restated here, exactly as `roles.ts` restates
 * the role union. The server enum-parity assertion covers the database side.
 *
 * These labels drive presentation only. The scope is applied in SQL.
 */

export const DATA_SCOPE_VALUES = ['ALL', 'TEAM', 'OWN'] as const
export type DataScopeValue = (typeof DATA_SCOPE_VALUES)[number]

export const DATA_SCOPE_LABELS: Readonly<Record<DataScopeValue, string>> = {
  ALL: 'Butun kompaniya',
  TEAM: 'Faqat oʻz boʻlimi',
  OWN: 'Faqat oʻz natijalari',
}

/** What each choice actually does, in the words the admin needs. */
export const DATA_SCOPE_HINTS: Readonly<Record<DataScopeValue, string>> = {
  ALL: 'Berilgan boʻlimlardagi kompaniya boʻyicha barcha raqamlarni koʻradi.',
  /*
    The ROP's setting, and the hint has to say WHICH unit, because the answer
    is not "the one on their card" — it is that unit plus every unit under it,
    grown from the person's own department AND from any department they head.
    An administrator who reads only «oʻz boʻlimi» would expect a head of NEWGEN
    to see NEWGEN and be surprised by the nine teams beneath it.
  */
  TEAM: 'Xodim biriktirilgan boʻlim va uning ostidagi boʻlimlar. ROP uchun — faqat oʻz jamoasi. Xodimni bogʻlash shart.',
  OWN: 'Faqat oʻziga biriktirilgan xodimning bitimlari. Xodimni bogʻlash shart.',
}
