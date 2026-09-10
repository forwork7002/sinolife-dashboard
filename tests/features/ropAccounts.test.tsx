// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * OPENING A ROP ACCOUNT, AND THE TWO DECISIONS THE FORM MAKES SO AN
 * ADMINISTRATOR CANNOT.
 *
 * The client asked for «alohida ROP uchun funksiya» — a place that offers ROPs
 * rather than the whole roster, because the two fields that decide how much of
 * the company an account reads were being set by hand: the data scope, and the
 * person the scope is grown from. Both fail SILENTLY when they are wrong. A
 * ROP account left on «Butun kompaniya» reads every rival team's money and
 * looks completely normal; one anchored to somebody the tree knows nothing
 * about reads one row and looks like a broken page.
 *
 * IT USED TO BE A SECOND TAB. The screen carried two readings behind a
 * `SegmentedControl` — every account, and every department head — and an
 * administrator had to know which one opened a ROP. The heads are now a choice
 * INSIDE «+ Yangi hisob», which is where somebody who wants to open an account
 * already is. What the tab knew is kept: the list is heads rather than the 289
 * people, each one carries the size of the scope it would grant, and a head
 * who already signs in cannot be given a second login.
 *
 * So this pins what the form SENDS, not what it draws: the POST body is the
 * only thing the server sees, and it is where both mistakes would show up.
 */

