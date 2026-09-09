import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
  The repository reads `env` at module scope for APP_TIMEZONE, and `env`
  refuses to load without a complete configuration — deliberately, so a
  misconfigured deployment fails at boot rather than at midnight. A unit test
  about SQL shape has no database and no secrets, so it supplies the four
  required names first and imports afterwards.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * The Тасдиклаш board answers two questions from one definition.
 *
 * `window` is the client's own board — what ARRIVED in the confirmation queue
 * during the period. `backlog` is what is waiting right now, whenever it
 * arrived, because a windowed queue cannot answer that: the oldest unworked
 * order on this portal predates every preset, so the tile and the header bell
 * both read zero while hundreds sat unworked.
 *
 * BOTH ARE DATED BY THE ARRIVAL IN `C4:NEW`, and these tests are what keeps
 * that true. The board used to select on Дата создания, which counts a deal on
 * the day it was registered rather than the day it reached Тасдиклаш — on
 * 2026-09-03 that showed four orders where the portal and the client's own bot
 * both had one. The distance between the two dates is days, not minutes, so a
 * silent regression here is not a rounding difference.
 *
 * Everything BELOW the cohort — the latest signal, the UNCONFIRMED_SHIPPED
 * refinement, the ROP name, the Tashkent daily number — is shared, and these
 * tests exist to keep it that way: two hand-maintained copies of this SQL
 * would drift, and the drift would show up as two screens disagreeing about
 * the same order.
 */
const queueSql = (
  InsightsRepository as unknown as {
    queueSql: (mode: 'window' | 'backlog', scopeParam: string) => string
  }
).queueSql

/*
  The scope placeholder every consumer supplies. It is a REQUIRED argument, so
  the prelude cannot be built without one — a board answering for the whole
  company because a new reading forgot to say whose it was is the failure the
  argument exists to make impossible. `$9` here is deliberately not a slot any
  real caller uses, so an assertion below can only be matching this parameter.
*/
const SCOPE = '$9'
const WINDOW = queueSql('window', SCOPE)
const BACKLOG = queueSql('backlog', SCOPE)

/*
  Negative assertions run against the SQL with its prose stripped.

  The builder carries some forty lines of comment explaining why each cohort
  is what it is, and those comments name the very columns the `not.toContain`
  checks below forbid. Asserted against the raw string, "this mode does not
  select on createdAtSource" would fail the moment somebody EXPLAINED that it
  does not — the test would be measuring the documentation.
*/
const bare = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

const WINDOW_SQL = bare(WINDOW)
const BACKLOG_SQL = bare(BACKLOG)

