import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  WIDENING IS A READ. A ROP given «Butun kompaniya» on RNP reads every team's
  sheet; the plan / cost / headcount and lead-split POSTs behind it are gated
  on `analytics:read:all` + `kpi:manage`, and a team-scoped MANAGER widened
  there would overwrite every team's plans (security review, 2026-10-05).
  The handler is the one place both paths meet, so this pins it at the source.
*/
describe('per-section scope never reaches a write', () => {
  const source = readFileSync('src/server/http/handler.ts', 'utf8')
  const write = source.slice(source.indexOf('export function mutationHandler'))
  const read = source.slice(
    source.indexOf('export function getHandler'),
    source.indexOf('export function mutationHandler'),
  )

  it('widens the GET path and not the mutation path', () => {
    expect(read).toContain("authorise(request, access, 'read')")
    expect(write).toContain("authorise(request, access, 'write')")
    expect(write).not.toContain("'read'")
    expect(write).not.toContain('widenForSection')
  })

  it('offers no edit controls on a widened read', () => {
    for (const route of ['src/app/api/v1/rnp/overview/route.ts', 'src/app/api/v1/registration/overview/route.ts']) {
      expect(readFileSync(route, 'utf8')).toMatch(/kpi:manage'\) && !ctx\.principal\.widened/)
    }
  })
})
