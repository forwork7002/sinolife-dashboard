'use client'

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StatusChip } from '@/components/ui/Stat'
import { authClient } from '@/lib/authClient'
import { t } from '@/lib/messages'
import { CodeField } from './CodeField'
import { QrCode } from './QrCode'

/**
 * Arming and disarming the second factor.
 *
 * THE SHAPE OF THIS SCREEN IS THE SECURITY PROPERTY, not decoration. Two
 * things must be true before `twoFactorEnabled` flips, and the UI is what
 * makes them true:
 *
 *   1. The backup codes are in the owner's hands, and they have said so.
 *   2. The authenticator app has produced a code this server accepted.
 *
 * better-auth enforces the second one — `skipVerificationOnEnable: false`, so
 * `/two-factor/enable` hands back a secret and ten codes and changes NOTHING
 * about sign-in; only `/two-factor/verify-totp` arms the account. The first is
 * enforced here, by the checkbox, and it is the one that matters more. There
 * is one user of this dashboard and no administrator behind them: a person who
 * arms 2FA, closes the tab, and later replaces their phone has no path back
 * except an UPDATE statement run by whoever holds DATABASE_URL. The codes are
 * shown exactly once, so "I will write them down later" cannot happen.
 *
 * Abandoning the setup halfway is therefore SAFE and is meant to be. The
 * unverified row sits in `two_factor` doing nothing, sign-in is unchanged, and
 * starting again overwrites it with a fresh secret and fresh codes.
 *
 * The password is asked for at both ends — arming and disarming — because
 * better-auth requires it and because it is what stops a stolen, still-warm
 * session from either locking the owner out of their own account or quietly
 * taking the lock off.
 */

type Stage =
  | { kind: 'idle' }
  /** Proving the password, before a secret is minted. */
  | { kind: 'password' }
  /** The secret and the codes exist; nothing is armed yet. */
  | { kind: 'setup'; totpUri: string; secret: string; backupCodes: readonly string[] }
  /** Proving the password, before the lock comes off. */
  | { kind: 'disarm' }

