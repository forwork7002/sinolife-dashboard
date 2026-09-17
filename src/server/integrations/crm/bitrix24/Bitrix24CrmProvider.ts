/**
 * Bitrix24 CRM provider.
 *
 * Implements the same `CrmProvider` interface as the demo provider, so nothing
 * downstream — sync engine, database, analytics, API, dashboard — changes when
 * this becomes the active source.
 *
 * The field mapping in `mapping.ts` was read from the live portal, not guessed.
 *
 * THROUGHPUT
 * The portal holds 415 591 deals, 317 674 contacts and 3.8 million stage
 * transitions. A list method returns at most 50 rows per call and the portal
 * allows ~2 calls a second, so read sequentially that is over three hours
 * before anything else runs.
 *
 * Every bulk read therefore goes through `batchWalk`: fifty id-chained seeks
 * packed into one HTTP request, 2 500 rows in well under a second. See that
 * method for why it walks by id rather than by offset — the short version is
 * that offsets work until the portal blocks the method, and then they do not
 * work at all.
 */

import {
  type CrmProvider,
  type FetchOptions,
  type Page,
  type ProviderCapabilities,
  type ProviderHealth,
  type RawCall,
  type RawCustomer,
  type RawDeal,
  type RawDealItem,
  type RawDepartment,
  type RawEmployee,
  type RawPayment,
  type RawPipeline,
  type RawProduct,
  type RawProductCategory,
  type RawSalesSource,
  type RawStage,
  type RawStageHistory,
  type RawStockLevel,
  type RawStore,
} from '@/server/integrations/crm/CrmProvider'
import type { ExternalSourceValue } from '@/server/domain/types'

import {
  ALL_PIPELINES,
  CONFIRMATION_REFUSAL_STAGES,
  DELIVERY_ROUTE_NAMES,
  PIPELINE_NAMES,
  UF,
  UF_FIELDS,
  callDirection,
  categoryFromSemantic,
  confirmStatusFromLabel,
  confirmationSignal,
  dealStatus,
  extractOrderCode,
  logisticsRole,
  pipelineRole,
  toDate,
  toMinorUnits,
} from './mapping'
import { RateLimiter, backoffDelayMs, sleep } from './rateLimiter'
import { PortalGate } from './portalGate'
import { PortalMeter, type PortalTime } from './portalMeter'
import { PortalBudget } from './portalBudget'
import { SELF_LIMIT_CODE } from './refusal'
import { classifyRefusal } from './refusal'

export interface Bitrix24ProviderOptions {
  readonly webhookUrl: string
  readonly rateLimitRps?: number
  /**
   * Invocations per rolling hour before calls are refused locally. Defaults to
   * `DEFAULT_HOURLY_INVOCATIONS`, which is sized for the worker; a deliberate
   * full import raises it.
   */
  readonly hourlyInvocations?: number
  readonly requestTimeoutMs?: number
  readonly maxRetries?: number
  readonly fetchImpl?: typeof fetch
  /** Override which pipelines are imported. Defaults to all nine. */
  readonly pipelines?: readonly number[]
  /**
   * Pipelines whose stage history is worth the read. Defaults to the four the
   * duration modules actually measure; the lead and triage funnels between
   * them account for most of the 3.8 million transitions and nothing looks at
   * how long a registration record sat in a stage.
   */
  readonly historyPipelines?: readonly number[]
  /**
   * Individual stages read regardless of which pipeline they sit in.
   *
   * WHY THIS EXISTS. The client's own reference (BITRIX_REFERENCE.md) tracks
   * three funnels — 4 Тасдиқлаш, 12 Первичный отдел, 6 Доставка — and says the
   * REAL "тасдиқланмади" state is held in `C12:UC_1OM8B2`, because selecting
   * «Ошибка первичный отдел» makes Bitrix move the deal there automatically
   * rather than leaving it in `C4:LOSE`.
   *
   * Funnel 12 as a whole is 995 551 transitions — five times this deployment's
   * entire history table, on a 1 GB database. The one stage that carries the
   * refusal is 17 242. Reading the stage instead of the funnel buys the
   * documented signal for 1.7% of the rows.
   */
  readonly historyStages?: readonly string[]
  /**
   * How far back to read telephony. Defaults to 1 month.
   *
   * The portal logs roughly 12 400 calls a DAY — measured, not estimated. A
   * year of that is four and a half million rows for a question nobody asks:
   * call activity is judged against this month, not against last spring.
   *
   * One month is ~370 000 rows. The first import pays for that once; after it,
   * incremental syncs add a day at a time. Raise it with BITRIX24_CALL_MONTHS
   * when a longer window is genuinely wanted, and expect the initial run to
   * grow in proportion.
   */
  readonly callHistoryMonths?: number
  readonly onProgress?: (message: string) => void
}

interface Bitrix24Response<T> {
  readonly result?: T
  readonly next?: number
  readonly total?: number
  readonly error?: string
  readonly error_description?: string
  /**
   * The portal's own meter, parsed and discarded on every call this
   * integration has ever made until 2026-09-16. See `portalMeter.ts`: this is
   * the number `OPERATION_TIME_LIMIT` is measured against, and the only
   * evidence about our load that comes from the side that does the blocking.
   */
  readonly time?: PortalTime
}

export class Bitrix24Error extends Error {
  /**
   * `code` and `method` are carried as FIELDS, not left to be read back out of
   * the message.
   *
   * Every decision about a refusal used to be a regex over English prose — the
   * worker substring-matched `OVERLOAD_LIMIT`, a React component kept a
   * two-element allowlist of codes, and the 429/5xx branch below threw the body
   * away before anyone could match anything. `classifyRefusal` reads these
   * fields first and falls back to the message only for errors raised elsewhere.
   */
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
    readonly code?: string,
    readonly method?: string,
  ) {
    super(message)
    this.name = 'Bitrix24Error'
  }
}

/**
 * A REFUSAL THAT WILL NOT CLEAR ON ITS OWN, and that is the whole distinction.
 *
 * `OVERLOAD_LIMIT` lifts on the portal's clock, so waiting is the right act.
 * A revoked or replaced webhook never lifts: every retry until somebody
 * installs a new one is a call that CANNOT succeed, and on 2026-09-15 that was
 * twelve entities asked again every three minutes — against a portal that had
 * blocked this same integration for four hours the day before, for volume.
 *
 * So the caller backs off exactly as it does for a throttle. Nothing here
 * decides HOW long; it decides only that no amount of asking is the answer.
 *
 * ONE VOCABULARY, NOT TWO. This kept its own list of the portal's codes until
 * `refusal.ts` arrived with the same list plus the three other kinds of refusal
 * and the `null` case that must never trip anything. Two lists of the same
 * codes in one repository is the drift CLAUDE.md keeps warning about, so this
 * is now a named reading of the shared classifier — the name is worth keeping,
 * the second copy of the vocabulary is not. It takes a MESSAGE because that is
 * what survives into `sync_log` and is all a later reader has; `classifyRefusal`
 * also reads the error's own `code` field when handed a live error.
 */
export function isCredentialFailure(message: string | null | undefined): boolean {
  if (!message) return false
  return classifyRefusal(message) === 'CREDENTIAL'
}

/** Rows a single list call returns. Fixed by the portal, not configurable. */
const LIST_PAGE = 50
/** Commands per batch request. The portal's hard limit. */
const BATCH_SIZE = 50

/**
 * Commands a walk opens with, and how fast it widens.
 *
 * THE 48 COMMANDS NOBODY NEEDED. Every `batchWalk` sent a fixed chain of fifty
 * seeks, on a once-a-minute incremental tick where the first one covers 50
 * changed rows and the portal has perhaps five. The other 49 each resolve a
 * `$result` reference to a row that does not exist, and the portal executes,
 * validates and refuses each of them — `INVALID_ARG_VALUE`, which the walk
 * reads as «the data ended» and which is exactly right. It is also fifty
 * invocations of `crm.deal.list` billed for five rows.
 *
 * Counted over a day at the deployed cadence — four hot entities, one tick a
 * minute, plus a second pass for stage history — that is ~360 000 method
 * invocations a day, of which ~355 000 exist only to discover that there was
 * nothing more to read. It is the largest single thing this integration does
 * to the portal, and it is invisible from here: one HTTP request a minute per
 * entity, well inside our own 2 rps limiter, is what our side of the wire sees.
 *
 * So a walk OPENS narrow and WIDENS only when it proves it needs to. A chain
 * that comes back full means there is more data, and the next round trip asks
 * for four times as much; a chain that runs dry ends the walk and resets. A
 * quiet tick costs 2 invocations instead of 50. A full import pays three extra
 * round trips at the start of a 186-request walk and is otherwise unchanged —
 * measured against `listDealIds`: 2 + 8 + 32 + 50 + 50 … reaches 464 000 deals
 * in 188 requests against the old 186.
 *
 * The floor is 2 rather than 1 so a tick with 51–100 changed rows still
 * finishes in one round trip, which is the ordinary busy minute on this portal.
 */
const CHAIN_MIN = 2
const CHAIN_GROWTH = 4

/**
 * The longest a single REST request may run on a cloud portal before Bitrix24
 * interrupts it — «не дольше чем за 60 секунд», apidocs.bitrix24.ru/limits.html.
 * Waiting past it only waits on an answer that has already been abandoned.
 */
export const PORTAL_REQUEST_LIMIT_MS = 60_000

/** Room for the portal's own interruption to arrive before we give up locally. */
const PORTAL_REQUEST_GRACE_MS = 5_000
const DEAL_SELECT = [
  'ID', 'TITLE', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID',
  'OPPORTUNITY', 'CURRENCY_ID', 'ASSIGNED_BY_ID', 'CONTACT_ID',
  'SOURCE_ID', 'DATE_CREATE', 'DATE_MODIFY', 'CLOSEDATE', 'CLOSED',
  'IS_RETURN_CUSTOMER',
  ...UF_FIELDS,
]

/**
 * The portal's own error code and sentence, as a suffix, or an empty string.
 *
 * Never throws: the body of a failed response is best-effort context, and a
 * parse error here would replace a real HTTP status with a JSON one.
 */
async function errorDetail(response: Response): Promise<{ code: string | null; detail: string }> {
  try {
    const body = (await response.json()) as {
      error?: string
      error_description?: string
    }
    if (!body?.error) return { code: null, detail: '' }
    return {
      code: String(body.error).toUpperCase(),
      detail: body.error_description
        ? ` — ${body.error}: ${body.error_description}`
        : ` — ${body.error}`,
    }
  } catch {
    return { code: null, detail: '' }
  }
}

