-- Every number Bitrix24 holds for a contact, not just the first. `phone` stays
-- as the primary so existing queries are untouched.
ALTER TABLE "customer" ADD COLUMN     "phones" TEXT[] DEFAULT ARRAY[]::TEXT[];