export function TwoFactorSection({ enabled }: { enabled: boolean }) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  /**
   * What the server told us on the last successful arm or disarm.
   *
   * `enabled` comes from the session, and the two-factor plugin rewrites the
   * session cookie the moment the flag moves — so it catches up on its own.
   * "On its own" is a refetch, though, and for the width of that refetch the
   * header would read "Yoqilmagan" directly above a chip saying "Yoqildi".
   * Two states of the same fact on one screen is how a reader stops believing
   * either. This is only ever set from a 200, so it cannot claim more than
   * the server did.
   */
  const [confirmed, setConfirmed] = useState<boolean | null>(null)
  const armed = confirmed ?? enabled
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** A one-line confirmation of the last thing that happened. */
  const [notice, setNotice] = useState<'armed' | 'disarmed' | null>(null)

  const reset = () => {
    setStage({ kind: 'idle' })
    setPassword('')
    setCode('')
    setSaved(false)
    setError(null)
  }

  const begin = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || password.length === 0) return
    setBusy(true)
    setError(null)

    const { data, error: failure } = await authClient.twoFactor.enable({ password })
    setBusy(false)

    if (failure || !data) {
      setError(describe(failure))
      return
    }
    // The endpoint answers with either a TOTP enrolment or an OTP one. Only
    // TOTP is configured on this deployment (no mail or SMS provider exists),
    // so anything else means the server changed underneath this screen.
    if (!('totpURI' in data) || typeof data.totpURI !== 'string') {
      setError(t.auth.twoFactor.generic)
      return
    }

    setPassword('')
    setNotice(null)
    setStage({
      kind: 'setup',
      totpUri: data.totpURI,
      secret: readSecret(data.totpURI),
      backupCodes: Array.isArray(data.backupCodes) ? data.backupCodes : [],
    })
  }

  const arm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !saved || code.length !== 6) return
    setBusy(true)
    setError(null)

    const { error: failure } = await authClient.twoFactor.verifyTotp({ code })
    setBusy(false)

    if (failure) {
      setError(
        failure.code === 'INVALID_CODE'
          ? t.auth.twoFactor.codeRejected
          : describe(failure),
      )
      // The code is cleared but the codes and the QR stay: the app is showing a
      // new number by now, and re-running enrolment would mint a second secret
      // and a second set of backup codes for no reason.
      setCode('')
      return
    }

    setConfirmed(true)
    setNotice('armed')
    reset()
  }

  const disarm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || password.length === 0) return
    setBusy(true)
    setError(null)

    const { error: failure } = await authClient.twoFactor.disable({ password })
    setBusy(false)

    if (failure) {
      setError(describe(failure))
      return
    }

    setConfirmed(false)
    setNotice('disarmed')
    reset()
  }

  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {t.auth.twoFactor.title}
        </h2>
        <StatusChip tone={armed ? 'good' : 'neutral'}>
          {armed ? t.auth.twoFactor.armed : t.auth.twoFactor.notArmed}
        </StatusChip>
      </div>

      <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
        {armed ? t.auth.twoFactor.armedBody : t.auth.twoFactor.notArmedBody}
      </p>

      {stage.kind === 'idle' && (
        <>
          <p className="mt-2.5 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {t.auth.twoFactor.lead}
          </p>
          {/*
            The recovery truth, stated where the decision is made. Muted and
            one sentence: a red banner here would be dismissed as boilerplate,
            and this is the one fact on the page a reader must actually carry
            away.
          */}
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {t.auth.twoFactor.recovery}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {armed ? (
              <Button onClick={() => setStage({ kind: 'disarm' })}>
                {t.auth.twoFactor.disable}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setStage({ kind: 'password' })}>
                {t.auth.twoFactor.start}
              </Button>
            )}
            {notice && (
              <StatusChip tone={notice === 'armed' ? 'good' : 'neutral'}>
                {notice === 'armed'
                  ? t.auth.twoFactor.armedNow
                  : t.auth.twoFactor.disabledNow}
              </StatusChip>
            )}
          </div>
        </>
      )}

      {(stage.kind === 'password' || stage.kind === 'disarm') && (
        <form
          className="mt-4 flex flex-col gap-3.5"
          onSubmit={stage.kind === 'password' ? begin : disarm}
        >
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {stage.kind === 'password'
              ? t.auth.twoFactor.passwordHint
              : t.auth.twoFactor.disableBody}
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
              {t.auth.twoFactor.passwordLabel}
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              className="focusable rounded-[var(--radius-panel-sm)] border px-3 py-2 text-sm"
              style={{
                background: 'var(--surface-raised)',
                borderColor: 'var(--border-strong)',
                color: 'var(--ink-primary)',
              }}
            />
          </label>

          <ErrorNote message={error} />

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={busy || password.length === 0}>
              {stage.kind === 'password'
                ? busy
                  ? t.auth.twoFactor.preparing
                  : t.auth.twoFactor.begin
                : busy
                  ? t.auth.twoFactor.disabling
                  : t.auth.twoFactor.disable}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              {t.auth.twoFactor.cancel}
            </Button>
          </div>
        </form>
      )}

      {stage.kind === 'setup' && (
        <form className="mt-4 flex flex-col gap-5" onSubmit={arm}>
          <Step index={1} title={t.auth.twoFactor.stepScan} body={t.auth.twoFactor.stepScanBody}>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
              <QrCode
                value={stage.totpUri}
                label={t.auth.twoFactor.qrAlt}
                fallback={
                  <p
                    className="text-xs sm:max-w-[220px]"
                    style={{ color: 'var(--status-warning)' }}
                  >
                    {t.auth.twoFactor.qrUnavailable}
                  </p>
                }
              />

              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
                  {t.auth.twoFactor.secretLabel}
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {t.auth.twoFactor.secretHint}
                </p>
                {/*
                  Grouped in fours for the person typing it into a phone with
                  their thumbs. The copy button hands over the ungrouped
                  string; authenticator apps ignore the spaces either way.
                */}
                <p
                  className="tabular mt-2 rounded-[var(--radius-panel-sm)] border px-3 py-2 text-[13px] leading-relaxed break-all select-all"
                  style={{
                    background: 'var(--surface-sunken)',
                    borderColor: 'var(--border)',
                    color: 'var(--ink-primary)',
                  }}
                >
                  {group(stage.secret)}
                </p>
                <div className="mt-2">
                  <CopyButton label={t.auth.twoFactor.copySecret} text={stage.secret} />
                </div>
              </div>
            </div>
          </Step>

          <Step index={2} title={t.auth.twoFactor.stepCodes} body={t.auth.twoFactor.stepCodesBody}>
            <ul className="tabular mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-[var(--radius-panel-sm)] border px-3 py-3 text-[13px] sm:grid-cols-3"
              style={{
                background: 'var(--surface-sunken)',
                borderColor: 'var(--border)',
                color: 'var(--ink-primary)',
              }}
            >
              {stage.backupCodes.map((backupCode) => (
                <li key={backupCode} className="select-all">
                  {backupCode}
                </li>
              ))}
            </ul>

            <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {t.auth.twoFactor.codesWhere}
            </p>

            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <CopyButton
                label={t.auth.twoFactor.copyCodes}
                text={stage.backupCodes.join('\n')}
              />
            </div>

            {/*
              The gate. `arm` refuses without it as well — a disabled button is
              a hint, not a rule — but the checkbox is the point: it turns
              "some codes went past on a screen" into a thing the owner
              deliberately said they had done.
            */}
            <label className="mt-3 flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={saved}
                onChange={(event) => setSaved(event.target.checked)}
                className="focusable mt-0.5 h-4 w-4 shrink-0 rounded-[4px]"
                style={{ accentColor: 'var(--series-1)' }}
              />
              <span className="text-xs font-medium" style={{ color: 'var(--ink-primary)' }}>
                {t.auth.twoFactor.savedCheckbox}
              </span>
            </label>
          </Step>

          <Step
            index={3}
            title={t.auth.twoFactor.stepConfirm}
            body={t.auth.twoFactor.stepConfirmBody}
          >
            <div className="mt-3 max-w-[220px]">
              <CodeField
                mode="totp"
                value={code}
                onChange={setCode}
                label={t.auth.twoFactor.confirmLabel}
                hint={t.auth.twoFactor.confirmHint}
                disabled={busy}
              />
            </div>
          </Step>

          {/*
            The same sentence as the idle state, in the same muted voice, at
            the moment it stops being hypothetical. It is repeated rather than
            left behind on the previous screen because this is the last click
            before the lock is on, and a warning read two minutes ago on a
            different view is a warning nobody is holding now.
          */}
          <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {t.auth.twoFactor.recovery}
          </p>

          <ErrorNote message={error} />

          {!saved && code.length === 6 && (
            <p className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
              {t.auth.twoFactor.needCodesSaved}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !saved || code.length !== 6}
            >
              {busy ? t.auth.twoFactor.arming : t.auth.twoFactor.arm}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              {t.auth.twoFactor.cancel}
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}

/** A numbered step in the enrolment sequence. */
function Step({
  index,
  title,
  body,
  children,
}: {
  index: number
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="tabular flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
          style={{ background: 'var(--track)', color: 'var(--ink-secondary)' }}
        >
          {index}
        </span>
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {title}
        </h3>
      </div>
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        {body}
      </p>
      {children}
    </section>
  )
}

/**
 * Copy to clipboard, with the failure state visible.
 *
 * `navigator.clipboard` is undefined outside a secure context — which is
 * exactly the local http deployment this app runs on today — and it can also
 * be refused by permission. Both are silent failures that would leave someone
 * believing ten one-time recovery codes were on their clipboard when they were
 * not. So the button says which of the two happened, and the codes stay
 * selectable on screen either way.
 */
function CopyButton({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(text)
      setState('done')
    } catch {
      setState('failed')
    }
    timer.current = setTimeout(() => setState('idle'), 4000)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={copy}>
        {label}
      </Button>
      {state === 'done' && <StatusChip tone="good">{t.auth.twoFactor.copied}</StatusChip>}
      {state === 'failed' && (
        <span className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
          {t.auth.twoFactor.copyFailed}
        </span>
      )}
    </div>
  )
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-panel-sm)] px-3 py-2 text-xs"
      style={{
        background: 'color-mix(in oklab, var(--status-critical) 12%, transparent)',
        color: 'var(--status-critical)',
      }}
    >
      {message}
    </p>
  )
}

