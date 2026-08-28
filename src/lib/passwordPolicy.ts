/**
 * What counts as a strong enough password here.
 *
 * This dashboard holds the company's whole commercial position — every deal,
 * every customer's phone number, every seller's performance, a year of
 * revenue. One reused password on one account exposes all of it at once, so
 * the floor is deliberately higher than the eight characters better-auth
 * defaults to.
 *
 * The rules, and why each one is here rather than being a checklist item:
 *
 * - **Twelve characters minimum.** Length is the only property that scales
 *   against offline guessing; eight characters of anything is inside the reach
 *   of a rented GPU for an afternoon.
 * - **Three of four character classes.** Requiring all four is what produces
 *   `Parol123!` — the class rules satisfied and the password still guessable.
 *   Three of four leaves room for a long passphrase (`bugungi savdo yaxshi
 *   ketdi` is four words, lowercase, and far stronger than the example above)
 *   while still refusing a bare dictionary word.
 * - **No banned string.** A short list of what people actually type here:
 *   the product name, the portal's name, the year, `parol`, `password`,
 *   keyboard walks. A password that CONTAINS one of these as its backbone is
 *   the first thing any attacker who knows the company will try.
 * - **No long run of one character, no straight keyboard run.** `aaaaaaaaaaaa`
 *   is twelve characters and one guess.
 * - **Not the email, not the name.** Both are known to anyone who has seen a
 *   single email from this company.
 *
 * Everything here is checked on the SERVER. A client-side meter is a courtesy
 * that tells the user what is wrong before they submit; it is never the
 * boundary, because the boundary has to hold for a request that never went
 * near the form.
 *
 * WHY THIS LIVES IN `lib/` RATHER THAN `server/auth/`. Both sides need it —
 * better-auth's hook to enforce it, the account form to explain it — and the
 * repo forbids client code from importing `@/server/*` because those modules
 * carry the database URL and the portal token. This file carries neither: it
 * is pure string arithmetic with no imports at all, so one copy can serve both
 * and the rules cannot drift apart into two versions that disagree.
 */

/** The house minimum. Also enforced by better-auth's own `minPasswordLength`. */
export const MIN_PASSWORD_LENGTH = 12

/** better-auth's own ceiling; stated here so the two cannot drift apart. */
export const MAX_PASSWORD_LENGTH = 128

/** How many of {lower, upper, digit, symbol} a password must use. */
export const REQUIRED_CHARACTER_CLASSES = 3

/**
 * Strings a password may not be built around.
 *
 * Lowercase, compared against the lowercased password. Kept short on purpose:
 * a long generic list mostly rejects passwords nobody would choose, while
 * these are the ones this company's people actually reach for.
 */
const BANNED_FRAGMENTS: readonly string[] = [
  'sinolife',
  'zextra',
  'collagen',
  'bitrix',
  'dashboard',
  'password',
  'parol',
  'admin',
  'qwerty',
  'asdfgh',
  'zxcvbn',
  '123456',
  '111111',
  '000000',
  'iloveyou',
  'welcome',
  'letmein',
  'navoiy',
  'toshkent',
  'tashkent',
]

/** Keyboard rows, used to catch straight runs like `qwertyuiop`. */
const KEYBOARD_ROWS: readonly string[] = [
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '1234567890',
]

/** The longest run of a single repeated character a password may contain. */
const MAX_REPEAT_RUN = 3

/** The longest straight keyboard or alphabet run a password may contain. */
const MAX_SEQUENCE_RUN = 4

export interface PasswordCheck {
  readonly ok: boolean
  /** Every failed rule, in the order a person would fix them. Uzbek, user-facing. */
  readonly problems: readonly string[]
}

/**
 * Check a password against the policy.
 *
 * Returns EVERY problem rather than the first, because a form that reveals one
 * rule at a time turns a single decision into five round trips.
 *
 * `identity` carries the values a password must not simply restate — the
 * account's email and name. Both are optional: the rule is skipped rather than
 * guessed when the caller does not have them.
 */
export function checkPassword(
  password: string,
  identity: { readonly email?: string | null; readonly name?: string | null } = {},
): PasswordCheck {
  const problems: string[] = []
  const lower = password.toLowerCase()

  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Kamida ${MIN_PASSWORD_LENGTH} ta belgi boʻlsin.`)
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    problems.push(`Koʻpi bilan ${MAX_PASSWORD_LENGTH} ta belgi.`)
  }

  const classes =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    // Anything that is not a letter or a digit counts as a symbol, including
    // a space — a passphrase should not be punished for using them.
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0)

  if (classes < REQUIRED_CHARACTER_CLASSES) {
    problems.push(
      'Kichik harf, bosh harf, raqam va belgidan kamida uch xilini ishlating.',
    )
  }

  const banned = BANNED_FRAGMENTS.find((fragment) => lower.includes(fragment))
  if (banned) {
    problems.push(`“${banned}” kabi taxmin qilinadigan soʻzni ishlatmang.`)
  }

  if (hasRepeatRun(password, MAX_REPEAT_RUN)) {
    problems.push('Bir belgini ketma-ket koʻp marta takrorlamang.')
  }

  if (hasSequenceRun(lower, MAX_SEQUENCE_RUN)) {
    problems.push('Klaviatura yoki alifbo ketma-ketligini ishlatmang (masalan “abcd”, “qwer”).')
  }

  const email = identity.email?.trim().toLowerCase()
  if (email) {
    const localPart = email.split('@')[0]
    if (lower.includes(email) || (localPart && localPart.length >= 4 && lower.includes(localPart))) {
      problems.push('Parol pochta manzilingizni takrorlamasin.')
    }
  }

  const name = identity.name?.trim().toLowerCase()
  if (name && name.length >= 4 && lower.includes(name)) {
    problems.push('Parol ismingizni takrorlamasin.')
  }

  return { ok: problems.length === 0, problems }
}

/** True when some character repeats more than `max` times in a row. */
function hasRepeatRun(password: string, max: number): boolean {
  let run = 1
  for (let i = 1; i < password.length; i += 1) {
    run = password[i] === password[i - 1] ? run + 1 : 1
    if (run > max) return true
  }
  return false
}

/**
 * True when the password contains a straight run — forwards or backwards —
 * along a keyboard row or the alphabet, longer than `max`.
 */
function hasSequenceRun(lowerPassword: string, max: number): boolean {
  const alphabets = [...KEYBOARD_ROWS, 'abcdefghijklmnopqrstuvwxyz']

  for (const row of alphabets) {
    const reversed = [...row].reverse().join('')
    for (const source of [row, reversed]) {
      for (let start = 0; start + max <= source.length; start += 1) {
        const run = source.slice(start, start + max + 1)
        if (run.length > max && lowerPassword.includes(run)) return true
      }
    }
  }
  return false
}

/**
 * A rough strength score for the client meter, 0–4.
 *
 * Deliberately crude and deliberately NOT an authority: the policy decides
 * whether a password is acceptable, this only decides how many bars to paint.
 * Growing with length past the minimum is the honest signal to give, because
 * length is what actually helps.
 */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0
  const { ok } = checkPassword(password)
  if (!ok) return password.length >= 8 ? 1 : 0
  if (password.length >= 20) return 4
  if (password.length >= 16) return 3
  return 2
}
