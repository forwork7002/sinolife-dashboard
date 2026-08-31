import type { Metadata, Viewport } from 'next'

import './globals.css'
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
  // The palette ships light and dark steps; let the browser chrome follow.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#050609' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uz" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
