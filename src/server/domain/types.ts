/**
 * Shared domain vocabulary.
 *
 * These unions mirror the enums in prisma/schema.prisma, but they are declared
 * here rather than imported from the generated Prisma client on purpose: the
 * domain layer must not depend on the persistence layer. That is what lets the
 * analytics engine be unit tested without a database, and what would let this
 * layer be lifted into a separate service unchanged.
 *
 * src/server/repositories/enumParity.ts asserts at compile time that these
 * stay in step with the Prisma enums, so the duplication cannot drift silently.
 */

export const EXTERNAL_SOURCES = ['DEMO', 'BITRIX24', 'MANUAL'] as const
export type ExternalSourceValue = (typeof EXTERNAL_SOURCES)[number]

export const ROLES = ['ADMIN', 'MANAGER', 'SALES'] as const
export type RoleValue = (typeof ROLES)[number]

/**
 * How much of a granted screen an account reads.
 *
 * Separate from the role because they answer different questions. See the
 * `DataScope` enum in prisma/schema.prisma for why they were split.
 *
 * WIDEST TO NARROWEST, and the order is the meaning: ALL is the company, TEAM
 * is one unit and everything under it, OWN is one person. TEAM exists because
 * a ROP is neither of the other two — given ALL they read every rival team's
 * money, given OWN they read a board with one row on it.
 */
export const DATA_SCOPES = ['ALL', 'TEAM', 'OWN'] as const
export type DataScopeValue = (typeof DATA_SCOPES)[number]

/**
 * What a pipeline is FOR.
 *
 * The portal runs nine pipelines and only two of them are sales. Naming the
 * role lets an analytics module say "the retention pipeline" instead of
 * hardcoding a category id, and lets a pipeline be reclassified in data.
 */
export const PIPELINE_ROLES = [
  'REVENUE',
  'RETENTION',
  'CONFIRMATION',
  'QUALIFICATION',
  'LEAD',
  'AI_TRIAGE',
  'IGNORED',
] as const
export type PipelineRoleValue = (typeof PIPELINE_ROLES)[number]

/**
 * A stage's place in the delivery ladder.
 *
 * CANCELLED_EARLY and REFUSED are deliberately separate: one is a customer who
 * changed their mind before anything shipped, the other is a parcel that
 * travelled and came back. Merging them hides the expensive half.
 */
export const LOGISTICS_ROLES = [
  'PREPARING',
  'WAREHOUSE',
  /** In the confirmation queue, nobody has worked it yet. */
  'PENDING_CONFIRM',
  /** An operator reached the customer and confirmed. Тасдиклаш · Сделка успешна. */
  'CONFIRMED',
  /** A post-delivery or payment stamp. NOT an operator reaching anyone. */
  'SETTLED',
  'IN_TRANSIT',
  'REGIONAL_HUB',
  'CARRIER',
  'CHASING',
  'DELIVERED',
  'REFUSED',
  'CANCELLED_EARLY',
] as const
export type LogisticsRoleValue = (typeof LOGISTICS_ROLES)[number]

export const CONFIRM_STATUSES = ['CONFIRMED', 'UNREACHABLE'] as const
export type ConfirmStatusValue = (typeof CONFIRM_STATUSES)[number]

/**
 * Where an order stands in the Тасдиклаш queue — the five states the team
 * already reads on the floor, in their own vocabulary:
 *
 *   CONFIRM_NEW          🕔 Тасдиқлаш            in the queue, nobody has worked it
 *   CONFIRMED            ✅ Тасдиқланди          reached the customer, order goes out
 *   NO_ANSWER            🟡 Кутармади (нд)       phone not picked up, still chasing
 *   REJECTED             ❌ Тасдиқланмади        the order was killed in the queue
 *   UNCONFIRMED_SHIPPED  🟣 Тасдиқланмай чиқди   it left the queue without a yes
 *
 * The keys are the Telegram bot's own status keys (`sinolifesalesadmin_v2`
 * `poller.py`), spelled the same way on purpose. The bot, its РОП dashboards
 * and this screen describe one process, and a second private vocabulary for it
 * would mean two teams comparing numbers that are not the same numbers.
 *
 * There is no Prisma enum behind this: it is derived per order from stage
 * history, so it is deliberately absent from `enumParity.ts`.
 */
export const CONFIRMATION_OUTCOMES = [
  'CONFIRM_NEW',
  'CONFIRMED',
  'NO_ANSWER',
  'REJECTED',
  'UNCONFIRMED_SHIPPED',
] as const
export type ConfirmationOutcomeValue = (typeof CONFIRMATION_OUTCOMES)[number]

/**
 * Which question the Тасдиклаш board is being asked.
 *
 * 'window'  — what came in during the reporting period, and where each order
 *             stands now. Dated by the order's own Дата создания, which is
 *             the client's specification and the one an operator can verify
 *             against Bitrix.
 * 'backlog' — what is waiting right now: every still-open order whose latest
 *             confirmation signal is CONFIRM_NEW, whenever it arrived. The
 *             reporting window does not apply. A queue dated by intake cannot
 *             answer this — the oldest unworked order is older than any
 *             preset — which is why it is a mode and not a filter.
 */
