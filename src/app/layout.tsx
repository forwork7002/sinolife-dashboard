import type { Metadata, Viewport } from 'next'

import './globals.css'
import { pageViewer } from '@/server/auth/viewer'
import { inter } from './fonts'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'SinoLife — Savdo tahlili',
  description: 'SinoLife ichki savdo tahlili va boshqaruv paneli',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The shell paints edge to edge and pads its own bar and floor with the
  // safe-area insets; without `cover` a notched phone letterboxes the app
  // in white above the header instead.
  viewportFit: 'cover',
  /*
    The palette ships light and dark steps; let the browser chrome follow.

    This pair answers for «Tizim» only. A reader who forces a theme gets a
    third, media-less meta prepended ahead of these by `lib/theme.ts` — the
    first matching one wins, and these two are keyed to exactly the setting a
    forced theme is overriding.
  */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#050609' },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  /*
    WHO IS READING, BEFORE THE FIRST FRAME.

    The sidebar is a client component, and both of the things that tell it which
    links to draw — the session and `/meta/filters` — are round trips that cannot
    have answered yet when this HTML is built. It used to fill that second by
    drawing every destination in the product, so a salesperson signed in and met
    the administrator's menu, «Foydalanuvchilar» included, for about a second
    before it collapsed to the four links they hold. The client reported it as a
    bug in the accounts screen, which is where they had just opened the account.

    Resolved HERE rather than per page because there is no dashboard layout: ten
    pages render the shell through `PageShell`, and threading a prop through all
    ten features to reach it is ten chances to forget. It shares the page guard's
    per-request cache, so it costs no extra query — see `pagePrincipal`.

    This is the same reasoning as the theme script below: a first paint that is
    wrong and then corrects itself is read as the application being broken, and
    the fix is always to know the answer before painting rather than to paint
    faster.
  */
  const viewer = await pageViewer()

  return (
    <html lang="uz" className={inter.variable} suppressHydrationWarning>
      <body>
        {/*
          THE THEME, BEFORE THE FIRST PIXEL.

          `lib/theme.ts` owns the preference; this runs the one line of it that
          cannot wait for the bundle. Parsed here, at the top of the body, the
          attribute is on <html> before any of the page below it is laid out,
          so a reader who chose dark never sees the white flash that a
          hydration-time apply would give them on every cold load — which on a
          screen left open all day is the whole difference between a dark theme
          and a dark theme that blinks at you.

          The key is written out rather than imported for the same reason: a
          script that must run before hydration cannot import a client module.
          It is `sinolife.theme.v1` in `lib/theme.ts`; the two have to move
          together, and `tests/features/theme.test.ts` is what notices when one
          of them moves alone.

          Wrapped in try/catch because a private window or blocked site data
          must cost a colour, not a render, and `suppressHydrationWarning`
          because the attribute this writes is on the very element React is
          about to reconcile.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var c=localStorage.getItem('sinolife.theme.v1');" +
              "if(c==='light'||c==='dark')" +
              "document.documentElement.setAttribute('data-theme',c)}catch(e){}",
          }}
        />
        <Providers viewer={viewer}>{children}</Providers>
      </body>
    </html>
  )
}