export class Bitrix24CrmProvider implements CrmProvider {
  readonly source: ExternalSourceValue = 'BITRIX24'

  /**
   * What this portal can actually supply.
   *
   * PRODUCT_CATEGORIES and PAYMENTS are false because the portal has none —
   * verified, not assumed. STORES and STOCK start false and are switched on by
   * `detectScopes()` when the webhook turns out to carry the `catalog` scope.
   *
   * A capability left false makes the API report the data as unavailable
   * rather than as zero. That distinction is the point: a warehouse page
   * showing 0 units in stock is a false statement, not an empty state.
   */
  capabilities: ProviderCapabilities = {
    DEPARTMENTS: true,
    EMPLOYEES: true,
    PRODUCT_CATEGORIES: false,
    PRODUCTS: true,
    PIPELINES: true,
    STAGES: true,
    SOURCES: true,
    CUSTOMERS: true,
    DEALS: true,
    DEAL_ITEMS: true,
    PAYMENTS: false,
    STAGE_HISTORY: true,
    CALLS: true,
    STORES: false,
    STOCK: false,
  }

  private readonly webhookUrl: string
  private readonly limiter: RateLimiter
  /**
   * The circuit breaker, per provider instance.
   *
   * Public because the sync worker drives its probe ladder and reports its
   * state; everything else in the system reaches it only through `call()`.
   */
  readonly gate = new PortalGate()
  /**
   * Separate from the gate on purpose: the gate is a fact about a refusal that
   * has already happened, the meter is a fact about the basket we are spending
   * right now. Public because the worker prints it and the support ticket
   * quotes it.
   */
  readonly meter = new PortalMeter()

  /**
   * How wide each method's walk is currently asking. Keyed by METHOD, so the
   * six-hourly sweep's widening resets the moment its walk ends and the next
   * incremental tick opens narrow again.
   */
  private readonly chains = new Map<string, number>()

  /**
   * The last line: what this process may ask for in any rolling hour.
   *
   * The chain width and the meter are what keep us far below it. If this ever
   * refuses a call, something has regressed — and refusing is the point, because
   * the alternative is spending our way into another portal-wide block and
   * finding out days later from a 401.
   */
  readonly budget: PortalBudget
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly fetchImpl: typeof fetch
  private readonly pipelines: readonly number[]
  private readonly historyPipelines: readonly number[]
  private readonly historyStages: readonly string[]
  private readonly callHistoryMonths: number
  private readonly progress: (m: string) => void

  /** Deals in a REVENUE pipeline — the only ones whose line items are read. */
  /**
   * Deals whose product rows are worth fetching.
   *
   * It used to be the REVENUE pipelines alone, which quietly emptied the
   * Продукт column for every order that had left them — a confirmation queue
   * order killed in Первичный отдел showed no products at all, on 10% of the
   * cohort, while the client's own dashboard showed them.
   *
   * The rule is now "the deal carries money", which is the honest signal that
   * it has products. Measured on the portal: it adds ~16 000 deals to the
   * ~16 700 already walked, because the two pipelines holding almost every
   * deal — ИИ обработка (116 399) and Регистрация (184 580) — carry an amount
   * on 0 and 226 of them respectively and are therefore still skipped.
   */
  private itemDealIds: string[] = []

  // Running totals, for progress output only. The walk is stateless — every
  // page is addressed by the id it starts after — so these carry no meaning
  // the sync depends on.
  private dealsRead = 0
  private customersRead = 0
  private historyRead = 0
  private callsRead = 0

  /** Resolved once from `crm.deal.fields`: field name → item id → label. */
  private enumLabels: Map<string, Map<string, string>> | undefined
  private grantedScopes: Set<string> | undefined

  constructor(options: Bitrix24ProviderOptions) {
    if (!options.webhookUrl) throw new Bitrix24Error('Bitrix24CrmProvider requires a webhook URL')
    if (!/^https:\/\//i.test(options.webhookUrl)) {
      throw new Bitrix24Error('Bitrix24 webhook URL must use https; it embeds an access token')
    }

    this.webhookUrl = options.webhookUrl.replace(/\/+$/, '') + '/'
    this.limiter = new RateLimiter(options.rateLimitRps ?? 2)
    this.budget = new PortalBudget(options.hourlyInvocations)
    this.timeoutMs = options.requestTimeoutMs ?? 30_000
    this.maxRetries = options.maxRetries ?? 3
    this.fetchImpl = options.fetchImpl ?? fetch
    this.pipelines = options.pipelines ?? ALL_PIPELINES
    this.historyPipelines = options.historyPipelines ?? [6, 14, 10, 4]
    this.historyStages = options.historyStages ?? [...CONFIRMATION_REFUSAL_STAGES]
    this.callHistoryMonths = options.callHistoryMonths ?? 1
    this.progress = options.onProgress ?? (() => {})
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private async call<T>(
    method: string,
    params: Record<string, unknown>,
    options: { bypassGate?: boolean; meterAs?: string; invocations?: number; retries?: number } = {},
  ): Promise<Bitrix24Response<T>> {
    /*
      THE METERED METHOD IS NOT ALWAYS THE TRANSPORT.

      A chained walk sends `batch` and spends `crm.deal.list`'s basket fifty
      times over. Filing that under «batch» would hide the only method the
      portal was ever going to refuse, which is exactly the blindness that made
      2026-09-14 take a live probe to diagnose.
    */
    const metered = options.meterAs ?? method
    let lastError: unknown
    /*
      THE ATTEMPTS MADE, NOT THE ATTEMPTS ALLOWED.

      This message printed `maxRetries + 1` unconditionally — «failed after 4
      attempts» — including for the non-retryable 401s that break out of the
      loop after ONE. Every credential and overload failure in `sync_log` has
      therefore overstated our own call volume four-fold, and that log is the
      evidence this integration hands Bitrix24 when it asks what we were doing
      to its portal. A number offered as proof has to be the measured one.
    */
    let attempts = 0
    const maxRetries = options.retries ?? this.maxRetries

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      /*
        THE CHEAPEST REQUEST IS THE ONE NEVER SENT.

        Consulted BEFORE the rate limiter, because a held call should not even
        occupy a token — during a block the limiter would otherwise pace our
        refusals at a tidy two per second. `bypassGate` is for the probe alone:
        it is the one call whose entire job is to find out whether the door has
        opened.
      */
      if (!options.bypassGate) {
        const held = this.gate.hold(method, new Date())
        if (held) {
          throw new Bitrix24Error(held.message, undefined, false, held.code, method)
        }
      }

      /*
        THE CEILING, AND IT IS DELIBERATELY THE LAST LINE.

        Everything above limits a RATE, and the rate was never what earned the
        blocks — 2 rps was true for every second of both of them. This is the
        only thing in the process that remembers how much we have asked for,
        and the only thing a regression cannot quietly walk past. A refusal
        here is safe wherever it lands: `listDealIds` throws rather than
        returning a short read, the sweep will not delete on an empty source,
        and no watermark advances except after a clean run.
      */
      if (!options.bypassGate) {
        const invocations = options.invocations ?? 1
        const budgetWait = this.budget.waitMs(invocations, new Date())
        if (!Number.isFinite(budgetWait)) {
          const state = this.budget.state(new Date())
          throw new Bitrix24Error(
            /*
              THE CODE GOES IN THE MESSAGE, because the message is what survives.
              `sync_log` stores text, and `syncErrorCode` recovers the code from
              it with a regex — so a code that lives only on the error's `code`
              field reaches the header chip as «UNKNOWN», which is the one thing
              an operator cannot act on.
            */
            `${SELF_LIMIT_CODE}: soatlik cheklov ${state.spent}/${state.ceiling} chaqiruv` +
              ` — "${metered}" yuborilmadi (eng koʻp: ${
                state.byMethod
                  .slice(0, 3)
                  .map((m) => `${m.method} ${m.invocations}`)
                  .join(', ') || 'yoʻq'
              })`,
            undefined,
            false,
            SELF_LIMIT_CODE,
            method,
          )
        }
        if (budgetWait > 0) await sleep(budgetWait)
        /*
          ATTRIBUTED TO THE WALKED METHOD, NOT TO `batch`, for the same reason
          the meter is. A trip exists to NAME the regression, and every chained
          walk in this file sends `batch` — so a breakdown keyed on the
          transport would report «batch 14 900» and leave whoever is reading it
          exactly where they started.
        */
        this.budget.spend(metered, invocations, new Date())
      }

      /*
        PACE AGAINST THE PORTAL'S BASKET, NOT AGAINST OUR OWN GUESS.

        The rate limiter answers «how fast may we send», which is a rule we
        chose. This answers «how much has the portal already billed this
        method», which is the rule the portal enforces — and it is the one that
        was never consulted. A probe is exempt: its entire job is to ask
        whether the door has opened, and holding it back would only lengthen an
        outage we can already see.
      */
      if (!options.bypassGate) {
        const meterWait = this.meter.waitMs(metered, new Date())
        if (meterWait > 0) {
          this.progress(
            `  portal hisoblagichi: ${metered} ${this.meter.operating(metered)}s —` +
              ` ${Math.round(meterWait / 1000)}s kutiladi`,
          )
          await sleep(meterWait)
        }
      }

      attempts += 1
      await this.limiter.acquire()
      this.meter.countRequest(options.invocations ?? 1)
      /*
        STARTED AFTER THE LIMITER, NOT BEFORE IT. The wait for a token is ours;
        what the portal is billed for starts when the request leaves.
      */
      const sentAt = Date.now()
      const controller = new AbortController()
      /**
       * A batch is fifty queries in one request, so it deserves more patience
       * than a single call. Holding it to the single-call timeout aborts work
       * the portal is still doing and then retries it, which is how a slow
       * read turns into a rate-limit block.
       *
       * BUT NEVER PAST THE PORTAL'S OWN CUT-OFF. Bitrix24's limits page
       * (apidocs.bitrix24.ru/limits.html): «один REST-запрос должен
       * выполниться не дольше чем за 60 секунд» — the portal interrupts it
       * itself. This was `timeoutMs × 6` = 180 s, so a request the portal had
       * already abandoned held the tick for two more minutes: during the
       * 2026-09-16 address block CUSTOMERS sat 165–177 s on sockets that were
       * never going to answer.
       */
      const ceiling = PORTAL_REQUEST_LIMIT_MS + PORTAL_REQUEST_GRACE_MS
      const timeout = Math.min(method === 'batch' ? this.timeoutMs * 6 : this.timeoutMs, ceiling)
      const timer = setTimeout(() => controller.abort(), timeout)

      try {
        const response = await this.fetchImpl(`${this.webhookUrl}${method}.json`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
          signal: controller.signal,
        })

        if (response.status === 429 || response.status >= 500) {
          /*
            THIS BRANCH USED TO THROW THE BODY AWAY, AND IT IS THE SAME BUG THE
            LONG COMMENT BELOW FIXED ONE BRANCH LOWER.

            Bitrix24 sends `QUERY_LIMIT_EXCEEDED` behind a 503 and
            `OPERATION_TIME_LIMIT` behind a 429 — both with the code in the
            body — and this line reported them as a bare «Bitrix24 responded
            503». Measured on 2026-09-15: eleven entity fetches issued 40 HTTP
            requests instead of 10, because the full retry ladder ran AND the
            worker's substring match for a code that never arrived meant its
            ten-minute wait never engaged. Reading the body costs nothing and
            makes both the retry decision and the gate correct.

            Retryability now comes from the CODE, not the status: a plain 5xx is
            worth retrying, an OVERLOAD_LIMIT behind one is not.
          */
          const { code, detail } = await errorDetail(response)
          const retryable = code === null || code === 'QUERY_LIMIT_EXCEEDED'
          throw new Bitrix24Error(
            `Bitrix24 responded ${response.status}${detail}`,
            response.status,
            retryable,
            code ?? undefined,
            method,
          )
        }
        if (!response.ok) {
          /*
            THE PORTAL SAYS WHY IN THE BODY, AND ON THIS ONE IT MATTERS MOST.

            A non-ok response used to be reported as bare «Bitrix24 responded
            401», which is what the sync log carried through the whole outage
            of 2026-09-14: every entity failing once a minute for a quarter of
            an hour under a message that reads like a revoked token. The body
            said something entirely different and entirely actionable —
            `OVERLOAD_LIMIT: REST API is blocked due to overload` — the
            portal's own throttle, which clears by itself and needs nobody to
            touch a credential. Diagnosing it took a probe against the live
            portal because this line threw the reason away.

            The code is the portal's vocabulary and the description is its own
            sentence; neither carries a secret, and `redact` still runs over
            the message on the way out.
          */
          const { code, detail } = await errorDetail(response)
          throw new Bitrix24Error(
            `Bitrix24 responded ${response.status}${detail}`,
            response.status,
            false,
            code ?? undefined,
            method,
          )
        }

        const payload = (await response.json()) as Bitrix24Response<T>
        if (payload.error) {
          throw new Bitrix24Error(
            `Bitrix24 error: ${payload.error}${payload.error_description ? ` (${payload.error_description})` : ''}`,
            response.status,
            // The portal throttles with this code rather than a 429.
            payload.error === 'QUERY_LIMIT_EXCEEDED',
            String(payload.error).toUpperCase(),
            method,
          )
        }
        // The door is open. Whatever we were waiting out is over — and this is
        // also how a successful probe closes the gate.
        this.gate.noteSuccess(method, new Date())
        /*
          READ THE METER BEFORE HANDING THE ROWS ON.

          A batch reports the basket of each command it carried under
          `result.result_time`, and the outer `time` describes the batch method
          itself. Both are filed: the sub-readings under the method that was
          actually spent, which is the one that gets refused.
        */
        const at = new Date()
        this.meter.record(method, payload.time, at)
        if (metered !== method) this.meter.record(metered, subcommandTime(payload.result), at)
        /*
          AND WHAT WE MEASURED, BECAUSE THIS PORTAL REPORTS NOTHING.

          Filed under the METERED method, so a fifty-command walk bills
          `crm.deal.list` and not `batch` — that is the method whose thirty-six
          seconds a tick got `obey.bitrix24.kz` blocked three mornings running.
          Successes only: a refusal returns in milliseconds and would drag the
          measurement down exactly when the portal is under strain.
        */
        this.meter.recordDuration(metered, (Date.now() - sentAt) / 1000, at)
        return payload
      } catch (error) {
        lastError = error
        // Told BEFORE the retry decision, so a refusal shuts the door for every
        // other entity in this tick rather than only for the next one.
        this.gate.trip(error, new Date())
        const retryable = error instanceof Bitrix24Error ? error.retryable : true
        if (!retryable || attempt === maxRetries) break
        await sleep(backoffDelayMs(attempt))
      } finally {
        clearTimeout(timer)
      }
    }

