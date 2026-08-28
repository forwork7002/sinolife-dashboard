'use client'

import { useId } from 'react'

/**
 * The field you type a second factor into.
 *
 * ONE COMPONENT FOR BOTH FLOWS, AND THAT IS THE POINT. The same control is
 * used to confirm the first code during enrolment on /account and to answer
 * the challenge on /login. Written twice, the two would drift — one would grow
 * paste handling, the other would keep a text keyboard on a phone — and the
 * flow that drifted would be the recovery one, which is the flow nobody
 * rehearses and everybody needs at the worst possible moment.
 *
 * It lives under `features/account/` because that is where the two-factor UI
 * lives; the login page imports it rather than owning a second copy.
 *
 * WHAT THE TWO MODES ACTUALLY CHANGE.
 *
 *   'totp'   Six digits. `inputMode="numeric"` puts the phone's number pad up
 *            instead of a full keyboard — the single biggest difference
 *            between this being pleasant and being fiddly on a phone.
 *            `autoComplete="one-time-code"` is what lets iOS offer the code
 *            straight from the notification. Everything that is not a digit is
 *            dropped as it arrives, so a code pasted with a space in the
 *            middle — which is how authenticator apps display it — just works.
 *
 *   'backup' Eleven characters, `xxxxx-xxxxx`. NOT uppercased, NOT
 *            lowercased: better-auth compares the backup code by exact string
 *            equality against a mixed-case alphabet, so "helpfully" changing
 *            the case is how a valid recovery code gets rejected while the
 *            owner is locked out. The one normalisation applied is inserting
 *            the dash when ten bare characters are typed or pasted, because
 *            the generated format always has it in the same place, and a
 *            person copying from paper will not always type it.
 *
 * Enter submits because this is a real <input> inside a real <form>. There is
 * no auto-submit on the sixth digit: a code typed one digit wrong would fire a
 * request before the reader had finished looking at it, and each wasted
 * attempt comes out of a budget that ends in a fifteen-minute lock.
 */
export function CodeField({
  mode,
  value,
  onChange,
  label,
  hint,
  autoFocus = false,
  disabled = false,
}: {
  mode: 'totp' | 'backup'
  value: string
  onChange: (value: string) => void
  label: string
  hint?: string
  autoFocus?: boolean
  disabled?: boolean
}) {
  const id = useId()
  const hintId = `${id}-hint`

  const accept = (raw: string) =>
    onChange(mode === 'totp' ? acceptDigits(raw) : acceptBackupCode(raw))

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-medium"
        style={{ color: 'var(--ink-secondary)' }}
      >
        {label}
      </label>
      <input
        id={id}
        // `text`, not `number`: a number input strips leading zeros, and a
        // TOTP code beginning with 0 is one code in ten.
        type="text"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-describedby={hint ? hintId : undefined}
        inputMode={mode === 'totp' ? 'numeric' : 'text'}
        autoComplete={mode === 'totp' ? 'one-time-code' : 'off'}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        // Tells a phone keyboard to show "Go" rather than a newline glyph.
        enterKeyHint="go"
        maxLength={mode === 'totp' ? 6 : 11}
        onChange={(event) => accept(event.target.value)}
        onPaste={(event) => {
          if (mode !== 'totp') return
          // Pull the six-digit run out of whatever was pasted. Filtering
          // digits alone is not enough: "SinoLife 2FA: 123456" filters to
          // "2123456" and the leading 2 would push the last digit off the end.
          const pasted = event.clipboardData.getData('text')
          const run = /(?<!\d)\d{6}(?!\d)/.exec(pasted)
          if (!run) return
          event.preventDefault()
          onChange(run[0])
        }}
        className="focusable tabular rounded-[var(--radius-panel-sm)] border px-3 text-center font-semibold"
        style={{
          background: 'var(--surface-raised)',
          borderColor: 'var(--border-strong)',
          color: 'var(--ink-primary)',
          /*
            Deliberately larger than every other input in the app: 44px tall
            with letter spacing, so it is a comfortable touch target and each
            character is separable at a glance when checking a code against a
            phone held in the other hand.
          */
          height: '44px',
          fontSize: mode === 'totp' ? '20px' : '16px',
          letterSpacing: mode === 'totp' ? '0.32em' : '0.06em',
          // The spacing above adds a gap after the LAST character too, which
          // visually shifts the whole value left of centre.
          textIndent: mode === 'totp' ? '0.32em' : '0.06em',
        }}
      />
      {hint && (
        <p id={hintId} className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

/** Digits only, at most six. */
function acceptDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6)
}

/**
 * `xxxxx-xxxxx`, with the dash supplied when it is missing.
 *
 * Whitespace goes (paper, phone keyboards and clipboards all add it) and
 * anything outside the generated alphabet goes with it. Case is preserved —
 * see the component comment; this is the one place where being helpful would
 * lock the owner out.
 */
function acceptBackupCode(raw: string): string {
  const body = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, 10)
  return body.length > 5 ? `${body.slice(0, 5)}-${body.slice(5)}` : body
}
