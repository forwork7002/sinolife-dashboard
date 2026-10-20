import { Shell } from '@/components/layout/Shell'

/**
 * THE APPLICATION'S FRAME, DRAWN ONCE (2026-10-20).
 *
 * The rail and the header used to be drawn by every page, through
 * `PageShell`, so a click on the rail unmounted the whole application and
 * mounted it again around the next screen: the rail's own state went (its
 * scroll position, its lead badge's and the header's observers, the
 * «Yangi versiya» check, which re-read the build on every page and so took a
 * deploy for the version it was running), and the rebuild was work done on
 * the click. The client asked for page-to-page moves without a stall
 * («silliq … qotmasdan»). A layout is what Next keeps across navigations:
 * only the page under it changes.
 *
 * The page still tells the frame what it is — whether it has a reporting
 * window, which source its figures came from — through `shellChrome.ts`.
 * `/login` is outside this group and gets no frame; `/` only forwards.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>
}
