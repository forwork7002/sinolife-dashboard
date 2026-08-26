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
  // The palette ships light and dark steps; let the browser chrome follow.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#08090c' },
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
