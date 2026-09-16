import { classifyRefusal, refusalCode, type RefusalClass } from './refusal'

/**
 * A door that shuts on the FIRST refusal and is opened again only by a probe.
 *
 * WHY THIS EXISTS, MEASURED. `SyncEngine.runAll` walks its entities in a loop
 * with no circuit breaker anywhere beneath it, so a portal that has already
 * said «no» is asked again by every remaining entity in the same tick. On
 * 2026-09-15, under a 401 `OVERLOAD_LIMIT`, a hot tick sent 3 requests of which
 * 2 left AFTER the refusal, a reference tick sent 12 of which 11 did, and a
 * restart inside the block sent 11 more because tick 0 is always a reference
 * tick. Over the four-hour block that is ~107 requests fired into a door that
 * was already closed — at exactly the moment the portal is complaining about
 * load.
 *
 * The worker already had a `throttled` flag, and it could not help: it is
 * computed from the RESULTS of `runAll`, so it can only shorten the NEXT tick,
 * never the tick it is computed from. This gate sits one layer lower — inside
 * `call()`, before the rate limiter — so it covers every caller: the engine,
 * the deletion sweep, `scripts/import.ts`, a hand-run resync.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never makes the portal answer sooner. An
 * `OVERLOAD_LIMIT` is an administrative block that Bitrix24 documents as manual
 * and not self-lifting; nothing here can shorten it. What it does is stop us
 * spending requests on a closed door, and — through the probe ladder — notice
 * the moment it opens, which the old flat ten-minute wait could not do faster
 * than ten minutes.
 *
 * In-process and deliberately so. It holds no lock and writes no table: two
 * workers never run at once (a Postgres advisory lock sees to that), and the
 * cost of a cold start is one refused request, which `seed()` removes by
 * reading what the last worker already wrote to `sync_log`.
 */

/** Why a call was refused locally, for the error the provider throws. */
export interface GateHold {
  readonly kind: RefusalClass
  readonly code: string
  readonly since: Date
  readonly message: string
}

export interface GateState {
  readonly open: boolean
  readonly kind: RefusalClass | null
  readonly code: string | null
  readonly since: Date | null
  readonly probeAt: Date | null
  readonly probes: number
}

/**
 * How long to wait before probing again, per consecutive probe.
 *
 * A throttle clears on the portal's clock and we cannot see that clock, so the
 * ladder starts impatient and ends resigned: a block that lifts in the first
 * minute costs us one minute of staleness, and one that lasts four hours costs
 * 26 probes instead of the ~72 requests the old loop spent on full ticks. The
 * 600 s cap IS the old `THROTTLED_WAIT_MS` from `scripts/syncWorker.ts`, moved
 * here rather than deleted: the 2026-09-14 incident put a flat ten minutes
 * there because a portal refusing the whole REST surface is not our error to
 * retry out of, and that bound still holds. What the flat wait could not do is
 * notice a block that lifted after ninety seconds — recovery always cost the
 * full ten minutes — which is what the rungs below the cap are for.
 */
const THROTTLE_LADDER_MS = [60_000, 120_000, 240_000, 480_000, 600_000]

/**
 * A revoked credential probes on a flat five minutes, and the flatness is the
 * point: it will not clear on its own, so backing off further would only delay
 * the moment we notice that somebody has finally issued a new webhook. Five
 * minutes over a working day is 288 requests — the price of recovering without
 * anybody having to restart the worker.
 */
const CREDENTIAL_PROBE_MS = 300_000

/**
 * A method that spent its operating budget is held for ten minutes, the window
 * Bitrix24 accumulates operating time over. This is NOT the whole portal: every
 * other method stays admissible, which is the difference between «the deals
 * pass is resting» and «the dashboard is dark».
 */
const METHOD_HOLD_MS = 600_000

/** Consecutive transient failures before the door shuts. */
const TRANSIENT_TOLERANCE = 3
const TRANSIENT_PROBE_MS = 60_000

export class PortalGate {
  private kind: RefusalClass | null = null
  private code: string | null = null
  private since: Date | null = null
  private probeAt: Date | null = null
  private probes = 0
  private transientRun = 0
  private readonly methodHolds = new Map<string, Date>()

  /**
   * Whether this call may leave, and why not.
   *
   * Returns `null` to admit the call. Anything else is a refusal the provider
   * turns into a thrown `Bitrix24Error` WITHOUT touching the network — which is
   * the entire saving.
   */
  hold(method: string, now: Date): GateHold | null {
    const methodUntil = this.methodHolds.get(method)
    if (methodUntil) {
      if (now < methodUntil) {
        return {
          kind: 'METHOD',
          code: 'OPERATION_TIME_LIMIT',
          since: methodUntil,
          message:
            `Bitrix24 gate: OPERATION_TIME_LIMIT holds "${method}"` +
            ` until ${methodUntil.toISOString()} — not sent`,
        }
      }
      this.methodHolds.delete(method)
    }

    if (this.kind === null || this.since === null) return null

    return {
      kind: this.kind,
      code: this.code ?? 'UNKNOWN',
      since: this.since,
      message:
        `Bitrix24 gate: ${this.code ?? 'UNKNOWN'} since ${this.since.toISOString()}` +
        ` — "${method}" not sent`,
    }
  }

