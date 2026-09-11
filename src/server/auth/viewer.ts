/**
 * The viewer, as the client is allowed to know them.
 *
 * ONE BUILDER, TWO DELIVERIES. The sidebar needs these five fields before it
 * can draw an honest menu, and it gets them twice: handed down by the root
 * layout on the very first frame, then again in the `/meta/filters` payload
 * every screen fetches. The second one is what makes an administrator's edit to
 * your own account move your sidebar without a reload — so both have to exist,
 * and both have to say the SAME thing. Built in two places, a field that
 * disagreed would show up as the menu shifting a second after the page opened,
 * which is the exact symptom the handed-down copy was added to remove.
 *
 * Presentation only. `requireSection` on the page and the permission on each
 * endpoint are the boundary; this decides which doors are worth drawing.
 */

import type { Viewer } from '@/lib/viewer'
import { pagePrincipal } from './pageGuard'
import { can, type Principal } from './rbac'

export function viewerOf(principal: Principal): Viewer {
  return {
    // The viewer's own id, so the admin screen can refuse to offer an action
    // the server would reject anyway — deleting yourself.
    userId: principal.userId,
    role: principal.role,
    sections: principal.sections,
    dataScope: principal.dataScope,
    /*
      Asked of `can`, not compared against 'ADMIN'.

      Same answer for an ordinary admin and one fewer place that has to be
      edited when the permission moves — and `can` also answers false for a
      deactivated account, which a role comparison cannot.
    */
    canManageUsers: can(principal, 'users:manage'),
  }
}

/**
 * The viewer for the page being rendered, or null when nobody is signed in.
 *
 * Shares `pagePrincipal`'s per-request cache with the page's own guard, so
 * handing the sidebar its menu costs no extra database work.
 */
export async function pageViewer(): Promise<Viewer | null> {
  const principal = await pagePrincipal()
  return principal ? viewerOf(principal) : null
}
