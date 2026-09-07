'use client'

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
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
import { formatDate } from '@/lib/format'
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
 *   4. HOW MUCH OF EACH — the data scope. The whole company, or one linked
 *      salesperson's own records.
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
 */
/**
 * The two readings of this screen.
 *
 * «Hisoblar» is every account on the deployment. «ROP» is the same data asked
 * a different question — which department heads have a team-scoped login and
 * which do not — and it is a separate tab rather than a filter because the
 * rows are not accounts at all: a head with no login has to appear, and a
 * filter over accounts cannot show a row that does not exist yet.
 */
type TabValue = 'accounts' | 'rops'

const TABS: readonly { readonly value: TabValue; readonly label: string }[] = [
  { value: 'accounts', label: 'Hisoblar' },
  { value: 'rops', label: 'ROP' },
]

export function UsersPage() {
  const queryClient = useQueryClient()
  // Shares react-query's cache with PageShell, so this costs no extra request.
  const viewerId = useFilterOptions().data?.data.viewer?.userId
  const [editing, setEditing] = useState<UserRowDto | null>(null)
  const [creating, setCreating] = useState(false)
  const [tab, setTab] = useState<TabValue>('accounts')
  /** The head an administrator is opening a new ROP account for. */
  const [ropTarget, setRopTarget] = useState<DepartmentHeadDto | null>(null)

  const query = useQuery({
    queryKey: ['users'],
    queryFn: ({ signal }) => apiGet<UsersPageDto>('/users', {}, signal),
  })

  /*
    THE ROP TAB'S OWN REQUEST, AND ITS OWN CADENCE.

    Separate from the accounts query because it is not free — each head's team
    size is asked of the real scope resolver — and because it is only wanted on
    one tab. `enabled` keeps it unsent until the administrator asks for it.

    Five minutes rather than the app's minute: this list changes when Bitrix24
    moves somebody or names a new head, which reaches us through the sync
    worker's reference-data pass — once every thirty ticks. Both fields are set,
    because `refetchInterval` runs on its own clock and never consults
    staleness; raising only one of them changes nothing.
  */
  const heads = useQuery({
    queryKey: ['users', 'heads'],
    queryFn: ({ signal }) => apiGet<UsersPageDto>('/users', { include: 'heads' }, signal),
    enabled: tab === 'rops',
    staleTime: 300_000,
    refetchInterval: 300_000,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] })
    // The viewer's own sections ride the filters payload, so a change to your
    // own account has to invalidate that too or the sidebar stays stale.
    void queryClient.invalidateQueries({ queryKey: ['filters'] })
  }

  const columns: Column<UserRowDto>[] = [
    {
      key: 'name',
      rowHeader: true,
      header: 'Xodim',
      render: (row) => (
        <span className="flex items-center gap-2">
          <InitialChip name={row.name} />
          <span className="min-w-0">
            <span className="block truncate font-medium" style={{ color: 'var(--ink-primary)' }}>
              {row.name}
            </span>
            <span className="block truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {row.username ?? row.email}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Rol',
      width: '140px',
      render: (row) => (
        <StatusChip tone={row.role === 'ADMIN' ? 'good' : 'neutral'}>
          {ROLE_LABELS[row.role]}
        </StatusChip>
      ),
    },
    {
      key: 'sections',
      header: 'Koʻra oladigan boʻlimlar',
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
      key: 'dataScope',
      header: 'Maʼlumot doirasi',
      width: '150px',
      render: (row) => (
        <span className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
          {DATA_SCOPE_LABELS[row.dataScope]}
        </span>
      ),
    },
    {
      key: 'employee',
      header: 'Bogʻlangan xodim',
      render: (row) =>
        row.employeeName ?? (
          <span style={{ color: 'var(--ink-muted)' }}>—</span>
        ),
    },
    {
      key: 'twoFactor',
      header: '2FA',
      width: '80px',
      render: (row) => (
        <span style={{ color: row.twoFactorEnabled ? 'var(--status-good)' : 'var(--ink-muted)' }}>
          {row.twoFactorEnabled ? <CheckCircleGlyph size={13} /> : <DashGlyph size={13} />}
        </span>
      ),
    },
    {
      key: 'isActive',
      header: 'Holat',
      width: '110px',
      render: (row) =>
        row.isActive ? (
          <StatusChip tone="good">Faol</StatusChip>
        ) : (
          <StatusChip tone="critical">Faol emas</StatusChip>
        ),
    },
    {
      key: 'createdAt',
      header: 'Yaratilgan',
      align: 'right',
      numeric: true,
      render: (row) => formatDate(row.createdAt),
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
        <span className="flex items-center gap-2">
          <SegmentedControl
            value={tab}
            options={TABS}
            onChange={setTab}
            ariaLabel="Foydalanuvchilar koʻrinishi"
          />
          {tab === 'accounts' && (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              + Yangi hisob
            </Button>
          )}
        </span>
      }
    >
      {tab === 'accounts' ? (
        <Card className="card-hero brackets px-4 py-4">
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(row) => row.id}
            status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
            errorMessage={(query.error as Error | null)?.message}
            onRetry={() => void query.refetch()}
            onRowClick={(row) => setEditing(row)}
            minWidth={1120}
            emptyTitle="Hisob yoʻq"
            emptyBody="Hali hech kimga hisob ochilmagan."
          />
        </Card>
      ) : (
        <RopBoard
          query={heads}
          accounts={items}
          onOpenAccount={setEditing}
          onCreate={setRopTarget}
        />
      )}

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

      {ropTarget && (
        <UserDialog
          title={`ROP hisobi — ${ropTarget.fullName}`}
          head={ropTarget}
          onClose={() => setRopTarget(null)}
          onSaved={() => {
            setRopTarget(null)
            refresh()
          }}
        />
      )}
    </PageShell>
  )
}

