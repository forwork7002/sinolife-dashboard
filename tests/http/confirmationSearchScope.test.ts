import { describe, expect, it } from 'vitest'

/*
  Same reason `confirmationQueueSql.test.ts` supplies these first: `env` is
  read at module scope for APP_TIMEZONE and refuses to load without a complete
  configuration. A unit test about SQL shape has no database — and this one
  could not use the local database anyway: the throwaway seed on 5433 holds
  no stage with a `confirmationSignal`, so the confirmation board is empty
  there and every arm of this statement returns nothing.
*/
process.env.DATABASE_URL ??= 'postgresql://test@127.0.0.1:5432/test'
process.env.BETTER_AUTH_SECRET ??= '0'.repeat(64)
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000'

const { InsightsRepository } = await import('@/server/repositories/insightsRepository')

/**
 * THE PRE-FILTER THAT MAKES A SEARCH ON THIS BOARD A LOOKUP.
 *
 * The board answers every search over all of time, and `allTime` starts at the
 * epoch — so the cohort is built over the entire signal history and the search
 * predicate then runs against it. None of the four trigram indexes can help
 * there: the predicate reaches `deal` and `customer` by id from the cohort, and
 * an index only pays when a statement STARTS from the table it is on. This
 * statement does, and the ids it returns bound the cohort.
 *
 * What can go wrong here is silent in every case, which is why these
 * assertions are so literal:
 *
 *   - an expression written a hair differently from the index's stops using
 *     the index, and nothing about the answer changes;
 *   - an arm without a LIMIT turns a broad term into a scan of a whole table;
 *   - a missing day-peer arm renumbers the day's orders 001, 002, 003, an
 *     identifier the floor reconciles against Telegram;
 *   - an arm NARROWER than the predicate loses rows the table would have
 *     shown while the tiles above it still count them.
 */
const searchScopeSql = (
  InsightsRepository as unknown as { searchScopeSql: () => string }
).searchScopeSql

const searchScopeParams = (
  InsightsRepository as unknown as {
    searchScopeParams: (term: string) => {
      like: string
      digitsLike: string | null
      headLike: string | null
      tailLike: string | null
    }
  }
).searchScopeParams

/**
 * The OTHER reading of the department name.
 *
 * `classified.rop` is the stripped name and `SEARCH_SQL` matches that column,
 * so the scope's department arm has to compare the same string. Both are read
 * here so the two can be compared as VALUES rather than as two hopefully
 * identical literals — the whole class of fault this file guards is a string
 * that looks right in the source and evaluates to something else.
 */
const queueSql = (
  InsightsRepository as unknown as {
    queueSql: (mode: 'window' | 'backlog', scopeParam?: string) => string
  }
).queueSql

const ROP_STRIP_SQL = (InsightsRepository as unknown as { ROP_STRIP_SQL: string }).ROP_STRIP_SQL

const SQL = searchScopeSql()

/** Assertions about the statement read the SQL, never the prose explaining it. */
const bare = SQL.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')