/**
 * Turn a better-auth failure into a sentence.
 *
 * The wrong-password case is reworded because better-auth's own message is
 * English and terse; the throttle is named because "try again" with no
 * timescale is what makes a person hammer a button. Anything else falls
 * through to the server's message, which for this plugin is specific enough to
 * be worth showing.
 */
function describe(failure: { status?: number; code?: string; message?: string } | null): string {
  if (!failure) return t.auth.twoFactor.generic
  if (failure.code === 'INVALID_PASSWORD') return t.auth.twoFactor.wrongPassword
  if (failure.status === 429) return t.auth.twoFactor.throttled
  return failure.message ?? t.auth.twoFactor.generic
}

/**
 * The base32 secret out of the enrolment URI.
 *
 * `URL` parses `otpauth://` fine — it is not a special scheme, so the query
 * string is still a query string. The regex is the fallback for the day a
 * runtime disagrees; returning an empty string would silently remove the
 * manual-entry path, which is the path someone uses when their phone's camera
 * will not focus.
 */
function readSecret(totpUri: string): string {
  try {
    const parsed = new URL(totpUri).searchParams.get('secret')
    if (parsed) return parsed
  } catch {
    // Fall through to the regex.
  }
  return /[?&]secret=([^&]+)/.exec(totpUri)?.[1] ?? ''
}

/** Groups of four, so a 52-character secret can be typed without losing place. */
function group(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ')
}
