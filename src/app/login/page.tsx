'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { signIn } from '@/lib/authClient'

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
 */
function describe(error: { status?: number; code?: string; message?: string }): string {
  if (error.code === 'INVALID_ORIGIN' || error.status === 403) {
    return `Bu manzildan kirish mumkin emas. Ilovani ${process.env.NEXT_PUBLIC_APP_URL ?? 'toʻgʻri manzil'} orqali oching.`
  }
  if (error.status === 401 || error.status === 400) {
    return 'Email yoki parol notoʻgʻri.'
  }
  if (error.status && error.status >= 500) {
    return 'Server javob bermadi. Birozdan soʻng qayta urinib koʻring.'
  }
  return error.message
    ? `Kirish amalga oshmadi: ${error.message}`
    : 'Kirish amalga oshmadi. Internet aloqasini tekshiring.'
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

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      const result = await signIn.email({ email, password })

      if (result.error) {
        setError(describe(result.error))
        setPending(false)
        return
      }
    } catch (cause) {
      // A rejected promise here is the network, not the credentials.
      setError(cause instanceof Error ? `Kirish amalga oshmadi: ${cause.message}` : 'Kirish amalga oshmadi.')
      setPending(false)
      return
    }

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
    const next = params.get('next')
    const destination = next && /^\/(?!\/)/.test(next) ? next : '/'

    router.push(destination)
    router.refresh()
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-10"
      style={{ background: 'var(--page)' }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl text-base font-bold"
            style={{ background: 'var(--series-1)', color: 'var(--ink-on-series)' }}
            aria-hidden="true"
          >
            S
          </span>
          <div>
            <p className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>
              SinoLife
            </p>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Savdo tahlili paneli
            </p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border p-6"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--ink-primary)' }}>
            Tizimga kirish
          </h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-secondary)' }}>
            Hisobingiz bilan davom eting.
          </p>

          <label className="mt-5 block">
            <span className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="username"
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
              Parol
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
              className="mt-3 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs"
              style={{
                background: 'color-mix(in oklab, var(--status-critical) 12%, transparent)',
                color: 'var(--ink-primary)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
            className="mt-5 w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{ background: 'var(--ink-primary)', color: 'var(--surface)' }}
          >
            {pending ? 'Kirilmoqda…' : 'Kirish'}
          </button>
        </form>

        {/*
          No credential hint.

          The demo accounts this box used to advertise are gone: the
          deployment provisions one administrator from environment variables.
          Printing any address here would hand an attacker a valid username
          for free, which is the same reason the error above never says which
          of the two fields was wrong.
        */}
        <p className="mt-4 text-center text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Kirish maʼlumotlari administrator tomonidan beriladi.
        </p>
      </div>
    </main>
  )
}