describe('confirmation queue SQL', () => {
  it('builds the same CTE chain in both modes', () => {
    const chain = (sql: string) =>
      [...sql.matchAll(/(\w+) AS(?: MATERIALIZED)? \(/g)].map((m) => m[1])

    expect(chain(WINDOW)).toEqual([
      'signal_stage',
      'moves',
      'agg',
      'dated',
      'classified',
      'scoped',
      'numbered',
      'visible',
    ])
    expect(chain(BACKLOG)).toEqual(chain(WINDOW))
  })

  it('binds both date parameters in both modes', () => {
    // The readings that build on this pass $1 and $2 positionally; a mode that
    // stopped referencing one would make every one of them a bind-count error.
    for (const sql of [WINDOW, BACKLOG]) {
      expect(sql).toContain('$1')
      expect(sql).toContain('$2')
    }
  })

  /**
   * THE ROP STRIP IS A REGEX INSIDE A TEMPLATE LITERAL, WHICH EATS ONE LAYER.
   *
   * The strip moved from `replace()` to `regexp_replace(…, 'gi')` so that a
   * department written «Charos(rop)» is handled like the ILIKE guard above it
   * already handles it. But `\(` is not a JavaScript escape, so a single
   * backslash collapsed to a bare `(` and Postgres received '(ROP)' — a
   * capture group matching the three letters, which leaves the parentheses
   * exactly where they were. Every РОП on the Тасдиклаш board, in the ROP
   * filter dropdown, in the Статистика panel and in the sellers board's ROP
   * column would have read «Sevinch()». Measured against Postgres:
   *
   *     regexp_replace('Sevinch(ROP)', '(ROP)',   '', 'gi')  ->  Sevinch()
   *     regexp_replace('Sevinch(ROP)', '\(ROP\)', '', 'gi')  ->  Sevinch
   *
   * ASSERTED ON THE BUILT STRING, NOT ON THE SOURCE. Every other check in this
   * file reads SQL text that would have looked correct either way — the fault
   * was precisely the difference between what the source says and what the
   * template literal evaluates to, so this is the one assertion that has to be
   * made on the value.
   */
  it('escapes the parentheses the ROP strip is supposed to remove', () => {
    for (const sql of [WINDOW, BACKLOG]) {
      // The evaluated string must carry a backslash before each paren.
      expect(sql).toContain("regexp_replace(dep.\"name\", '\\(ROP\\)', '', 'gi')")
      // And must not carry the unescaped form, which is a capture group.
      expect(sql).not.toContain("regexp_replace(dep.\"name\", '(ROP)', '', 'gi')")
    }
  })

  it('balances its parentheses in both modes', () => {
    for (const sql of [WINDOW, BACKLOG]) {
      expect((sql.match(/\(/g) ?? []).length).toBe((sql.match(/\)/g) ?? []).length)
    }
  })

  it('dates the window cohort by the arrival in the queue, not by Дата создания', () => {
    expect(WINDOW_SQL).toContain('a.queued_at >= $1')
    expect(WINDOW_SQL).toContain('a.queued_at <  $2')
    // The rule this replaced. It counted a deal on the day it was registered
    // in «Регистрация», which can be days before anyone may work it.
    expect(WINDOW_SQL).not.toContain('d."createdAtSource" >= $1')
    expect(WINDOW_SQL).not.toContain('d."createdAtSource" <')
    // The window asks who arrived, not who is still waiting.
    expect(WINDOW_SQL).not.toContain("a.signal = 'CONFIRM_NEW'")
    // Nothing narrows the history scan: the window already bounds it.
    expect(WINDOW_SQL).not.toContain('d0."status"')
  })

  it('dates the backlog cohort the same way, and narrows the scan to live orders', () => {
    expect(BACKLOG_SQL).toContain("a.signal = 'CONFIRM_NEW'")
    // Same cohort key as the window, so the bell and the board can never
    // disagree about WHICH day an order belongs to — only about which orders.
    expect(BACKLOG_SQL).toContain('a.queued_at >= $1')
    expect(BACKLOG_SQL).toContain('a.queued_at < $2')
    expect(BACKLOG_SQL).not.toContain('d."createdAtSource" >= $1')
    // Without a window there is no cheap bound on the history scan, so the
    // join to open deals is what keeps the bell affordable to poll.
    expect(BACKLOG_SQL).toContain(`d0."status" = 'OPEN'`)
  })

  it('keeps an order that never reached the queue off the board, in both modes', () => {
    /*
      There is no explicit IS NOT NULL anywhere, and there must not need to be.
      `queued_at` is `max(moved_at) FILTER (WHERE signal = 'CONFIRM_NEW')`, so
      it is NULL for a deal that appeared straight in `C6:NEW` — some fifty of
      them on this portal — and a NULL fails both comparisons. Those orders
      were never announced by the bot and have never been on the client's
      board; under the old creation-date cohort they were on ours.

      What this pins is that the cohort compares the FILTERed aggregate and
      nothing else. Swap it for `moved_at` and the fifty come back silently.
    */
    expect(WINDOW_SQL).toContain(`max(moved_at) FILTER (WHERE signal = 'CONFIRM_NEW') AS queued_at`)
    for (const sql of [WINDOW_SQL, BACKLOG_SQL]) {
      expect(sql).toMatch(/WHERE[\s\S]{0,80}a\.queued_at >= \$1/)
      expect(sql).not.toMatch(/WHERE[^)]*a\.moved_at >= \$1/)
    }
  })

  it('restarts the daily № on the day the cohort is dated by', () => {
    /*
      The number and the САНА beside it have to name the same day. Partition
      this by the creation date while the board is dated by the arrival and a
      single ROP shows two «001»s on one screen, because one queue day holds
      arrivals created across several days.
    */
    for (const sql of [WINDOW_SQL, BACKLOG_SQL]) {
      expect(sql).toContain(
        `PARTITION BY c.rop, (c.queued_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tashkent')::date`,
      )
      expect(sql).toContain('ORDER BY c.queued_at ASC, c.deal_id ASC')
      expect(sql).not.toContain('PARTITION BY c.rop, (c.created_at')
    }
  })

  it('bounds the history scan on the left only', () => {
    /*
      This is what makes the arrival cohort both correct and affordable. The
      left bound cannot change the answer — the arrival it selects on is at or
      after $1, and every move older than that arrival loses `max(moved_at)`
      anyway — while a right bound WOULD: it would freeze an order at the
      status it held at midnight on the window's last day. «Kecha» showed 96
      orders against a true 101 when this closed at $2.
    */
    for (const sql of [WINDOW_SQL, BACKLOG_SQL]) {
      expect(sql).toContain('AND h."enteredAt" >= $1')
      expect(sql).not.toContain('h."enteredAt" <')
    }
  })

  it('still exposes Дата создания as a column, without dating anything by it', () => {
    // It is what the САНА tooltip shows and what the `createdAt` sort reads,
    // so the projection stays even though the cohort no longer touches it.
    for (const sql of [WINDOW_SQL, BACKLOG_SQL]) {
      expect(sql).toContain('d."createdAtSource" AS created_at')
    }
  })

  it('classifies an order identically in both modes', () => {
    // The refinement that turns a CONFIRMED signal into UNCONFIRMED_SHIPPED,
    // and the ROP derivation, must not depend on which question is asked.
    const shared = [
      `WHEN w.signal = 'CONFIRMED' AND d."confirmStatus" = 'UNREACHABLE'`,
      `THEN 'UNCONFIRMED_SHIPPED'`,
      `dep."name" ILIKE '%(ROP)%'`,
      'row_number() OVER (',
    ]
    for (const fragment of shared) {
      expect(WINDOW).toContain(fragment)
      expect(BACKLOG).toContain(fragment)
    }
  })

  it('shares every line below the cohort between the two modes', () => {
    /*
      The four fragments above are hand-picked, and a hand-picked list is only
      ever as good as the last person to extend it. Everything from `classified`
      onward is built from one template with no mode branch, so it can be
      compared whole — and then a divergence nobody thought to name still fails.
    */
    const tail = (sql: string) => sql.slice(sql.indexOf('classified AS ('))

    expect(tail(WINDOW)).toBe(tail(BACKLOG))
    expect(tail(WINDOW).length).toBeGreaterThan(500)
  })
})

