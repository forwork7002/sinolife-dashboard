/**
 * Deterministic pseudo-random number generator.
 *
 * The demo dataset must be reproducible: the same seed has to produce the same
 * employees, the same deals and the same revenue on every machine and every
 * run. `Math.random()` cannot do that, so mulberry32 is used instead — a small,
 * fast, well-distributed 32-bit generator with no external dependency.
 *
 * This is emphatically NOT for anything security-related. Session tokens,
 * password salts and the auth secret come from `crypto`, never from here.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    if (!Number.isInteger(seed)) {
      throw new TypeError(`Rng seed must be an integer, got ${seed}`)
    }
    // Force to uint32. A zero state is fine for mulberry32.
    this.state = seed >>> 0
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }

  /** Integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number {
    if (min > max) throw new RangeError(`Rng.int: min ${min} exceeds max ${max}`)
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** True with the given probability. */
  bool(probability = 0.5): boolean {
    return this.next() < probability
  }

  /** Uniform choice. Throws on an empty collection rather than returning undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: empty collection')
    return items[Math.floor(this.next() * items.length)]!
  }

  /**
   * Weighted choice. Weights need not sum to 1; they are normalised.
   * Used to make the demo data lopsided in the way real sales data is —
   * a few strong performers, a long tail, most deals from two channels.
   */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    if (entries.length === 0) throw new RangeError('Rng.weighted: empty collection')

    let total = 0
    for (const [, weight] of entries) {
      if (weight < 0) throw new RangeError('Rng.weighted: negative weight')
      total += weight
    }
    if (total <= 0) throw new RangeError('Rng.weighted: weights sum to zero')

    let roll = this.next() * total
    for (const [value, weight] of entries) {
      roll -= weight
      if (roll < 0) return value
    }
    // Floating point can leave a sliver at the top of the range.
    return entries[entries.length - 1]![0]
  }

  /** Fisher-Yates on a copy; the input is left untouched. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
    }
    return copy
  }

  /**
   * Approximately standard normal, via the Irwin-Hall central limit trick.
   *
   * Summing 12 uniforms gives mean 6 and variance 1, so subtracting 6 yields a
   * unit normal directly — no square roots, and no Box-Muller log/cos pair.
   * Values beyond about ±6 sigma cannot occur, which is a feature here: it
   * keeps generated deal sizes inside a plausible range.
   */
  private standardNormal(): number {
    let sum = 0
    for (let i = 0; i < 12; i++) sum += this.next()
    return sum - 6
  }

  /**
   * Roughly normal integer, clamped to [min, max].
   *
   * Deal sizes cluster around a typical value rather than spreading evenly, so
   * a uniform distribution would make the demo data look obviously synthetic.
   */
  normalInt(mean: number, stdDev: number, min: number, max: number): number {
    if (min > max) throw new RangeError(`Rng.normalInt: min ${min} exceeds max ${max}`)
    const value = Math.round(mean + this.standardNormal() * stdDev)
    return Math.min(max, Math.max(min, value))
  }
}
