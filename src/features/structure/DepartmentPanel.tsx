'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/states/States'
import { InitialChip } from '@/components/ui/DataTable'
import { MultiplyGlyph } from '@/components/ui/Icons'
import { apiGet, type DepartmentMemberDto, type StructureDto } from '@/lib/api'
import { formatCompactUzs, formatNumber } from '@/lib/format'

/**
 * The unit's own people, in the panel the portal opens beside the chart.
 *
 * It answers the question the client asked this screen to be wired to the floor
 * for — «kim kimning qoʻlida ishlayapti» — so the roster is the panel's whole
 * content and the head is at the top of it, marked.
 *
 * A SECOND REQUEST, not a field on every node. The chart draws twenty cards and
 * a reader opens one panel; shipping 289 people to render thirteen of them
 * would put the entire roster on the wire again on every change of the
 * reporting window.
 *
 * WHAT THE SOURCE HAS AND THIS DOES NOT: the «Коммуникации» tab, «Добавить
 * сотрудников» and the «...» menu. The first is a Bitrix24 chat feature this
 * application has no access to; the other two write into the portal, and
 * nothing here writes to a CRM.
 */
export function DepartmentPanel({
  node,
  apiParams,
  onClose,
}: {
  node: StructureDto
  /** The page's window and filters, so the panel's money matches the card's. */
  apiParams: Record<string, string | number>
  onClose: () => void
}) {
  const query = useQuery({
    queryKey: ['structure-roster', node.id, apiParams],
    queryFn: ({ signal }) =>
      apiGet<DepartmentMemberDto[]>(
        '/insights/structure/roster',
        { ...apiParams, departmentId: node.id },
        signal,
      ),
  })

  /*
    Escape closes it, from anywhere on the page.

    Not a focus trap: this panel sits beside the chart rather than over it, and
    trapping focus would take the arrow keys away from the tree the reader is
    steering. Escape is the one thing a panel owes a keyboard user, and the
    close button is the first thing in its own tab order.
  */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const people = query.data?.data ?? []
  const active = people.filter((p) => p.isActive)
  const withMoney = people.some((p) => p.revenue !== null)

  return (
    <aside
      className="org-panel"
      aria-label={`${node.name} — xodimlar`}
      // A live region would announce the whole roster on every selection. The
      // heading below is what a screen reader is sent to instead.
      tabIndex={-1}
    >
      <header className="org-panel-head">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
            {node.name}
          </h3>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {/*
              The count above the list is the ACTIVE one, and the list carries
              everybody. A panel reading «13 xodim» over nine visible rows is a
              gap that costs an afternoon, so the deactivated are counted out
              loud rather than quietly dropped.
            */}
            Jami {formatNumber(node.memberCount)} faol xodim
            {people.length > active.length &&
              ` · ${formatNumber(people.length - active.length)} oʻchirilgan`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Yopish"
          className="focusable org-panel-close"
        >
          <MultiplyGlyph />
        </button>
      </header>

      <div className="org-panel-body">
        {query.isPending && <LoadingSkeleton rows={5} />}

        {query.isError && (
          <ErrorState
            message={(query.error as Error).message}
            onRetry={() => void query.refetch()}
          />
        )}

        {!query.isPending && !query.isError && people.length === 0 && (
          <EmptyState
            title="Boʻlim boʻsh"
            body="Bitrix24 bu boʻlimda hech kimni koʻrsatmayapti. Odatda bu boʻlim ostidagi jamoalarda ishlaydi."
          />
        )}

        {people.length > 0 && (
          <ul className="org-panel-list">
            {people.map((person) => (
              <PersonRow key={person.id} person={person} withMoney={withMoney} />
            ))}
          </ul>
        )}

        {/*
          SAY WHY THE COLUMN DOES NOT ADD UP TO THE CARD.

          The roster is Bitrix24's membership and the card's money is this
          dashboard's crediting, so a person whose SECOND unit this is appears
          here with their own revenue while that revenue counts towards their
          first unit. On this data the difference is a single seller and 18.9
          mln soʻm — small enough to look like a bug and large enough to be
          worth a phone call. The tag alone says which row; this says why.
        */}
        {withMoney && people.some((p) => !p.isPrimary) && (
          <p className="mt-2 px-1.5 pb-1 text-[10px] leading-snug" style={{ color: 'var(--ink-muted)' }}>
            «Ikkinchi boʻlim» belgisi qoʻyilgan xodimlarning puli oʻz asosiy boʻlimiga yoziladi,
            shuning uchun bu roʻyxatning yigʻindisi kartadagi summadan katta boʻlishi mumkin.
          </p>
        )}
      </div>
    </aside>
  )
}

function PersonRow({
  person,
  withMoney,
}: {
  person: DepartmentMemberDto
  withMoney: boolean
}) {
  return (
    <li className="org-person" data-inactive={!person.isActive || undefined}>
      <InitialChip name={person.fullName} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px]" style={{ color: 'var(--ink-primary)' }}>
            {person.fullName}
          </span>
          {person.isHead && <span className="org-tag org-tag--head">Rahbar</span>}
          {/*
            «Ikkinchi boʻlim» is not decoration.

            Bitrix24 lists a person in every unit of their UF_DEPARTMENT, and
            this dashboard credits their money to the FIRST one only. Without
            the tag their row would read as a seller whose revenue had gone
            missing.
          */}
          {!person.isPrimary && <span className="org-tag">Ikkinchi boʻlim</span>}
          {!person.isActive && <span className="org-tag org-tag--off">Faol emas</span>}
        </div>

        {person.position && (
          <p className="truncate text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
            {person.position}
          </p>
        )}
      </div>

      {withMoney && person.revenue && (
        <div className="shrink-0 text-right">
          <div className="tabular text-[11.5px]" style={{ color: 'var(--ink-primary)' }}>
            {person.revenue.amount === 0 ? (
              <span style={{ color: 'var(--ink-muted)' }}>—</span>
            ) : (
              formatCompactUzs(person.revenue.amount)
            )}
          </div>
          {(person.deals ?? 0) > 0 && (
            <div className="tabular text-[10px]" style={{ color: 'var(--ink-muted)' }}>
              {formatNumber(person.deals ?? 0)} bitim
            </div>
          )}
        </div>
      )}
    </li>
  )
}