/**
 * WHOSE BOARD IS THIS.
 *
 * A ROP given «Тасдиклаш» must read their own floor and not the company's, and
 * a salesperson their own orders — the client asked for exactly this: «ROP
 * Asliddin bersam shu faqat uzini malumotlarini korishi kerak umumiy emas».
 *
 * There are nine readings built on this one prelude — the row list, its
 * pagination count, the five tiles, the ROP panel, the ROP filter's options,
 * the header bell, the rejection control chart and both of the sellers board's
 * queue queries. Narrowing them one at a time is how two of them end up
 * disagreeing in front of the same operator, so the predicate lives in
 * `classified`, the CTE all nine are cut from, and these tests pin it there.
 */
describe('the caller\'s scope', () => {
  it('cuts in exactly two places, and both are doors out of the prelude', () => {
    /*
      `scoped` is the cheap door — the cohort with the caller's cut and no
      window function. `visible` is the same cut applied to `numbered`. Every
      one of the nine readings selects from one or the other, so there is still
      a single predicate deciding who is on this board; it is simply written on
      both sides of the window function rather than above it.
    */
    const sql = bare(WINDOW)
    const cte = (name: string) => {
      const from = sql.indexOf(`${name} AS (`)
      const next = sql.indexOf(' AS (', from + name.length + 5)
      return sql.slice(from, next === -1 ? undefined : next)
    }

    expect(cte('scoped')).toContain(SCOPE)
    expect(cte('visible')).toContain(SCOPE)
    // Exactly two, so a third cut cannot appear unnoticed and disagree.
    expect(sql.split(SCOPE).length - 1).toBe(2 * 2)
  })

  it('leaves no reading able to select the UNCUT cohort', () => {
    /*
      THE HAZARD THIS RESTRUCTURE INTRODUCED, GUARDED AT ITS SOURCE.

      Numbering before the cut means `classified` is now an UNSCOPED set that
      lives inside the prelude, and a reading that selected from it would
      answer for the whole company while looking exactly like its neighbours.
      Two places may: `scoped`, which cuts it, and `numbered`, which numbers
      it and is itself cut by `visible`. Nothing else, ever.

      Asserted over the repository's own source rather than over one built
      string, because the nine readings append their SQL in nine different
      methods and only the file sees all of them.
    */
    const source = readFileSync(
      join(process.cwd(), 'src/server/repositories/insightsRepository.ts'),
      'utf8',
    )
    const uncut = source.match(/FROM classified\b/g) ?? []
    expect(uncut).toHaveLength(2)
  })

  it('mints the daily number BEFORE the cut, never after it', () => {
    /*
      THE «№» IS A LABEL THE FLOOR READS OUT LOUD — to each other, and against
      the bot's Тасдиклаш posts. Numbering after the cut counts the rows the
      reader happens to be allowed to see, so a seller scoped to themselves
      would call their sixth order «001» while their ROP called it «006».

      It is not an OWN-only hazard either: `c.rop` is NULL for every unit whose
      name carries no (ROP) marker, so the partition pools Операцион,
      Регистрация and everyone else into one group, and any scope admitting
      some of those people slices it.
    */
    const sql = bare(WINDOW)
    const numbered = sql.slice(sql.indexOf('numbered AS ('), sql.indexOf('visible AS ('))

    expect(numbered).toContain('row_number() OVER (')
    expect(numbered).toContain('FROM classified c')
    // The window's input is the UNCUT cohort. This is the assertion that
    // fails if somebody moves the predicate back above it.
    expect(numbered).not.toContain(SCOPE)
  })

  it('matches on the OPERATOR, the person the board credits the order to', () => {
    /*
      Not `d."employeeId"`. The assignee drifts — this portal moves deals to
      back office while they are processed, which put 556 July orders on the
      head of Операцион — so a team boundary drawn on the assignee would file
      a seller's own order outside their ROP's board. `e` is the alias the
      COALESCE resolves to, two lines above.
    */
    const sql = bare(WINDOW)
    expect(sql).toContain(`c.operator_id = ANY(string_to_array(${SCOPE}, ','))`)
    // The column the predicate reads is PROJECTED from that one join, never
    // re-derived: a second COALESCE somewhere else would be a second
    // definition of whose order this is.
    expect(sql).toContain('JOIN "employee" e ON e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")')
    expect(sql).toContain('e."id" AS operator_id')
    expect(sql.match(/COALESCE\(d\."operatorEmployeeId"/g) ?? []).toHaveLength(1)
  })

  it('treats a null scope as the whole company and nothing else as one', () => {
    // `null` is how an ALL-scoped account is expressed. An EMPTY list must not
    // be — the repository turns that into a sentinel id instead, because
    // `= ANY('{}')` is the only correct reading of "admits nobody".
    expect(bare(WINDOW)).toContain(`${SCOPE}::text IS NULL OR`)
  })

  it('narrows both modes identically', () => {
    // The bell counts the backlog and the page counts a window; they differ in
    // which orders ENTER the cohort, never in whose they are. A mode-dependent
    // scope would make the header and the board it links to describe two
    // different populations, which this file already forbids for the cohort.
    const tail = (sql: string) => sql.slice(sql.indexOf('classified AS ('))
    expect(tail(WINDOW)).toContain(SCOPE)
    expect(tail(BACKLOG)).toBe(tail(WINDOW))
  })

  it('cannot be built without one', () => {
    /*
      The argument is required and has no default. TypeScript enforces it at
      every call site; this asserts the shape a cast could still get past —
      that the prelude interpolates whatever it is handed rather than carrying
      a silent "no filter" of its own.
    */
    const withoutScope = (queueSql as unknown as (mode: string) => string)('window')
    expect(withoutScope).toContain('undefined')
  })
})

/**
 * «🔁 ҚАЙТА ТУШДИ» — the mark the floor already reads in Telegram.
 *
 * The bot derives it from its own memory: it keeps each deal's previous stage
 * in `deal_state.json` and notices the move back into `C4:NEW`. A dashboard
 * that reads the portal has no "what it was before" — but Bitrix does keep the
 * fact, as one stage-history row per entry, so an order that entered `C4:NEW`
 * more than once came back. That is what this fragment counts.
 *
 * IT MUST NOT BE BOUNDED BY THE WINDOW. Everything else on the board is: the
 * history table is six figures of rows and the cohort's scan has to start
 * somewhere. This one already knows the deal, so it reads that deal's own
 * history end to end — and it has to, because an order first queued in July
 * and returned this morning is a return, and a window opening today cannot see
 * the July arrival to compare against.
 */
const historySql = (
  InsightsRepository as unknown as { QUEUE_HISTORY_SQL: string }
).QUEUE_HISTORY_SQL
const REPEAT = bare(historySql)

describe('the repeat mark', () => {
  it('counts entries into the queue stage, and nothing else', () => {
    expect(REPEAT).toContain(`ss.signal = 'CONFIRM_NEW'`)
    expect(REPEAT).toContain('count(*)::int AS entries')
    // Correlated on the row's own deal: this runs after the page is cut, so it
    // is one index lookup per rendered row rather than a pass over the cohort.
    expect(REPEAT).toContain(`h."dealId" = d."id"`)
    expect(REPEAT).toContain('LEFT JOIN LATERAL')
  })

  it('reads the whole of that deal\'s history, not the window', () => {
    expect(REPEAT).not.toContain('$1')
    expect(REPEAT).not.toContain('$2')
    expect(REPEAT).not.toContain('enteredAt" >=')
  })

  it('draws the mark on GAPS, not on entries', () => {
    /*
      Deal 319494 on 2026-09-03: queued 14:40, confirmed 14:49, back at 14:55,
      confirmed again 14:56. Two entries — and one person correcting a mistake
      inside a quarter of an hour, which the bot does not announce and this
      board should not mark. The rule is the bot's: at least six hours since
      the previous arrival.
    */
    expect(REPEAT).toContain("interval '6 hours'")
    expect(REPEAT).toContain('AS returns')
    /*
      The gap is between CONSECUTIVE arrivals, so a long-dormant order that
      bounces twice today is one return and not two. It is measured over the
      VISIT list now rather than over the raw arrival rows — the visit list is
      one row per arrival, in arrival order, so the sequence is the same one
      the old `lag` over `enteredAt` walked.
    */
    expect(REPEAT).toContain('lag(v.queued_at) OVER (ORDER BY v.visit_no)')
  })

  it('names the visit the mark is about, not merely the latest one', () => {
    // `previous_at` is the arrival before the last QUALIFYING return, so the
    // tooltip cannot report a fifteen-minute bounce as the reason for a badge
    // drawn because of something that happened four days ago.
    expect(REPEAT).toContain('max(prev) FILTER')
  })

  it('is used by BOTH row queries, which are chosen by the window length', () => {
    /*
      The board switches shape at 62 days — two statements below it, one above.
      A mark added to only one of them would appear and disappear as somebody
      widened the period, which is the kind of fault nobody reports because it
      looks like the data changed.
    */
    const source = readFileSync('src/server/repositories/insightsRepository.ts', 'utf8')
    const uses = source.match(/InsightsRepository\.QUEUE_HISTORY_SQL/g) ?? []
    expect(uses).toHaveLength(2)
  })
})

/**
 * THE ROW CARRIES ITS OWN PAST, AND COUNTS ONLY ITS PRESENT.
 *
 * The board is one row per order dated by its LAST arrival, so an order
 * confirmed on the 29th and pulled back into Тасдиклаш on the 31st is a row on
 * the 31st and the 29th loses it. Deal 834920 did that, and six of the 127
 * orders that arrived on 2026-08-29 did. The СТАТУС column now shows the
 * earlier visits under the current one so the day it left is still readable
 * from the row it landed on.
 *
 * The danger in that is arithmetic, not layout: the moment an earlier visit
 * can be counted, one order is two and «тасдиқланиш %» can exceed the orders
 * it divides. These tests are the fence — the visit list exists only in the
 * two ROW queries, and every number on the screen still comes from the single
 * `outcome` the cohort already agreed on.
 */
describe('the queue history on a row', () => {
  it('splits the deal into visits, one per arrival', () => {
    // The running count of arrivals IS the visit number.
    expect(REPEAT).toContain(`count(*) FILTER (WHERE ss.signal = 'CONFIRM_NEW') OVER (`)
    expect(REPEAT).toContain('AS visit_no')
    // Each visit's last word, tie-broken exactly as `agg` breaks it.
    expect(REPEAT).toContain('(array_agg(m.signal ORDER BY m.entered_at DESC, m.signal))[1]')
    expect(REPEAT).toContain('GROUP BY m.visit_no')
  })

  it('files a same-instant decision under the visit it ended', () => {
    /*
      Two signal moves stamped in the same second are ordinary — 123 pairs in
      a month on this portal — and in two of them one was an arrival and the
      other a decision: deals 828090 and 847980, both «Кутармади» landing in
      the same second the deal bounced back into the queue. Sorting the
      arrival LAST within an instant files that decision under the visit it
      ended rather than under one that had not begun. Without the term the
      answer came from the row's cuid, which is to say from nothing.
    */
    expect(REPEAT).toContain(`ORDER BY h."enteredAt", (ss.signal = 'CONFIRM_NEW'), h."id"`)
  })

  it('frames the running count by ROWS, not by the default RANGE', () => {
    /*
      Under RANGE, every move sharing an instant with an arrival becomes its
      peer and is pulled into the visit that arrival OPENS — so a refusal
      stamped in the same second as the next arrival would be filed under a
      visit that had not started yet. Deal 834920 has two moves inside one
      second on 2026-08-31, which is not rare enough to leave to chance.
    */
    expect(REPEAT).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW')
  })

  it('drops the moves that happened before any arrival', () => {
    /*
      The ~52 orders that appear straight in C6:NEW have a confirmation signal
      and no queue visit. The cohort does not carry them, and neither does
      this — a visit numbered 0 is a signal with no arrival to belong to.
    */
    expect(REPEAT).toContain('WHERE m.visit_no > 0')
  })

  it('hands the list back newest first', () => {
    // So `visits[0]` is the state the row is filed under, and the UI renders
    // the chain top-down without reversing it.
    expect(REPEAT).toContain('ORDER BY visit_no DESC')
  })

  it('refines UNCONFIRMED_SHIPPED on the LAST visit only', () => {
    /*
      «Тастиклаш анализ» is a field on the DEAL describing where it stands now,
      not something the portal keeps per visit. Reading it onto an August visit
      would invent a fact; confining it to the last visit is also what keeps
      `visits[0]` identical to `classified.outcome`, which is the invariant the
      whole cell is drawn on.
    */
    expect(REPEAT).toContain(`WHEN outcome = 'CONFIRMED' AND is_last AND d."confirmStatus" = 'UNREACHABLE'`)
    // Derived from the same `lead` that decides which visits are shown, so the
    // two can never disagree about which visit is the newest.
    expect(REPEAT).toContain('lead(v.queued_at) OVER (ORDER BY v.visit_no) IS NULL AS is_last')
  })

  /**
   * THE LIST IS NOT GATED ON REPEAT_GAP_HOURS, AND THAT IS DELIBERATE.
   *
   * The tempting rule is «show only the visits 🔁 calls returns», so the mark
   * and the chain can never say different things on one row. It was written,
   * measured and reverted: `REPEAT_GAP_HOURS` is ELAPSED TIME while this board
   * is cut into Tashkent days, and the two do not line up. An order arriving
   * 22:00, confirmed 23:00 and back at 01:00 has a two-hour gap and no mark —
   * and its row still leaves yesterday for today, because the cohort dates it
   * by the LAST arrival. Gating the list on the gap hands that operator the
   * bare chip this whole column exists to replace, which is deal 834920's
   * failure wearing a different clock.
   *
   * Two close arrivals are not always the same state twice either: refused at
   * 09:00, back at 12:00, waiting now is three hours, no mark, and the chain
   * is the only place that refusal is still readable.
   */
  it('carries every visit, not only the ones the mark counts', () => {
    // No forward-gap anywhere, and no FILTER between json_agg and its alias —
    // the inner min()/max() FILTERs that build a visit are a different thing.
    expect(REPEAT).not.toContain('next_gap')
    const aggregate = REPEAT.slice(REPEAT.indexOf('json_agg('), REPEAT.indexOf('AS visits'))
    expect(aggregate).not.toContain('FILTER')
  })

  it('is selected by both row queries and by nothing else', () => {
    const source = readFileSync('src/server/repositories/insightsRepository.ts', 'utf8')
    // Once in confirmationBoard's `decorated`, once in confirmationOrders.
    expect(source.match(/rep\.visits AS visits/g) ?? []).toHaveLength(2)
  })

  it('never reaches the cohort, so nothing can count a visit twice', () => {
    /*
      The five tiles, the Статистика panel, the state filter and the header
      bell are all built on `queueSql` — `classified.outcome`, one state per
      order. A visit list inside the cohort is the shape in which an order
      confirmed in August and refused in September becomes two orders.
    */
    for (const sql of [WINDOW_SQL, BACKLOG_SQL]) {
      expect(sql).not.toContain('visit_no')
      expect(sql).not.toContain('json_agg')
    }
  })
})

/**
 * WHAT EACH TILE IN THE BAND IS WORTH — the same five FILTERs, over money.
 *
 * The band's sums are the ROP breakdown added down its columns, exactly as its
 * counts are, and the breakdown is written TWICE: `confirmationByRop` for a
 * window up to two months, and the `by_rop` CTE inside `confirmationBoard` for
 * anything longer. Two hand-maintained copies of one measurement drift, and
 * this one drifts silently — a money column added to the short shape alone
 * leaves «Shu yil» printing a band of zero soʻm with every count on it correct.
 */
describe('the state band’s money', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/server/repositories/insightsRepository.ts'),
    'utf8',
  )

  /** The five states as the two breakdowns name them, in one place. */
  const STATES = [
    ['CONFIRMED', 'confirmed_amount'],
    ['NO_ANSWER', 'no_answer_amount'],
    ['REJECTED', 'rejected_amount'],
    ['CONFIRM_NEW', 'pending_amount'],
    ['UNCONFIRMED_SHIPPED', 'unconfirmed_shipped_amount'],
  ] as const

  it('is summed per state in both breakdowns', () => {
    for (const [state, column] of STATES) {
      const sums = [
        ...source.matchAll(
          new RegExp(
            `sum\\(d\\."amountMinor"\\) FILTER \\(WHERE c\\.outcome = '${state}'\\)::text\\s*\\n?\\s*AS ${column}`,
            'g',
          ),
        ),
      ]
      // Once in confirmationByRop, once in confirmationBoard's by_rop CTE.
      expect(sums, state).toHaveLength(2)
    }
  })

  it('crosses the driver as text, never as a number', () => {
    /*
      ::text on every one of them, and not for tidiness. `sum(bigint)` is
      numeric — which this driver hands back inconsistently — and inside
      `confirmationBoard` the column travels through `json_agg`, where a
      numeric is parsed by `JSON.parse` as a double. A year of this cohort in
      minor units runs past the fifteen digits a double keeps exactly, so the
      band would be wrong by a few soʻm in a figure the floor reconciles
      against Bitrix24 digit for digit. The counts beside it are safe as
      numbers; money never is.
    */
    const money = [...source.matchAll(/sum\(d\."amountMinor"\) FILTER \(WHERE c\.outcome[\s\S]{0,120}?AS \w*amount/g)]
    expect(money).toHaveLength(10)
    for (const [fragment] of money) expect(fragment).toContain('::text')
  })

  it('is measured beside the counts, over the same cohort rows', () => {
    /*
      Both breakdowns GROUP BY c.rop over the queue's own CTE, and the money
      has to be a column of THAT aggregate — not a second pass, not a second
      join to `deal`. The tiles and their sums are one population wearing one
      label, and the only way to be sure of it is that one GROUP BY produces
      both.
    */
    const byRop = source.slice(
      source.indexOf("queueSql(mode, '$4')"),
      source.indexOf('GROUP BY c.rop', source.indexOf("queueSql(mode, '$4')")),
    )
    const cte = source.slice(
      source.indexOf('by_rop AS ('),
      source.indexOf('GROUP BY c.rop', source.indexOf('by_rop AS (')),
    )

    for (const block of [byRop, cte]) {
      for (const [, column] of STATES) expect(block).toContain(column)
      // The cohort's own alias, joined once, feeding counts and money alike.
      expect(block).toContain('JOIN "deal" d ON d."id" = c.deal_id')
      expect(block).toContain("count(*) FILTER (WHERE c.outcome = 'CONFIRMED')")
    }
  })
})

