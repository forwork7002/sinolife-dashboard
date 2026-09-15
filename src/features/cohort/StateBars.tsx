'use client'

import type { RetentionGroupDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { retentionGroupSpec } from '@/lib/retentionGroups'

/**
 * База as four states, not as fifteen stages.
 *
 * WHAT THIS REPLACED, and why. The card drew one bar per portal stage, in
 * funnel order — fifteen of them on production. Ten were never named in the
 * copy above them, the three largest («Недозвоны» 2 279, «Неактивные» 1 864,
 * «Активный клиент» 825 on 2026-09-15) sat scattered between cadence steps,
 * and the reading anybody actually wants — how much of the base is being
 * worked, how much has gone cold — had to be done by adding rows up in the
 * head. The partition is `src/lib/retentionGroups.ts`; the stages are still
 * there, one hover away, and a stage the table does not know becomes its own
 * «Boshqa bosqichlar» row rather than disappearing into one of the four.
 *
 * Bars are proportional to the largest group rather than to the total, and
 * nothing here prints a percentage of the base: the groups are NOT parts of a
 * whole. One customer can hold two open База deals and stand in two states, so
 * the four add up to more than the база they came from — which is why the card
 * states that base separately, counted distinct by the database.
 */
export function StateBars({
  groups,
  baseCustomers,
  workedCustomers,
}: {
  readonly groups: readonly RetentionGroupDto[]
  readonly baseCustomers: number
  readonly workedCustomers: number
}) {
  const max = Math.max(...groups.map((g) => g.customers), 1)

  return (
    <div className="space-y-3">
      {/*
        «Faol bazada», in the one place it has a denominator.

        It was a tile at the top of the page beside «Jami mijozlar», where the
        two read as a contradiction — 12 558 active out of 11 512 total. They
        count different populations and now say so by standing together: both
        are about База, and the smaller is a subset of the larger.
      */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          Bazada jami{' '}
          <span className="tabular font-medium" style={{ color: 'var(--ink-primary)' }}>
            {formatNumber(baseCustomers)}
          </span>{' '}
          ta mijoz
        </span>
        <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          shundan{' '}
          <span className="tabular font-medium" style={{ color: 'var(--ink-primary)' }}>
            {formatNumber(workedCustomers)}
          </span>{' '}
          tasida ochiq bitim bor
        </span>
      </div>

      <ul className="space-y-2">
        {groups.map((group) => {
          const spec = retentionGroupSpec(group.key)
          /* The stage breakdown as a native title, the same way the pinned
             cells of the matrix carry theirs: it is a LABEL, not a data panel,
             and every number in it is already on screen as a bar. */
          const detail = group.stages
            .map((s) => `${s.stage.replace(/^.*·\s*/, '')} — ${formatNumber(s.customers)}`)
            .join('\n')

          return (
            <li key={group.key} className="flex items-center gap-3" title={detail || spec.hint}>
              <span className="w-48 shrink-0 text-xs" style={{ color: 'var(--ink-secondary)' }}>
                <span className="block truncate" style={{ color: 'var(--ink-primary)' }}>
                  {spec.label}
                </span>
                <span className="block truncate text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                  {spec.hint}
                </span>
              </span>

              <div
                className="h-2.5 flex-1 overflow-hidden rounded-full"
                style={{ background: 'var(--track)' }}
              >
                <div
                  className="grow-x h-full rounded-full"
                  style={{
                    width: `${(group.customers / max) * 100}%`,
                    /*
                      CATEGORICAL, where the old per-stage list was sequential.

                      Fifteen stages of one quantity took the magnitude hue;
                      four named states are four different things, and the
                      colour is fixed per state in `retentionGroups.ts` so it
                      never follows rank. None of them is `--series-7`, which
                      is this page's accent — a value mark must not wear page
                      identity, even by coincidence.
                    */
                    background: `var(${spec.colour})`,
                  }}
                />
              </div>

              <span
                className="tabular w-20 shrink-0 text-right text-xs font-medium"
                style={{ color: 'var(--ink-primary)' }}
              >
                {formatNumber(group.customers)}
              </span>
            </li>
          )
        })}
      </ul>

      <p className="text-[10.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        Har bir mijoz oʻz guruhida bir marta sanaladi. Ikkita ochiq bitimi bor mijoz ikki guruhda
        koʻrinishi mumkin, shuning uchun guruhlar yigʻindisi bazadagi jami mijozdan koʻp boʻlishi
        mumkin. Guruh ustiga sichqonchani olib borsangiz, ichidagi bosqichlar chiqadi.
      </p>
    </div>
  )
}
