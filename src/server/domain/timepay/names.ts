/**
 * Which ISH employee a TimePay person is, by name — «Otsenka ROP app»'s
 * `integrations/timepay/names.ts`, restated (same keys, so both apps link
 * the same people).
 *
 * The portal writes «Davlatbek Sirojov 115» (the extension number in the
 * name); TimePay may write «Sirojov Davlatbek Xolmirzayevich», in either
 * script. The key is first name + surname, script- and order-independent;
 * patronymics and numbers are dropped. Bitrix24 holds no staff phone numbers
 * (checked 2026-11-05), so a name is all there is to link on.
 */

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
  к: 'k', қ: 'q', л: 'l', м: 'm', н: 'n', о: 'o', ў: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'x', ҳ: 'h', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/**
 * Patronymic endings (Uzbek and Russian forms) — never part of the key.
 * «zoda» is NOT one here (Otsenka's list has it): it threw away the given
 * name «Ozoda» and leaves only surnames like «Rahimzoda», which are names.
 */
const PATRONYMIC = /(ovich|evich|ovna|evna|ogli|ugli|qizi|kizi)$/

/** Words that say what a person is, not who — «Madina Shodiyeva (stajor) 177». */
const NOT_A_NAME = new Set(['stajor', 'stajyor', 'rop'])

export function normalizeName(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[а-яёўқғҳ]/g, (c) => CYR[c] ?? c)
    .replace(/[`'ʻʼ‘’"]/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !PATRONYMIC.test(w) && !NOT_A_NAME.has(w))
}

/**
 * One spelling per sound, for the exact key only: «Abdullayeva» / «Abdullaeva»,
 * «Kholmirzaev» / «Xolmirzaev», «Djuraev» / «Juraev». Not fuzzy matching — two
 * names still have to be identical after it.
 */
export function canonicalSpelling(word: string): string {
  return word.replace(/kh/g, 'x').replace(/dj/g, 'j').replace(/ye/g, 'e')
}

/** «davlatbek|sirojov» — the first two name words, sorted. Empty when unusable. */
export function nameKey(full: string): string {
  const w = normalizeName(full).slice(0, 2).map(canonicalSpelling)
  return w.length === 2 ? w.sort().join('|') : ''
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = d[j]!
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return d[b.length]!
}

function tokenSim(a: string, b: string): number {
  if (a === b) return 1
  // «Davlat» / «Davlatbek»: a short form of the same name.
  if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.9
  return 1 - lev(a, b) / Math.max(a.length, b.length)
}

/**
 * 0…1: how likely two spellings are the same person. Only a SUGGESTION for
 * the administrator's link list — never a link by itself.
 */
export function nameSimilarity(x: string, y: string): number {
  const a = normalizeName(x).slice(0, 2).map(canonicalSpelling)
  const b = normalizeName(y).slice(0, 2).map(canonicalSpelling)
  if (a.length < 2 || b.length < 2) return 0
  const straight = (tokenSim(a[0]!, b[0]!) + tokenSim(a[1]!, b[1]!)) / 2
  const crossed = (tokenSim(a[0]!, b[1]!) + tokenSim(a[1]!, b[0]!)) / 2
  return Math.max(straight, crossed)
}

/**
 * The links an exact key settles: a TimePay person and an employee whose
 * keys are equal, and each the ONLY one with that key on their side — two
 * «Madina Hamroyeva» on either side link nobody (the administrator does).
 */
export function exactNameLinks(
  people: readonly { readonly timepayId: number; readonly fullName: string }[],
  employees: readonly { readonly id: string; readonly fullName: string }[],
): Map<number, string> {
  const byKey = <T>(rows: readonly T[], name: (row: T) => string) => {
    const out = new Map<string, T[]>()
    for (const row of rows) {
      const key = nameKey(name(row))
      if (key === '') continue
      const list = out.get(key)
      if (list) list.push(row)
      else out.set(key, [row])
    }
    return out
  }
  const emp = byKey(employees, (e) => e.fullName)
  const tp = byKey(people, (p) => p.fullName)
  const out = new Map<number, string>()
  for (const [key, list] of tp) {
    const match = emp.get(key)
    if (list.length === 1 && match?.length === 1) out.set(list[0]!.timepayId, match[0]!.id)
  }
  return out
}
