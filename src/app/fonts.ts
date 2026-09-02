/**
 * Typeface.
 *
 * Inter Variable, self-hosted. Three things make it the right choice here
 * rather than a system stack:
 *
 *   - It carries Cyrillic. The portal returns Russian stage and pipeline names
 *     ("Успешно заказ", "Доставка"), so Cyrillic is content, not decoration —
 *     a Latin-only face would fall back mid-sentence and change weight.
 *   - It has real tabular figures, which is what lets a column of amounts stay
 *     aligned as the digits change. See `.tabular` in globals.css.
 *   - It has an optical-size axis. Headings are drawn with tighter spacing and
 *     a smaller x-height automatically, from the same file — the difference
 *     between a display cut and a scaled-up body cut, without a second
 *     download.
 *
 * SELF-HOSTED, not next/font/google, for two reasons. The Content-Security-
 * Policy allows `font-src 'self'` and nothing else, and a build that fetches
 * from fonts.googleapis.com fails on a host with no outbound network — which
 * is a deployment failing for a reason that has nothing to do with the deploy.
 *
 * The file is subsetted to Latin + Cyrillic + the modifier letters Uzbek needs
 * for oʻ and gʻ: 197 KB from 352 KB. `display: swap` means text is readable
 * immediately in the fallback and reflows once, rather than being invisible
 * while the font loads.
 */

import localFont from 'next/font/local'

export const inter = localFont({
  src: './fonts/InterVariable.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
  /*
    The metric-matched fallback stays ON (the default synthesises an
    'Arial'-based face with size-adjust so the swap barely moves the layout).
    This line used to read `adjustFontFallback: false` under a comment claiming
    the opposite — the one deliberate opt-out in the file was of the exact
    feature the comment said it had, and every cold load reflowed on swap.
    'Arial' is the default; written out so nobody reads absence as another
    opt-out.
  */
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
})
