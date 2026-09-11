'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { DataScopeValue } from './dataScope'
import type { RoleValue } from './roles'
import type { SectionValue } from './sections'

/**
 * Who is looking, as the SERVER already knew it when it rendered the page.
 *
 * WHY THIS EXISTS AT ALL, since the same five fields also ride `/meta/filters`.
 * The sidebar is drawn by a client component, and the two things that tell it
 * what to draw — `useSession()` and that payload — are both round trips. Neither
 * can have answered during the server render or on the first client one, so for
 * about a second the rail knew nothing about the person reading it. It filled
 * that second by showing EVERY destination, «Foydalanuvchilar» included, and a
 * salesperson's first impression of the dashboard was the administrator's menu
 * blinking at them. See `tests/features/navColdLoad.test.tsx`.
 *
 * Every page is `force-dynamic` and sits behind a guard that has already
 * resolved the principal, so the answer was on the server the whole time. The
 * root layout reads it once (`pageViewer`) and hands it down through this
 * context; `src/server/auth/viewer.ts` builds the object, and the same function
 * builds the one `/meta/filters` returns, so the handed-down value and the
 * fetched one cannot disagree and make the menu move when the payload lands.
 *
 * PRESENTATION ONLY, exactly like the payload it mirrors. The page guard and
 * every endpoint's permission are what actually refuse access; this only keeps
 * the rail from offering a door it knows is locked.
 */
export interface Viewer {
  readonly userId: string
  readonly role: RoleValue
  readonly sections: readonly SectionValue[]
  readonly dataScope: DataScopeValue
  readonly canManageUsers: boolean
}

/**
 * `null` is "nobody is signed in", which is a real state — `/login` renders
 * under the same layout. It is NOT "we do not know yet": the server always
 * knows, so a consumer that reads null must fail closed rather than guess.
 */
const ViewerContext = createContext<Viewer | null>(null)

export function ViewerProvider({
  value,
  children,
}: {
  value: Viewer | null
  children: ReactNode
}) {
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>
}

export function useServerViewer(): Viewer | null {
  return useContext(ViewerContext)
}
