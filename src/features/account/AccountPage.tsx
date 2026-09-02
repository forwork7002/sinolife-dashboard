'use client'

import { useState } from 'react'

import { Shell } from '@/components/layout/Shell'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StatusChip } from '@/components/ui/Stat'
import { authClient, sessionUser, useSession } from '@/lib/authClient'
import { ROLE_LABELS } from '@/lib/roles'
import {
  MIN_PASSWORD_LENGTH,
  checkPassword,
  passwordStrength,
} from '@/lib/passwordPolicy'
import { TwoFactorSection } from './TwoFactorSection'

/**
 * The account screen: who you are, and how to change your password.
 *
 * WHY THE POLICY MODULE IS IMPORTED INTO A CLIENT COMPONENT. `passwordPolicy`
 * is pure TypeScript — no Prisma, no environment, no secrets — so bundling it
 * costs a few hundred bytes and buys the one thing a server-only check cannot:
 * the reader sees which rule they are breaking WHILE they type, instead of
 * after a round trip. It is not the boundary. The identical function runs in
 * better-auth's `before` hook on every password-setting route, so a request
 * that never went near this form is judged by exactly the same rules. Two
 * copies of a rule drift; one module used twice cannot.
 *
 * The form deliberately asks for the current password. better-auth requires it
 * anyway, and it is what makes a stolen, still-warm session unable to lock the
 * real owner out of their own account.
 *
 * The second factor lives in its own component below the password. Order is
 * intentional: the password is the credential this page has always changed and
 * the one someone arrives here to rotate, while arming 2FA is a deliberate,
 * once-ever act that needs a phone in hand. Putting the longer, rarer flow
 * first would push the routine one below the fold.
 */
