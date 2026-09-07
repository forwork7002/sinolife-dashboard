/**
 * The floor number an operator's name carries, and what it is for.
 *
 * Every seller on this portal is badged with a two-to-four digit number —
 * «Davlatbek Sirojov 115», «Bonu Umidovna 117». It is not a Bitrix id (those
 * two are 6886 and 6890); it is the number the floor, the client's dashboards
 * and the client's bonus rules all use to mean one person.
 *
 * IT IS THE ONLY STABLE JOIN BETWEEN THREE SPELLINGS OF THE SAME PERSON.
 * Bitrix keeps the badge on LAST_NAME, so `user.get` reads «Davlatbek Sirojov
 * 115»; this application composes `fullName` the other way round and stores
 * «Sirojov 115 Davlatbek»; and the portal's own operator snapshot field spells
 * it «Davlatbek Sirojov 115» again. Measured over all 289 production employees
 * on 2026-09-04: 90 names carry the number first, 16 last, 237 somewhere, and
 * 50 have none at all. Anything that anchors at one end matches a sixth of the
 * roster.
 *
 * EXACTLY ONE standalone token, or nothing — the same rule
 * `marketingService.employeeCode()` uses to pair these people against the
 * Roistat sheet, proven there against a 24 541-row import. Two numbers in one
 * name is an ambiguity, not a match; no production row has two today.
 */

/** The badge, or null when the name does not carry exactly one. */
export function floorNumberOf(fullName: string): number | null {
  const digits = fullName
    // Separators are not always spaces — «130-Salomat Shoimova» is a real row.
    .replace(/[^0-9\p{L}]+/gu, ' ')
    .split(' ')
    .filter((token) => /^\d{2,4}$/.test(token))

  if (digits.length !== 1) return null
  const value = Number.parseInt(digits[0]!, 10)
  return Number.isFinite(value) ? value : null
}

/**
 * Index people by their badge, keeping only the unambiguous ones.
 *
 * Two employees sharing a number is not a match, it is a collision, and
 * resolving it either way would silently move somebody's sales. Measured on
 * production: of 127 badges in the client's naming space, 123 resolve to
 * exactly one active employee, 1 collides and 3 name nobody.
 */
export function indexByFloorNumber<T>(
  people: readonly T[],
  of: (person: T) => { readonly id: string; readonly fullName: string },
): Map<number, string> {
  const buckets = new Map<number, string[]>()
  for (const person of people) {
    const { id, fullName } = of(person)
    const badge = floorNumberOf(fullName)
    if (badge === null) continue
    const bucket = buckets.get(badge)
    if (bucket) bucket.push(id)
    else buckets.set(badge, [id])
  }

  const unique = new Map<number, string>()
  for (const [badge, ids] of buckets) {
    if (ids.length === 1) unique.set(badge, ids[0]!)
  }
  return unique
}
