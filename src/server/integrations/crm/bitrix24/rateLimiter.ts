/**
 * Token-bucket rate limiter.
 *
 * Bitrix24 throttles per portal, and exceeding the limit gets the whole portal
 * temporarily blocked — which would affect the customer's actual CRM users, not
 * just our sync. Staying under the limit is therefore our responsibility, and
 * this is the only place in the codebase allowed to decide when a request may
 * leave.
 *
 * Deliberately confined to the Bitrix24 directory: no other layer knows or
 * cares that the upstream is rate limited.
 */
export class RateLimiter {
  private tokens: number
  private lastRefillMs: number
  private readonly queue: (() => void)[] = []
  private draining = false

  /**
   * @param ratePerSecond Sustained request rate.
   * @param burst Bucket capacity. Defaults to one second's worth.
   * @param now Injected clock, for deterministic tests.
   */
  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number = Math.max(1, Math.ceil(ratePerSecond)),
    private readonly now: () => number = () => Date.now(),
  ) {
    if (ratePerSecond <= 0) {
      throw new RangeError(`RateLimiter: ratePerSecond must be positive, got ${ratePerSecond}`)
    }
    this.tokens = this.burst
    this.lastRefillMs = this.now()
  }

  private refill(): void {
    const nowMs = this.now()
    const elapsedSeconds = (nowMs - this.lastRefillMs) / 1000
    if (elapsedSeconds <= 0) return

    this.tokens = Math.min(this.burst, this.tokens + elapsedSeconds * this.ratePerSecond)
    this.lastRefillMs = nowMs
  }

  /** Milliseconds until at least one token is available. */
  private delayUntilToken(): number {
    this.refill()
    if (this.tokens >= 1) return 0
    return Math.ceil(((1 - this.tokens) / this.ratePerSecond) * 1000)
  }

  /** Resolves once a token has been consumed. Requests are served in order. */
  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
      void this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true

    try {
      while (this.queue.length > 0) {
        const wait = this.delayUntilToken()
        if (wait > 0) {
          await sleep(wait)
          continue
        }
        this.tokens -= 1
        this.queue.shift()!()
      }
    } finally {
      this.draining = false
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Exponential backoff with full jitter.
 *
 * Jitter matters: without it, several sync workers that fail together would
 * retry in lockstep and hammer the portal at exactly the same moments.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs = 500,
  maxMs = 30_000,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** attempt)
  return Math.floor(random() * exponential)
}
