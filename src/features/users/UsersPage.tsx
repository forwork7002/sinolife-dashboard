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
import { StatusChip } from '@/components/ui/Stat'
import { PageShell, useFilterOptions } from '@/features/shared/PageShell'
import { apiGet, apiWrite, type UserRowDto, type UsersPageDto } from '@/lib/api'
import { formatDate } from '@/lib/format'
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
          rows={query.data?.data.items ?? []}
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
 * Create or edit, in one form.
 *
 * The two differ in exactly three places — the password is required on create
 * and optional on edit, the email is fixed once issued, and only an existing
 * account can be switched off — so splitting them into two components would
 * duplicate the section grid, the role picker and the error handling to avoid
 * three conditionals.
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
  const [role, setRole] = useState<RoleValue>(user?.role ?? 'SALES')
  /*
    ALL on a new account, deliberately.

    An administrator opening this form is handing someone screens; the useful
    default is that those screens have numbers on them. OWN is the narrower,
    rarer intent and has to be chosen — along with the person it narrows to.
  */
  const [dataScope, setDataScope] = useState<DataScopeValue>(user?.dataScope ?? 'ALL')
  const [employeeId, setEmployeeId] = useState<string>(user?.employeeId ?? '')
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [sections, setSections] = useState<string[]>([...(user?.sections ?? [])])

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
  const scopeNeedsEmployee = dataScope === 'OWN' && employeeId === ''

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
              className="focusable w-full rounded-lg border px-2.5 py-1.5 text-sm"
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
              className="focusable w-full rounded-lg border px-2.5 py-1.5 text-sm"
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
              placeholder={editing ? 'Oʻzgartirmasangiz boʻsh qoldiring' : 'Kamida 12 ta belgi'}
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
              className="focusable w-full rounded-lg border px-2.5 py-1.5 text-sm"
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
            <select
              value={dataScope}
              onChange={(e) => setDataScope(e.target.value as DataScopeValue)}
              className="focusable w-full rounded-lg border px-2.5 py-1.5 text-sm"
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
            <span className="mt-1 block text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
              {DATA_SCOPE_HINTS[dataScope]}
            </span>
          </Field>

          <Field label="Bogʻlangan xodim">
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="focusable w-full rounded-lg border px-2.5 py-1.5 text-sm"
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
            {dataScope === 'OWN' && employeeId === '' && (
              <span
                className="mt-1 block text-[10.5px]"
                style={{ color: 'var(--status-warning)' }}
              >
                «Faqat oʻz natijalari» uchun xodim tanlanishi shart — aks holda hisob
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
          {dataScope === 'OWN' && blockedByScope.length > 0 && (
            <p
              className="mt-3 rounded-lg px-3 py-2 text-[11.5px]"
              style={{
                background: 'color-mix(in oklab, var(--status-warning) 12%, transparent)',
                color: 'var(--status-warning)',
              }}
            >
              Bu boʻlimlar faqat kompaniya boʻyicha hisoblanadi va «Faqat oʻz natijalari»
              doirasida ochilmaydi: {blockedByScope.map((spec) => spec.label).join(', ')}.
              Yo doirani «Butun kompaniya» qiling, yo bu boʻlimlarni olib tashlang.
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
        className="focusable w-full rounded-lg border py-1.5 pr-9 pl-2.5 text-sm"
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
