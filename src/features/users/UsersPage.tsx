'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DataTable, InitialChip, type Column } from '@/components/ui/DataTable'
import {
  CheckCircleGlyph,
  DashGlyph,
  EyeGlyph,
  EyeOffGlyph,
  TrashGlyph,
} from '@/components/ui/Icons'
import { SegmentedControl } from '@/components/ui/Controls'
import { StatusChip } from '@/components/ui/Stat'
import { PageShell, useFilterOptions } from '@/features/shared/PageShell'
import {
  apiGet,
  apiWrite,
  type DepartmentHeadDto,
  type UserRowDto,
  type UsersPageDto,
} from '@/lib/api'
import { MIN_PASSWORD_LENGTH } from '@/lib/passwordPolicy'
import {
  DATA_SCOPE_HINTS,
  DATA_SCOPE_LABELS,
  DATA_SCOPE_VALUES,
  type DataScopeValue,
} from '@/lib/dataScope'
import { ROLE_HINTS, ROLE_LABELS, ROLE_VALUES, type RoleValue } from '@/lib/roles'
import { SECTIONS, companyWideSections, defaultSectionsFor } from '@/lib/sections'

/**
 * Account administration.
 *
 * WHAT AN ADMINISTRATOR DECIDES HERE, in the order the screen asks it:
 *   1. WHO — name, login, and a password they hand over themselves.
 *   2. WHAT THEY MAY CHANGE — the role. Administering accounts, editing KPI
 *      plans. It says nothing about what they READ.
 *   3. WHICH SCREENS — the section ticks. This is the reach boundary: the page
 *      redirects and the endpoint refuses, so an unticked screen cannot be
 *      opened by typing its URL either.
 *   4. HOW MUCH OF EACH — the data scope. The whole company, one team, or one
 *      linked salesperson's own records.
 *
 * WHY 2 AND 4 ARE SEPARATE QUESTIONS. They used to be one, and the answer was
 * the role: the only account that saw the company's numbers was one that could
 * also administer the company. So an administrator would create a salesperson,
 * tick six sections, hand over the password — and the person would open all
 * six screens and find every figure blank or refused, with nothing on this
 * form to explain why. Splitting the two makes "read-only, whole company" a
 * thing this screen can express, and it is now the default.
 *
 * WHY "not configured" IS A STATE AND NOT AN EMPTY SET. An account with no
 * ticks follows its role's defaults, so every account that predates this
 * screen keeps working. The table says so in words rather than showing an
 * empty cell that reads as "sees nothing".
 *
 * ONE READING, NOT TWO. This screen carried a `SegmentedControl` — «Hisoblar»,
 * every account, and «ROP», every department head — and the second tab was the
 * only way to open a team-scoped account. An administrator who wanted to give
 * a ROP a login had to know that the button marked «+ Yangi hisob» was the
 * wrong one. The heads are now a CHOICE INSIDE that button, which is where
 * somebody opening an account already is. Everything the tab knew is kept, in
 * `HeadPicker`: the list is heads rather than the 289-name roster, each option
 * carries the size of the scope it grants, a head who already signs in is
 * refused a second login, and the units nobody heads are named.
 */
