/**
 * When the portal's seller snapshot on a deal is a COPY of an older deal's.
 *
 * «Фамилия имя ответсвенный (не удалять)» and «Организация сотрудника (не
 * удалять)» name the seller and their team at the moment of sale, and every
 * queue reading credits the order to them rather than to ASSIGNED_BY_ID,
 * because back office takes deals over while they are processed (see
 * `UF.OPERATOR_NAME`). The client's automation writes them once and never
 * again — so a deal Bitrix24 opens as a repeat of an older one arrives with
 * the OLD deal's seller already filled in, and nothing overwrites it.
 *
 * Deal 1150184 on 2026-10-19: opened by Ziyoda Ashirova 170 (Baza(ROP)) for a
 * returning customer, owned by her, sold by her — and carrying «Davlatbek
 * Sirojov 115 / Sevinch(ROP)» from the customer's 27.08 deal, so the board put
 * her order on Sevinch's team. Across 12 870 Тасдиклаш / Доставка / Ecommerce
 * deals opened 01.05–19.10.2026 it is the only one this rule matches.
 *
 * THE RULE IS NARROW ON PURPOSE. The snapshot is believed unless the deal
 * itself says who sold it: the person who OPENED it still OWNS it and sits on
 * a sales («(ROP)») team. Every legitimate disagreement measured over the same
 * deals fails one of the three — back office owning the row (629 in
 * Логистика), a desk registrar opening it for a seller, a bulk hand-over of
 * old orders to a Baza operator (the 16.07 transfer), a badge renumbered.
 */
export function isCopiedOperatorSnapshot(deal: {
  /** The snapshot resolved to one of our people, or null. */
  readonly snapshotEmployeeId: string | null
  /** ASSIGNED_BY_ID, resolved. */
  readonly ownerEmployeeId: string
  /** CREATED_BY_ID, resolved, or null when the portal named nobody we know. */
  readonly creatorEmployeeId: string | null
  /** The owner's PRIMARY unit is a «(ROP)» sales team. */
  readonly ownerOnSalesTeam: boolean
}): boolean {
  return (
    deal.snapshotEmployeeId !== null &&
    deal.snapshotEmployeeId !== deal.ownerEmployeeId &&
    deal.creatorEmployeeId === deal.ownerEmployeeId &&
    deal.ownerOnSalesTeam
  )
}

/** A unit is a sales team only if its name says so — the rule `ropNameSql` uses. */
export function isSalesTeamName(name: string | null | undefined): boolean {
  return name ? /\(ROP\)/i.test(name) : false
}
