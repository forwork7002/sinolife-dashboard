/**
 * One build per question, however many people are asking it.
 *
 * WHY THIS EXISTS AS A MODULE. The command centre grew this by hand and its
 * comment records the failure that forced it: that screen is where every login
 * lands, so its readers arrive together, and six of them inside a minute put
 * ninety-six queries into a queue eight connections wide — the tail waited past
 * the connect timeout and the page 500'd. The same shape is everywhere in this
 * application. `/meta/alerts` runs an all-time confirmation cohort on every
 * screen once a minute; the sellers board builds that cohort twice per request
 * and is company-wide by construction; the cohorts endpoint scans the whole
 * deal history and takes no period at all. Each of them is identical for every
 * reader, and each was being recomputed per request against one vCPU.
 *
 * WHAT THIS IS NOT. It is not a cache in front of the database — it is a memo
 * in front of ONE ANSWER, keyed by the whole question. That distinction is the
 * safety property: a key that omits an argument does not serve a slightly
 * stale answer, it serves the WRONG one. Two rules follow, and both have cost
 * this codebase a real bug:
 *
 *   * THE PRESET IS PART OF THE QUESTION. On a Monday «Bugun» and «Shu hafta»
 *     resolve to the identical window and still demand different comparisons —
 *     keyed on the window alone they shared an entry and served each other's
 *     "oʻtgan davrda" line. `commandCentreCacheKey.ts` carries the full story
 *     and the measured numbers (78 where 103 was right, and the reverse).
 *   * A SCOPED ANSWER MAY NOT BE MEMOISED HERE AT ALL. Every key this module
 *     is given is written by hand, and a caller that forgets to put the
 *     principal's scope in one turns a cache into a disclosure. So the rule is
 *     stronger than "remember the scope": only memoise answers that carry NO
 *     scope — company-wide by construction, like the confirmation queue and
 *     the sellers board, whose routes pass `ctx.query` and never `ctx.scope`.
 *     If a screen ever becomes scoped, its memo has to be deleted in the same
 *     commit, not extended.
 *
 * THE PROMISE IS WHAT IS STORED, not the resolved value. Readers arriving
 * together is the case that actually breaks the pool, and it is precisely the
 * case a value cache cannot help with: all of them miss, and all of their
 * queries go out anyway. Storing the in-flight promise collapses them into one.
 *
 * A REJECTION IS NEVER CACHED. Caching a timeout would turn one bad second
 * into a whole TTL of them, which is the opposite of the point.
 */

interface Entry<T> {
  readonly at: number
  readonly value: Promise<T>
}

export interface TtlCache<T> {
  /** Resolve `key`, building with `build` on a miss or an expired entry. */
  get(key: string, build: () => Promise<T>): Promise<T>
  /** Drop everything. For tests, and for a caller that knows it invalidated. */
  clear(): void
  /** How many live entries are held. For tests. */
  size(): number
}

/**
 * @param ttlMs How long an answer stays good.
 *
 *   Match it to the cadence of the data behind it, not to how fresh you wish
 *   the screen were. Everything on this dashboard moves when the sync worker
 *   ticks, once a minute, so 60_000 is the honest default for anything reading
 *   deals — a shorter TTL buys no freshness at all and only adds misses. Where
 *   a screen's own client polls on a fixed interval, a TTL BELOW that interval
 *   is worse than useless: a solo reader misses every single time.
 */
export function ttlCache<T>(ttlMs: number): TtlCache<T> {
  const entries = new Map<string, Entry<T>>()

  return {
    get(key, build) {
      const now = Date.now()

      const hit = entries.get(key)
      if (hit && now - hit.at < ttlMs) return hit.value

      /*
        Swept by age rather than by count.

        The keys here are questions — a handful of periods and filter
        combinations in play at any moment — and they age out on their own. The
        sweep is what stops a month of custom ranges accumulating in a process
        that runs for weeks between deploys.
      */
      for (const [k, entry] of entries) {
        if (now - entry.at >= ttlMs) entries.delete(k)
      }

      const value = build()
      entries.set(key, { at: now, value })
      value.catch(() => {
        // Only if it is still OURS. A later build may already have replaced
        // this entry, and deleting that one would evict a good answer.
        if (entries.get(key)?.value === value) entries.delete(key)
      })

      return value
    },

    clear() {
      entries.clear()
    },

    size() {
      return entries.size
    },
  }
}

/**
 * A stable string for a list that reaches a query as a filter.
 *
 * Sorted, because two callers passing the same ids in a different order are
 * asking the same question and must share an entry. `undefined` and `[]` are
 * deliberately DIFFERENT strings: across this codebase an empty array means
 * "no filter" and widens to the whole company, so collapsing the two here
 * would let a narrowed question read a wide answer.
 */
export function keyPart(value: readonly string[] | string | null | undefined): string {
  if (value === undefined) return '~'
  if (value === null) return '-'
  if (typeof value === 'string') return value
  return `[${[...value].sort().join(',')}]`
}