  /**
   * Record a refusal the portal actually sent.
   *
   * `null` from `classifyRefusal` is a per-record fact, not a refusal, and must
   * not shut the door — `batchWalk` ends every completed walk on an
   * `INVALID_ARG_VALUE`, so treating that as a refusal would open the gate on
   * every successful sync.
   */
  trip(error: unknown, now: Date): RefusalClass | null {
    const kind = classifyRefusal(error)
    if (kind === null) return null

    const code = refusalCode(error) ?? 'UNKNOWN'

    /*
      ANY REFUSAL THE PORTAL NAMED ENDS THE TRANSIENT RUN.

      `transientRun` counts CONSECUTIVE nameless failures — a socket, a DNS
      miss, an abort. A code in the body is proof the portal is talking to us,
      and that includes `OPERATION_TIME_LIMIT`, which is why this sits above the
      METHOD branch rather than below it. Without the reset the only thing that
      ever cleared the count was a SUCCESS, so three network errors at startup
      armed a hair trigger that then survived the whole outage — see the
      TRANSIENT branch below for what it did to the ladder.
    */
    if (kind !== 'TRANSIENT') this.transientRun = 0

    if (kind === 'METHOD') {
      const method = methodOf(error)
      if (method) this.methodHolds.set(method, new Date(now.getTime() + METHOD_HOLD_MS))
      return kind
    }

    if (kind === 'TRANSIENT') {
      /*
        A SOCKET ERROR MAY NOT DEMOTE A GATE THAT ALREADY NAMES ITS REFUSAL.

        Measured on production 2026-09-16, under a live `OVERLOAD_LIMIT`: the
        printed wait stayed at 60 s across every probe instead of climbing
        60 → 120 → 240 → 480 → 600. Two things combined to do that. The startup
        health check failed at network level three times, which left
        `transientRun` at the tolerance FOREVER — it is only ever reset by a
        success, and there are none during a block — so every later transient
        went straight to `openGate`. And `openGate` rewrites `kind`, so a single
        stray socket error turned a THROTTLE gate into a TRANSIENT one, whose
        probe delay is a flat 60 s and whose `probes` counter starts again at
        zero. The next `OVERLOAD_LIMIT` then saw a kind MISMATCH and opened at
        rung zero. Round and round, at ~860 probes a day against a portal that
        had administratively blocked us — while the support ticket opened after
        2026-09-14 promises in writing that we back off when refused.

        THROTTLE and CREDENTIAL are specific diagnoses; TRANSIENT is the absence
        of one. The specific one wins, and holding the ladder is the whole point.
      */
      if (this.kind === 'THROTTLE' || this.kind === 'CREDENTIAL') return kind

      this.transientRun += 1
      if (this.transientRun < TRANSIENT_TOLERANCE) return kind
      this.openGate(kind, code, now, TRANSIENT_PROBE_MS)
      return kind
    }

    // THROTTLE and CREDENTIAL both close the whole portal to us. Re-tripping an
    // already-open gate must not reset `since` — the dashboard shows that
    // timestamp as «failing since», and an outage that restarts its own clock
    // every probe would always read as seconds old.
    if (this.kind === kind) {
      this.scheduleProbe(now)
      return kind
    }

    this.openGate(kind, code, now, this.probeDelayMs(kind, 0))
    return kind
  }

  /** A call got through. Whatever we were waiting out is over. */
  noteSuccess(method: string, now: Date): void {
    this.methodHolds.delete(method)
    this.transientRun = 0
    if (this.kind === null) return

    this.kind = null
    this.code = null
    this.since = null
    this.probeAt = null
    this.probes = 0
    void now
  }

  /**
   * Start already-closed, from what the previous worker wrote to `sync_log`.
   *
   * A restart during a block used to cost 11 requests re-discovering a block the
   * database already knew about, ~17 times a day at the measured restart rate.
   */
  seed(kind: RefusalClass, code: string, since: Date, now: Date): void {
    if (kind !== 'THROTTLE' && kind !== 'CREDENTIAL') return
    this.kind = kind
    this.code = code
    this.since = since
    this.probes = 0
    this.probeAt = new Date(now.getTime() + this.probeDelayMs(kind, 0))
  }

  isOpen(): boolean {
    return this.kind !== null
  }

  dueForProbe(now: Date): boolean {
    if (this.kind === null || this.probeAt === null) return false
    return now >= this.probeAt
  }

  /** Called when a probe leaves, so a failed probe backs the ladder off. */
  noteProbe(now: Date): void {
    if (this.kind === null) return
    this.probes += 1
    this.scheduleProbe(now)
  }

  /** How long the worker should sleep before there is any point asking again. */
  nextWaitMs(now: Date): number {
    if (this.kind === null || this.probeAt === null) return 0
    return Math.max(0, this.probeAt.getTime() - now.getTime())
  }

  state(): GateState {
    return {
      open: this.kind !== null,
      kind: this.kind,
      code: this.code,
      since: this.since,
      probeAt: this.probeAt,
      probes: this.probes,
    }
  }

  private openGate(kind: RefusalClass, code: string, now: Date, delayMs: number): void {
    this.kind = kind
    this.code = code
    this.since = now
    this.probes = 0
    this.probeAt = new Date(now.getTime() + delayMs)
  }

  private scheduleProbe(now: Date): void {
    if (this.kind === null) return
    this.probeAt = new Date(now.getTime() + this.probeDelayMs(this.kind, this.probes))
  }

  private probeDelayMs(kind: RefusalClass, probes: number): number {
    if (kind === 'CREDENTIAL') return CREDENTIAL_PROBE_MS
    if (kind === 'TRANSIENT') return TRANSIENT_PROBE_MS
    const index = Math.min(probes, THROTTLE_LADDER_MS.length - 1)
    return THROTTLE_LADDER_MS[index]!
  }
}

/** The method name the provider stamped on the error, for per-method holds. */
function methodOf(error: unknown): string | null {
  if (error && typeof error === 'object' && 'method' in error) {
    const method = (error as { method?: unknown }).method
    if (typeof method === 'string' && method.length > 0) return method
  }
  return null
}
