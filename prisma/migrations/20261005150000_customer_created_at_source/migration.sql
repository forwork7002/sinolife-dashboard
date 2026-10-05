/*
  The contact's own creation time in Bitrix24 (DATE_CREATE), for «Kiruvchi
  qoʻngʻiroqlar»: a number is «Соф янги» when its contact was created with
  the call. Nullable — the minute sync fills contacts it re-reads, and the
  worker's one-off night re-read (`CUSTOMERS_FULL_READ`) fills the rest.
*/
ALTER TABLE "customer" ADD COLUMN "createdAtSource" TIMESTAMP(3);
