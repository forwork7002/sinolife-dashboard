import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * RECHARTS IS NOT ON «MIJOZ QAYTISHI»'S CRITICAL PATH.
 *
 * `CustomerFlowChart` is the only Recharts on this screen and it sits below the
 * matrix and a row of tiles. Imported statically it put the library — ~380 KB
 * unparsed, ~110 KB over the wire — in the route's synchronous entry set, so
 * all of it was parsed before hydration and the three `/insights` requests
 * that draw the matrix left later by that much. Every other chart in the
 * product is behind `next/dynamic` for the same reason (`SalesPage` says it at
 * length).
 *
 * A source pin because the cost is invisible to every other test: jsdom loads
 * the chunk either way, and only a production build's client manifest shows
 * which entry set the library landed in.
 */
const PAGE = readFileSync(join(process.cwd(), 'src/features/cohort/CohortPage.tsx'), 'utf8')

describe('the cohort page’s chart chunk', () => {
  it('never imports the chart or recharts statically', () => {
    expect(PAGE).not.toMatch(/^import[^;]*from '@\/components\/charts\/CustomerFlowChart'/m)
    expect(PAGE).not.toMatch(/^import[^;]*from 'recharts'/m)
  })

  it('loads the chart through next/dynamic, client-only, behind a skeleton of its own height', () => {
    expect(PAGE).toMatch(/^import dynamic from 'next\/dynamic'$/m)
    /* The fallback is the slot's own loading skeleton, so a late chunk adds
       no second visible state and nothing under the card moves. */
    expect(PAGE).toMatch(
      /dynamic\(\s*\(\) => import\('@\/components\/charts\/CustomerFlowChart'\)\.then\(\(m\) => m\.CustomerFlowChart\),\s*\{ ssr: false, loading: \(\) => <ChartSkeleton height=\{280\} \/> \},?\s*\)/,
    )
    expect(PAGE).toMatch(/<CustomerFlowChart data=\{f\.series\} height=\{280\} \/>/)
  })
})