export function AccountPage() {
  const { data: session } = useSession()
  const user = sessionUser(session?.user)

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  // Checked as they type, against the account's own identity so "do not reuse
  // your email" can actually fire here rather than only on the server.
  const check = checkPassword(next, { email: user?.email, name: user?.name })
  const strength = passwordStrength(next)
  const mismatch = confirm.length > 0 && next !== confirm
  const canSubmit =
    current.length > 0 && next.length > 0 && !mismatch && check.ok && state !== 'saving'

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    setState('saving')
    setError(null)

    const { error: failure } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      // Other devices are signed out; this one keeps its session so the person
      // is not ejected from the page they are standing on.
      revokeOtherSessions: true,
    })

    if (failure) {
      setState('idle')
      /*
        The server's message is shown as-is when it has one: the policy hook
        returns every broken rule in one sentence, and a generic "xatolik"
        would throw that away. A wrong current password is the one case worth
        rewording, because better-auth's own wording is English and terse.
      */
      setError(
        failure.code === 'INVALID_PASSWORD'
          ? 'Joriy parol notoʻgʻri.'
          : (failure.message ?? 'Parolni oʻzgartirib boʻlmadi.'),
      )
      return
    }

    setState('done')
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  return (
    <Shell>
      <div className="mx-auto flex max-w-[720px] flex-col gap-5">
        <header>
          <div className="accent-rule" aria-hidden="true" />
          <h1
            className="display mt-2.5 text-2xl font-semibold"
            style={{ color: 'var(--ink-primary)' }}
          >
            Hisob
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-secondary)' }}>
            Kirish maʼlumotlaringiz, parol va ikki bosqichli himoya.
          </p>
        </header>

        <Card className="px-5 py-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
            Kim sifatida kirgansiz
          </h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
            <dt style={{ color: 'var(--ink-muted)' }}>Ism</dt>
            <dd style={{ color: 'var(--ink-primary)' }}>{user?.name ?? '—'}</dd>
            <dt style={{ color: 'var(--ink-muted)' }}>Pochta</dt>
            <dd className="tabular" style={{ color: 'var(--ink-primary)' }}>
              {user?.email ?? '—'}
            </dd>
            <dt style={{ color: 'var(--ink-muted)' }}>Rol</dt>
            <dd style={{ color: 'var(--ink-primary)' }}>
              {user ? ROLE_LABELS[user.role] : '—'}
            </dd>
          </dl>
        </Card>

        <Card className="px-5 py-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
            Parolni oʻzgartirish
          </h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
            Parol oʻzgargach, boshqa barcha qurilmalardagi seanslar yopiladi. Bu qurilma
            ochiq qoladi.
          </p>

          <form className="mt-4 flex flex-col gap-3.5" onSubmit={submit}>
            <Field
              label="Joriy parol"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
            />

            <div>
              <Field
                label="Yangi parol"
                value={next}
                onChange={setNext}
                autoComplete="new-password"
              />
              {next.length > 0 && <StrengthMeter strength={strength} />}
              {next.length > 0 && !check.ok && (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {check.problems.map((problem) => (
                    <li key={problem} className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
                      {problem}
                    </li>
                  ))}
                </ul>
              )}
              {next.length === 0 && (
                <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  Kamida {MIN_PASSWORD_LENGTH} ta belgi; kichik harf, bosh harf, raqam va
                  belgidan uch xili. Uzun ibora eng kuchlisi.
                </p>
              )}
            </div>

            <div>
              <Field
                label="Yangi parolni takrorlang"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
              />
              {mismatch && (
                <p className="mt-1.5 text-[11px]" style={{ color: 'var(--status-critical)' }}>
                  Parollar mos kelmadi.
                </p>
              )}
            </div>

            {error && (
              <p
                className="rounded-[var(--radius-panel-sm)] px-3 py-2 text-xs"
                style={{
                  background: 'color-mix(in oklab, var(--status-critical) 12%, transparent)',
                  /*
                    --delta-down, not --status-critical: text ON a 12% tint of
                    the critical hue. globals.css measured the bare token at
                    4.11:1 there in dark — under the 4.5:1 floor — and minted
                    this lighter cut of the same hue for exactly this seat.
                  */
                  color: 'var(--delta-down)',
                }}
                role="alert"
              >
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" disabled={!canSubmit}>
                {state === 'saving' ? 'Saqlanmoqda…' : 'Parolni oʻzgartirish'}
              </Button>
              {state === 'done' && (
                <StatusChip tone="good">Parol oʻzgartirildi</StatusChip>
              )}
            </div>
          </form>
        </Card>

        {/*
          Armed state is read from the SESSION, not from anything this page
          remembers. The two-factor plugin rewrites the session cookie the
          moment `twoFactorEnabled` moves, so a reload always shows the truth
          and the section cannot get stuck claiming a lock that is not on.
          (It briefly prefers its own just-confirmed answer while that refetch
          lands — see the `confirmed` comment in TwoFactorSection.)
        */}
        <TwoFactorSection enabled={user?.twoFactorEnabled ?? false} />
      </div>
    </Shell>
  )
}

function Field({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      <input
        type="password"
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="focusable rounded-[var(--radius-panel-sm)] border px-3 py-2 text-sm"
        style={{
          background: 'var(--surface-raised)',
          borderColor: 'var(--border-strong)',
          color: 'var(--ink-primary)',
        }}
      />
    </label>
  )
}

/**
 * Four bars, and a word.
 *
 * The word is what carries the meaning: a colour-only meter says nothing to a
 * reader who cannot separate amber from green, and this is the one control on
 * the page whose whole job is to communicate a judgement.
 */
function StrengthMeter({ strength }: { strength: 0 | 1 | 2 | 3 | 4 }) {
  const words = ['juda zaif', 'zaif', 'yetarli', 'kuchli', 'juda kuchli'] as const
  const tones = [
    'var(--status-critical)',
    'var(--status-critical)',
    'var(--status-warning)',
    'var(--status-good)',
    'var(--status-good)',
  ] as const

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className="h-1 flex-1 rounded-full"
            style={{
              background: index < strength ? tones[strength] : 'var(--track)',
              transition: 'background var(--duration-enter) var(--ease-out)',
            }}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium" style={{ color: tones[strength] }}>
        {words[strength]}
      </span>
    </div>
  )
}
