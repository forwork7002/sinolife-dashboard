// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StateBars } from '@/features/cohort/StateBars'
import type { RetentionGroupDto } from '@/lib/api'
import { formatNumber } from '@/lib/format'

/**
 * The «База» card cannot be seen locally, so it is proved here.
 *
 * The demo seed holds no RETENTION pipeline at all — `pipeline` is empty — so
 * every local render of this card is its empty state, and the only place the
 * four bars have ever drawn is production. That is precisely the case a test
 * has to carry: the numbers below are the live funnel as read on 2026-09-15.
 *
 * What it pins is the one claim the card makes that a reader would otherwise
 * take on trust: the bars are NOT parts of a whole. 1 122 + 6 097 + 3 325 +
 * 4 448 is 14 992, while the base is 12 558 distinct customers, because
 * somebody with two open База deals stands in two states. The card must print
 * the database's own distinct base and must never compute one by adding the
 * bars up — which is the shape this component would take if somebody
 * "simplified" it, and which produces a plausible bigger number.
 */

/** The live C10 funnel, grouped — read from production on 2026-09-15. */
const GROUPS: RetentionGroupDto[] = [
  {
    key: 'NEW',
    customers: 1122,
    openCustomers: 1100,
    stages: [
      { stage: 'База · Успешно раздача', customers: 16 },
      { stage: 'База · Новый база', customers: 1106 },
    ],
  },
  {
    key: 'CADENCE',
    customers: 6097,
    openCustomers: 6000,
    stages: [
      { stage: 'База · 1 кун', customers: 1238 },
      { stage: 'База · 3 кун', customers: 1229 },
      { stage: 'База · 10 кун', customers: 1467 },
      { stage: 'База · 20 кун', customers: 1054 },
      { stage: 'База · 30 кун', customers: 1109 },
    ],
  },
  {
    key: 'ACTIVE',
    customers: 3325,
    openCustomers: 1900,
    stages: [
      { stage: 'База · Актив', customers: 811 },
      { stage: 'База · Активный клиент', customers: 825 },
      { stage: 'База · Перерыв успешно', customers: 375 },
      { stage: 'База · Успешно', customers: 1314 },
    ],
  },
  {
    key: 'LOST',
    customers: 4448,
    openCustomers: 3558,
    stages: [
      { stage: 'База · Недозвоны', customers: 2279 },
      { stage: 'База · Неактивные', customers: 1864 },
      { stage: 'База · Пропущенный', customers: 225 },
      { stage: 'База · Не активный клиент', customers: 80 },
    ],
  },
]

const BASE = 12_558
const WORKED = 9_400

describe('the База card', () => {
  it('draws one bar per state, not one per portal stage', () => {
    render(<StateBars groups={GROUPS} baseCustomers={BASE} workedCustomers={WORKED} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('Aloqa siklida')).toBeTruthy()
    expect(screen.getByText('Sovigan — aloqa uzilgan')).toBeTruthy()
  })

  it('prints the database’s distinct base, never the sum of the bars', () => {
    render(<StateBars groups={GROUPS} baseCustomers={BASE} workedCustomers={WORKED} />)

    // 12 558, not the 14 992 the four bars add up to.
    expect(screen.getByText(formatNumber(BASE))).toBeTruthy()
    expect(screen.queryByText(formatNumber(14_992))).toBeNull()
  })

  it('states the worked figure beside the base it is a subset of', () => {
    /*
      It was a tile at the top of the page next to «Jami mijozlar 11 512»,
      where 12 558 read as a contradiction. Here both numbers are about База
      and the smaller is visibly part of the larger.
    */
    render(<StateBars groups={GROUPS} baseCustomers={BASE} workedCustomers={WORKED} />)

    expect(screen.getByText(formatNumber(WORKED))).toBeTruthy()
    expect(screen.getByText(/tasida ochiq bitim bor/)).toBeTruthy()
  })

  it('keeps every portal stage reachable, in the group’s own hover', () => {
    render(<StateBars groups={GROUPS} baseCustomers={BASE} workedCustomers={WORKED} />)

    const cadence = screen.getByText('Aloqa siklida').closest('li')
    const title = cadence?.getAttribute('title') ?? ''

    // The funnel prefix is stripped — the card is already headed «База».
    expect(title).toContain(`1 кун — ${formatNumber(1238)}`)
    expect(title).toContain(`30 кун — ${formatNumber(1109)}`)
    expect(title).not.toContain('База ·')
  })

  it('scales the bars to the largest group, never to the base', () => {
    render(<StateBars groups={GROUPS} baseCustomers={BASE} workedCustomers={WORKED} />)

    const bars = document.querySelectorAll('.grow-x')
    // CADENCE is the largest, so it is the full width and everything else is
    // read against it. Against the base every bar would be under half and the
    // four would look like a funnel that loses most of its people at once.
    expect((bars[1] as HTMLElement).style.width).toBe('100%')
    expect((bars[0] as HTMLElement).style.width).toBe(`${(1122 / 6097) * 100}%`)
  })

  it('draws a stage the partition has never seen rather than dropping it', () => {
    /* The portal grows stages. An unfiled one becomes its own row with a label
       saying what happened — it does not vanish into one of the four, and it
       does not take the card down. */
    render(
      <StateBars
        groups={[...GROUPS, { key: 'OTHER', customers: 40, openCustomers: 40, stages: [] }]}
        baseCustomers={BASE}
        workedCustomers={WORKED}
      />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('Boshqa bosqichlar')).toBeTruthy()
  })
})
