/**
 * What counts as an acceptable password here.
 *
 * EIGHT CHARACTERS, AND NOTHING ELSE — set by the owner of this deployment,
 * deliberately, after using the stricter version.
 *
 * The rules this replaced were twelve characters, three of four character
 * classes, a banned-fragment list, no repeated or keyboard runs, and no
 * restating of the account's own email or name. They were defensible on a
 * dashboard holding a year of revenue, and they were also what made handing a
 * login to an operator a negotiation: the administrator types a password, the
 * form refuses it, and the next attempt is `Parol123!` anyway.
 *
 * WHAT STILL PROTECTS AN ACCOUNT, now that the password carries less of it:
 *   - the sign-in lockout — five failures and the account stops answering for
 *     fifteen minutes, on BOTH credential paths (see `auth.ts`);
 *   - a five-per-minute rate limit on each sign-in endpoint;
 *   - two-factor, per account, for anyone who arms it;
 *   - accounts are provisioned by an administrator; there is no public sign-up.
 *
 * Those are what make a short password survivable: guessing is throttled to a
 * handful of attempts a minute and stopped entirely after five wrong ones, so
 * the offline-cracking argument the old floor was built against does not reach
 * anyone who has to come through the front door. It would reach someone who
 * stole the password hashes — which is the risk this change accepts.
 *
 * The one bound that is NOT a policy choice is the ceiling: better-auth
 * refuses anything longer, and hashing a megabyte of input is a denial of
 * service rather than a strong password.
 *
 * WHY THIS LIVES IN `lib/` RATHER THAN `server/auth/`. Both sides need it —
 * better-auth's hook to enforce it, the account form to explain it — and the
 * repo forbids client code from importing `@/server/*` because those modules
 * carry the database URL and the portal token. This file carries neither: it
 * is pure string arithmetic with no imports at all, so one copy serves both
 * and the rules cannot drift into two versions that disagree.
 */

/** The house minimum. Also enforced by better-auth's own `minPasswordLength`. */
export const MIN_PASSWORD_LENGTH = 8

/** better-auth's own ceiling; stated here so the two cannot drift apart. */
export const MAX_PASSWORD_LENGTH = 128

export interface PasswordCheck {
  readonly ok: boolean
  /** Every failed rule, in the order a person would fix them. Uzbek, user-facing. */
  readonly problems: readonly string[]
}

/**
 * Check a password against the policy.
 *
 * Returns EVERY problem rather than the first, because a form that reveals one
 * rule at a time turns a single decision into several round trips. With one
 * rule left that is a distinction without a difference today, and the shape is
 * kept so restoring a rule does not change every caller.
 */
export function checkPassword(
  password: string,
  /*
    Kept in the signature rather than removed.

    Every call site passes the account's email and name, and dropping the
    parameter would mean editing each of them to say that nothing is checked.
    Restoring an identity rule later is then one edit here instead of five.
  */
  _identity: { readonly email?: string | null; readonly name?: string | null } = {},
): PasswordCheck {
  const problems: string[] = []

  if (password.length < MIN_PASSWORD_LENGTH) {
    problems.push(`Kamida ${MIN_PASSWORD_LENGTH} ta belgi boʻlsin.`)
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    problems.push(`Koʻpi bilan ${MAX_PASSWORD_LENGTH} ta belgi.`)
  }

  return { ok: problems.length === 0, problems }
}

/**
 * A four-step meter for the account form.
 *
 * Length only, because length is all the policy asks for. It is advice rather
 * than a gate — nothing here can refuse a password `checkPassword` accepted —
 * so it stays useful even though the rules no longer require anything beyond
 * eight characters: a longer password really is a better one.
 */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (!password) return 0
  if (password.length < MIN_PASSWORD_LENGTH) return 0
  if (password.length >= 20) return 4
  if (password.length >= 14) return 3
  if (password.length >= 10) return 2
  return 1
}