const api = vi.hoisted(() => ({
  items: [] as unknown[],
  heads: [] as unknown[],
  headless: [] as unknown[],
  reads: [] as { path: string; params: Record<string, string> }[],
  writes: [] as { method: string; path: string; body: Record<string, unknown> }[],
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: async (path: string, params: Record<string, string> = {}) => {
    api.reads.push({ path, params })
    return path === '/users' && params.include === 'heads'
      ? { data: { items: api.items, heads: api.heads, headlessUnits: api.headless } }
      : { data: { items: api.items } }
  },
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>,
  )
}

/** Open «+ Yangi hisob» and switch it to the department-head reading. */
async function openRopForm() {
  renderPage()
  fireEvent.click(screen.getByRole('button', { name: '+ Yangi hisob' }))
  fireEvent.click(screen.getByRole('button', { name: 'Boʻlim rahbari (ROP)' }))
  // The picker renders straight away, disabled, while the heads are in flight —
  // waiting for the box alone would pick heads out of an empty list.
  await waitFor(() =>
    expect(screen.getByRole('option', { name: 'Rahbarni tanlang' })).toBeTruthy(),
  )
}

function chooseHead(employeeId: string) {
  fireEvent.change(screen.getByLabelText('Boʻlim rahbari'), { target: { value: employeeId } })
}

beforeEach(() => {
  api.items = []
  api.heads = [head()]
  api.headless = []
  api.reads = []
  api.writes = []
})

describe('the accounts screen', () => {
  /*
    ONE READING, NOT TWO.

    The second tab is the thing this change removes; asserting its absence is
    what stops it growing back beside the mode switch that replaced it.
  */
  it('has no second tab to find the department heads behind', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Yangi hisob' })).toBeTruthy())

    expect(screen.queryByRole('button', { name: 'ROP' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hisoblar' })).toBeNull()
  })
})

describe('opening a ROP account', () => {
  /*
    NINETEEN RECURSIVE QUERIES, ASKED ONLY WHEN SOMEBODY WANTS THEM.

    Each head's team size is resolved by the real scope resolver, one query per
    head. The accounts table needs none of it. When this lived on a tab it went
    out the moment the tab was opened and again every five minutes; now nothing
    asks until an administrator says the account is for a ROP.
  */
  it('does not ask the portal for department heads until ROP is chosen', async () => {
    renderPage()
    await waitFor(() => expect(api.reads.length).toBeGreaterThan(0))

    expect(api.reads.some((read) => read.params.include === 'heads')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '+ Yangi hisob' }))
    expect(api.reads.some((read) => read.params.include === 'heads')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Boʻlim rahbari (ROP)' }))
    await waitFor(() =>
      expect(api.reads.some((read) => read.params.include === 'heads')).toBe(true),
    )
  })

  /*
    THE LIST IS HEADS, AND EACH ONE SAYS HOW BIG IT IS.

    The size is the resolved scope, asked of the same query the request path
    uses. It is in the option text because «Lola(ROP)» and «Тошкент онлайн»
    look alike in a list and are a team and a floor of nine teams respectively.
  */
  it('offers heads with the size of the scope each one carries', async () => {
    api.heads = [
      head(),
      head({
        employeeId: 'emp-branch',
        fullName: 'Sodiqov Murod',
        heads: [{ id: 'dep-tosh', name: 'Тошкент онлайн', isSalesTeam: false, descendants: 9 }],
        teamSize: 121,
      }),
    ]

    await openRopForm()

    expect(screen.getByRole('option', { name: 'Sirojov 115 Davlatbek — 27 kishi' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Sodiqov Murod — 121 kishi' })).toBeTruthy()
  })

  /*
    THE SCOPE IS NOT A CHOICE ON THIS FORM.

    Chosen from a list that already says who heads what, offering «Butun
    kompaniya» beside it is offering the one answer that undoes the feature.
    What the choice buys is printed under it instead: the unit, the teams that
    ride along with it, and the number of people the account will read.
  */
  it('locks the scope to the team and prints what it resolves to', async () => {
    api.heads = [
      head({
        employeeId: 'emp-branch',
        fullName: 'Sodiqov Murod',
        heads: [{ id: 'dep-tosh', name: 'Тошкент онлайн', isSalesTeam: false, descendants: 9 }],
        teamSize: 121,
      }),
    ]

    await openRopForm()
    chooseHead('emp-branch')

    expect(screen.queryByRole('option', { name: 'Butun kompaniya' })).toBeNull()
    expect(screen.getAllByText('Faqat oʻz boʻlimi').length).toBeGreaterThan(0)
    expect(screen.getByText('Тошкент онлайн')).toBeTruthy()
    expect(screen.getByText('+9 ta ost-boʻlim')).toBeTruthy()
    expect(screen.getByText('121 ta xodim')).toBeTruthy()
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
    await openRopForm()
    chooseHead('emp-rop')

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
    THE NAME AND THE LOGIN COME WITH THE HEAD.

    Picking the person is the first thing this form asks, so the two fields
    that follow from it are filled rather than retyped — and the login is a
    guess the administrator can overwrite, never the floor badge.
  */
  it('fills the name and suggests a login from the head that was picked', async () => {
    await openRopForm()
    chooseHead('emp-rop')

    expect(screen.getByLabelText<HTMLInputElement>('Ism').value).toBe('Sirojov 115 Davlatbek')
    expect(screen.getByLabelText<HTMLInputElement>('Login').value).toBe('sirojov')
  })

  /*
    A HEAD WHO ALREADY SIGNS IN IS NOT OFFERED A SECOND LOGIN.

    `user.employeeId` is unique and `createUser` refuses the clash, so the
    option is disabled and says why. Correcting such an account — its scope
    above all — is done by opening its row in the table, where every field is
    unlocked.
  */
  it('will not open a second account for a head who already has one', async () => {
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

    await openRopForm()

    const option = screen.getByRole<HTMLOptionElement>('option', {
      name: 'Sirojov 115 Davlatbek — hisobi bor',
    })
    expect(option.disabled).toBe(true)
  })

  /*
    WHY A BOʻLIM YOU EXPECTED IS NOT ON THE LIST.

    Only a unit with a head can carry an account, and this portal has units
    without one — «Тошкент онлайн» names nine sales teams and no head at all.
    Unsaid, an administrator hunts the list for it, does not find it, and
    reports the screen; the field to fill is `UF_HEAD` in Bitrix24.
  */
  it('names the units nobody heads, so a missing one is not a bug report', async () => {
    api.headless = [{ id: 'dep-tosh', name: 'Тошкент онлайн', descendants: 9 }]

    await openRopForm()

    expect(screen.getByText(/Тошкент онлайн/)).toBeTruthy()
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