/**
 * The ROP board.
 *
 * WHY THIS IS A SEPARATE TAB AND NOT A BETTER DROPDOWN. Anchoring a «Faqat oʻz
 * boʻlimi» account is not the same choice as linking an OWN account: it can
 * only be made against somebody the department tree knows about, the answer it
 * produces is a whole team rather than one person, and how big that team is
 * depends on whether the person heads a team or a branch. None of that fits in
 * a `<select>` of 289 names sorted alphabetically — which is what an
 * administrator was previously asked to make the choice from.
 *
 * The list is heads only, the team size beside each name is the real resolved
 * scope, and picking one opens a form that has already made the two decisions
 * that were easy to get wrong: the scope and the person it is anchored to.
 */
function RopBoard({
  query,
  accounts,
  onOpenAccount,
  onCreate,
}: {
  query: UseQueryResult<{ data: UsersPageDto }>
  /** The full account rows, so an existing ROP opens the ordinary edit form. */
  accounts: readonly UserRowDto[]
  onOpenAccount: (user: UserRowDto) => void
  onCreate: (head: DepartmentHeadDto) => void
}) {
  const rows = query.data?.data.heads ?? []
  const headless = query.data?.data.headlessUnits ?? []
  const byId = new Map(accounts.map((account) => [account.id, account]))

  const columns: Column<DepartmentHeadDto>[] = [
    {
      key: 'head',
      rowHeader: true,
      header: 'Rahbar',
      render: (row) => (
        <span className="flex items-center gap-2">
          <InitialChip name={row.fullName} />
          <span className="min-w-0">
            <span className="block truncate font-medium" style={{ color: 'var(--ink-primary)' }}>
              {row.fullName}
            </span>
            <span className="block truncate text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {/*
                The unit they are FILED in, which is not always one they head —
                «Навоий» names a head whose own record sits in two other units,
                and the portal draws that card with no head row. Saying where
                the person actually sits keeps that from looking like a bug.
              */}
              {row.homeDepartmentName ?? 'Boʻlimga biriktirilmagan'}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'units',
      header: 'Rahbarlik qiladigan boʻlimi',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {row.heads.map((unit) => (
            <span key={unit.id} className="flex items-center gap-1">
              <span className="text-[12px]" style={{ color: 'var(--ink-primary)' }}>
                {unit.name}
              </span>
              {/*
                The descendant count, said next to the name rather than folded
                into the team size. Heading a branch hands over every team under
                it — «Тошкент онлайн» is nine — and the administrator is looking
                at the NAME when they decide, not at the number two columns
                away.
              */}
              {unit.descendants > 0 && (
                <StatusChip tone="warning">+{unit.descendants} ta ost-boʻlim</StatusChip>
              )}
              {/*
                THE ROOT IS «BUTUN KOMPANIYA» UNDER ANOTHER NAME, so it gets
                the strongest mark on the row rather than a footnote. Headship
                descends to any depth: an account anchored to whoever runs the
                top of the tree reads every employee on the portal, which is
                the exact grant this tab exists to avoid making by accident.
              */}
              {unit.isRoot && <StatusChip tone="critical">butun kompaniya</StatusChip>}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'teamSize',
      header: 'Doiraga tushadi',
      align: 'right',
      numeric: true,
      width: '130px',
      render: (row) => (
        <span style={{ color: 'var(--ink-primary)' }}>{row.teamSize} kishi</span>
      ),
    },
    {
      key: 'account',
      header: 'Hisob',
      width: '230px',
      render: (row) => {
        if (!row.account) {
          return (
            <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              Hisob yoʻq — ochish uchun bosing
            </span>
          )
        }

        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px]" style={{ color: 'var(--ink-primary)' }}>
              {row.account.username ?? '—'}
            </span>
            {row.account.isActive ? (
              <StatusChip tone="good">Faol</StatusChip>
            ) : (
              <StatusChip tone="critical">Faol emas</StatusChip>
            )}
            {/*
              A head whose account is NOT team-scoped is the case this screen
              exists to make visible. Said as a warning rather than hidden: the
              administrator opened this tab to grant one floor, and an account
              reading the whole company under a ROP's name is the opposite
              outcome, arrived at silently.
            */}
            {row.account.dataScope !== 'TEAM' && (
              <StatusChip tone="warning">{DATA_SCOPE_LABELS[row.account.dataScope]}</StatusChip>
            )}
          </span>
        )
      },
    },
  ]

  return (
    <div className="grid gap-3">
      <Card className="px-4 py-3">
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          ROP hisobi — bu <strong>«{DATA_SCOPE_LABELS.TEAM}»</strong> doirasidagi hisob. U faqat
          oʻzi rahbarlik qiladigan boʻlim, oʻzi biriktirilgan boʻlim va ular ostidagi boʻlimlar
          xodimlarining natijalarini koʻradi. Sotuvchilar reytingidagi <strong>oʻrin, ulush va
          jami</strong> raqamlar ham faqat shu roʻyxat ichida hisoblanadi — kompaniya boʻyicha
          emas. Qaysi ekranlar ochilishini har bir hisob uchun oʻzingiz tanlaysiz.
        </p>

        {/*
          WHY A BOʻLIM YOU EXPECTED IS NOT ON THE LIST.

          Only a unit with a head can carry an account, and this portal has
          units without one — «Тошкент онлайн» names nine sales teams and no
          head at all. Unsaid, an administrator hunts the list for it, does not
          find it, and reports the screen; the field to fill is `UF_HEAD` on
          the department card in Bitrix24, and nothing this application can do
          will put it there.
        */}
        {headless.length > 0 && (
          <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Rahbari belgilanmagan boʻlimlar bu roʻyxatda yoʻq —{' '}
            <span style={{ color: 'var(--ink-secondary)' }}>
              {headless.map((unit) => unit.name).join(', ')}
            </span>
            . Rahbarni Bitrix24 dagi boʻlim kartochkasida belgilang.
          </p>
        )}
      </Card>

      <Card className="card-hero brackets px-4 py-4">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.employeeId}
          status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
          errorMessage={(query.error as Error | null)?.message}
          onRetry={() => void query.refetch()}
          onRowClick={(row) => {
            /*
              One click, two destinations. A head who already has a login is
              edited through the ordinary account form — there is nothing
              ROP-specific about changing their sections or their password, and
              a second form for it would be a second place to keep in step.
              A head with no login goes to the same form with the two dangerous
              fields already decided.
            */
            const existing = row.account ? byId.get(row.account.id) : undefined
            if (existing) onOpenAccount(existing)
            else onCreate(row)
          }}
          minWidth={980}
          emptyTitle="Boʻlim rahbari topilmadi"
          emptyBody="Bitrix24 da hech qaysi boʻlimga rahbar belgilanmagan. Portalda rahbarni belgilang — keyingi sinxronizatsiyadan soʻng bu yerda chiqadi."
        />
      </Card>
    </div>
  )
}