export function UsersPage() {
  const queryClient = useQueryClient()
  // Shares react-query's cache with PageShell, so this costs no extra request.
  const viewerId = useFilterOptions().data?.data.viewer?.userId
  const [editing, setEditing] = useState<UserRowDto | null>(null)
  const [creating, setCreating] = useState(false)

  const query = useQuery({
    queryKey: ['users'],
    queryFn: ({ signal }) => apiGet<UsersPageDto>('/users', {}, signal),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] })
    // The viewer's own sections ride the filters payload, so a change to your
    // own account has to invalidate that too or the sidebar stays stale.
    void queryClient.invalidateQueries({ queryKey: ['filters'] })
  }

  /*
    FIVE COLUMNS, DOWN FROM EIGHT.

    «Yaratilgan» and a column of its own for 2FA were answering questions
    nobody opens this screen to ask, and the eighth column pushed `minWidth`
    past 1100 — a horizontal scrollbar on the laptop the office actually uses.
    The role and the data scope moved into ONE cell because they are read
    together: "what may this person change, and how much do they see". 2FA
    rides beside the status as a glyph, where it is still visible at a glance.
  */
  const columns: Column<UserRowDto>[] = [
    {
      key: 'name',
      rowHeader: true,
      header: 'Xodim',
      render: (row) => (
        <span className="flex items-center gap-2">
          <InitialChip name={row.name} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-medium" style={{ color: 'var(--ink-primary)' }}>
                {row.name}
              </span>
              {/*
                A team-scoped account IS a ROP account — that is the whole
                definition — so the tab that used to list them separately is
                replaced by a mark on the row they were already on.
              */}
              {row.dataScope === 'TEAM' && <StatusChip tone="neutral">ROP</StatusChip>}
            </span>
            <span className="block truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {row.username ?? row.email}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'access',
      header: 'Kirish huquqi',
      width: '210px',
      render: (row) => (
        <span className="block min-w-0">
          <span className="block truncate text-[12px]" style={{ color: 'var(--ink-primary)' }}>
            {ROLE_LABELS[row.role]}
          </span>
          <span className="block truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {DATA_SCOPE_LABELS[row.dataScope]}
          </span>
        </span>
      ),
    },
    {
      key: 'sections',
      header: 'Boʻlimlar',
      width: '150px',
      render: (row) =>
        row.sections.length === 0 ? (
          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Rol boʻyicha ({defaultSectionsFor(row.role).length} ta)
          </span>
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
            {row.sections.length} ta tanlangan
          </span>
        ),
    },
    {
      key: 'employee',
      header: 'Bogʻlangan xodim',
      render: (row) => row.employeeName ?? <span style={{ color: 'var(--ink-muted)' }}>—</span>,
    },
    {
      key: 'isActive',
      header: 'Holat',
      width: '150px',
      render: (row) => (
        <span className="flex items-center gap-1.5">
          {row.isActive ? (
            <StatusChip tone="good">Faol</StatusChip>
          ) : (
            <StatusChip tone="critical">Faol emas</StatusChip>
          )}
          {/*
            2FA, as a glyph rather than a column. It matters — an administrator
            account without it is the weakest door in the building — but it is
            one bit, and a whole column of dashes was spending 80px to say so.
          */}
          <span
            title={row.twoFactorEnabled ? '2FA yoqilgan' : '2FA yoqilmagan'}
            style={{ color: row.twoFactorEnabled ? 'var(--status-good)' : 'var(--ink-muted)' }}
          >
            {row.twoFactorEnabled ? <CheckCircleGlyph size={13} /> : <DashGlyph size={13} />}
          </span>
        </span>
      ),
    },
  ]

  const items = query.data?.data.items ?? []

  return (
    <PageShell
      period={false}
      title="Foydalanuvchilar"
      description="Kim kira oladi, qaysi boʻlimlarni ochadi va har birida qancha maʼlumot koʻradi."
      accent="var(--series-7)"
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          + Yangi hisob
        </Button>
      }
    >
      <Card className="card-hero brackets px-4 py-4">
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
          onRowClick={(row) => setEditing(row)}
          minWidth={860}
          emptyTitle="Hisob yoʻq"
          emptyBody="Hali hech kimga hisob ochilmagan."
        />
      </Card>

      {creating && (
        <UserDialog
          title="Yangi hisob"
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            refresh()
          }}
        />
      )}

      {editing && (
        <UserDialog
          title={editing.name}
          user={editing}
          isSelf={editing.id === viewerId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refresh()
          }}
        />
      )}
    </PageShell>
  )
}

/**
 * The two kinds of account, asked as the first question on the create form.
 *
 * They differ in exactly the two fields that fail SILENTLY when they are
 * wrong: the data scope, and the person the scope is grown from. A ROP account
 * left on «Butun kompaniya» reads every rival team's money and looks perfectly
 * normal; one anchored to somebody the department tree knows nothing about
 * reads a single row and looks like a broken page. Asking the question once,
 * in words, is what keeps an administrator from having to get both right in
 * two unrelated dropdowns.
 */
type AccountKind = 'plain' | 'rop'

const KINDS: readonly { readonly value: AccountKind; readonly label: string }[] = [
  { value: 'plain', label: 'Oddiy hisob' },
  { value: 'rop', label: 'Boʻlim rahbari (ROP)' },
]

