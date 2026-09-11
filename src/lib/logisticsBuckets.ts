/**
 * The client's own logistics report, as six columns over the Доставка funnel.
 *
 * THIS IS A BUSINESS DEFINITION, APPROVED BY NAME. The floor has run logistics
 * off a Google Sheet exported from the portal's Доставка kanban — ДАТА, ЗАКАЗ,
 * ТАСТИКЛАНГАН, не собран, В пути, Ожидание/нд, Отказ, Успешно, %покрытия —
 * and this table is that sheet's columns mapped onto `deal_stage.logisticsRole`
 * stage by stage, confirmed with the client on 2026-09-10.
 *
 * WHY IT LIVES IN `src/lib`. Both sides read it: the repository builds its
 * bucket CASE from `roles`, and the screen draws its labels and colours from
 * the same rows. Every other cross-boundary shape in this codebase is mirrored
 * by hand into `src/lib/api.ts` with a comment saying nothing checks the
 * mirror; a six-way partition the client approved is exactly the thing that
 * must not have two definitions. `src/lib` is client-safe (no server imports),
 * and `sections.ts` and `roles.ts` already cross the boundary this way.
 *
 * THE SIX PARTITION ALL EIGHTEEN C6 STAGES — mutually exclusive, exhaustive,
 * and pinned by `tests/domain/logisticsBuckets.test.ts` against
 * `DELIVERY_STAGE_ROLES`. A role that stops being named here does not vanish:
 * it falls to `UNMAPPED_BUCKET` and is reported, because six columns that
 * claim to be the whole funnel have to be able to prove it.
 */

/**
 * The labels are the client's own column headers, VERBATIM and in Russian.
 *
 * Same doctrine as the Доставка board on Savdo dinamikasi: the whole value of
 * this screen is that it reconciles against obey.bitrix24.kz and against the
 * sheet beside it, and a translated header is one more thing to reconcile.
 * Everything AROUND the numbers is Uzbek; the numbers' names are theirs.
 *
 * `colour` is a CSS custom property from `globals.css`, so the composition
 * bar, the table rows, the daily chart and the reconciliation table cannot
 * disagree about which colour means which column. It is fixed per bucket and
 * never reassigned by size — «colour follows the entity, never its rank»
 * (docs/DESIGN.md). `--series-8` is the palette's red and no tile on this
 * screen uses `tone="critical"`, so red here means exactly one thing: Отказ.
 *
 * `as const` is load-bearing. It preserves the role literals, which is what
 * lets `insightsRepository` prove this table against `LogisticsRoleValue` at
 * compile time — the trick `repositories/enumParity.ts` plays on the Prisma
 * enums. This module cannot import `@/server/domain/types` (eslint forbids it
 * both ways), so the check has to be made from the server side.
 */
