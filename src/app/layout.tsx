import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'

import './globals.css'
import { AppFrame } from '@/components/layout/AppFrame'
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
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
          together. Nothing else is duplicated — this sets the attribute and
          stops, and every token behind it lives in globals.css.

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
        <Providers>
          {/*
            The shell mounts HERE, once, so navigation swaps only the page
            under it — see AppFrame for what rebuilding it per page cost.

            The Suspense boundary is for the build, not the eye: the shell
            reads `useSearchParams`, and a statically prerendered path (the
            not-found page) cannot answer that on the server, so without a
            boundary `next build` fails on it. Every real screen is
            force-dynamic and never shows the fallback.
          */}
          <Suspense fallback={null}>
            <AppFrame>{children}</AppFrame>
          </Suspense>
        </Providers>
      </body>
    </html>
  )
}
