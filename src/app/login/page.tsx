'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { authClient } from '@/lib/authClient'
import { t } from '@/lib/messages'
import { ChallengeForm } from './ChallengeForm'

/**
 * Turn a sign-in failure into something the reader can act on.
 *
 * Wrong credentials stay deliberately vague — naming which of the two was
 * wrong tells an attacker which addresses are real accounts.
 *
 * Everything else must NOT wear that message. An origin rejection reported as
 * "wrong password" is how a working password came to look broken: the app is
 * reachable at several addresses, better-auth trusts only the configured one,
 * and the resulting 403 was rendered as a credential problem. The person
 * retyped the password for twenty minutes.
 *
 * THE LOCKOUT IS THE NEWEST BRANCH AND THE ONE THAT MATTERS MOST HERE.
 * `hooks.before` in server/auth/auth.ts refuses a locked address with 429 and
 * `ACCOUNT_LOCKED_OUT`, and its message — written by `lockoutMessage` in
 * server/auth/lockout.ts — already carries the wait in whole minutes, in
 * Uzbek. It is shown verbatim rather than rewritten, because the number is the
 * whole value of the message and this side has no way to compute it. Falling
 * through to the generic branch below is what produced "Kirish amalga oshmadi:
 * Juda koʻp muvaffaqiyatsiz urinish…", a refusal wearing a failure's clothes.
 *
 * A 429 WITHOUT that code is better-auth's per-minute request throttle, which
 * is not about this account at all and clears itself inside the rate-limit
 * window.
 */
function describe(error: { status?: number; code?: string; message?: string }): string {
  if (error.code === 'ACCOUNT_LOCKED_OUT') {
    return error.message ?? t.auth.signIn.throttled
  }
  if (error.status === 429) {
    return t.auth.signIn.throttled
  }
  if (error.code === 'INVALID_ORIGIN' || error.status === 403) {
    return t.auth.signIn.wrongOrigin(
      process.env.NEXT_PUBLIC_APP_URL ?? 'toʻgʻri manzil',
    )
  }
  if (error.status === 401 || error.status === 400) {
    return t.auth.signIn.wrongCredentials
  }
  if (error.status && error.status >= 500) {
    return t.auth.signIn.serverDown
  }
  return error.message ? t.auth.signIn.failed(error.message) : t.auth.signIn.offline
}