/**
 * A first guess at the login, from the person's name.
 *
 * A GUESS, AND EDITABLE — it fills the field, it does not own it. Names on this
 * portal carry a floor badge as a bare number («Sirojov 115 Davlatbek»,
 * «130-Salomat Shoimova»), and about a fifth of them are Cyrillic, so this
 * takes the first ASCII word that actually contains a letter and gives up
 * quietly when there is none. An empty box the administrator has to fill is a
 * far better outcome than a login of «115» handed to a ROP.
 */
export function loginSuggestion(fullName: string | undefined): string {
  if (!fullName) return ''
  return (
    fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .find((word) => word.length >= 3 && /[a-z]/.test(word)) ?? ''
  )
}

/**
 * Create or edit, in one form.
 *
 * The two differ in exactly three places — the password is required on create
 * and optional on edit, only an existing account can be switched off, and the
 * kind switch is a question you can only answer once — so splitting them into
 * two components would duplicate the section grid, the role picker and the
 * error handling to avoid three conditionals.
 */
function UserDialog({
  title,
  user,
  isSelf = false,
  onClose,
  onSaved,
}: {
  title: string
  user?: UserRowDto
  /** Your own account. Deletion is not offered on it. */
  isSelf?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const editing = user !== undefined

  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  // One toggle for both password fields: they must match, so reading one
  // without the other tells you nothing about why they do not.
  const [showPassword, setShowPassword] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [kind, setKind] = useState<AccountKind>('plain')
  /*
    SALES on a new account, and it is already the default for everybody.

    Role says what an account may CHANGE, not what it reads — a ROP reads a
    whole team and changes nothing. The picker stays enabled: the client may
    want a particular ROP to own their team's KPI plans, and that is a MANAGER.
  */
  const [role, setRole] = useState<RoleValue>(user?.role ?? 'SALES')
  /*
    ALL on a new account, deliberately.

    An administrator opening this form is handing someone screens; the useful
    default is that those screens have numbers on them. The narrower scopes are
    the rarer intent and have to be chosen — along with the person they narrow
    to.
  */
  const [dataScope, setDataScope] = useState<DataScopeValue>(user?.dataScope ?? 'ALL')
  const [employeeId, setEmployeeId] = useState<string>(user?.employeeId ?? '')
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [sections, setSections] = useState<string[]>([...(user?.sections ?? [])])

  // The roster the filter bar already loaded, reused rather than refetched.
  const employees = useFilterOptions().data?.data.employees ?? []

  /*
    ONLY EXISTING ACCOUNTS ARE EDITED AS ORDINARY ONES.

    A head who already signs in opens the table row, not this switch: nothing
    about changing their password or a tick is ROP-specific, and their scope is
    corrected in the unlocked «Maʼlumot doirasi» dropdown like anybody else's.
  */
  const isRop = !editing && kind === 'rop'

  /*
    THE HEADS, ASKED FOR ONLY WHEN SOMEBODY WANTS ONE.

    Each option's team size is resolved by the real scope resolver, one
    recursive query per head — roughly nineteen on this portal. When this list
    lived behind a tab it went out the moment the tab was opened and again
    every five minutes; nothing polls it now, because a modal that is open for
    a minute has nothing to learn from a second answer. The five-minute
    `staleTime` is what makes reopening the form instant: the roster changes
    when Bitrix24 names a new head, which reaches us through the sync worker's
    reference-data pass, not while the administrator is typing a password.
  */
  const headsQuery = useQuery({
    queryKey: ['users', 'heads'],
    queryFn: ({ signal }) => apiGet<UsersPageDto>('/users', { include: 'heads' }, signal),
    enabled: isRop,
    staleTime: 300_000,
  })
  const heads = headsQuery.data?.data.heads ?? []
  const headlessUnits = headsQuery.data?.data.headlessUnits ?? []
  /*
    THE SELECTED HEAD IS DERIVED FROM `employeeId`, NEVER STORED BESIDE IT.

    Two pieces of state for one choice is how a form ends up sending a scope
    anchored to one person while showing the team size of another — and the
    number on screen is the only thing standing between an administrator and
    granting a branch of nine teams by accident.
  */
  const head: DepartmentHeadDto | undefined = heads.find((row) => row.employeeId === employeeId)

  /*
    SWITCHING THE KIND RESETS THE THREE FIELDS THAT FOLLOW FROM IT.

    The scope, the person it is anchored to and the opening set of ticks are
    answers to the kind question, not to anything the administrator typed. A
    switch that left the previous kind's scope behind would produce exactly the
    silent mismatch this form exists to prevent.

    THE ROP TICKS ARE NOT EMPTY, and that is deliberate. An empty list means
    "follow the role", and a SALES role's defaults include the command centre
    and Logistika — two screens that aggregate across the whole company and
    refuse a narrowed account outright. Tasdiqlash and Sotuvchilar both narrow
    correctly and are the two the client asked for the account for. Every tick
    stays editable.
  */
  const switchKind = (next: AccountKind) => {
    setKind(next)
    setEmployeeId('')
    setDataScope(next === 'rop' ? 'TEAM' : 'ALL')
    setSections(next === 'rop' ? ['confirmation', 'sellers'] : [])
  }

  /*
    PICKING THE HEAD FILLS THE NAME AND GUESSES THE LOGIN.

    On the ROP form the person is the FIRST thing chosen, so retyping a name
    the list just showed is pure transcription — and transcription of names
    like «Sirojov 115 Davlatbek» is where the typos are.
  */
  const chooseHead = (id: string) => {
    setEmployeeId(id)
    const picked = heads.find((row) => row.employeeId === id)
    if (!picked) return
    setName(picked.fullName)
    setUsername(loginSuggestion(picked.fullName))
  }

  const save = useMutation({
    mutationFn: async () => {
      if (password && password !== confirm) {
        throw new Error('Parollar mos kelmadi.')
      }
      if (editing) {
        return apiWrite<UserRowDto>('PATCH', `/users/${user.id}`, {
          name,
          role,
          isActive,
          sections,
          dataScope,
          // Empty means "no link", which is a legitimate state for a
          // company-wide account and is stored as null rather than ''.
          employeeId: employeeId === '' ? null : employeeId,
          // Only when it actually changed: sending the same login back would
          // still rewrite the synthesised email and write an audit entry
          // describing a change that did not happen.
          ...(username.trim() && username.trim() !== (user.username ?? '')
            ? { username: username.trim() }
            : {}),
          ...(password ? { password } : {}),
        })
      }
      return apiWrite<UserRowDto>('POST', '/users', {
        name,
        username,
        password,
        role,
        sections,
        dataScope,
        employeeId: employeeId === '' ? null : employeeId,
      })
    },
    onSuccess: onSaved,
  })

  const remove = useMutation({
    mutationFn: () => apiWrite<{ id: string }>('DELETE', `/users/${user!.id}`, {}),
    onSuccess: onSaved,
  })

  const toggle = (id: string) =>
    setSections((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    )

  const groups = [...new Set(SECTIONS.map((s) => s.group))]
  const roleDefaults = defaultSectionsFor(role)
  // What the ticks resolve to: an empty list follows the role, and the
  // warning has to judge what the account will ACTUALLY hold.
  const effective = sections.length > 0 ? sections : roleDefaults
  const blockedByScope = companyWideSections(effective)
  /*
    BOTH NARROWED SCOPES NEED THE LINK, and for the same reason.

    OWN resolves to that person's rows; TEAM grows the department subtree from
    that person's record. Neither has anything to start from without it, and
    the server refuses both — so the form has to warn about both or it lets an
    administrator save a combination that comes back as a red field.
  */
  const scopeIsNarrowed = dataScope !== 'ALL'
  const scopeNeedsEmployee = scopeIsNarrowed && employeeId === ''

  return (
    // A modal, because this is a decision that should not be half-made while
    // the table behind it changes under a refetch.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: 'color-mix(in oklab, black 55%, transparent)' }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <Card className="w-full max-w-3xl px-5 py-5">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--ink-primary)' }}>
              {title}
            </h2>
            {editing && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                {user.username ?? user.email}
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Yopish
          </Button>
        </header>

        {!editing && (
          <div className="mb-4">
            <SegmentedControl
              value={kind}
              options={KINDS}
              onChange={switchKind}
              ariaLabel="Hisob turi"
            />
          </div>
        )}

        {isRop && (
          <div className="mb-4">
            <HeadPicker
              heads={heads}
              headlessUnits={headlessUnits}
              selected={head}
              isPending={headsQuery.isPending}
              isError={headsQuery.isError}
              onChoose={chooseHead}
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ism">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="focusable w-full rounded-[var(--radius-panel-sm)] border px-2.5 py-1.5 text-sm"
              style={{
                background: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--ink-primary)',
              }}
            />
          </Field>

          <Field label="Login">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              /*
                Editable, including your own.

                It is what the person types to sign in, so changing it strands
                them until they are told the new one — which is why the hint
                below says so rather than the field being locked. An
                administrator who has to keep a login they typed wrong has no
                way to fix it, and that is the worse failure.
              */
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={editing && !user.username ? user.email : 'masalan: dilnoza'}
              className="focusable w-full rounded-[var(--radius-panel-sm)] border px-2.5 py-1.5 text-sm"
              style={{
                background: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--ink-primary)',
              }}
            />
            {editing && (
              <span className="mt-1 block text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                {user.username
                  ? 'Oʻzgartirsangiz, xodim yangi login bilan kiradi — unga aytishni unutmang.'
                  : `Hozir email bilan kiradi (${user.email}). Login qoʻysangiz, ikkalasi ham ishlaydi.`}
              </span>
            )}
          </Field>

          <Field label={editing ? 'Yangi parol (ixtiyoriy)' : 'Parol'}>
            <PasswordInput
              value={password}
              onChange={setPassword}
              shown={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
              /*
                The floor, read from the policy rather than typed.

                It said «12» while `checkPassword` accepted 8 — the file's own
                header records the deliberate move down — so the form was
                turning away passwords the server would have taken, on the one
                screen where an administrator is inventing a credential for
                somebody else.
              */
              placeholder={
                editing
                  ? 'Oʻzgartirmasangiz boʻsh qoldiring'
                  : `Kamida ${MIN_PASSWORD_LENGTH} ta belgi`
              }
            />
          </Field>

          <Field label="Parolni takrorlang">
            <PasswordInput
              value={confirm}
              onChange={setConfirm}
              shown={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
            />
          </Field>

          <Field label="Rol">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RoleValue)}
              className="focusable w-full rounded-[var(--radius-panel-sm)] border px-2.5 py-1.5 text-sm"
              style={{
                background: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--ink-primary)',
              }}
            >
              {ROLE_VALUES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
            {/*
              What the role does, spelled out under it.

              It no longer decides what anybody SEES, and an administrator who
              still reads it that way picks the wrong one and then wonders why
              the ticks below did not take effect.
            */}
            <span className="mt-1 block text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
              {ROLE_HINTS[role]}
            </span>
          </Field>

          <Field label="Maʼlumot doirasi">
            {/*
              LOCKED ON THE ROP FORM, and shown rather than hidden.

              The kind switch above already said this account follows one
              team; offering «Butun kompaniya» beside it invites the one
              mistake the switch exists to remove. Printed as a chip instead of
              a disabled `<select>` because a greyed-out control reads as
              "broken here" rather than "already decided" — and the hint
              underneath is the same sentence the ordinary form shows, so the
              two readings cannot describe the scope differently.

              To give a head something OTHER than their own floor, save the
              account and open its row, where every field is unlocked.
            */}
            {isRop ? (
              <div
                className="rounded-[var(--radius-panel-sm)] border px-2.5 py-1.5 text-sm"
                style={{
                  background: 'color-mix(in oklab, var(--series-7) 8%, transparent)',
                  borderColor: 'var(--border)',
                  color: 'var(--ink-primary)',
                }}
              >
                {DATA_SCOPE_LABELS.TEAM}
              </div>
            ) : (
              <select
                value={dataScope}
                onChange={(e) => setDataScope(e.target.value as DataScopeValue)}
                className="focusable w-full rounded-[var(--radius-panel-sm)] border px-2.5 py-1.5 text-sm"
                style={{
                  background: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--ink-primary)',
                }}
              >
                {DATA_SCOPE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {DATA_SCOPE_LABELS[value]}
                  </option>
                ))}
              </select>
            )}
            <span className="mt-1 block text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
              {DATA_SCOPE_HINTS[dataScope]}
            </span>
          </Field>

          {/*
            The roster picker, for the accounts a person is not a head on.

            On the ROP form the person was already chosen above, from a list
            that could answer for the scope; offering all 289 names a second
            time would offer mostly wrong answers to a question already
            settled.
          */}
          {!isRop && (
            <Field label="Bogʻlangan xodim">
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="focusable w-full rounded-[var(--radius-panel-sm)] border px-2.5 py-1.5 text-sm"
                style={{
                  background: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--ink-primary)',
                }}
              >
                <option value="">Bogʻlanmagan</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName}
                  </option>
                ))}
              </select>
              {/*
                Stated as a consequence, not as a red field.

                The server refuses this combination outright, so the form's job
                is to say what the choice will do while it is still a choice.
              */}
              {scopeNeedsEmployee && (
                <span
                  className="mt-1 block text-[10.5px]"
                  style={{ color: 'var(--status-warning)' }}
                >
                  «{DATA_SCOPE_LABELS[dataScope]}» uchun xodim tanlanishi shart — aks holda hisob
                  hech qanday raqam koʻrmaydi.
                </span>
              )}
            </Field>
          )}

          {editing && (
            <Field label="Holat">
              <label
                className="flex items-center gap-2 text-sm"
                style={{ color: 'var(--ink-primary)' }}
              >
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Hisob faol
              </label>
            </Field>
          )}
        </div>

        <section className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>
              Koʻra oladigan boʻlimlar
            </h3>
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {sections.length === 0
                ? `Hech narsa belgilanmagan — rol boʻyicha ${roleDefaults.length} ta boʻlim koʻrinadi`
                : `${sections.length} ta boʻlim tanlandi`}
            </p>
          </div>

          {/*
            TWO BUTTONS, DOWN FROM THREE.

            «Rol boʻyicha toʻldirish» wrote the role's defaults into the list
            explicitly — which is what an EMPTY list already does, only frozen,
            so an account that should have followed its role stopped doing so
            the moment somebody pressed it. The line above already says what
            empty means; these two are the ends of the range.
          */}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSections(SECTIONS.map((s) => s.id))}
            >
              Hammasi
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSections([])}>
              Tozalash
            </Button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <div key={group}>
                <p
                  className="mb-1 text-[10.5px] font-medium tracking-wide uppercase"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {group}
                </p>
                <ul className="space-y-1">
                  {SECTIONS.filter((s) => s.group === group).map((spec) => (
                    <li key={spec.id}>
                      <label
                        className="flex items-center gap-2 text-[13px]"
                        style={{ color: 'var(--ink-primary)' }}
                      >
                        <input
                          type="checkbox"
                          checked={sections.includes(spec.id)}
                          onChange={() => toggle(spec.id)}
                        />
                        {spec.label}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/*
            The one combination that ticks a box and delivers nothing.

            These screens aggregate across the whole company and take no
            employee filter, so a narrowed account is refused rather than shown
            a blank page. Said here, next to the ticks, because the
            administrator is looking at the ticks when they make the mistake.
          */}
          {scopeIsNarrowed && blockedByScope.length > 0 && (
            <p
              className="mt-3 rounded-lg px-3 py-2 text-[11.5px]"
              style={{
                background: 'color-mix(in oklab, var(--status-warning) 12%, transparent)',
                color: 'var(--status-warning)',
              }}
            >
              Bu boʻlimlar faqat kompaniya boʻyicha hisoblanadi va «
              {DATA_SCOPE_LABELS[dataScope]}» doirasida ochilmaydi:{' '}
              {blockedByScope.map((spec) => spec.label).join(', ')}. Yo doirani «Butun kompaniya»
              qiling, yo bu boʻlimlarni olib tashlang.
            </p>
          )}
        </section>

        {save.isError && (
          <p className="mt-4 text-xs" style={{ color: 'var(--status-critical)' }}>
            {(save.error as Error).message}
          </p>
        )}

        {remove.isError && (
          <p className="mt-2 text-xs" style={{ color: 'var(--status-critical)' }}>
            {(remove.error as Error).message}
          </p>
        )}

        <footer className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {/*
            Delete sits apart from Save, on the other side of the footer.

            Deactivating is the gentler move and is one checkbox away above;
            this is here for the account that should not exist at all. Two
            clicks, because the first is easy to make by accident and there is
            no undo — the row and its credentials go, and only the audit trail
            of what they did remains.

            Never on your own account. The server refuses it either way, but an
            administrator who can SEE "Hisobni oʻchirish" under their own name
            has to think about it every time they open their own row.
          */}
          {editing && !isSelf && (
            <span className="mr-auto">
              {confirmDelete ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
                    Butunlay oʻchirilsinmi?
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    {remove.isPending ? 'Oʻchirilmoqda…' : 'Ha, oʻchir'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    Yoʻq
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                  <span
                    className="inline-flex items-center gap-1.5"
                    style={{ color: 'var(--status-critical)' }}
                  >
                    <TrashGlyph size={13} />
                    Hisobni oʻchirish
                  </span>
                </Button>
              )}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Bekor
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={
              save.isPending ||
              name.trim().length < 2 ||
              scopeNeedsEmployee ||
              (!editing && (!password || username.trim().length < 3))
            }
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saqlanmoqda…' : editing ? 'Saqlash' : 'Yaratish'}
          </Button>
        </footer>
      </Card>
    </div>
  )
}

/**
 * The department heads, and what anchoring an account to one actually buys.
 *
 * WHY THIS LIST AND NOT THE ROSTER. An OWN or ALL account can be linked to
 * anybody, so the ordinary picker offers all 289 people. A TEAM account cannot:
 * the scope is grown from the department tree, so somebody filed nowhere who
 * heads nothing anchors on nothing and `assertScopeIsUsable` refuses to save
 * them. Nineteen right answers beat 289 mostly-wrong ones.
 *
 * WHY THE NUMBER IS IN THE OPTION TEXT. «Lola(ROP)» and «Тошкент онлайн» look
 * alike in a dropdown and are a team of 27 and a floor of nine teams
 * respectively. The size is the REAL resolved scope — the same query the
 * request path runs — so the figure read here before saving is the figure the
 * account then gets.
 */
function HeadPicker({
  heads,
  headlessUnits,
  selected,
  isPending,
  isError,
  onChoose,
}: {
  heads: readonly DepartmentHeadDto[]
  headlessUnits: readonly { readonly id: string; readonly name: string }[]
  selected: DepartmentHeadDto | undefined
  isPending: boolean
  isError: boolean
  onChoose: (employeeId: string) => void
}) {
  return (
    <div
      className="rounded-[var(--radius-panel-sm)] border px-3 py-3"
      style={{
        background: 'color-mix(in oklab, var(--series-7) 5%, transparent)',
        borderColor: 'var(--border)',
      }}
    >
      <Field label="Boʻlim rahbari">
        <select
          value={selected?.employeeId ?? ''}
          onChange={(e) => onChoose(e.target.value)}
          disabled={isPending || isError}
          className="focusable w-full rounded-[var(--radius-panel-sm)] border px-2.5 py-1.5 text-sm"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border)',
            color: 'var(--ink-primary)',
          }}
        >
          <option value="">
            {isPending
              ? 'Rahbarlar yuklanmoqda…'
              : isError
                ? 'Rahbarlar roʻyxati kelmadi'
                : 'Rahbarni tanlang'}
          </option>
          {heads.map((row) => (
            /*
              A HEAD WHO ALREADY SIGNS IN IS NOT OFFERED A SECOND LOGIN.

              `user.employeeId` is unique and `provisionUser` writes it in its
              THIRD statement, so the clash used to be a `P2002` nothing
              translates — a 500 that left behind a real, signable account with
              no username, role SALES and scope ALL. `createUser` refuses it
              now; saying so in the option is what keeps an administrator from
              meeting that refusal after typing a password.
            */
            <option key={row.employeeId} value={row.employeeId} disabled={row.account !== null}>
              {row.account
                ? `${row.fullName} — hisobi bor`
                : `${row.fullName} — ${row.teamSize} kishi`}
            </option>
          ))}
        </select>
      </Field>

      {selected && (
        <div className="mt-2">
          <span className="flex flex-wrap items-center gap-1.5">
            {selected.heads.map((unit) => (
              <span key={unit.id} className="flex items-center gap-1">
                <span className="text-[12px]" style={{ color: 'var(--ink-primary)' }}>
                  {unit.name}
                </span>
                {/*
                  The descendant count, said next to the NAME rather than
                  folded into the team size. Heading a branch hands over every
                  team under it — «Тошкент онлайн» is nine — and the
                  administrator is looking at the name when they decide.
                */}
                {unit.descendants > 0 && (
                  <StatusChip tone="warning">+{unit.descendants} ta ost-boʻlim</StatusChip>
                )}
                {/*
                  THE ROOT IS «BUTUN KOMPANIYA» UNDER ANOTHER NAME, so it gets
                  the strongest mark rather than a footnote. Headship descends
                  to any depth: an account anchored to whoever runs the top of
                  the tree reads every employee on the portal, which is the
                  exact grant this picker exists to avoid making by accident.
                */}
                {unit.isRoot && <StatusChip tone="critical">butun kompaniya</StatusChip>}
              </span>
            ))}
          </span>

          <span className="mt-1.5 block text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
            Doiraga <strong>{selected.teamSize} ta xodim</strong> tushadi
            {selected.heads.some((unit) => unit.descendants > 0)
              ? ' — ost-boʻlimlardagilar bilan birga.'
              : '.'}
            {/*
              The unit they are FILED in, which is not always one they head —
              «Навоий» names a head whose own record sits in two other units,
              and the portal draws that card with no head row. Saying where the
              person actually sits keeps that from looking like a bug.
            */}
            {selected.homeDepartmentName && ` Oʻzi: ${selected.homeDepartmentName}.`}
          </span>

          {selected.heads.some((unit) => unit.isRoot) && (
            <span className="mt-1 block text-[10.5px]" style={{ color: 'var(--status-critical)' }}>
              Bu xodim eng yuqori boʻlim rahbari — «{DATA_SCOPE_LABELS.TEAM}» unga butun
              kompaniyani ochadi, «{DATA_SCOPE_LABELS.ALL}» bilan bir xil.
            </span>
          )}
        </div>
      )}

      {/*
        WHY A BOʻLIM YOU EXPECTED IS NOT ON THE LIST.

        Only a unit with a head can carry an account, and this portal has units
        without one — «Тошкент онлайн» names nine sales teams and no head at
        all. Unsaid, an administrator hunts the list for it, does not find it,
        and reports the screen; the field to fill is `UF_HEAD` on the
        department card in Bitrix24, and nothing this application can do will
        put it there.
      */}
      {headlessUnits.length > 0 && (
        <p className="mt-2 text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
          Rahbari belgilanmagan boʻlimlar bu roʻyxatda yoʻq —{' '}
          <span style={{ color: 'var(--ink-secondary)' }}>
            {headlessUnits.map((unit) => unit.name).join(', ')}
          </span>
          . Rahbarni Bitrix24 dagi boʻlim kartochkasida belgilang.
        </p>
      )}
    </div>
  )
}

/**
 * A password field with an eye.
 *
 * The administrator is typing a credential they have to read aloud or write
 * down for somebody else, so hiding it helps nobody — a mistyped password
 * they cannot see becomes a person who cannot sign in and an admin who does
 * not know why. Masked by default all the same, because this screen gets
 * opened in an open office.
 */
function PasswordInput({
  value,
  onChange,
  shown,
  onToggle,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  shown: boolean
  onToggle: () => void
  placeholder?: string
}) {
  return (
    <span className="relative block">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={shown ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder={placeholder}
        className="focusable w-full rounded-[var(--radius-panel-sm)] border py-1.5 pr-9 pl-2.5 text-sm"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--ink-primary)',
        }}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={shown ? 'Parolni yashirish' : 'Parolni koʻrsatish'}
        aria-pressed={shown}
        className="focusable absolute top-1/2 right-1.5 -translate-y-1/2 rounded px-1 py-0.5 transition-opacity hover:opacity-70"
        style={{ color: shown ? 'var(--ink-secondary)' : 'var(--ink-muted)' }}
      >
        {shown ? <EyeOffGlyph size={14} /> : <EyeGlyph size={14} />}
      </button>
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}