    /*
      `attempts`, not `maxRetries + 1`.

      The constant was a lie on every non-retryable error: a 401 breaks out of
      the loop after ONE request, and the message still read «failed after 4
      attempts». That sentence went into `sync_log`, into the dashboard tooltip
      and into the 2026-09-14 incident notes, and it is why the first reading of
      that outage was «the client is hammering the portal four times over».
    */
    const cause = lastError instanceof Bitrix24Error ? lastError : undefined
    throw new Bitrix24Error(
      `Bitrix24 call "${method}" failed after ${attempts} ${
        attempts === 1 ? 'attempt' : 'attempts'
      }: ${redact(lastError)}${networkCause(lastError)}`,
      cause?.status,
      false,
      cause?.code,
      method,
    )
  }

  /**
   * Read every page of a small list method, sequentially.
   *
   * `unwrap` exists because the portal is not consistent about response shape.
   * `crm.*` list methods return a bare array; `crm.stagehistory.list` nests
   * under `result.items`; every `catalog.*` method nests under a key named
   * after the entity (`result.stores`, `result.products`). Spreading the
   * object as if it were an array throws, so the shape is stated per call
   * rather than assumed.
   */
  private async listAll<T>(
    method: string,
    params: Record<string, unknown>,
    label: string,
    unwrap: (value: unknown) => T[] = asArray,
  ): Promise<T[]> {
    const rows: T[] = []
    let start = 0

    for (let guard = 0; guard < 20_000; guard++) {
      const payload = await this.call<unknown>(method, { ...params, start })
      const batch = unwrap(payload.result)
      rows.push(...batch)

      if (rows.length > 0 && rows.length % 500 === 0) {
        this.progress(`  ${label}: ${rows.length}${payload.total ? `/${payload.total}` : ''}`)
      }
      if (payload.next === undefined) break
      start = payload.next
    }

    return rows
  }

  /**
   * Read up to 2 500 rows in ONE round trip, walking by id.
   *
   * WHY NOT OFFSETS
   * The obvious approach — fifty `start=` offsets packed into a batch — works
   * and is fast, right up until the portal cuts you off. Bitrix24 meters
   * "operating time" per method, and `start=400000` makes the database count
   * past four hundred thousand rows before returning fifty. Measured: the
   * contact import ran for twenty-five minutes and then every
   * `crm.contact.list` call in the account began answering
   * `OPERATION_TIME_LIMIT`, including cheap ones, for the next ten minutes.
   *
   * WHAT THIS DOES INSTEAD
   * Each command filters `>ID` and sets `start=-1`, which is an indexed seek
   * and skips the row count entirely. Commands are CHAINED inside the batch:
   * command N filters on the last id command N-1 returned, using Bitrix24's
   * `$result` reference. Fifty chained seeks cost about a second and no
   * measurable operating time.
   *
   * Measured against the old path: 2 500 deals in 0.4s instead of 6s, with no
   * block. It is also strictly ordered, so no row can be returned twice or
   * skipped — which offset paging could not guarantee once the underlying
   * table was being written to during the read.
   *
   * TERMINATION
   * A command returning fewer than 50 rows is the end of the data. Everything
   * after it in the same batch is discarded: its `$result` reference points at
   * a row that does not exist, the filter comes back empty, and the portal
   * would answer from the beginning of the table.
   */
  private async batchWalk<T>(
    method: string,
    params: Record<string, unknown>,
    afterId: string,
    options: {
      unwrap?: (value: unknown) => T[]
      /** Where the last row's id sits in a command's result. */
      refPath?: string
      /** `filter` for crm.*, `FILTER` for voximplant. */
      filterKey?: string
      /** Sort clause that makes the walk monotonic. */
      orderQuery?: string
      idOf?: (row: T) => string
    } = {},
  ): Promise<{ rows: T[]; done: boolean }> {
    const {
      unwrap = asArray as (value: unknown) => T[],
      refPath = '[49][ID]',
      filterKey = 'filter',
      orderQuery = 'order[ID]=ASC',
      idOf = (row: T) => String((row as { ID?: unknown }).ID ?? ''),
    } = options

    const base = encodeParams(params)
    const prefix = `${method}?${base ? `${base}&` : ''}${orderQuery}`

    // Narrow until proven otherwise — see CHAIN_MIN. `refPath` still reaches
    // the 50th row of the previous command, because that is the page size the
    // portal returns, not the number of commands we sent.
    const chain = Math.min(BATCH_SIZE, Math.max(CHAIN_MIN, this.chains.get(method) ?? CHAIN_MIN))

    const cmd: Record<string, string> = {
      // `>ID` needs no encoding: it contains no `=`, which is the character
      // that would otherwise split the key from the value.
      c0: `${prefix}&${filterKey}[>ID]=${encodeURIComponent(afterId)}&start=-1`,
    }
    for (let i = 1; i < chain; i++) {
      cmd[`c${i}`] = `${prefix}&${filterKey}[>ID]=$result[c${i - 1}]${refPath}&start=-1`
    }

    const payload = await this.call<{ result?: Record<string, unknown>; result_error?: unknown }>(
      'batch',
      { halt: 0, cmd },
      // Billed to the walked method's basket, and `chain` invocations — not
      // the one HTTP request our own limiter counts.
      { meterAs: method, invocations: chain },
    )

    const errors = (payload.result?.result_error ?? {}) as Record<
      string,
      { error?: string } | undefined
    >
    const results = payload.result?.result as Record<string, unknown> | undefined

    const rows: T[] = []
    const seen = new Set<string>()

    /** A walk that ended: reset the width so the next one opens narrow. */
    const ended = (): { rows: T[]; done: true } => {
      this.chains.delete(method)
      return { rows, done: true }
    }

    for (let i = 0; i < chain; i++) {
      const error = errors[`c${i}`]

      if (error) {
        /**
         * A chain that ran dry is not a failure.
         *
         * Every command references the 50th row of the one before it. Once a
         * command returns fewer than 50 rows — the end of the data — the next
         * reference resolves to nothing, the filter arrives empty, and the
         * portal answers INVALID_ARG_VALUE. That is the batch telling us it
         * reached the end, which is exactly what we asked it to find out.
         *
         * Anything else — a rate limit, a bad field, a blocked method — is a
         * real failure and must not be swallowed, because silently returning
         * a short page here would look identical to "no more data" and would
         * truncate the import without a word.
         */
        if (i > 0 && error.error === 'INVALID_ARG_VALUE') return ended()

        throw new Bitrix24Error(
          `Bitrix24 batch of ${method} failed at command ${i}: ${JSON.stringify(error).slice(0, 200)}`,
        )
      }

      const batch = unwrap(results?.[`c${i}`])

      for (const row of batch) {
        // A wrapped page would repeat ids already collected. Cheap insurance
        // against the one failure mode that corrupts data silently.
        const id = idOf(row)
        if (id && seen.has(id)) continue
        if (id) seen.add(id)
        rows.push(row)
      }

      if (batch.length < LIST_PAGE) return ended()
    }

    // The chain filled, so there is more. Ask for four times as much next
    // round trip — the widening is what keeps a full import the same price it
    // was while leaving a quiet tick at two commands.
    this.chains.set(method, Math.min(BATCH_SIZE, chain * CHAIN_GROWTH))
    return { rows, done: false }
  }

  /**
   * Bitrix24's batch endpoint for many DIFFERENT commands.
   *
   * Product rows are per-deal, and 16 500 sequential calls at 2/second is over
   * two hours. Batched it is a few minutes — the difference between usable
   * product analytics and none.
   */
  private async batch<T>(commands: Record<string, string>, label = 'batch'): Promise<Record<string, T>> {
    const entries = Object.entries(commands)
    const results: Record<string, T> = {}

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = Object.fromEntries(entries.slice(i, i + BATCH_SIZE))
      const payload = await this.call<{ result?: Record<string, T> }>(
        'batch',
        { halt: 0, cmd: chunk },
        { invocations: Object.keys(chunk).length },
      )
      Object.assign(results, payload.result?.result ?? {})
      if (i % (BATCH_SIZE * 20) === 0) this.progress(`  ${label}: ${i}/${entries.length}`)
    }

    return results
  }

  /** Everything is fetched in one pass; the sync engine gets a single page. */
  private page<T>(items: T[]): Page<T> {
    return { items }
  }

  // -------------------------------------------------------------------------
  // Portal capabilities
  // -------------------------------------------------------------------------

  /**
   * Ask the portal which scopes the webhook actually carries.
   *
   * Capabilities are derived from the answer rather than assumed, so granting
   * `catalog` later switches the warehouse and margin modules on with no code
   * change — and NOT granting it leaves them explicitly unavailable instead of
   * quietly empty.
   */
  /**
   * A REFUSAL IS NOT AN ANSWER OF «NO SCOPES».
   *
   * This memo used to be written in the `catch` as well as the `try`, so a
   * `scope` call refused during a block cached `new Set()` for the LIFE OF THE
   * PROCESS. Every consequence was silent: `STORES` and `STOCK` stayed false,
   * the API then correctly reported warehouse and cost data as *unavailable*
   * rather than zero, and it stayed that way long after the portal had
   * recovered — until somebody redeployed. On 2026-09-15 a worker started
   * inside the outage, which is exactly the case that triggers it.
   *
   * Now only a real answer is remembered. A refusal is rethrown, so the entity
   * fails honestly and `sync_log` says so, and a short negative cooldown keeps
   * the four call sites from turning one refused tick into four `scope` calls.
   */
  private scopeRetryAfter: Date | null = null

  async detectScopes(): Promise<ReadonlySet<string>> {
    if (this.grantedScopes) return this.grantedScopes

    if (this.scopeRetryAfter && new Date() < this.scopeRetryAfter) {
      throw new Bitrix24Error(
        `Bitrix24 scope unknown — retry after ${this.scopeRetryAfter.toISOString()}`,
        undefined,
        false,
      )
    }

    try {
      const payload = await this.call<string[]>('scope', {})
      this.grantedScopes = new Set(payload.result ?? [])
      this.scopeRetryAfter = null
    } catch (error) {
      this.scopeRetryAfter = new Date(Date.now() + 60_000)
      throw error
    }

    const hasCatalog = this.grantedScopes.has('catalog')
    this.capabilities = {
      ...this.capabilities,
      STORES: hasCatalog,
      STOCK: hasCatalog,
    }

    if (!hasCatalog) {
      this.progress('  catalog scope yoʻq — sklad va tannarx ulanmagan')
    }

    return this.grantedScopes
  }

  /**
   * Enumeration item ids → labels, from `crm.deal.fields`.
   *
   * The custom fields arrive as numeric item ids ("98"), not text. Resolving
   * them from the portal rather than a hardcoded table means an operator who
   * adds a region next month gets the right name without a redeploy.
   */
  private async loadEnumLabels(): Promise<Map<string, Map<string, string>>> {
    if (this.enumLabels) return this.enumLabels

    const payload = await this.call<Record<string, { items?: { ID: string; VALUE: string }[] }>>(
      'crm.deal.fields',
      {},
    )

    const map = new Map<string, Map<string, string>>()
    for (const field of UF_FIELDS) {
      const items = payload.result?.[field]?.items ?? []
      map.set(field, new Map(items.map((i) => [String(i.ID), i.VALUE])))
    }

    this.enumLabels = map
    return map
  }

  private label(field: string, value: unknown): string | undefined {
    if (value === null || value === undefined || value === '') return undefined
    return this.enumLabels?.get(field)?.get(String(value)) ?? undefined
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  /**
   * One call, not two — and the one that was dropped is the one that told us
   * least.
   *
   * `profile` existed here only to print `user #8868` into a single startup log
   * line. `detectScopes()` on the next line proves connectivity AND authorisation
   * on its own, so the second request bought a decoration. It was also issued at
   * precisely the worst moment: at the measured ~17 restarts a day, a worker
   * starting inside a block spent its first request on the decoration.
   *
   * Worse, it was issued FIRST, so during a block it threw and `detectScopes()`
   * never ran — leaving STORES and STOCK false for that worker's entire life and
   * the warehouse screens reporting data as unavailable long after the portal
   * had recovered. Order alone caused that; dropping the call fixes it.
   *
   * `profile` survives as `probe()` below, where being the cheapest method on the
   * portal is exactly the property wanted.
   */
  async healthCheck(): Promise<ProviderHealth> {
    try {
      const scopes = await this.detectScopes()
      const names = this.pipelines.map((p) => PIPELINE_NAMES[p] ?? p).join(', ')
      return {
        ok: true,
        detail: `Bitrix24 ulandi. Voronkalar: ${names}. Ruxsatlar: ${[...scopes].join(', ')}.`,
      }
    } catch (error) {
      return { ok: false, detail: `Bitrix24 unreachable: ${redact(error)}` }
    }
  }

  /**
   * Is the door open again?
   *
   * The ONLY call allowed past the gate, and the cheapest method the portal
   * offers: no CRM table is touched, no operating time accrues that matters. It
   * replaces the old design where the worker waited a flat ten minutes and then
   * discovered the answer by running a whole tick — four entities and their
   * pages — into whatever it found.
   *
   * A success closes the gate through the ordinary `noteSuccess` path in
   * `call()`, so recovery needs no separate bookkeeping.
   */
  async probe(): Promise<boolean> {
    this.gate.noteProbe(new Date())
    try {
      /*
        ONE ATTEMPT. The ladder IS the retry: four back-to-back connection
        attempts per rung is four knocks on a firewall that has already
        dropped our address, and it made each rung ~40 s longer than printed.
      */
      await this.call('profile', {}, { bypassGate: true, retries: 0 })
      this.lastProbeError = null
      return true
    } catch (error) {
      this.lastProbeError = redact(error)
      return false
    }
  }

  /**
   * Why the last probe failed, in words, or null after a success.
   *
   * THE GATE'S CODE IS NOT ENOUGH ON ITS OWN. A network failure carries no
   * portal code, so the worker printed «portal hali ham band (UNKNOWN)» on every
   * rung after the 2026-09-16 redeploy while the real answer — a connect
   * timeout from the server's address, with the same webhook answering in
   * 480 ms from an office laptop — was swallowed here. «Bitrix24 is refusing
   * us» and «Bitrix24 cannot be reached from this machine» need different
   * people, and only the message can tell them apart.
   */
  lastProbeError: string | null = null

  // -------------------------------------------------------------------------
  // Organisation
  // -------------------------------------------------------------------------

  /**
   * The company tree.
   *
   * `UF_HEAD` names the employee who runs each department. It is carried
   * through as `headExternalId` and resolved to an internal id by the sync
   * handler, which runs after employees — a head cannot be linked while the
   * person is still unknown.
   */
  async fetchDepartments(_o?: FetchOptions): Promise<Page<RawDepartment>> {
    try {
      const rows = await this.listAll<{
        ID: string
        NAME: string
        SORT?: number
        PARENT?: string
        UF_HEAD?: string
      }>('department.get', {}, 'departments')

      return this.page(
        rows.map((d) => ({
          externalId: String(d.ID),
          name: d.NAME.trim(),
          parentExternalId: d.PARENT ? String(d.PARENT) : undefined,
          headExternalId: d.UF_HEAD ? String(d.UF_HEAD) : undefined,
          sortOrder: Number(d.SORT ?? 0),
          isActive: true,
        })),
      )
    } catch (error) {
      /*
        «SCOPE YOʻQ» IS A GUESS, AND UNDER A BLOCK IT WAS THE WRONG ONE.

        This catch was unconditional, so a refused `department.get` resolved
        with ZERO departments — and an empty page is a successful page: the
        engine records SUCCESS and ADVANCES the watermark. That is one of the
        two passes that made the freshness chip read «2 daqiqa oldin» over
        four-hour-old deals on 2026-09-14, which the client reported as
        «avtomatik yangilanmayapti». The chip was not lying about its own
        measurement; this line was manufacturing the measurement.

        A portal refusal is rethrown so the entity fails and says why. Only a
        genuine permission problem still takes the quiet path.
      */
      if (classifyRefusal(error) !== null) throw error
      this.progress('  departments: scope yoʻq, oʻtkazib yuborildi')
      return this.page([])
    }
  }

  async fetchEmployees(_o?: FetchOptions): Promise<Page<RawEmployee>> {
    const rows = await this.listAll<{
      ID: string
      NAME?: string
      LAST_NAME?: string
      SECOND_NAME?: string
      EMAIL?: string
      PERSONAL_MOBILE?: string
      WORK_PHONE?: string
      WORK_POSITION?: string
      ACTIVE?: boolean
      PERSONAL_PHOTO?: string
      DATE_REGISTER?: string
      UF_DEPARTMENT?: number[]
    }>('user.get', {}, 'employees')

    return this.page(
      rows.map((u) => {
        /*
          UF_DEPARTMENT IS AN ARRAY, AND THE PORTAL'S OWN ORG CHART READS ALL OF IT.

          Nine of this portal's 208 active people sit in two units at once — a
          registrar who also works a sales floor, the owner who heads one team and
          sits in another. `hr/structure` counts each of them once in EVERY unit,
          so keeping only `[0]` left five of its twenty cards short by one or two.
          The first entry stays the primary: it is what every analytic credits the
          person to, and crediting two units would double their money.
        */
        const departments = (u.UF_DEPARTMENT ?? []).map(String).filter((id) => id.length > 0)

        return {
          externalId: String(u.ID),
          fullName:
            [u.LAST_NAME, u.NAME, u.SECOND_NAME].filter(Boolean).join(' ').trim() || `User ${u.ID}`,
          email: u.EMAIL || undefined,
          phone: u.PERSONAL_MOBILE || u.WORK_PHONE || undefined,
          position: u.WORK_POSITION || undefined,
          departmentExternalId: departments[0],
          departmentExternalIds: departments,
          avatarUrl: u.PERSONAL_PHOTO || undefined,
          hiredAt: toDate(u.DATE_REGISTER),
          isActive: u.ACTIVE !== false,
        }
      }),
    )
  }

  // -------------------------------------------------------------------------
  // Catalogue
  // -------------------------------------------------------------------------

  async fetchProductCategories(_o?: FetchOptions): Promise<Page<RawProductCategory>> {
    return this.page([])
  }

  /**
   * Products, merged from two views of the same catalogue.
   *
   * `crm.product.list` returns the 57 items the CRM knows about and their sale
   * price. It is not the whole catalogue: deal product rows reference ids it
   * never returns, which is why 77% of line items had nothing to attach to
   * before the `catalog` scope existed.
   *
   * `catalog.product.list` covers both catalogue blocks — 57 products and 103
   * trade offers — and carries `purchasingPrice`, the entire basis of gross
   * margin. It requires `iblockId` in BOTH the filter and the select, so the
   * blocks are read from `catalog.catalog.list` rather than hardcoded.
   *
   * Purchase price is left undefined when the portal has none. Twenty-two of
   * the 57 products carry one and no offer does, so margin coverage is partial
   * and the margin module has to say so rather than quietly treating an
   * unpriced product as free.
   */
  async fetchProducts(_o?: FetchOptions): Promise<Page<RawProduct>> {
    const crmRows = await this.listAll<{
      ID: string
      NAME: string
      PRICE?: string
      CURRENCY_ID?: string
      ACTIVE?: string
      SECTION_ID?: string
      XML_ID?: string
    }>(
      'crm.product.list',
      { select: ['ID', 'NAME', 'PRICE', 'CURRENCY_ID', 'ACTIVE', 'SECTION_ID', 'XML_ID'] },
      'products',
    )

    const products = new Map<string, RawProduct>()

    for (const p of crmRows) {
      products.set(String(p.ID), {
        externalId: String(p.ID),
        name: p.NAME,
        sku: p.XML_ID || undefined,
        priceMinor: p.PRICE ? toMinorUnits(p.PRICE) : undefined,
        currency: p.CURRENCY_ID || 'UZS',
        isActive: p.ACTIVE !== 'N',
      })
    }

    for (const c of await this.fetchCatalogueProducts()) {
      const existing = products.get(c.externalId)
      products.set(c.externalId, existing ? { ...existing, costMinor: c.costMinor } : c)
    }

    const withCost = [...products.values()].filter((p) => p.costMinor !== undefined).length
    this.progress(`  mahsulotlar: ${products.size}, tannarxi bor: ${withCost}`)

    return this.page([...products.values()])
  }

  /** The trade catalogue, across every catalogue block. Empty without scope. */
  private async fetchCatalogueProducts(): Promise<RawProduct[]> {
    const scopes = await this.detectScopes()
    if (!scopes.has('catalog')) return []

    try {
      const catalogues = await this.listAll<{ iblockId: number }>(
        'catalog.catalog.list',
        {},
        'catalogues',
        nestedIn('catalogs'),
      )

      const rows: RawProduct[] = []

      for (const catalogue of catalogues) {
        const products = await this.listAll<{
          id: number
          iblockId: number
          name: string
          purchasingPrice?: string | number | null
          active?: string
        }>(
          'catalog.product.list',
          {
            // iblockId is mandatory in the select as well as the filter — the
            // portal rejects the call outright without it.
            select: ['id', 'iblockId', 'name', 'purchasingPrice', 'active'],
            filter: { iblockId: catalogue.iblockId },
            order: { id: 'ASC' },
          },
          `catalogue ${catalogue.iblockId}`,
          nestedIn('products'),
        )

        for (const p of products) {
          rows.push({
            externalId: String(p.id),
            name: p.name,
            /*
              Null means the portal has no purchase price for this item. It
              must stay undefined: a zero cost reports as 100% margin.

              THE NULL CHECK ALONE WAS NOT ENOUGH. `purchasingPrice` comes back
              as an empty string for an item nobody has filled in, and
              `toMinorUnits('')` returns 0n rather than throwing — so a blank
              catalogue field was persisting as a REAL zero cost, which is
              exactly the value `prisma/schema.prisma` forbids on this column.
              A non-positive result is therefore folded back into undefined
              here, and the margin SQL refuses it a second time so neither
              layer is load-bearing on its own.
            */
            costMinor: (() => {
              if (p.purchasingPrice === null || p.purchasingPrice === undefined) {
                return undefined
              }
              const minor = toMinorUnits(p.purchasingPrice)
              return minor > 0n ? minor : undefined
            })(),
            currency: 'UZS',
            isActive: p.active !== 'N',
          })
        }
      }

      return rows
    } catch (error) {
      // Same correction as `fetchDepartments`: a refused catalogue is not an
      // empty catalogue. Swallowing it here let `handlers.ts` write
      // `costMinor: null` over every product that had a cost, so every margin
      // figure on the dashboard read «no cost» while the run finished SUCCESS.
      if (classifyRefusal(error) !== null) throw error
      this.progress(`  katalog oʻqilmadi: ${redact(error)}`)
      return []
    }
  }

  // -------------------------------------------------------------------------
  // Pipelines and stages
  // -------------------------------------------------------------------------

  async fetchPipelines(_o?: FetchOptions): Promise<Page<RawPipeline>> {
    const rows = await this.listAll<{ ID: string; NAME: string; SORT?: number }>(
      'crm.dealcategory.list',
      { order: { SORT: 'ASC' } },
      'pipelines',
    )

    // The default pipeline (#0 Регистрация) is not returned by
    // crm.dealcategory.list — Bitrix24 treats it as "no category". It holds
    // 179 842 deals, so it is added explicitly rather than lost.
    const known = new Set(rows.map((r) => Number(r.ID)))
    const pipelines: RawPipeline[] = rows.map((r) => ({
      externalId: String(r.ID),
      name: r.NAME,
      role: pipelineRole(Number(r.ID)),
      sortOrder: Number(r.SORT ?? 0),
    }))

    if (!known.has(0)) {
      pipelines.unshift({
        externalId: '0',
        name: PIPELINE_NAMES[0] ?? 'Umumiy',
        role: pipelineRole(0),
        sortOrder: 0,
      })
    }

    this.progress(`  pipelines: ${pipelines.length}`)
    return this.page(pipelines)
  }

  /**
   * Stages, for every imported pipeline.
   *
   * Stage ids repeat across pipelines (`C6:WON`, `C14:WON`), so each stage
   * carries its pipeline. `crm.dealcategory.stage.list` returns SEMANTICS only
   * for the terminal stages on this portal, which is why `categoryFromSemantic`
   * falls back to the id suffix — without it "Доставлено" and "Отказ" both land
   * in IN_PROGRESS and the funnel shows nothing ever finishing.
   */
  /**
   * NINE PIPELINES, ONE REQUEST.
   *
   * This was a `for` loop of nine bare calls — 31% of the whole reference pass
   * and 432 requests a day — over a helper that already packs fifty DIFFERENT
   * commands into a single request. The calls are independent and their results
   * are only pushed into one array, so nothing about the loop needed the round
   * trips. Under a block it also means one refusal instead of nine.
   *
   * THE MISSING-KEY CHECK IS NOT DEFENSIVE, IT IS LOAD-BEARING. `batch()` reads
   * `payload.result?.result` and ignores `result_error`, and `halt: 0` makes the
   * portal answer HTTP 200 with per-command failures buried in the body. Without
   * this throw, one refused pipeline would import as «that funnel has no stages»
   * — and CLAUDE.md records what that costs: with no stage semantics
   * «Доставлено» and «Отказ» both land in IN_PROGRESS and the funnel shows
   * nothing ever finishing.
   */
  async fetchStages(_o?: FetchOptions): Promise<Page<RawStage>> {
    const stages: RawStage[] = []

    const commands: Record<string, string> = {}
    for (const pipelineId of this.pipelines) {
      commands[`p${pipelineId}`] = `crm.dealcategory.stage.list?id=${pipelineId}`
    }

    const answered = await this.batch<
      { STATUS_ID: string; NAME: string; SORT?: string; SEMANTICS?: string }[]
    >(commands)

    const missing = this.pipelines.filter((id) => answered[`p${id}`] === undefined)
    if (missing.length > 0) {
      throw new Bitrix24Error(
        `Bitrix24 crm.dealcategory.stage.list javob bermadi: voronka ${missing.join(', ')}`,
        undefined,
        false,
        undefined,
        'crm.dealcategory.stage.list',
      )
    }

    for (const pipelineId of this.pipelines) {
      const rows = answered[`p${pipelineId}`] ?? []
      rows.forEach((s, index) => {
        stages.push({
          externalId: s.STATUS_ID,
          name: `${PIPELINE_NAMES[pipelineId] ?? pipelineId} · ${DELIVERY_ROUTE_NAMES[s.STATUS_ID] ?? s.NAME}`,
          pipelineExternalId: String(pipelineId),
          category: categoryFromSemantic(s.SEMANTICS, index === 0, s.STATUS_ID),
          logisticsRole: logisticsRole(s.STATUS_ID),
          confirmationSignal: confirmationSignal(s.STATUS_ID),
          sortOrder: pipelineId * 1000 + Number(s.SORT ?? index),
          isActive: true,
        })
      })
    }

    this.progress(`  stages: ${stages.length}`)
    return this.page(stages)
  }

  async fetchSources(_o?: FetchOptions): Promise<Page<RawSalesSource>> {
    const rows = await this.listAll<{ STATUS_ID: string; NAME: string }>(
      'crm.status.list',
      { filter: { ENTITY_ID: 'SOURCE' } },
      'sources',
    )
    return this.page(rows.map((s) => ({ externalId: s.STATUS_ID, name: s.NAME, isActive: true })))
  }

  // -------------------------------------------------------------------------
  // Deals
  // -------------------------------------------------------------------------

  /**
   * Deals, 2 500 per page.
   *
   * The cursor is the row offset. `pageSize` from the sync engine is ignored on
   * purpose: the page size here is dictated by the portal's batch limit, and
   * honouring a smaller request would multiply the number of round trips by an
   * order of magnitude for no benefit.
   */
  /**
   * Every deal id the portal currently holds, for the deletion sweep.
   *
   * WHY THIS EXISTS SEPARATELY FROM `fetchDeals`
   * The sweep needs one thing — the set of ids that still exist — and used to
   * get it by running a FULL `fetchDeals` pass, which reads twenty-three
   * fields for 432 000 deals and re-upserts every one of them. On a 1-vCPU
   * database that is thirty to sixty minutes of pure write traffic to learn
   * something the ID column alone answers, and the worker's tick loop was
   * blocked for all of it. Selecting only ID makes the same walk cost a
   * couple of minutes and not a single write.
   *
   * The filter is built from `this.pipelines` exactly as `fetchDeals` does.
   * A filter that diverged would mark deals in the excluded pipelines as
   * missing and delete rows the portal still has.
   *
   * Throws rather than returning a partial set. A half-read walk handed to the
   * sweep would look like "these deals are gone" — the caller must be able to
   * tell a short read from a small portal.
   */
  async listDealIds(): Promise<Set<string>> {
    const filter: Record<string, unknown> = { CATEGORY_ID: [...this.pipelines] }
    const ids = new Set<string>()

    let afterId = '0'
    for (;;) {
      const { rows, done } = await this.batchWalk<Record<string, string>>(
        'crm.deal.list',
        { filter, select: ['ID'] },
        afterId,
      )

      for (const row of rows) ids.add(String(row.ID))

      if (done || rows.length === 0) break
      afterId = String(rows[rows.length - 1]!.ID)
    }

    return ids
  }

  async fetchDeals(options: FetchOptions = {}): Promise<Page<RawDeal>> {
    await this.loadEnumLabels()

    const afterId = options.cursor ?? '0'
    if (afterId === '0') this.itemDealIds = []

    const filter: Record<string, unknown> = { CATEGORY_ID: [...this.pipelines] }
    if (options.updatedSince) {
      filter['>=DATE_MODIFY'] = isoLocal(options.updatedSince)
    }

    const { rows, done } = await this.batchWalk<Record<string, string>>(
      'crm.deal.list',
      { filter, select: DEAL_SELECT },
      afterId,
    )

    const deals: RawDeal[] = []

    for (const d of rows) {
      const id = String(d.ID)
      const categoryId = Number(d.CATEGORY_ID ?? 0)
      const role = pipelineRole(categoryId)
      const status = dealStatus(d.STAGE_SEMANTIC_ID, d.STAGE_ID)

      // Money, not pipeline: see `itemDealIds`.
      if (toMinorUnits(d.OPPORTUNITY) > 0n) this.itemDealIds.push(id)

      deals.push({
        externalId: id,
        title: d.TITLE || `Bitim ${id}`,
        amountMinor: toMinorUnits(d.OPPORTUNITY),
        currency: d.CURRENCY_ID || 'UZS',
        stageExternalId: d.STAGE_ID!,
        status,
        employeeExternalId: String(d.ASSIGNED_BY_ID ?? ''),
        customerExternalId: d.CONTACT_ID ? String(d.CONTACT_ID) : undefined,
        sourceExternalId: d.SOURCE_ID || undefined,
        pipelineExternalId: String(categoryId),
        orderCode: extractOrderCode(d.TITLE),
        // The single flag every revenue query filters on. Set from the
        // pipeline's role so a retention copy of a delivered order can never
        // reach a total, whatever else goes wrong downstream.
        countsAsRevenue: role === 'REVENUE',
        region: this.label(UF.REGION, d[UF.REGION]),
        fulfilmentPoint: this.label(UF.FULFILMENT_POINT, d[UF.FULFILMENT_POINT]),
        // Raw, NOT through label(): it is free text, and label() would return
        // undefined for every value that is not an enumeration item id.
        deliveryAddress: nonEmpty(d[UF.ADDRESS]),
        confirmStatus: confirmStatusFromLabel(this.label(UF.CONFIRM_STATUS, d[UF.CONFIRM_STATUS])),
        refusalReason: this.label(UF.REFUSAL_REASON, d[UF.REFUSAL_REASON]),
        paymentMethodRaw: this.label(UF.PAYMENT_METHOD, d[UF.PAYMENT_METHOD]),
        productLine: this.label(UF.PRODUCT_LINE, d[UF.PRODUCT_LINE]),
        customerGrade: this.label(UF.CUSTOMER_GRADE, d[UF.CUSTOMER_GRADE]),
        // Free text, so raw — `label()` resolves enumeration ids and would
        // return undefined for every one of these. Same trap as ADDRESS.
        operatorNameSource: nonEmpty(d[UF.OPERATOR_NAME]),
        operatorTeamSource: nonEmpty(d[UF.OPERATOR_TEAM]),
        isReturnCustomer: d.IS_RETURN_CUSTOMER === 'Y',
        createdAtSource: toDate(d.DATE_CREATE) ?? new Date(),
        updatedAtSource: toDate(d.DATE_MODIFY),
        /**
         * Only trust CLOSEDATE when Bitrix24 says the deal is actually closed.
         *
         * A pre-dispatch cancellation has none — the portal still thinks the
         * deal is open — so it falls back to when the deal last moved, which
         * is when someone put it in that stage. Without a date it would be
         * absent from every period-scoped loss figure while still counting in
         * the totals, and the two would never reconcile.
         */
        closedAt:
          status === 'OPEN' ? undefined : (toDate(d.CLOSEDATE) ?? toDate(d.DATE_MODIFY)),
        metadata: {
          pipelineId: categoryId,
          pipelineName: PIPELINE_NAMES[categoryId] ?? null,
          pipelineRole: role,
          stageSemantic: d.STAGE_SEMANTIC_ID ?? null,
          /**
           * The contact this deal points at, kept as the SOURCE id.
           *
           * Deals are written before their contacts exist — the deal pass is
           * what discovers which contacts are worth fetching — so `customerId`
           * is null on the first write. Keeping the source id here lets the
           * customer pass close the link with one UPDATE instead of re-reading
           * 415 591 deals from the portal a second time.
           */
          contactId: d.CONTACT_ID ? String(d.CONTACT_ID) : null,
        },
      })
    }

    this.dealsRead += rows.length
    this.progress(`  deals: ${this.dealsRead}`)

    return {
      items: deals,
      nextCursor: done ? undefined : (rows[rows.length - 1]?.ID ?? undefined),
    }
  }

  /**
   * Contacts, paged straight through.
   *
   * An earlier version fetched only the contacts an imported deal referenced,
   * which made sense when two pipelines were in scope and 15 000 of the
   * portal's 317 674 contacts mattered. Now that every pipeline is imported,
   * nearly all of them do — and filtering by 250 000 ids means either 5 000
   * sequential calls or query strings tens of kilobytes long inside a batch.
   *
   * Reading the table in order costs 127 round trips and roughly fifteen
   * minutes, and it is simpler. The deal → customer links are closed
   * afterwards by the customer handler's `finalize`, from the contact id kept
   * on each deal.
   */
  async fetchCustomers(options: FetchOptions = {}): Promise<Page<RawCustomer>> {
    const afterId = options.cursor ?? '0'

    const filter: Record<string, unknown> = {}
    if (options.updatedSince) {
      filter['>=DATE_MODIFY'] = isoLocal(options.updatedSince)
    }

    const { rows, done } = await this.batchWalk<{
      ID: string
      NAME?: string
      LAST_NAME?: string
      SECOND_NAME?: string
      PHONE?: { VALUE: string }[]
      EMAIL?: { VALUE: string }[]
      ADDRESS_CITY?: string
      DATE_MODIFY?: string
    }>(
      'crm.contact.list',
      {
        filter,
        select: ['ID', 'NAME', 'LAST_NAME', 'SECOND_NAME', 'PHONE', 'EMAIL', 'ADDRESS_CITY', 'DATE_MODIFY'],
      },
      afterId,
    )

    const customers: RawCustomer[] = rows.map((c) => ({
      externalId: String(c.ID),
      /*
        NAME and LAST_NAME only — SECOND_NAME is a scratchpad on this portal.

        The floor types birthdates, ages, a lone dot and lead-capture
        timestamps into it, so concatenating all three produced customer names
        like `ig Gulrux Xuddiyeva 2025-07-30T14:58:02.000Z`. Measured against
        the client's own board: 61 of 1 666 names, 3.7% of the column, carried
        a date or a full ISO timestamp. A patronymic is worth less than a name
        that reads as a name.
      */
      name: [c.LAST_NAME, c.NAME].filter(Boolean).join(' ').trim() || `Kontakt ${c.ID}`,
      isCompany: false,
      phone: c.PHONE?.[0]?.VALUE,
      /*
        All of them, deduplicated and blank-stripped.

        `crm.contact.list` returns PHONE as an array and a contact routinely
        has two. Taking [0] alone lost the rest silently — the queue showed one
        number and the operator had no way to know another existed.
      */
      phones: [
        ...new Set(
          (c.PHONE ?? [])
            .map((entry) => entry?.VALUE?.trim())
            .filter((value): value is string => !!value),
        ),
      ],
      email: c.EMAIL?.[0]?.VALUE,
      region: c.ADDRESS_CITY || undefined,
      updatedAtSource: toDate(c.DATE_MODIFY),
    }))

    this.customersRead += rows.length
    this.progress(`  customers: ${this.customersRead}`)

    return {
      items: customers,
      nextCursor: done ? undefined : (rows[rows.length - 1]?.ID ?? undefined),
    }
  }

  /**
   * Line items — for REVENUE pipelines only.
   *
   * `crm.deal.productrows.get` takes one deal at a time. Reading line items for
   * all 415 591 deals would take days and tell us nothing: the lead and triage
   * funnels carry no products. The 16 500 deals that produce money do.
   */
  async fetchDealItems(_o?: FetchOptions): Promise<Page<RawDealItem>> {
    if (this.itemDealIds.length === 0) return this.page([])

    const commands: Record<string, string> = {}
    for (const id of this.itemDealIds) {
      commands[`d${id}`] = `crm.deal.productrows.get?id=${id}`
    }

    const results = await this.batch<
      {
        PRODUCT_ID: string
        PRODUCT_NAME?: string
        ORIGINAL_PRODUCT_NAME?: string
        QUANTITY: string
        PRICE: string
        DISCOUNT_SUM?: string
        DISCOUNT_RATE?: string
      }[]
    >(commands, 'product rows')

    const items: RawDealItem[] = []

    for (const [key, rows] of Object.entries(results)) {
      const dealId = key.slice(1)
      for (const [index, row] of (rows ?? []).entries()) {
        if (!row?.PRODUCT_ID) continue
        const unit = toMinorUnits(row.PRICE)
        /*
          Zero is a real quantity here: a gift line, priced at nothing and
          shipped with the order. The old `Math.max(1, …)` clamp rewrote it to
          1, so our line total stopped reconciling against the deal's own
          amount — caught on deal 850490, where their board shows
          `Sedana Sinolife - 0 ta` and ours claimed one.

          Negative is still refused: that is a data error, not a giveaway.
        */
        const raw = Number(row.QUANTITY ?? 1)
        const quantity = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 1

        items.push({
          // Bitrix24 gives product rows no stable id, so one is composed from
          // the deal and the row position — stable across re-imports.
          externalId: `${dealId}-${index}`,
          dealExternalId: dealId,
          productExternalId: String(row.PRODUCT_ID),
          quantity,
          unitPriceMinor: unit,
          totalMinor: unit * BigInt(quantity),
          productName: row.PRODUCT_NAME || row.ORIGINAL_PRODUCT_NAME || undefined,
          /**
           * PER UNIT, times the quantity.
           *
           * Bitrix24 names this field DISCOUNT_SUM, which reads like a line
           * total. It is not. The portal's own arithmetic is
           * `PRICE + DISCOUNT_SUM = list price` — per unit — and the database
           * proves it: across a month, at every quantity above one, the
           * per-unit identity matches and the per-line one never does
           * (qty 2: 469 of 475 lines match per-unit, 0 per-line; qty 4: 171 of
           * 172 against 0).
           *
           * Stored per line, as the schema promises, so multiply here rather
           * than at every read. Left unmultiplied it understated the month's
           * discounts by 389 mln soʻm — a quarter of the total — and silently,
           * because a discount that is too small makes margin look better.
           */
          discountMinor: discountOf(row, unit, quantity),
          // A rate is scale-free, so this one needs no quantity. 100 means the
          // line was given away outright; those destroy margin silently unless
          // they are visible.
          discountRateBp: Math.round(Number(row.DISCOUNT_RATE ?? 0) * 100),
        })
      }
    }

    this.progress(`  deal items: ${items.length}`)
    return this.page(items)
  }

  /** Not available on this portal — verified. See mapping.ts. */
  async fetchPayments(_o?: FetchOptions): Promise<Page<RawPayment>> {
    return this.page([])
  }

  // -------------------------------------------------------------------------
  // Stage history
  // -------------------------------------------------------------------------

  /**
   * Stage transitions — the basis of every duration in the product.
   *
   * The portal holds 3.8 million of them and the endpoint returns 50 at a
   * time, so this is the longest step by far. Two things keep it tractable:
   * only the pipelines whose durations anyone measures are read, and the rows
   * come back 2 500 at a time through the batch endpoint.
   *
   * The response nests rows under `result.items`, unlike every other list
   * method — hence the unwrap.
   */
  async fetchStageHistory(options: FetchOptions = {}): Promise<Page<RawStageHistory>> {
    /*
      TWO PASSES BEHIND ONE CURSOR.

      Bitrix ANDs the members of a filter, so "these funnels, plus this one
      stage from another funnel" cannot be asked in a single call. The walk is
      therefore a pass per filter, with the pass index carried in the cursor —
      `"<pass>:<afterId>"` — so the sync handler keeps driving one paged fetch
      and knows nothing about it. A bare cursor left over from a run that
      predates the second pass reads as pass 0, which is what it was.
    */
    const { pass, afterId } = parseHistoryCursor(options.cursor)
    const passes = this.historyFilters()

    // Nothing left to walk. Reachable when `historyStages` is empty and the
    // caller hands back the cursor that ended pass 0.
    if (pass >= passes.length) return { items: [], nextCursor: undefined }

    const filter: Record<string, unknown> = { ...passes[pass] }
    if (options.updatedSince) {
      filter['>CREATED_TIME'] = isoLocal(options.updatedSince)
    }

    const { rows, done } = await this.batchWalk<{
      ID: number
      OWNER_ID: number
      STAGE_ID: string
      CREATED_TIME: string
      TYPE_ID: number
    }>(
      'crm.stagehistory.list',
      { entityTypeId: 2, filter },
      afterId,
      // Unlike every other list method, this one nests its rows under
      // `items`, so the chain reference has to reach through that key too.
      { unwrap: nestedIn('items'), refPath: '[items][49][ID]' },
    )

    const history: RawStageHistory[] = rows
      .filter((r) => r.OWNER_ID && r.STAGE_ID && r.CREATED_TIME)
      .map((r) => ({
        externalId: String(r.ID),
        dealExternalId: String(r.OWNER_ID),
        stageExternalId: r.STAGE_ID,
        enteredAt: toDate(r.CREATED_TIME) ?? new Date(),
      }))

    this.historyRead += rows.length
    this.progress(`  stage history: ${this.historyRead}`)

    /*
      A finished pass hands over to the next one rather than ending the walk.

      The ids of the two passes are unrelated, so the next pass restarts from
      zero; it is a different query over the same table, not a continuation.
    */
    if (done) {
      const next = pass + 1
      return {
        items: history,
        nextCursor: next < passes.length ? `${next}:0` : undefined,
      }
    }

    return {
      items: history,
      nextCursor: `${pass}:${String(rows[rows.length - 1]?.ID ?? '')}`,
    }
  }

  /**
   * The filters the history walk applies, in order.
   *
   * The pipelines first because they are the bulk of the rows and the ones
   * every duration module reads; the individual stages after, because they
   * exist to add a signal the pipelines do not carry.
   */
  private historyFilters(): Record<string, unknown>[] {
    const filters: Record<string, unknown>[] = [
      { CATEGORY_ID: [...this.historyPipelines] },
    ]
    if (this.historyStages.length > 0) {
      filters.push({ STAGE_ID: [...this.historyStages] })
    }
    return filters
  }

  // -------------------------------------------------------------------------
  // Telephony
  // -------------------------------------------------------------------------

  /**
   * Call records — who spoke to whom, for how long, and whether it connected.
   *
   * Read one DAY at a time, not by walking a single 283 000-row result.
   *
   * `voximplant.statistic.get` is metered: asking it for offset 20 000 of the
   * whole history earns `OPERATION_TIME_LIMIT` and the method is then blocked
   * for everyone, including the cheap calls. Measured, not guessed — the first
   * import hit it after eight batches. A day holds roughly eight hundred
   * calls, so every offset stays under a thousand and the method never gets
   * near its limit.
   *
   * Bounded to the last `callHistoryMonths` because the portal has been
   * running since 2025 and nobody asks how long a call lasted two years ago,
   * while the volume would dominate the import.
   *
   * `transcript` and `score` are not populated. The recordings are, so a call
   * quality scorer added later reads this table instead of facing a year-long
   * gap in the data.
   */
  async fetchCalls(options: FetchOptions = {}): Promise<Page<RawCall>> {
    const from = startOfUtcDay(
      options.updatedSince ?? new Date(Date.now() - this.callHistoryMonths * 30 * DAY_MS),
    )
    const days = Math.max(1, Math.ceil((Date.now() - from.getTime()) / DAY_MS))

    const [dayText, afterText] = (options.cursor ?? '0:0').split(':')
    const startDay = Number(dayText)

    // Skip empty days rather than returning an empty page for each, which the
    // sync engine would read as the end of the data.
    for (let day = startDay; day < days; day++) {
      const dayStart = new Date(from.getTime() + day * DAY_MS)
      const windowEnd = new Date(dayStart.getTime() + DAY_MS)

      /**
       * On an incremental run, start at the watermark instant — not at
       * midnight of the day it falls in.
       *
       * Day windows exist to keep offsets shallow, not to define the query.
       * Flooring to midnight made every minute-by-minute sync re-read the
       * whole day: 10 000 rows and forty seconds to find the handful of calls
       * that were actually new.
       */
      const windowStart =
        options.updatedSince && day === startDay && options.updatedSince > dayStart
          ? options.updatedSince
          : dayStart

      const afterId = day === startDay ? (afterText ?? '0') : '0'

      const { rows, done } = await this.batchWalk<{
        ID: string
        PORTAL_USER_ID?: string
        PHONE_NUMBER?: string
        CALL_TYPE?: string
        CALL_CATEGORY?: string
        CALL_DURATION?: string
        CALL_START_DATE?: string
        CALL_RECORD_URL?: string
        CALL_FAILED_CODE?: string
        CRM_ENTITY_TYPE?: string
        CRM_ENTITY_ID?: string
      }>(
        'voximplant.statistic.get',
        {
          FILTER: {
            '>=CALL_START_DATE': isoLocal(windowStart),
            '<CALL_START_DATE': isoLocal(windowEnd),
          },
        },
        afterId,
        // Telephony names its parameters in upper case and sorts through SORT
        // rather than an order map, so the walk's clauses differ here.
        { filterKey: 'FILTER', orderQuery: 'SORT=ID&ORDER=ASC' },
      )

      if (rows.length === 0) continue

      const calls: RawCall[] = rows
        .filter((r) => r.ID && r.CALL_START_DATE)
        .map((r) => ({
          externalId: String(r.ID),
          employeeExternalId: nonEmpty(r.PORTAL_USER_ID),
          customerExternalId:
            r.CRM_ENTITY_TYPE === 'CONTACT' ? nonEmpty(r.CRM_ENTITY_ID) : undefined,
          dealExternalId: r.CRM_ENTITY_TYPE === 'DEAL' ? nonEmpty(r.CRM_ENTITY_ID) : undefined,
          direction: callDirection(r.CALL_CATEGORY, r.CALL_TYPE),
          phoneNumber: r.PHONE_NUMBER || undefined,
          startedAt: toDate(r.CALL_START_DATE) ?? dayStart,
          durationSec: Number(r.CALL_DURATION ?? 0),
          // 200 is the portal's success code; anything else is a failed leg,
          // and the reason is kept so "nobody answered" reads differently
          // from "the number was wrong".
          connected: r.CALL_FAILED_CODE === '200',
          failedCode:
            r.CALL_FAILED_CODE && r.CALL_FAILED_CODE !== '200' ? r.CALL_FAILED_CODE : undefined,
          recordUrl: r.CALL_RECORD_URL || undefined,
        }))

      this.callsRead += rows.length
      this.progress(
        `  calls: ${this.callsRead} (${dayStart.toISOString().slice(0, 10)}, kun ${day + 1}/${days})`,
      )

      const lastId = rows[rows.length - 1]?.ID
      const nextCursor = !done && lastId ? `${day}:${lastId}` : day + 1 < days ? `${day + 1}:0` : undefined

      return { items: calls, nextCursor }
    }

    return this.page([])
  }

  // -------------------------------------------------------------------------
  // Warehouse
  // -------------------------------------------------------------------------

  async fetchStores(_o?: FetchOptions): Promise<Page<RawStore>> {
    const scopes = await this.detectScopes()
    if (!scopes.has('catalog')) return this.page([])

    const rows = await this.listAll<{
      id: string
      title: string
      address?: string
      active?: string
    }>(
      'catalog.store.list',
      { select: ['id', 'title', 'address', 'active'], order: { id: 'ASC' } },
      'stores',
      nestedIn('stores'),
    )

    return this.page(
      rows.map((s) => ({
        externalId: String(s.id),
        name: s.title,
        address: s.address || undefined,
        isActive: s.active !== 'N',
      })),
    )
  }

  async fetchStockLevels(_o?: FetchOptions): Promise<Page<RawStockLevel>> {
    const scopes = await this.detectScopes()
    if (!scopes.has('catalog')) return this.page([])

    /**
     * The portal defines four stores but keeps no balances in them:
     * `catalog.storeproduct.list` returns zero rows and
     * `catalog.document.list` zero documents. Inventory is simply not run in
     * Bitrix24 here.
     *
     * So this reads what is there and imports whatever it finds — today,
     * nothing. The warehouse module reports dispatch by fulfilment point,
     * which the portal DOES record on every deal, and says plainly that
     * on-hand balances are not maintained rather than drawing an empty shelf.
     */
    const rows = await this.listAll<{
      storeId: string
      productId: string
      amount?: string
      quantityReserved?: string
    }>(
      'catalog.storeproduct.list',
      { select: ['storeId', 'productId', 'amount', 'quantityReserved'] },
      'stock',
      nestedIn('storeProducts'),
    )

    return this.page(
      rows.map((r) => ({
        storeExternalId: String(r.storeId),
        productExternalId: String(r.productId),
        quantity: String(r.amount ?? '0'),
        reserved: String(r.quantityReserved ?? '0'),
      })),
    )
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

/** Midnight UTC of the day a date falls in. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Math.floor(date.getTime() / DAY_MS) * DAY_MS)
}

/**
 * A source id, or nothing.
 *
 * The empty string is the trap this closes. `('' && map.get(''))` evaluates to
 * `''`, not `undefined`, so `?? null` leaves an empty string in a foreign key
 * column and Postgres rejects the whole multi-row insert. Normalising blank to
 * undefined at the provider boundary means no downstream writer has to know.
 */
export function nonEmpty(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const text = String(value).trim()
  return text === '' ? undefined : text
}

/**
 * Split a stage-history cursor into its pass and its position.
 *
 * `"1:8842"` is pass 1, after id 8842. A bare `"8842"` predates the second
 * pass and means pass 0, so a sync interrupted by the deploy that introduced
 * this resumes where it stopped instead of walking the funnels again.
 */
function parseHistoryCursor(cursor: string | undefined): { pass: number; afterId: string } {
  if (!cursor) return { pass: 0, afterId: '0' }

  const split = cursor.indexOf(':')
  if (split < 0) return { pass: 0, afterId: cursor }

  const pass = Number.parseInt(cursor.slice(0, split), 10)
  return {
    pass: Number.isFinite(pass) && pass >= 0 ? pass : 0,
    afterId: cursor.slice(split + 1) || '0',
  }
}

/** A list method that returns a bare array. */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * A list method that nests its rows under a named key.
 *
 * `crm.stagehistory.list` uses `items`; every `catalog.*` method uses a key
 * named after the entity. Falls back to a bare array so one helper covers both
 * conventions.
 */
export function nestedIn<T>(key: string): (value: unknown) => T[] {
  return (value) => {
    if (Array.isArray(value)) return value as T[]
    const inner = (value as Record<string, unknown> | undefined)?.[key]
    return Array.isArray(inner) ? (inner as T[]) : []
  }
}

/**
 * Serialise nested params the way Bitrix24's query strings expect.
 *
 * `{ filter: { CATEGORY_ID: [6, 14] } }` becomes
 * `filter[CATEGORY_ID][0]=6&filter[CATEGORY_ID][1]=14`. Needed because batch
 * commands are query strings, not JSON bodies.
 *
 * KEYS ARE ENCODED, NOT JUST VALUES.
 * Bitrix24 puts the comparison operator inside the key: a range filter is
 * `FILTER[>=CALL_START_DATE]`. Left raw, the `>` and `<` do not survive the
 * query string, and the portal does not complain — it silently drops the
 * filter and answers with the whole table.
 *
 * That failure is invisible at a glance and expensive: a day-windowed read of
 * telephony came back with calls from the previous year, every window
 * returning the same ancient rows, so 20 750 fetched rows held 12 800 distinct
 * ones. The same bug would have made every incremental sync a full one, since
 * `>=DATE_MODIFY` and `>CREATED_TIME` are built the same way.
 *
 * Brackets stay literal — the portal's parser needs them — and everything
 * between them is percent-encoded.
 */
export function encodeParams(params: Record<string, unknown>): string {
  const parts: string[] = []

  const walk = (prefix: string, value: unknown): void => {
    if (value === null || value === undefined) return

    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v))
      return
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(`${prefix}[${encodeURIComponent(k)}]`, v)
      }
      return
    }
    parts.push(`${prefix}=${encodeURIComponent(String(value))}`)
  }

  for (const [key, value] of Object.entries(params)) walk(encodeURIComponent(key), value)
  return parts.join('&')
}

