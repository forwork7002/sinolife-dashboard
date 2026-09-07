-- Indexes for the Тасдиклаш board's global search.
--
-- WHY THESE AND NOT THE FOUR ALREADY HERE. 20260831150000 indexed title,
-- orderCode, customer.name and customer.phone, and the confirmation board has
-- never been able to use one of them: its search predicate runs over the
-- cohort, where `deal` and `customer` are reached by id from `numbered`
-- rather than scanned. An index only pays when a statement STARTS from the
-- table it is on. These five exist for the scope statement
-- (InsightsRepository.confirmationSearchScope), which does — it resolves a
-- term to a bounded set of deal ids and the cohort is then built from those.
--
-- WHY THEY ARE HERE AND NOT IN schema.prisma: two are expression indexes and
-- Prisma's schema language cannot express either. `prisma migrate dev` will
-- report all five as drift and offer to drop them, exactly as it already does
-- for the four trigram indexes above and for deal_operatorNameSource_idx;
-- dropping them is what would be wrong.
--
-- PLAIN `CREATE INDEX`, NOT CONCURRENTLY, AND THAT IS NOT AN OVERSIGHT.
-- Prisma runs every migration file inside a transaction on PostgreSQL and
-- CREATE INDEX CONCURRENTLY raises 25001 there. The safe order is to run these
-- five statements by hand against production with CONCURRENTLY added, before
-- the push; `IF NOT EXISTS` then makes this file a no-op there and a real
-- create on a fresh clone. Run without that, the build takes SHARE on `deal`
-- and `customer`: reads are unaffected — the old web container serves them
-- throughout PRE_DEPLOY — and the only writer, the sync worker, blocks for the
-- build and then proceeds. Estimated on the one-core instance: customer
-- ~10–30 s, each deal index ~30–90 s.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

/*
  1. THE PHONE, AS THE SEARCH ACTUALLY COMPARES IT.

  The column holds +998944340037 and the screen shows +99894***0037, so every
  comparison is made on digits only — and `regexp_replace("phone", …)` is a
  function over a column, which customer_phone_trgm_idx cannot answer. This
  index is over the identical expression, so the query and the index match.
  regexp_replace(text,text,text,text) is IMMUTABLE (checked in pg_proc), which
  is what makes an expression index legal here.

  A GENERATED STORED COLUMN would work too and is NOT recommended: it needs an
  ACCESS EXCLUSIVE lock and a full rewrite of 326 859 rows during PRE_DEPLOY,
  and it would have to be declared in schema.prisma or read as drift forever.

  The `phones` ARRAY still cannot be indexed — array_to_string is STABLE
  (checked in pg_proc) and Postgres refuses a non-IMMUTABLE index expression.
  It does not need to be: only 3 702 of 326 859 customers have one and every
  number in it is a SECOND number, so customer_extra_phones_idx keeps the
  fallback arm cheap.
*/
CREATE INDEX IF NOT EXISTS "customer_phone_digits_trgm_idx"
  ON "customer" USING gin ((regexp_replace("phone", '[^0-9]', '', 'g')) gin_trgm_ops);

/*
  2. THE BITRIX DEAL ID, AS A SUBSTRING.

  A btree on this column would be smaller and is the obvious choice — the ⌘K
  search matches a deal id exactly, on the argument that 9258 is not a prefix
  of 925842 in any sense a person means by typing it. It is the wrong choice
  here: the confirmation board's own predicate matches this column with ILIKE,
  and the scope statement may only ever be WIDER than the predicate. An exact
  arm would make a partial id findable on the unbounded fallback and not on the
  fast path — a board whose answer depends on how broad the term happened to
  be, which is the one failure this whole design exists to prevent.

  Cheap despite the row count: the values are digits, so the trigram
  dictionary is tiny even though the posting lists are long.
*/
CREATE INDEX IF NOT EXISTS "deal_externalid_trgm_idx"
  ON "deal" USING gin ("externalId" gin_trgm_ops);

-- 3. The region. Fourteen distinct values over 420 000 rows, so the posting
--    lists are long and the dictionary tiny — a few MB.
CREATE INDEX IF NOT EXISTS "deal_region_trgm_idx"
  ON "deal" USING gin ("region" gin_trgm_ops);

-- 4. The delivery address. The most expensive of the five (free text over
--    420 000 rows, budget 50–80 MB). Drop it if the price is wrong; the arm
--    then costs a capped sequential scan instead of nothing.
CREATE INDEX IF NOT EXISTS "deal_delivery_address_trgm_idx"
  ON "deal" USING gin ("deliveryAddress" gin_trgm_ops);

/*
  5. THE AMOUNT AS THE SCREEN PRINTS IT.

  The column holds minor units and the tile prints "1 600 000", so the search
  compares (amountMinor / 100)::text. int8/int4 division and int8 output are
  both IMMUTABLE. The expression must be written IDENTICALLY at the call site
  or the index is silently not used — which is why confirmationSearchScope.test
  asserts on that exact text.
*/
CREATE INDEX IF NOT EXISTS "deal_amount_major_trgm_idx"
  ON "deal" USING gin ((("amountMinor" / 100)::text) gin_trgm_ops);

-- NOT INDEXED, DELIBERATELY: employee."fullName", sales_source."name",
-- product."name" and department."name". They are 289 / 6 / 14 / 20 rows here
-- and hundreds on production, and each arm reads one of them sequentially to
-- feed an indexed lookup on deal_employeeId_createdAtSource_idx,
-- deal_operatorEmployeeId_idx, deal_sourceId_idx or deal_item_productId_idx.
-- A trigram index over a few hundred rows costs more to maintain than the scan
-- it replaces.
