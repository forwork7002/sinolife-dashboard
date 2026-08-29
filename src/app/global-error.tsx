'use client'

/**
 * The last boundary — what renders when the root layout itself failed.
 *
 * It REPLACES the root layout rather than nesting inside it, which is why it
 * carries its own `<html>` and `<body>`: by the time this shows, the layout
 * that would normally provide them is the thing that broke.
 *
 * Deliberately hook-free and provider-free. Everything this app usually leans
 * on — the query client, the theme tokens from globals.css, the fonts — is
 * reached through the layout that just failed, so any of it could be the
 * cause. The styles are inline and the colours are literals for the same
 * reason: a CSS variable resolves to nothing if the stylesheet never loaded,
 * and an error page that renders black-on-black is worse than none.
 *
 * The prop is `retry`, NOT `reset`. That rename is a breaking change in this
 * major — see node_modules/next/dist/docs/01-app/01-getting-started/
 * 10-error-handling.md — and the old name silently gives you an undefined
 * function, so the button does nothing.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="uz">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f6f7f9',
          color: '#14171f',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <main style={{ maxWidth: '26rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
            Sahifa yuklanmadi
          </h1>
          <p style={{ fontSize: '0.8125rem', lineHeight: 1.6, color: '#5b6270' }}>
            Kutilmagan xatolik yuz berdi. Qayta urinib koʻring — muammo takrorlansa,
            quyidagi kodni administratorga yuboring.
          </p>

          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: '1.25rem',
              padding: '0.625rem 1.25rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#14171f',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Qayta urinish
          </button>

          {/* The digest is the only thread back to the server log for this
              exact failure, so it is shown rather than swallowed. */}
          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontSize: '0.6875rem', color: '#8a9099' }}>
              Xato kodi: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