/**
 * THE COLUMN FILTERS, AND WHERE EACH ONE IS ALLOWED TO REACH.
 *
 * The client asked on 2026-09-09 for Excel-style filters on the РОП, РЕГИОН
 * and СУММА columns. Two of the three narrow more than the rows: the state
 * band is the per-ROP breakdown added down its columns, so a filter that
 * reaches the breakdown reaches the band, and one that does not cannot.
 *
 * THE LINE IS DRAWN ON PURPOSE AND IS INVISIBLE WHEN IT MOVES.
 *
 *   · РЕГИОН and СУММА narrow the cohort — rows, tiles and the Статистика
 *     panel alike. A reader who filters to Хорезм is asking what Хорезм is
 *     worth, and a band that answered for the whole country would be a figure
 *     nobody asked for sitting above a table that disagreed with it.
 *   · РОП narrows the rows and the tiles but NOT the panel, because the panel
 *     is a comparison OF ROP groups — applying it would leave the one row the
 *     reader picked, and there is nothing to compare a group against but the
 *     others.
 *
 * Nothing else in the suite would name it if it moved: both readings would
 * still be internally consistent, still be correct measurements, and still be
 * of two different populations printed under one heading.
 *
 * The window's LENGTH picks between two hand-maintained SQL shapes, so both are
 * asked the same question here — a predicate added to one and not the other is
 * a month and a year answering differently.
 */