export const LOGISTICS_BUCKETS = [
  {
    key: 'PREPARING',
    label: 'ТАСТИКЛАНГАН',
    /** Подготовка товара, Обработка заказов. */
    roles: ['PREPARING'],
    colour: '--series-5',
  },
  {
    key: 'WAREHOUSE',
    label: 'не собран',
    /** Заказ в мой склад. */
    roles: ['WAREHOUSE'],
    colour: '--series-6',
  },
  {
    key: 'IN_TRANSIT',
    label: 'В пути',
    /** В пути — dispatched, not yet handed to a post office. */
    roles: ['IN_TRANSIT'],
    colour: '--series-1',
  },
  {
    key: 'WAITING',
    label: 'Ожидание / нд',
    /*
      The eight post offices, PLUS the two chasing stages.

      TOSHKENT-1, NAVOIY, VODIY, QASHQADARYO, SURXONDARYO (REGIONAL_HUB) and
      CARAVAN, OSON POCHTA, BEK POCHTA (CARRIER) are the parcel standing at a
      counter waiting to be collected. «Юрист смс» and «Пропущенный» (CHASING)
      are the same parcel with the customer not answering — «нд» in the
      client's own header is недозвон, which is what those two stages are.

      CONSEQUENCE WORTH KNOWING: this column is therefore NOT the total of the
      post-office table, which starts from the eight hub and carrier stages
      alone. A screen that labels that table «Ожидание» disagrees with its own
      column by exactly the two chasing stages.
    */
    roles: ['REGIONAL_HUB', 'CARRIER', 'CHASING'],
    colour: '--series-4',
  },
  {
    key: 'REFUSED',
    label: 'Отказ',
    /*
      ONE COLUMN ON SCREEN, TWO NUMBERS UNDERNEATH — never merged in SQL.

      «Отказ» is a parcel that shipped, travelled and came back; «Отказ
      предварительно» is a customer who changed their mind before dispatch and
      cost a phone call. `schema.prisma` says they must never be merged and
      the client asked for one column, so the merge happens in the RENDERING:
      every bucket carries its roles' figures separately in `parts`, and the
      expensive half is one hover away.

      Which of the two an order counts as is decided by whether it ever
      reached a hub or a carrier, NOT by the stage name — since June the
      portal writes every refusal to «Отказ предварительно», and read from the
      name alone the screen reports that nothing ever came back.
    */
    roles: ['REFUSED', 'CANCELLED_EARLY'],
    colour: '--series-8',
  },
  {
    key: 'DONE',
    label: 'Успешно',
    /*
      Доставлено, and «Успешно заказ» with it — the client's choice.

      THIS COLUMN IS NOT FAKT 2. FAKT 2 is `DELIVERED` alone, over the whole
      queue cohort; this is DELIVERED + SETTLED over FAKT 1. «Успешно заказ»
      (C6:UC_YUKVF1) is a settlement stamp automation writes within five
      seconds of Доставлено in two thirds of cases, so on any real window the
      two figures are equal — 0 orders stood in it over the client's own week.
      They are still two measures. The payload carries both under different
      names and the reconciliation table prints the stage that separates them,
      so nothing on screen has to guess which one it is looking at.
    */
    roles: ['DELIVERED', 'SETTLED'],
    colour: '--series-3',
  },
] as const satisfies readonly {
  key: string
  label: string
  roles: readonly string[]
  colour: string
}[]

export type LogisticsBucketKey = (typeof LOGISTICS_BUCKETS)[number]['key']

/**
 * NOT A SEVENTH COLUMN. A FAKT 1 order whose current stage is outside Доставка.
 *
 * It happens when a confirmed order is moved into another funnel afterwards.
 * The six columns above claim to be the whole of ЗАКАЗ, so an order that
 * matches none of them is COUNTED AND REPORTED rather than quietly dropped
 * out of a partition the screen says is exhaustive. Expected zero; a non-zero
 * value is a real event the reader should see, not an error to swallow.
 */
export const UNMAPPED_BUCKET = 'OTHER'

/** The six keys in the client's own funnel order. Never sorted by size. */
export const LOGISTICS_BUCKET_KEYS: readonly LogisticsBucketKey[] = LOGISTICS_BUCKETS.map(
  (bucket) => bucket.key,
)

const BY_KEY = new Map<string, (typeof LOGISTICS_BUCKETS)[number]>(
  LOGISTICS_BUCKETS.map((bucket) => [bucket.key, bucket]),
)

/** The client's header for a bucket, or the key itself if one ever goes missing. */
export function bucketLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key
}

/** The CSS custom property a bucket's marks are drawn in, as a `var(…)`. */
export function bucketColour(key: string): string {
  const bucket = BY_KEY.get(key)
  return bucket ? `var(${bucket.colour})` : 'var(--axis)'
}

/**
 * Which column a `logisticsRole` falls in — the same rule the SQL is built
 * from, for the rare client-side reading that needs it (the reconciliation
 * table receives its bucket on the payload rather than deriving it here).
 */
export function bucketForRole(role: string | null | undefined): string {
  if (!role) return UNMAPPED_BUCKET
  for (const bucket of LOGISTICS_BUCKETS) {
    if ((bucket.roles as readonly string[]).includes(role)) return bucket.key
  }
  return UNMAPPED_BUCKET
}
