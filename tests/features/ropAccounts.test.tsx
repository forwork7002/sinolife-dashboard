// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE ROP TAB, AND THE TWO DECISIONS IT MAKES SO AN ADMINISTRATOR CANNOT.
 *
 * The client asked for «alohida ROP uchun funksiya» — a place that offers ROPs
 * rather than the whole roster, because the two fields that decide how much of
 * the company an account reads were being set by hand: the data scope, and the
 * person the scope is grown from. Both fail SILENTLY when they are wrong. A
 * ROP account left on «Butun kompaniya» reads every rival team's money and
 * looks completely normal; one anchored to somebody the tree knows nothing
 * about reads one row and looks like a broken page.
 *
 * So this pins what the form SENDS, not what it draws: the POST body is the
 * only thing the server sees, and it is where both mistakes would show up.
 */

const api = vi.hoisted(() => ({
  items: [] as unknown[],
  heads: [] as unknown[],
  writes: [] as { method: string; path: string; body: Record<string, unknown> }[],
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: async (path: string, params: Record<string, string> = {}) =>
    path === '/users' && params.include === 'heads'
      ? { data: { items: api.items, heads: api.heads } }
      : { data: { items: api.items } },
  apiWrite: async (method: string, path: string, body: Record<string, unknown>) => {
    api.writes.push({ method, path, body })
    return { data: { id: 'created' } }
  },
}))

vi.mock('@/features/shared/PageShell', () => ({
  PageShell: ({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
  useFilterOptions: () => ({
    data: { data: { employees: [], viewer: { userId: 'admin-1' } } },
  }),
}))

const { UsersPage, loginSuggestion } = await import('@/features/users/UsersPage')

function head(overrides: Record<string, unknown> = {}) {
  return {
    employeeId: 'emp-rop',
    fullName: 'Sirojov 115 Davlatbek',
    isActive: true,
    homeDepartmentName: 'Lola(ROP)',
    heads: [{ id: 'dep-lola', name: 'Lola(ROP)', isSalesTeam: true, descendants: 0 }],
    teamSize: 27,
    account: null,
    ...overrides,
  }
}

async function openRopTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'ROP' }))
  await waitFor(() => expect(screen.getByText('27 kishi')).toBeTruthy())
}

beforeEach(() => {
  api.items = []
  api.heads = [head()]
  api.writes = []
})