describe('what each column filter is allowed to narrow', () => {
  // The repository's own text. Read here rather than shared with the describe
  // above it, so neither block can be reordered into breaking the other.
  const source = readFileSync('src/server/repositories/insightsRepository.ts', 'utf8')

  /** The two blocks that produce the PAGE of rows, one per window shape. */
  const rowBlocks = () => {
    const short = source.slice(
      source.indexOf("queueSql(mode, '$8')}"),
      source.indexOf('ORDER BY ${sortColumn[query.sort]}'),
    )
    const long = source.slice(source.indexOf('filtered AS ('), source.indexOf('page AS ('))
    return { short, long }
  }

  /**
   * The two blocks that produce the per-ROP breakdown, one per window shape.
   *
   * ANCHORED ON THE METHOD, not on `queueSql(mode, '$4')` the way the older
   * block above does. Three methods bind the scope at $4, and the first of
   * them has no `GROUP BY c.rop` of its own — so slicing from the first match
   * to the first GROUP BY swallows two unrelated statements, one of which has
   * a `ropMatch` in it. That is harmless for an assertion that something is
   * PRESENT and fatal for one that something is ABSENT, which is what the
   * prohibition below needs.
   */
  const cohortBlocks = () => {
    const shortFrom = source.indexOf('async confirmationByRop(')
    const short = source.slice(shortFrom, source.indexOf('GROUP BY c.rop', shortFrom))
    const longFrom = source.indexOf('by_rop AS (')
    const long = source.slice(longFrom, source.indexOf('GROUP BY c.rop', longFrom))
    return { short, long }
  }

  it('lets region and summa reach the rows in both window shapes', () => {
    for (const block of Object.values(rowBlocks())) {
      expect(block).toContain('regionMatch')
      expect(block).toContain('amountRange')
      expect(block).toContain('ropMatch')
    }
  })

  it('lets region and summa reach the ROP breakdown in both window shapes', () => {
    for (const block of Object.values(cohortBlocks())) {
      expect(block).toContain('regionMatch')
      expect(block).toContain('amountRange')
    }
  })

  it('keeps the ROP selection OUT of the ROP breakdown, in both shapes', () => {
    /*
      The one assertion here that is a prohibition rather than a requirement.
      A `ropMatch` in either of these blocks would collapse the Статистика
      panel to the single row the reader selected — and the panel would still
      look correct, which is exactly why this is pinned in a test rather than
      left to the comment above the SQL.
    */
    for (const block of Object.values(cohortBlocks())) expect(block).not.toContain('ropMatch')
  })

  it('compares lists and ranges rather than scalars', () => {
    const rop = InsightsRepository as unknown as {
      ropMatch: (p: string) => string
      regionMatch: (p: string) => string
      amountRange: (a: string, b: string) => string
    }

    /*
      `::text[]` and `= ANY`, not `= $n`. The controls are checkbox lists now,
      and a scalar predicate would have silently matched only the last name in
      the list. NULL is the empty selection and means «everything»: `= ANY` over
      an EMPTY array is false for every row, so a repository that sent `[]`
      instead of `null` would render an empty table for a filter nobody set.
    */
    for (const built of [rop.ropMatch('$5'), rop.regionMatch('$9')]) {
      expect(built).toContain('::text[] IS NULL')
      expect(built).toContain('= ANY(')
    }

    // The sentinels are compared, not just displayed: a NULL rop and a NULL
    // region are both real populations and both have to be selectable.
    expect(rop.ropMatch('$5')).toContain(InsightsRepository.NO_ROP)
    expect(rop.regionMatch('$9')).toContain(InsightsRepository.NO_REGION)

    // Two independent bounds, each optional, and inclusive at both ends.
    const range = rop.amountRange('$10', '$11')
    expect(range).toContain('$10::bigint IS NULL OR d."amountMinor" >= $10::bigint')
    expect(range).toContain('$11::bigint IS NULL OR d."amountMinor" <= $11::bigint')
  })
})