/**
 * Bitrix24 filters compare against portal-local time, not UTC.
 *
 * An ISO string ending in `Z` is accepted but interpreted in the portal's
 * timezone, which would silently shift every incremental watermark by the
 * offset. Formatting with the offset spelled out removes the ambiguity.
 */
export function isoLocal(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, '+00:00')
}

/**
 * Strip anything token-shaped from an error before it is logged.
 *
 * The webhook URL carries the access token in its path, so any error carrying
 * a URL is a credential leak waiting to happen.
 */
/**
 * The socket-level reason under a failed `fetch`, as « [CODE]», or nothing.
 *
 * Node's fetch reports every network failure as the same «fetch failed» and
 * keeps the reason — `UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET`, `ENOTFOUND` — on
 * `error.cause.code`. `redact` reads only the message, so without this the
 * sync log could not tell a portal that drops our address from a DNS fault.
 * Only an uppercase token is taken, so nothing arbitrary reaches the log.
 */
export function networkCause(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? (error as { name?: unknown }).name : undefined
  if (name === 'AbortError' || name === 'TimeoutError') return ' [TIMEOUT]'
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined
  const code =
    cause && typeof cause === 'object' && 'code' in cause ? (cause as { code?: unknown }).code : undefined
  return typeof code === 'string' && /^[A-Z_]{3,40}$/.test(code) ? ` [${code}]` : ''
}

