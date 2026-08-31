/**
 * Client-side data-scope vocabulary.
 *
 * Mirrors `@/server/domain/types` — client code may not import from
 * `@/server/*`, so the union is restated here, exactly as `roles.ts` restates
 * the role union. The server enum-parity assertion covers the database side.
 *
 * These labels drive presentation only. The scope is applied in SQL.
 */

export const DATA_SCOPE_VALUES = ['ALL', 'OWN'] as const
export type DataScopeValue = (typeof DATA_SCOPE_VALUES)[number]

export const DATA_SCOPE_LABELS: Readonly<Record<DataScopeValue, string>> = {
  ALL: 'Butun kompaniya',
  OWN: 'Faqat oʻz natijalari',
}

/** What each choice actually does, in the words the admin needs. */
export const DATA_SCOPE_HINTS: Readonly<Record<DataScopeValue, string>> = {
  ALL: 'Berilgan boʻlimlardagi kompaniya boʻyicha barcha raqamlarni koʻradi.',
  OWN: 'Faqat oʻziga biriktirilgan xodimning bitimlari. Xodimni bogʻlash shart.',
}