describe('the ROP tab', () => {
  /*
    THE LIST IS HEADS, AND IT SAYS HOW BIG EACH ONE IS.

    The size is the resolved scope, asked of the same query the request path
    uses. It is on the row because «Lola(ROP)» and «Тошкент онлайн» look alike
    in a list and are a team and a floor of nine teams respectively.
  */
  it('offers the head, the unit they run and the size of the scope', async () => {
    api.heads = [
      head({
        employeeId: 'emp-branch',
        fullName: 'Sodiqov Murod',
        heads: [
          { id: 'dep-tosh', name: 'Тошкент онлайн', isSalesTeam: false, descendants: 9 },
        ],
        teamSize: 121,
      }),
    ]

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <UsersPage />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'ROP' }))

    await waitFor(() => expect(screen.getByText('121 kishi')).toBeTruthy())
    expect(screen.getByText('Тошкент онлайн')).toBeTruthy()
    // The branch warning: nine teams ride along with this one name.
    expect(screen.getByText('+9 ta ost-boʻlim')).toBeTruthy()
  })

  /*
    THE SCOPE IS NOT A CHOICE ON THIS FORM.

    Opened from a row that already says who heads what, offering «Butun
    kompaniya» beside it is offering the one answer that undoes the tab.
  */
  it('opens a form with no company-wide option on it', async () => {
    await openRopTab()
    fireEvent.click(screen.getByText('Sirojov 115 Davlatbek'))

    expect(screen.queryByRole('option', { name: 'Butun kompaniya' })).toBeNull()
    expect(screen.getAllByText('Faqat oʻz boʻlimi').length).toBeGreaterThan(0)
    // The consequence of the choice, before it is saved.
    expect(screen.getByText('27 ta xodim')).toBeTruthy()
  })

  /*
    WHAT THE SERVER ACTUALLY RECEIVES.

    `dataScope` and `employeeId` are the pair `assertScopeIsUsable` judges, and
    the two the administrator was previously setting by hand in two unrelated
    dropdowns. The role is SALES because a ROP reads a team and changes
    nothing, and the sections are ticked rather than left empty — an empty list
    means "follow the role", and a SALES role's defaults include two screens
    that refuse a narrowed account outright.
  */
  it('sends the team scope, the head and a usable set of sections', async () => {
    await openRopTab()
    fireEvent.click(screen.getByText('Sirojov 115 Davlatbek'))

    fireEvent.change(screen.getByLabelText('Parol'), { target: { value: 'Salom-Dunyo-42' } })
    fireEvent.change(screen.getByLabelText('Parolni takrorlang'), {
      target: { value: 'Salom-Dunyo-42' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Yaratish' }))

    await waitFor(() => expect(api.writes).toHaveLength(1))
    const write = api.writes[0]

    expect(write.method).toBe('POST')
    expect(write.path).toBe('/users')
    expect(write.body.dataScope).toBe('TEAM')
    expect(write.body.employeeId).toBe('emp-rop')
    expect(write.body.role).toBe('SALES')
    expect(write.body.sections).toEqual(['confirmation', 'sellers'])
  })

  /*
    A HEAD WHO ALREADY HAS A LOGIN IS EDITED, NOT DUPLICATED.

    `user.employeeId` is unique, so a second account for the same person is not
    a thing the server would accept — and there is nothing ROP-specific about
    changing a password or a tick, so the row opens the ordinary form with
    every field unlocked.
  */
  it('opens the ordinary account form for a head who already has one', async () => {
    api.items = [
      {
        id: 'user-1',
        name: 'Davlatbek',
        username: 'davlatbek',
        email: 'davlatbek@sinolife.local',
        role: 'SALES',
        isActive: true,
        sections: ['sellers'],
        dataScope: 'ALL',
        employeeId: 'emp-rop',
        employeeName: 'Sirojov 115 Davlatbek',
        twoFactorEnabled: false,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]
    api.heads = [
      head({
        account: {
          id: 'user-1',
          username: 'davlatbek',
          isActive: true,
          dataScope: 'ALL',
          sections: ['sellers'],
        },
      }),
    ]

    await openRopTab()
    // The tab flags it: a ROP whose account still reads the whole company.
    expect(screen.getByText('Butun kompaniya')).toBeTruthy()

    fireEvent.click(screen.getByText('Sirojov 115 Davlatbek'))
    // The free form, so the scope can be corrected.
    expect(screen.getByRole('option', { name: 'Butun kompaniya' })).toBeTruthy()
  })
})

describe('the login the ROP form suggests', () => {

  /*
    THE FLOOR BADGE IS NOT A LOGIN.

    Ninety of this portal's 289 names carry a bare 2–4 digit badge and it is
    not always at the end — «Sirojov 115 Davlatbek», «130-Salomat Shoimova».
    Taking "the first word" without asking whether it contains a letter hands a
    ROP the login «115», which the administrator then has to notice before
    saving rather than after telling them.
  */
  it('never suggests the floor badge', () => {
    expect(loginSuggestion('Sirojov 115 Davlatbek')).toBe('sirojov')
    expect(loginSuggestion('130-Salomat Shoimova')).toBe('salomat')
  })

  /*
    A CYRILLIC NAME GIVES UP QUIETLY.

    About a fifth of the roster is spelled in Cyrillic and the login character
    set is ASCII. An empty box the administrator fills in is a better answer
    than a transliteration this file would have to invent — and inventing one
    is how two people end up with logins nobody can predict.
  */
  it('leaves the box empty rather than transliterating', () => {
    expect(loginSuggestion('Содиков Мурод')).toBe('')
    expect(loginSuggestion(undefined)).toBe('')
  })
})
