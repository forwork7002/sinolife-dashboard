// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * «HISOB» HYDRATES ON WHAT THE SERVER PRINTED, THEN SHOWS THE ACCOUNT.
 *
 * The server has no session store and prints «—» for the name, the login and
 * the role. Since 2026-10-20 the shell around this page is the `(app)`
 * layout's and hydrates before it, asking for the session as it does — so by
 * the time the page hydrates the browser's store can already hold the account,
 * and printing it then was a hydration mismatch (React #418 on a local build:
 * the page thrown away and drawn again). Pinned as it happens: server markup
 * with no session, hydration with one.
 */

const auth = vi.hoisted(() => ({ user: undefined as unknown }))

vi.mock('@/lib/authClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authClient')>()),
  useSession: () => ({ data: auth.user ? { user: auth.user } : undefined, isPending: !auth.user }),
}))

const { AccountPage } = await import('@/features/account/AccountPage')

afterEach(() => {
  auth.user = undefined
  document.body.innerHTML = ''
})

describe('AccountPage', () => {
  it('hydrates on the server’s «—» with no mismatch, and then names the account', async () => {
    auth.user = undefined
    const html = renderToString(<AccountPage />)
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    auth.user = { id: 'u1', name: 'Dilnoza Karimova', email: 'dilnoza@sinolife.uz', role: 'SALES' }
    const recoverable: unknown[] = []
    await act(async () => {
      hydrateRoot(container, <AccountPage />, { onRecoverableError: (error) => recoverable.push(error) })
    })

    expect(recoverable).toEqual([])
    expect(container.textContent).toContain('Dilnoza Karimova')
    expect(container.textContent).toContain('dilnoza@sinolife.uz')
  })
})