export function redact(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/https:\/\/[^\s/]+\/rest\/\d+\/[^\s/]+/gi, 'https://<portal>/rest/<redacted>')
    .replace(/\b[a-z0-9]{20,}\b/gi, '<redacted>')
}

/**
 * A line's discount, per line, with the impossible rows rejected.
 *
 * QUANTITY: Bitrix24's DISCOUNT_SUM is per UNIT despite the name — the
 * portal's own arithmetic is `PRICE + DISCOUNT_SUM = list price`, and the
 * database confirms it at every quantity above one.
 *
 * THE REJECTED ROWS: 33 lines carry `DISCOUNT_SUM = -PRICE` with
 * `DISCOUNT_RATE = 0`. Read literally that says the catalogue price was
 * exactly zero and the customer was charged a markup of the entire sale — a
 * rate of zero and an amount of everything cannot both be true. They are a
 * parse artefact worth 22.6 mln soʻm of phantom markup, and reporting them as
 * "sold above list" would be inventing a fact. Zero is the honest value: no
 * discount is recorded for these lines, because none was.
 */
function discountOf(
  row: { DISCOUNT_SUM?: string; DISCOUNT_RATE?: string },
  unitPriceMinor: bigint,
  quantity: number,
): bigint {
  const perUnit = toMinorUnits(row.DISCOUNT_SUM)
  const rateBp = Math.round(Number(row.DISCOUNT_RATE ?? 0) * 100)

  if (rateBp === 0 && perUnit === -unitPriceMinor && perUnit !== 0n) return 0n

  return perUnit * BigInt(quantity)
}

/**
 * The worst basket reading among a batch's sub-commands.
 *
 * `result.result_time` is one `time` block per command, and a chained walk's
 * fifty commands all spend ONE method's basket — so the highest reading is the
 * state that method is actually in, and the one the portal will refuse on. The
 * lowest would be the reading from before this batch ran.
 */
function subcommandTime(result: unknown): PortalTime | undefined {
  if (!result || typeof result !== 'object') return undefined
  const times = (result as { result_time?: unknown }).result_time
  if (!times || typeof times !== 'object') return undefined

  let worst: PortalTime | undefined
  for (const value of Object.values(times as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const time = value as PortalTime
    if (typeof time.operating !== 'number') continue
    if (!worst || time.operating > (worst.operating ?? 0)) worst = time
  }
  return worst
}