export const CONFIRMATION_QUEUE_MODES = ['window', 'backlog'] as const
export type ConfirmationQueueMode = (typeof CONFIRMATION_QUEUE_MODES)[number]

/**
 * What a single stage move says about an order's confirmation.
 *
 * The outcomes above are what an ORDER ends up in; these are what a STAGE
 * says. They differ by one member: `UNCONFIRMED_SHIPPED` is not something a
 * stage can mean, only something a deal's «Тастиклаш анализ» field can turn a
 * CONFIRMED move into.
 */
export const CONFIRMATION_SIGNALS = ['CONFIRM_NEW', 'NO_ANSWER', 'REJECTED', 'CONFIRMED'] as const
export type ConfirmationSignalValue = (typeof CONFIRMATION_SIGNALS)[number]

/** Columns the confirmation queue may be ordered by. An allowlist: it reaches SQL. */
export const CONFIRMATION_ORDER_SORTS = [
  'createdAt',
  'movedAt',
  'queuedAt',
  'decidedAt',
  'amountMinor',
  'title',
] as const
export type ConfirmationOrderSortValue = (typeof CONFIRMATION_ORDER_SORTS)[number]

export const CALL_DIRECTIONS = ['INBOUND', 'OUTBOUND', 'CALLBACK'] as const
export type CallDirectionValue = (typeof CALL_DIRECTIONS)[number]

/**
 * Our normalised meaning of a pipeline stage. Bitrix24 stage IDs are mapped
 * onto these by configuration; no analytics code ever reads a stage name.
 */
export const STAGE_CATEGORIES = ['NEW', 'IN_PROGRESS', 'WON', 'LOST'] as const
export type StageCategoryValue = (typeof STAGE_CATEGORIES)[number]

export const DEAL_STATUSES = ['OPEN', 'WON', 'LOST'] as const
export type DealStatusValue = (typeof DEAL_STATUSES)[number]

export const KPI_METRICS = [
  'REVENUE',
  'DEALS_CREATED',
  'DEALS_WON',
  'AVERAGE_DEAL',
  'CONVERSION_RATE',
] as const
export type KpiMetricValue = (typeof KPI_METRICS)[number]

export const KPI_PERIODS = ['MONTH', 'QUARTER', 'YEAR'] as const
export type KpiPeriodValue = (typeof KPI_PERIODS)[number]

export const KPI_STATUSES = ['ACHIEVED', 'ON_TRACK', 'AT_RISK', 'BEHIND'] as const
export type KpiStatusValue = (typeof KPI_STATUSES)[number]

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER'] as const
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number]

export const SYNC_ENTITIES = [
  'DEPARTMENTS',
  'EMPLOYEES',
  'PRODUCT_CATEGORIES',
  'PRODUCTS',
  'PIPELINES',
  'STAGES',
  'SOURCES',
  'CUSTOMERS',
  'DEALS',
  'DEAL_ITEMS',
  'PAYMENTS',
  'STAGE_HISTORY',
  'CALLS',
  'STORES',
  'STOCK',
] as const
export type SyncEntityValue = (typeof SYNC_ENTITIES)[number]

/**
 * Dependency order for a full synchronisation.
 *
 * Deals reference stages, employees, customers and sources, so those must
 * already exist when deals are written. Running the entities in this order is
 * what keeps foreign keys satisfiable on a cold database.
 *
 * STAGE_HISTORY, CALLS and STOCK come last: they reference deals, employees
 * and products, and they are the slowest steps, so a failure there leaves
 * everything cheaper already committed.
 *
 * A deal whose customer is nonetheless missing still imports — the link is
 * nullable and the customer pass has a backfill for it — because losing a
 * deal's revenue over an unresolvable contact would be the worse trade.
 */
export const SYNC_ORDER: readonly SyncEntityValue[] = [
  'DEPARTMENTS',
  'EMPLOYEES',
  'PRODUCT_CATEGORIES',
  'PRODUCTS',
  'PIPELINES',
  'STAGES',
  'SOURCES',
  'STORES',
  'CUSTOMERS',
  'DEALS',
  'DEAL_ITEMS',
  'PAYMENTS',
  'STOCK',
  'STAGE_HISTORY',
  'CALLS',
]

export const SYNC_MODES = ['FULL', 'INCREMENTAL'] as const
export type SyncModeValue = (typeof SYNC_MODES)[number]

export const SYNC_STATUSES = ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'] as const
export type SyncStatusValue = (typeof SYNC_STATUSES)[number]

/** Map a stage category onto the deal status it implies. */
export function statusForStageCategory(category: StageCategoryValue): DealStatusValue {
  switch (category) {
    case 'WON':
      return 'WON'
    case 'LOST':
      return 'LOST'
    case 'NEW':
    case 'IN_PROGRESS':
      return 'OPEN'
  }
}

/** A deal is resolved once it has left the pipeline, either way. */
export function isResolved(status: DealStatusValue): boolean {
  return status === 'WON' || status === 'LOST'
}