describe('the confirmation search scope statement', () => {
  it('caps every arm, and the whole set', () => {
    /*
      A term like «collagen» matches 146 431 deal titles on production. Without
      a cap per arm the pre-filter reads all of them and the day-peer expansion
      behind it drags in every arrival of every day they touch — slower than
      the unbounded shape it replaced, which is the one way this can be worse
      than doing nothing.
    */
    const hits = bare.slice(bare.indexOf('WITH hits AS ('), bare.indexOf('arrivals AS ('))
    const arms = (hits.match(/\bUNION\b/g) ?? []).length + 1

    expect(arms).toBeGreaterThan(10)
    // One per arm inside `hits` …
    expect((hits.match(/\bLIMIT\b/g) ?? []).length).toBe(arms)
    // … one on `days`, because the expansion's cost is per DAY and not per hit
    // …
    // … and one more on the union of the hits with their day-peers, which is
    // what tells the caller the set is too broad to be a lookup at all.
    expect((bare.match(/\bLIMIT\b/g) ?? []).length).toBe(arms + 2)
  })

  it('caps the day-peer expansion on its own count, not on the hit count', () => {
    /*
      THE HIT CAP DOES NOT BOUND THIS, AND THAT WAS THE HOLE.

      `hits` stops at 2 000 orders, but the expansion behind them costs one
      index range scan per distinct ARRIVAL DAY — so an operator's name
      matching ~800 orders spread over ~300 days sat comfortably inside the hit
      cap, ran 300 range scans, and had the result thrown away by
      SEARCH_SCOPE_CAP. The board paid for this statement AND for the unbounded
      query it then fell back to, which is the one way the pre-filter can be
      worse than not existing.

      Same shape as the hit cap: one row above the limit so the overflow is a
      fact, a one-time gate so the expensive half does not run at all past it,
      and the sentinel raised on either count.
    */
    expect(bare).toContain('LIMIT 151')
    expect(bare).toContain('WHERE (SELECT count(*) FROM days) <= 150')
    expect(bare).toContain('(SELECT count(*) FROM days) > 150')
  })

  it('writes the phone exactly as customer_phone_digits_trgm_idx carries it', () => {
    /*
      The index is on an EXPRESSION, so the query has to spell that expression
      character for character or Postgres silently plans a sequential scan of
      326 859 customers. Nothing else about the answer changes, which is why
      this is asserted on the text.
    */
    expect(bare).toContain(`regexp_replace(c."phone", '[^0-9]', '', 'g') LIKE $2`)
  })

  it('writes the amount exactly as deal_amount_major_trgm_idx carries it', () => {
    // The column holds minor units and the screen prints «1 600 000», so the
    // comparison — and therefore the index — is on the major-unit text.
    expect(bare).toContain(`("amountMinor" / 100)::text LIKE $2`)
  })

  it('matches the Bitrix id the way the predicate does, not the way ⌘K does', () => {
    /*
      An exact arm on a btree is the obvious shape and the wrong one: the
      board's predicate matches this column with ILIKE, so an exact arm would
      make the scope NARROWER than the predicate and a partial id would find
      its order on the unbounded fallback and not on the fast path. Every arm
      here is a superset of what SEARCH_SQL does with the same column.
    */
    expect(bare).toContain(`"externalId" ILIKE $1`)
    expect(bare).not.toContain(`"externalId" = $`)
  })

  it('carries no second copy of the ROP strip', () => {
    /*
      `\\(ROP\\)` inside a JavaScript template literal is one collapsed
      backslash away from printing «Sevinch()» on every ROP on this board, and
      the assertion that guards it reads the string queueSql builds — it would
      not see a copy living here. Matching the department's raw name is a
      superset of matching the stripped one, and a superset is all this
      statement is allowed to be.
    */
    expect(bare).toContain(`dep."name" ILIKE $1`)
    expect(bare).not.toContain('(ROP)')
    expect(bare).not.toContain('regexp_replace(dep.')
  })

  it('resolves the operator the row prints, not only the deal owner', () => {
    /*
      The board displays COALESCE(operatorEmployeeId, employeeId) — the
      portal's own snapshot of who sold the order. A pre-filter that resolved
      only the assignee would fail to reach exactly the deals that snapshot
      exists for: 556 July orders sat on the head of Операцион.
    */
    expect(bare).toContain(`e."id" = d."employeeId"`)
    expect(bare).toContain(`e."id" = d."operatorEmployeeId"`)
    expect(bare).toContain(`e."id" = COALESCE(d."operatorEmployeeId", d."employeeId")`)
  })

  it('dates every hit by its arrival in C4:NEW, the way the cohort does', () => {
    // Same rule as `agg.queued_at`: the LAST arrival, and only an arrival —
    // the ~52 deals that appear straight in C6:NEW were never on this board.
    expect(bare).toContain(`s."confirmationSignal" = 'CONFIRM_NEW'`)
    expect(bare).toContain(`max(h."enteredAt") AS queued_at`)
  })

  it('bounds the day-peer scan on BOTH sides', () => {
    /*
      Unlike `moves`, which must stay open on the right so an order shows the
      status it holds NOW, this one asks a closed question: which orders
      arrived on this Tashkent day. Both bounds, converted back to the UTC the
      column stores.
    */
    expect(bare).toContain('h."enteredAt" >=')
    expect(bare).toContain('h."enteredAt" <')
    expect(bare).toContain("AT TIME ZONE 'Asia/Tashkent'")
    expect(bare).toContain("AT TIME ZONE 'UTC'")
  })

  it('returns the day-peers as well as the hits', () => {
    /*
      `numbered` restarts № per ROP per Tashkent day and that column promises
      the number never changes. A cohort built from the matches alone would
      print 001 over the day's thirty-seventh order — nothing errors, nothing
      looks wrong, and the floor reconciles that number against Telegram.
    */
    expect(bare).toContain('SELECT deal_id, false AS overflow FROM arrivals')
    expect(bare).toContain('SELECT deal_id, false FROM peers')
    expect(bare).toContain('peers AS (')
  })

  it('reports an overflow as a fact, never as a short answer', () => {
    /*
      THE FAILURE THIS CLOSES. A term matching three thousand deal titles
      truncates its arm at the cap, resolves fifteen hundred of them to
      arrivals, and comes back a set with nothing about it to distrust — a
      board silently missing half the orders it was asked for, on the one
      screen where «Buyurtma topilmadi» is said to a customer on the phone.

      So the arms are capped one ABOVE the hit cap and the overflow rides back
      as its own row: at or below the cap no arm truncated, which is what makes
      the answer a complete superset rather than a plausible one.
    */
    expect(bare).toContain('LIMIT 2001')
    // Word-bounded: the outer cap is LIMIT 20001, which contains the string.
    expect(bare).not.toMatch(/LIMIT 2000\b/)
    expect(bare).toContain('AS overflow')
    expect(bare).toContain('SELECT NULL::text, true')
    // And past the cap the expensive half does not run at all.
    expect(bare).toContain('WHERE (SELECT count(*) FROM hits) <= 2000')
    expect(bare).toContain('WHERE (SELECT count(*) FROM hits) > 2000')
  })

  it('counts DEALS on the one arm whose join can multiply them', () => {
    // A deal carries up to four line items, so this arm's LIMIT would count
    // items and cut it at fewer orders than the cap claims — an overflow that
    // never announces itself.
    expect(bare).toContain('SELECT DISTINCT di."dealId"')
  })

  it('balances its parentheses', () => {
    expect((SQL.match(/\(/g) ?? []).length).toBe((SQL.match(/\)/g) ?? []).length)
  })
})

