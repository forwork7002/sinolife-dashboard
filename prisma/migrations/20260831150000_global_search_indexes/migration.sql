-- Indexes for the global search box.
--
-- WHY THEY ARE HERE AND NOT IN schema.prisma. Two of them are expression
-- indexes — one over an array rendered as text, one partial — and Prisma's
-- schema language cannot express either, so declaring the other two there
-- would split one feature's storage across two places and still not be the
-- whole picture. `prisma migrate dev` on a developer machine will report these
-- as drift; that is expected, and dropping them is what would be wrong.
--
-- MEASURED ON PRODUCTION, before and after, against 326 859 customers and
-- 423 845 deals on a one-core instance:
--
--   phone, substring        1 638 ms  ->     7 ms
--   order code, substring   6 488 ms  ->  0.25 ms
--   customer name              482 ms ->    18 ms
--   deal title               1 339 ms ->     2 ms
--
-- They cost about 50 MB in total, which on an 824 MB database with a 190 MB
-- cache is a real price — paid because a search box that takes six seconds is
-- one nobody uses twice.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The three fields people actually type: a phone number, an order code, a name.
CREATE INDEX IF NOT EXISTS "customer_phone_trgm_idx"
  ON "customer" USING gin ("phone" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "customer_name_trgm_idx"
  ON "customer" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "deal_ordercode_trgm_idx"
  ON "deal" USING gin ("orderCode" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "deal_title_trgm_idx"
  ON "deal" USING gin ("title" gin_trgm_ops);

/*
  Second and third numbers, which live in an array.

  `phones` is empty for all but 3 702 of the 326 859 customers, and NOT ONE has
  a number there that is missing from `phone` — the array only ever adds
  further numbers for the 737 people who gave more than one. So the search
  reads `phone` through its own index and falls back to this handful of rows,
  which this index is what makes findable: without it Postgres has to read all
  326 859 to discover which 3 702 have an array at all.

  A trigram index over the array itself is not possible — rendering it as text
  is not IMMUTABLE, and Postgres refuses such an expression in an index.
*/
CREATE INDEX IF NOT EXISTS "customer_extra_phones_idx"
  ON "customer" ("id") WHERE array_length("phones", 1) > 0;
