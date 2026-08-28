'use client'

import { useState } from 'react'

import { CodeField } from '@/features/account/CodeField'
import { authClient } from '@/lib/authClient'
import { t } from '@/lib/messages'

/**
 * The second step of signing in.
 *
 * It is only ever reached after `/sign-in/email` returned 200 with
 * `twoFactorRedirect: true` — better-auth's way of saying "the password was
 * right and there is no session yet". The pending challenge lives in a signed,
 * short-lived cookie the server set on that response, so this form carries no
 * secret of its own and nothing from the first step needs to be held in memory
 * while the owner reaches for their phone.
 *
 * RENDERED IN PLACE, NOT ON A SECOND PAGE. The plugin offers `twoFactorPage`,
 * which navigates with a full reload; taking it would throw away the `?next=`
 * destination the middleware recorded and cost a round trip in the middle of
 * an authentication. See the comment in `lib/authClient.ts`.
 *
 * THE TWO INPUTS ARE ONE COMPONENT AWAY FROM EACH OTHER ON PURPOSE. The backup
 * code is not a hidden fallback behind a support article; it is a link under
 * the field, because the moment it is needed is the moment the phone is gone
 * and nobody is available to explain where it went.
 */
export function ChallengeForm({
  onVerified,
  onRestart,
}: {
  onVerified: () => void
  onRestart: () => void
}) {
  const [mode, setMode] = useState<'totp' | 'backup'>('totp')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * The challenge itself is gone — five wrong codes inside one sign-in, or a
   * cookie that expired. No further code can succeed, so the form is replaced
   * by the one action that can: start again from the password.
   */
  const [spent, setSpent] = useState(false)

  const complete = mode === 'totp' ? code.length === 6 : code.length === 11

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || !complete) return

    setPending(true)
    setError(null)

    try {
      const result =
        mode === 'totp'
          ? await authClient.twoFactor.verifyTotp({ code })
          : await authClient.twoFactor.verifyBackupCode({ code })

      if (result.error) {
        const failure = result.error
        if (
          failure.code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' ||
          failure.code === 'INVALID_TWO_FACTOR_COOKIE'
        ) {
          setSpent(true)
          setError(t.auth.challenge.expired)
        } else if (failure.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
          setError(t.auth.challenge.locked)
        } else if (failure.status === 429) {
          /*
            better-auth's own throttle on /two-factor/*, contributed by the
            plugin: three requests per ten SECONDS. A different thing from the
            account lock above and on a different timescale, so it must not
            wear the per-minute wording the password step uses — that would
            send someone away for a minute over a limit measured in seconds.

            Measured behaviour, worth writing down: the memory limiter
            refreshes its timestamp on every request it ALLOWS, so the window
            only rolls after ten seconds of actual silence. Retrying every two
            seconds keeps it shut. Hence "wait a moment", not "try again".

            The string lives under `twoFactor` rather than `challenge` because
            it describes those endpoints, and the account screen hits the same
            limit while arming.
          */
          setError(t.auth.twoFactor.throttled)
        } else {
          /*
            Everything else collapses to one sentence, deliberately. A wrong
            code, a code from the wrong account, a code for an account with no
            authenticator: naming which would tell an attacker who got the
            password whether they are pointed at a real, armed account.
          */
          setError(
            mode === 'totp' ? t.auth.challenge.invalidCode : t.auth.challenge.invalidBackup,
          )
        }
        setCode('')
        setPending(false)
        return
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? t.auth.signIn.failed(cause.message)
          : t.auth.signIn.offline,
      )
      setPending(false)
      return
    }

    onVerified()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border p-6"
      style={{
        background: 'var(--surface-raised)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-raised), var(--edge-highlight)',
      }}
    >
      <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
        {t.auth.challenge.title}
      </h1>
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {mode === 'totp' ? t.auth.challenge.lead : t.auth.challenge.leadBackup}
      </p>

      {!spent && (
        <div className="mt-5">
          <CodeField
            /*
              Remounted when the mode changes — the key is the mode — so the
              caret lands in whichever field is now on screen. Without it, a
              person who taps "zaxira kodni ishlatish" is looking at an empty
              field with the keyboard still pointed at the old one.
            */
            key={mode}
            mode={mode}
            value={code}
            onChange={setCode}
            label={mode === 'totp' ? t.auth.challenge.codeLabel : t.auth.challenge.backupLabel}
            hint={mode === 'backup' ? t.auth.challenge.backupHint : undefined}
            autoFocus
            disabled={pending}
          />
        </div>
      )}

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

      {spent ? (
        <button
          type="button"
          onClick={onRestart}
          className="focusable mt-5 w-full rounded-lg px-3 py-2.5 text-sm font-medium"
          style={{ background: 'var(--ink-primary)', color: 'var(--surface)' }}
        >
          {t.auth.challenge.restart}
        </button>
      ) : (
        <>
          <button
            type="submit"
            disabled={pending || !complete}
            className="focusable mt-5 w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{ background: 'var(--ink-primary)', color: 'var(--surface)' }}
          >
            {pending ? t.auth.challenge.submitting : t.auth.challenge.submit}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === 'totp' ? 'backup' : 'totp')
              setCode('')
              setError(null)
            }}
            className="focusable mt-3 w-full rounded-lg py-1 text-center text-xs underline underline-offset-2"
            style={{ color: 'var(--ink-secondary)' }}
          >
            {mode === 'totp' ? t.auth.challenge.useBackup : t.auth.challenge.useCode}
          </button>
        </>
      )}
    </form>
  )
}
