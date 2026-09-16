import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * WHAT THE CALL-ACTIVITY STATEMENT PROMISES.
 *
 * Four arms over one scan — the window's totals, per operator, per team and per
 * day — so nothing on the block can disagree with anything else on it. Every
 * arm carries the same measures for the same reason.
 *
 * This reads the source text rather than running the query, like every other
 * test in this directory: no test here touches a database, and the mistakes
 * worth catching are all visible in the SQL.
 */
const SOURCE = readFileSync(
  join(process.cwd(), 'src/server/repositories/insightsRepository.ts'),
  'utf8',
)

function activitySql(): string {
  const at = SOURCE.indexOf('async callActivity(')
  expect(at).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
}

function code(): string {
  return activitySql()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the call activity statement', () => {
  it('carries no backtick inside the SQL, which would close the template literal', () => {
    /*
      Found the hard way on 2026-09-16: a comment inside this statement quoted a
      file name in backticks, and every test in this file still passed — they
      read the source as TEXT and never compile it. Only running the method
      found it. This is the cheap guard for that exact failure.
    */
    expect(activitySql()).not.toContain('`')
  })

  it('is one scan with four grouping sets and no more', () => {
    expect(code()).toMatch(
      /GROUPING SETS\s*\(\s*\(employee_id\)\s*,\s*\(team\)\s*,\s*\(day\)\s*,\s*\(\)\s*\)/i,
    )
  })

  it('buckets the day through UTC first, never in one step', () => {
    /*
      `startedAt` is a naive UTC timestamp. The one-step form
      `AT TIME ZONE 'Asia/Tashkent'` READS the column as Tashkent local and
      returns an instant five hours off, which silently moves every call near
      midnight into the wrong day. CLAUDE.md states the two-step rule; this is
      where it is enforced for this statement. The probes behind the spec used
      the one-step form, and their day boundaries were wrong for exactly this
      reason.
    */
    expect(code()).toMatch(/"startedAt"\s+AT TIME ZONE 'UTC'\s+AT TIME ZONE/i)
    expect(code()).not.toMatch(/"startedAt"\s+AT TIME ZONE\s+'Asia/i)
  })

  it('names `connected` on every duration measure', () => {
    /*
      Above the floor no failed leg carries seconds, so the FILTER changes no
      number today — it states the population. Without it, the day the portal
      starts reporting ring time on a failed call, talk time silently grows.
    */
    const sql = code()
    expect(sql).toMatch(/sum\(duration_sec\)\s+FILTER \(WHERE connected\)/i)
    expect([...sql.matchAll(/FILTER \(WHERE connected\)/gi)].length).toBeGreaterThanOrEqual(4)
  })

  it('uses percentile_disc, never percentile_cont', () => {
    /*
      A duration is a whole number of seconds the portal observed.
      Interpolating between two of them invents a call that did not happen.
    */
    expect(code()).toMatch(/percentile_disc\(0\.5\)/i)
    expect(code()).toMatch(/percentile_disc\(0\.9\)/i)
    expect(code()).not.toMatch(/percentile_cont/i)
  })

  it('counts customers distinctly, never rows', () => {
    expect(code()).toMatch(/count\(DISTINCT customer_id\)/i)
  })

  it('groups the team on the employee’s PRIMARY department', () => {
    /*
      `department_member` lists one person in every unit Bitrix24 names, so
      grouping on it inflates the total and the team arm stops summing to the
      overall arm. Measured: Azizbek(ROP) reads 1 902 calls on the primary
      department and 2 847 through memberships.
    */
    expect(code()).toMatch(/"employee"[\s\S]{0,200}"departmentId"/i)
    expect(code()).not.toMatch(/department_member/i)
  })

  it('strips (ROP) but keeps a department that has no marker', () => {
    /*
      `ropOf` in sellerBoardRepository returns null without the marker.
      Applying that rule here would drop Регистрация, Операцион and NEWGEN —
      4 420 of 20 607 calls, 21.4% — into an unlabelled hole.
    */
    const sql = code()
    expect(sql).toMatch(/regexp_replace\(\s*dp\."name"/i)
    expect(sql).toMatch(/COALESCE\(\s*NULLIF\(/i)
  })

  it('clamps the window at the data floor rather than trusting the caller', () => {
    // The clamp is in TypeScript, not SQL — assert the method reads it.
    const body = SOURCE.slice(SOURCE.indexOf('async callActivity('))
    expect(body.slice(0, 1200)).toMatch(/callWindowStart\(/)
  })
})

function namedSql(marker: string): string {
  const at = SOURCE.indexOf(marker)
  expect(at, marker).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('`\n', at)
  const close = SOURCE.indexOf('\n      `,', open)
  expect(close, marker).toBeGreaterThan(open)
  return SOURCE.slice(open + 1, close)
}

function namedCode(marker: string): string {
  return namedSql(marker)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
}

describe('the duration band statement', () => {
  it('carries no backtick inside the SQL', () => {
    expect(namedSql('async callDurationBands(')).not.toContain('`')
  })

  it('builds its CASE from CALL_DURATION_BANDS rather than typing bounds out', () => {
    /*
      The bands are a business definition with one home. A CASE written by hand
      here would be a second copy, and the two would agree until the day
      somebody moved a bound.
    */
    const body = SOURCE.slice(SOURCE.indexOf('async callDurationBands('))
    expect(body.slice(0, 1500)).toMatch(/CALL_DURATION_BANDS/)
    expect(namedCode('async callDurationBands(')).not.toMatch(/<\s*600\b/)
  })

  it('bands connected calls only', () => {
    expect(namedCode('async callDurationBands(')).toMatch(/WHERE[\s\S]{0,120}"connected"/i)
  })

  it('clamps at the floor', () => {
    const body = SOURCE.slice(SOURCE.indexOf('async callDurationBands('))
    expect(body.slice(0, 1500)).toMatch(/callWindowStart\(/)
  })
})

describe('the customer band statement', () => {
  it('carries no backtick inside the SQL', () => {
    expect(namedSql('async callCustomerBands(')).not.toContain('`')
  })

  it('aggregates per customer before banding, not per call', () => {
    /*
      The question is how many calls ONE customer takes, so the GROUP BY on the
      customer has to happen first and the CASE reads its count. Banding the
      calls directly would answer a different question and look like this one.
    */
    const sql = namedCode('async callCustomerBands(')
    expect(sql).toMatch(/GROUP BY\s+customer_id/i)
    expect(sql).toMatch(/count\(\*\)/i)
  })

  it('excludes the unlinked calls rather than bucketing them as one customer', () => {
    /*
      `customerId` is null on 0.7% of rows. Grouped, every one of them would
      collapse into a single enormous customer in the 6+ band. They are
      excluded here and disclosed as `unlinkedCalls` on the activity payload.
    */
    expect(namedCode('async callCustomerBands(')).toMatch(/"customerId" IS NOT NULL/i)
  })

  it('clamps at the floor', () => {
    const body = SOURCE.slice(SOURCE.indexOf('async callCustomerBands('))
    expect(body.slice(0, 1500)).toMatch(/callWindowStart\(/)
  })
})