export default function LoginPage() {
  return (
    // useSearchParams needs a Suspense boundary during prerender.
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  /**
   * Whether the password was accepted and a second factor is outstanding.
   *
   * This is the only thing that has to be carried across the two steps. The
   * password is dropped the moment the challenge appears: the pending
   * challenge is a signed cookie the server issued, so there is no reason to
   * keep a credential alive in memory while somebody unlocks their phone.
   */
  const [challenge, setChallenge] = useState(false)

  /**
   * Return them to where they were heading.
   *
   * The middleware records it as `?next=`. Sending everyone to the home page
   * instead means clicking Logistika, signing in, and landing somewhere
   * else — small, but it reads as the app losing your place.
   *
   * Only a same-site path is accepted: an absolute URL here would make the
   * login page an open redirect.
   */
  function proceed() {
    const next = params.get('next')
    const destination = next && /^\/(?!\/)/.test(next) ? next : '/'

    router.push(destination)
    router.refresh()
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      /*
        LOGIN NAME ONLY. No email.

        This is an internal dashboard for a call centre: an operator is given a
        login by their administrator, and most of them have no work mailbox at
        all. Asking for an email address asked for something that does not
        exist, so the field is a login and the request is always the login
        endpoint — including for the administrator, who was given one too.

        `/sign-in/email` stays mounted server-side as a recovery door, sharing
        the same lockout bucket and the same rate limit as this path, but
        nothing in the product points at it.
      */
      const result = await authClient.signIn.username({
        username: email.trim(),
        password,
      })

      if (result.error) {
        setError(describe(result.error))
        setPending(false)
        return
      }

      /**
       * 200, but no session: the second factor is still outstanding.
       *
       * better-auth signals this with `twoFactorRedirect` on the body rather
       * than an error, and the distinction is easy to miss — treating it as
       * success is a redirect to a dashboard that immediately bounces back to
       * /login with no message at all.
       */
      if (result.data && 'twoFactorRedirect' in result.data && result.data.twoFactorRedirect) {
        setPassword('')
        setPending(false)
        setChallenge(true)
        return
      }
    } catch (cause) {
      // A rejected promise here is the network, not the credentials.
      setError(
        cause instanceof Error ? t.auth.signIn.failed(cause.message) : t.auth.signIn.offline,
      )
      setPending(false)
      return
    }

    proceed()
  }

  return (
    /*
      The first screen anyone sees, so it carries the same light as the app:
      two faint accent pools behind a raised card, the brand mark washed in
      the revenue hue. `background` on main would flatten the ambient
      gradients painted on <html>, so it stays transparent.
    */
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="rise w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-xl text-base font-bold"
            style={{
              background: `linear-gradient(135deg, var(--series-1), color-mix(in oklab, var(--series-1) 55%, var(--series-7)))`,
              color: 'var(--ink-on-series)',
              boxShadow: '0 4px 14px -4px color-mix(in oklab, var(--series-1) 55%, transparent)',
            }}
            aria-hidden="true"
          >
            S
          </span>
          <div>
            <p className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>
              {t.app.name}
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Savdo tahlili paneli
            </p>
          </div>
        </div>

        {challenge ? (
          <ChallengeForm
            onVerified={proceed}
            /*
              Back to the password, with the fields empty. Reached only when
              the challenge is spent — a fresh one has to be issued by
              /sign-in/email, so there is nothing to preserve.
            */
            onRestart={() => {
              setChallenge(false)
              setEmail('')
              setPassword('')
              setError(null)
            }}
          />
        ) : (
          <form
            onSubmit={onSubmit}
            className="rounded-2xl border p-6"
            style={{
              background: 'var(--surface-raised)',
              borderColor: 'var(--border)',
              boxShadow: 'var(--shadow-raised), var(--edge-highlight)',
            }}
          >
            <h1
              className="text-lg font-semibold tracking-tight"
              style={{ color: 'var(--ink-primary)' }}
            >
              {t.auth.signIn.title}
            </h1>
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
              {t.auth.signIn.lead}
            </p>

            <label className="mt-5 block">
              <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
                {t.auth.signIn.email}
              </span>
              <input
                type="text"
                required
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focusable outline-none"
                style={{
                  background: 'var(--surface-raised)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--ink-primary)',
                }}
              />
            </label>

            <label className="mt-3 block">
              <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
                {t.auth.signIn.password}
              </span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focusable outline-none"
                style={{
                  background: 'var(--surface-raised)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--ink-primary)',
                }}
              />
            </label>

            {error && (
              <p
                role="alert"
                className="mt-3 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs"
                style={{
                  background: 'color-mix(in oklab, var(--status-critical) 12%, transparent)',
                  color: 'var(--ink-primary)',
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  className="mt-px shrink-0"
                >
                  <circle cx="12" cy="12" r="9" stroke="var(--status-critical)" strokeWidth="2" />
                  <path d="M12 7v6" stroke="var(--status-critical)" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="12" cy="16.5" r="1" fill="var(--status-critical)" />
                </svg>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="focusable mt-5 w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-opacity disabled:opacity-60"
              style={{ background: 'var(--ink-primary)', color: 'var(--surface)' }}
            >
              {pending ? t.auth.signIn.submitting : t.auth.signIn.submit}
            </button>
          </form>
        )}

        {/*
          No credential hint.

          The demo accounts this box used to advertise are gone: the
          deployment provisions one administrator from environment variables.
          Printing any address here would hand an attacker a valid username
          for free, which is the same reason the error above never says which
          of the two fields was wrong.
        */}
        <p className="mt-4 text-center text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {t.auth.signIn.adminNote}
        </p>
      </div>
    </main>
  )
}