/**
 * Create or edit, in one form.
 *
 * The two differ in exactly three places — the password is required on create
 * and optional on edit, the email is fixed once issued, and only an existing
 * account can be switched off — so splitting them into two components would
 * duplicate the section grid, the role picker and the error handling to avoid
 * three conditionals.
 */
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

function UserDialog({
  title,
  user,
  head,
  isSelf = false,
  onClose,
  onSaved,
}: {
  title: string
  user?: UserRowDto
  /**
   * Opening a NEW account for this department head.
   *
   * Its presence decides two fields the administrator would otherwise have to
   * get right by hand, and they are the two that fail quietly: the scope, and
   * the person the scope is grown from. Everything else on the form stays
   * exactly as it is — the role, the password, and above all the section
   * ticks, which the client asked to keep choosing themselves.
   *
   * Never passed together with `user`: an existing account is edited through
   * the ordinary form, because nothing about changing a password or a tick is
   * ROP-specific and a second copy of that form would be a second thing to
   * keep in step.
   */
  head?: DepartmentHeadDto
  /** Your own account. Deletion is not offered on it. */
  isSelf?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const editing = user !== undefined
  const isRop = head !== undefined

  const [name, setName] = useState(user?.name ?? head?.fullName ?? '')
  const [username, setUsername] = useState(user?.username ?? loginSuggestion(head?.fullName))
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  // One toggle for both password fields: they must match, so reading one
  // without the other tells you nothing about why they do not.
  const [showPassword, setShowPassword] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /*
    SALES for a ROP, and it is already the default for everybody.

    Role says what an account may CHANGE, not what it reads — a ROP reads a
    whole team and changes nothing. The picker stays enabled: the client may
    want a particular ROP to own their team's KPI plans, and that is a MANAGER.
  */
  const [role, setRole] = useState<RoleValue>(user?.role ?? 'SALES')
  /*
    ALL on a new account, deliberately.

    An administrator opening this form is handing someone screens; the useful
    default is that those screens have numbers on them. OWN is the narrower,
    rarer intent and has to be chosen — along with the person it narrows to.
  */
  const [dataScope, setDataScope] = useState<DataScopeValue>(
    user?.dataScope ?? (isRop ? 'TEAM' : 'ALL'),
  )
  const [employeeId, setEmployeeId] = useState<string>(user?.employeeId ?? head?.employeeId ?? '')
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  /*
    A ROP ACCOUNT OPENS WITH TICKS, WHERE AN ORDINARY ONE OPENS WITH NONE.

    An empty list means "follow the role", and a SALES role's default set
    includes the command centre and Logistika — two screens that aggregate
    across the whole company and refuse a narrowed account outright. The
    sidebar already hides them from a ROP and the page guard already lands them
    somewhere usable, so nothing breaks; but an account created for one purpose
    and configured for another is a thing the administrator then has to
    discover. Both of these narrow correctly, and both are the reason the
    client asked for the account. Every tick stays editable.
  */
  const [sections, setSections] = useState<string[]>([
    ...(user?.sections ?? (isRop ? ['confirmation', 'sellers'] : [])),
  ])

  // The roster the filter bar already loaded, reused rather than refetched.
  const employees = useFilterOptions().data?.data.employees ?? []

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

              This form was opened from a row that says «this person heads that
              unit»; the scope is the whole reason it exists, so offering it as
              a choice invites the one mistake the tab was built to remove.
              Printed as a chip instead of a disabled `<select>` because a
              greyed-out control reads as "broken here" rather than "already
              decided" — and the hint underneath is the same sentence the free
              form shows, so the two screens cannot describe the scope
              differently.

              To give a head something OTHER than their own floor, edit the
              account on the «Hisoblar» tab, where every field is open.
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

          <Field label={isRop ? 'Boʻlim rahbari' : 'Bogʻlangan xodim'}>
            {/*
              THE ANSWER, NOT THE QUESTION.

              On the ROP form the person is what the administrator clicked, so
              the picker is replaced by what that choice actually buys: the
              units it anchors on and how many employees the scope resolves to.
              The count comes from the same resolver the request path uses, so
              the number read here is the number the account gets — and it is
              the only place a branch head's «nine teams» becomes a figure
              before the account exists rather than after.
            */}
            {isRop ? (
              <div
                className="rounded-[var(--radius-panel-sm)] border px-2.5 py-1.5"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <span className="block text-sm" style={{ color: 'var(--ink-primary)' }}>
                  {head.fullName}
                </span>
                <span className="mt-0.5 block text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                  {head.heads.map((unit) => unit.name).join(', ')}
                </span>
                <span className="mt-1 block text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                  Doiraga <strong>{head.teamSize} ta xodim</strong> tushadi
                  {head.heads.some((unit) => unit.descendants > 0)
                    ? ' — ost-boʻlimlardagilar bilan birga.'
                    : '.'}
                </span>
                {/*
                  The one grant on this list that is not a team. Said in the
                  form as well as on the row, because this is the last screen
                  before the password is typed.
                */}
                {head.heads.some((unit) => unit.isRoot) && (
                  <span
                    className="mt-1 block text-[10.5px]"
                    style={{ color: 'var(--status-critical)' }}
                  >
                    Bu xodim eng yuqori boʻlim rahbari — «{DATA_SCOPE_LABELS.TEAM}» unga butun
                    kompaniyani ochadi, «{DATA_SCOPE_LABELS.ALL}» bilan bir xil.
                  </span>
                )}
              </div>
            ) : (
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
            )}
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

          {editing && (
            <Field label="Holat">
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-primary)' }}>
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

          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSections([...roleDefaults])}>
              Rol boʻyicha toʻldirish
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSections(SECTIONS.map((s) => s.id))}>
              Hammasi
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSections([])}>
              Tozalash (rolga qaytarish)
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
            employee filter, so an OWN-scoped account is refused rather than
            shown a blank page. Said here, next to the ticks, because the
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
              {blockedByScope.map((spec) => spec.label).join(', ')}. Yo doirani «Butun
              kompaniya» qiling, yo bu boʻlimlarni olib tashlang.
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
          */}
          {/*
            Never on your own account.

            The server refuses it either way, but an administrator who can SEE
            "Hisobni oʻchirish" under their own name has to think about it
            every time they open their own row. The action that cannot be
            undone should not be the one sitting under the cursor.
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