describe('the term, as the scope statement binds it', () => {
  it('escapes the LIKE wildcards a person means literally', () => {
    /*
      Measured on the local database, over 1 600 deals: `title ILIKE '%'||'%'||'%'`
      matches all 1 600, and `'%'||'a_a'||'%'` matches 368. Escaped, both match
      nothing — which is what a person typing a per cent sign meant.
    */
    expect(searchScopeParams('100%').like).toBe('%100\\%%')
    expect(searchScopeParams('bx_1').like).toBe('%bx\\_1%')
    expect(searchScopeParams('a\\b').like).toBe('%a\\\\b%')
  })

  it('binds NULL rather than «%%» for a term with no digits', () => {
    // '%%' matches every row in the table, on an arm meant to find one order.
    expect(searchScopeParams('Oq Yoʻl').digitsLike).toBeNull()
    expect(searchScopeParams('+998 90 111 22 33').digitsLike).toBe('%998901112233%')
  })

  it('splits the masked phone into a prefix and a suffix', () => {
    // The column holds +998944340037 and the screen shows +99894***0037.
    // People search by copying what they can see; digits-only turns that into
    // 998940037, a sequence in no phone number.
    const masked = searchScopeParams('+99894***0037')
    expect(masked.headLike).toBe('99894%')
    expect(masked.tailLike).toBe('%0037')
  })

  it('refuses a masked form with an empty half', () => {
    // A lone star would otherwise reduce to '%' on both sides and match every
    // customer in the database.
    expect(searchScopeParams('***').headLike).toBeNull()
    expect(searchScopeParams('***').tailLike).toBeNull()
    expect(searchScopeParams('99894*').headLike).toBeNull()
    expect(searchScopeParams('*0037').tailLike).toBeNull()
  })
})
