/**
 * The База funnel's fifteen stages, as the four questions a reader has.
 *
 * WHY THE STAGES ARE NOT SHOWN ONE BY ONE. `/analytics/cohort` drew all
 * fifteen as fifteen bars, in portal order, under a hint that promised «1 kun,
 * 3 kun, 10 kun, 20 kun, 30 kun» — five of them. The other ten were not
 * described anywhere, and the three that matter most («Недозвоны» 2 279,
 * «Неактивные» 1 864, «Активный клиент» 825 on 2026-09-15) sat between the
 * cadence steps rather than beside each other. Fifteen numbers that have to be
 * added up in the reader's head are not a picture of the customer base.
 *
 * The four groups are the four states a customer in База can be in: just
 * arrived, inside the follow-up cadence, converted to an active buyer, or gone
 * cold. Each one is a different next action, which is the test for whether a
 * grouping earns its place.
 *
 * KEYED BY STAGE ID, NOT BY NAME, for the same reason `DELIVERY_STAGE_ROLES`
 * is: the portal's stage names are edited from its UI and stored here prefixed
 * with their funnel («База · 1 кун»), so a name is a label and an id is a fact.
 * The ids below were read off the live portal's C10 funnel on 2026-09-15.
 *
 * WHY IT LIVES IN `src/lib`. Both sides read it — the repository builds its
 * CASE from `stages`, the screen draws its labels and colours from the same
 * rows — and a partition of a funnel must not have two definitions. Same
 * doctrine, and the same directory, as `logisticsBuckets.ts`.
 *
 * A STAGE THAT IS NOT NAMED HERE DOES NOT VANISH. The portal grows stages —
 * «Ожидание / нд» appeared in C6 in September and was found only because the
 * logistics table could prove itself — so anything unmapped falls to
 * `UNMAPPED_RETENTION_GROUP` and is drawn as its own row rather than silently
 * dropped into one of the four. `tests/domain/retentionGroups.test.ts` pins the
 * partition against the funnel's known stage list.
 */

export const RETENTION_GROUPS = [
  {
    key: 'NEW',
    label: 'Yangi — bazaga tushgan',
    /** «Успешно раздача» is the funnel's entry stage (category NEW), not a win. */
    hint: 'Успешно раздача · Новый база',
    stages: ['C10:NEW', 'C10:UC_79XRT6'],
    colour: '--series-1',
  },
  {
    key: 'CADENCE',
    label: 'Aloqa siklida',
    hint: '1 кун · 3 кун · 10 кун · 20 кун · 30 кун',
    stages: [
      'C10:FINAL_INVOICE',
      'C10:UC_FEENT1',
      'C10:UC_1TH09B',
      'C10:UC_8VIZ08',
      'C10:UC_4OTGKV',
    ],
    colour: '--series-3',
  },
  {
    key: 'ACTIVE',
    label: 'Faol mijoz',
    hint: 'Актив · Активный клиент · Перерыв успешно · Успешно',
    stages: ['C10:UC_W94F10', 'C10:PREPAYMENT_INVOIC', 'C10:UC_KYP1SE', 'C10:WON'],
    colour: '--series-6',
  },
  {
    key: 'LOST',
    label: 'Sovigan — aloqa uzilgan',
    hint: 'Недозвоны · Неактивные · Пропущенный · Не активный клиент',
    stages: ['C10:UC_S5YE1H', 'C10:UC_SDQ5HF', 'C10:UC_WWD9W7', 'C10:LOSE'],
    colour: '--series-8',
  },
] as const satisfies readonly {
  key: string
  label: string
  hint: string
  stages: readonly string[]
  colour: string
}[]

export type RetentionGroupKey = (typeof RETENTION_GROUPS)[number]['key']

/** Where a stage this table has never heard of is counted. Drawn, never dropped. */
export const UNMAPPED_RETENTION_GROUP = 'OTHER'

/** The order the card draws them in, plus the unmapped tail. */
export const RETENTION_GROUP_ORDER: readonly string[] = [
  ...RETENTION_GROUPS.map((g) => g.key),
  UNMAPPED_RETENTION_GROUP,
]

const BY_KEY = new Map<string, (typeof RETENTION_GROUPS)[number]>(
  RETENTION_GROUPS.map((g) => [g.key, g]),
)

/** Label and colour for a key the server sent, including the unmapped tail. */
export function retentionGroupSpec(key: string): {
  readonly label: string
  readonly hint: string
  readonly colour: string
} {
  return (
    BY_KEY.get(key) ?? {
      label: 'Boshqa bosqichlar',
      hint: 'Guruhlarga kiritilmagan — portalda yangi bosqich paydo boʻlgan boʻlishi mumkin',
      colour: '--ink-muted',
    }
  )
}

/** Which group a stage id falls in. The one rule the SQL and the screen share. */
export function retentionGroupOf(externalId: string | null): string {
  if (externalId === null) return UNMAPPED_RETENTION_GROUP
  for (const group of RETENTION_GROUPS) {
    if ((group.stages as readonly string[]).includes(externalId)) return group.key
  }
  return UNMAPPED_RETENTION_GROUP
}
