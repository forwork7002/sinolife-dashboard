/**
 * WHO RUNS THE AI REGISTRATOR — «AI registrator → Boshqaruv» (2026-10-30).
 *
 * The owner: «shu boshqaruv panel faqatgina adminjonga koʻrinadi». One
 * account, named by its owner — not a role (another ADMIN is refused) and not
 * a section (a tick on /users cannot hand it out). Two sign-ins count as that
 * account, because nothing in the repository says which of them «adminjon» is:
 *
 *   · the login `adminjon` (username, case-insensitive — better-auth lowers it);
 *   · the founding administrator, ADMIN_EMAIL — the owner's own account, the
 *     one `db:seed:users` provisions.
 *
 * Both are the owner's; neither can be created by anyone but an administrator.
 * Narrow it here, and only here — `requirePrincipal` asks this once per
 * request and every gate (page, panel API, sidebar link) reads the result.
 */

export const AI_CONTROL_LOGINS: readonly string[] = ['adminjon']

export function isAiControlAccount(
  user: { readonly username: string | null; readonly email: string | null },
  foundingAdminEmail: string | undefined,
): boolean {
  const login = user.username?.trim().toLowerCase() ?? ''
  if (login !== '' && AI_CONTROL_LOGINS.includes(login)) return true
  const email = user.email?.trim().toLowerCase() ?? ''
  return foundingAdminEmail !== undefined && foundingAdminEmail !== '' && email === foundingAdminEmail
}

/** The name an audit line records the saver by: the login, else the e-mail. */
export function auditLabel(user: { readonly username: string | null; readonly email: string | null; readonly name?: string | null }): string {
  return user.username?.trim() || user.email?.trim() || user.name?.trim() || 'nomaʼlum'
}
