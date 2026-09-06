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
    The ROP's setting, and the hint has to say the rule EXACTLY, because the
    two halves of it differ. Being filed in a unit grants that unit and nothing
    below it; HEADING a unit grants it and everything beneath. An administrator
    who read only «oʻz boʻlimi» would expect the head of a branch to see one
    card and be surprised by the nine teams under it — and, the other way
    round, would not expect a clerk filed in that branch to see them at all.

    The last sentence is not a footnote: granting this to whoever heads the
    ROOT of the tree is the same thing as granting «Butun kompaniya», and the
    administrator should read that here rather than discover it afterwards.
  */
  TEAM: 'Xodim biriktirilgan boʻlim; agar u boʻlim rahbari boʻlsa — oʻsha boʻlim va uning ostidagi barcha boʻlimlar. ROP uchun — faqat oʻz jamoasi. Xodimni bogʻlash shart. Eng yuqori boʻlim rahbariga berilsa — butun kompaniya demakdir.',
  OWN: 'Faqat oʻziga biriktirilgan xodimning bitimlari. Xodimni bogʻlash shart.',
}
