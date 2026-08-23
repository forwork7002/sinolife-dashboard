# Bitrix24 integration

**Status: `BITRIX24_INTEGRATION_PENDING`.** No credentials have been supplied,
and no connection to a real portal has been attempted.

## What already works

| Piece | State |
|---|---|
| `CrmProvider` interface | Done |
| Webhook authentication | Done |
| Rate limiting (token bucket) | Done |
| Retry with jittered exponential backoff | Done |
| Request timeouts | Done |
| Cursor pagination (`start` / `next`) | Done |
| Credential redaction in errors and logs | Done |
| Sync engine: idempotent upsert, watermarks, audit log | Done |
| Deletion sweep (opt-in, guarded) | Done — policy decision pending, see §10 |
| **Field mapping** | **Not done — needs the live portal** |
| **Stage ID → category mapping** | **Not done — needs the live portal** |

The transport is finished. What is missing is the translation between Bitrix24's
vocabulary and ours, and that genuinely cannot be written without seeing the
portal.

## Why the mapping is empty rather than guessed

`src/server/integrations/crm/bitrix24/mapping.ts` declares every field with
`sourceField: ''` and `confirmed: false`.

Pre-filling plausible guesses like `OPPORTUNITY` or `ASSIGNED_BY_ID` would be
worse than leaving it blank. A Bitrix24 portal is heavily customised: this
business will have its own pipeline, its own stage IDs and its own custom
fields. A wrong-but-plausible mapping imports silently and produces a dashboard
that looks authoritative and is wrong. An empty mapping refuses to run.

`assertMappingComplete()` enforces this at startup. Enabling
`DATA_SOURCE=bitrix24` with an unconfirmed mapping fails with the exact list of
unmapped fields.

## Steps to finish

1. **Provide the webhook.** Set `BITRIX24_WEBHOOK_URL` in `.env`. It embeds an
   access token — treat it as a password. Never commit it. The URL must be
   `https`; the app rejects `http`.
2. **Confirm the field mapping.** For each entity in `mapping.ts`, fill in
   `sourceField` from the real portal and set `confirmed: true`.
3. **Map the stages.** Populate `BITRIX24_STAGE_CATEGORIES` with the portal's
   stage IDs (`C1:NEW` and similar) mapped to `NEW` / `IN_PROGRESS` / `WON` /
   `LOST`. This one matters most: every won/lost, revenue and conversion figure
   depends on it.
4. **Implement the `map*` methods** in `Bitrix24CrmProvider`. The transport
   helper `fetchPage` is already there; only translation is needed.
5. **Dry run.** `POST /api/v1/sync/run` with `mode=FULL` against a staging
   database, then reconcile the totals against Bitrix24's own reports before
   pointing production at it.
6. **Switch** `DATA_SOURCE=bitrix24`.

Nothing in the frontend, the analytics engine, the database schema or the API
changes at any step.

## Open questions for the business

These need answers from someone who knows the Bitrix24 setup. They are not
blocking today's work, but they are blocking step 2.

1. **Which pipeline(s)?** Does SinoLife use a single deal pipeline or several?
   If several, should the dashboard aggregate them or separate them?
2. **Stage IDs.** The full list of stage IDs and names, and which count as won
   and lost. Are there stages that mean neither — on hold, postponed?
3. **Deal amount.** Which field carries the value the business considers
   revenue? Is it net or gross of VAT? Which currency field, and are multiple
   currencies in use?
4. **Employee identity.** Are salespeople Bitrix24 users, or contacts? Is the
   deal owner the responsible user, or a custom field?
5. **Departments.** Bitrix24 departments are a tree. Which level should the
   dashboard group by?
6. **Products.** Are deal product rows used consistently? If not, product
   analytics will be incomplete and should say so rather than under-report.
7. **Payments — the biggest unknown.** Standard Bitrix24 has no payment ledger
   on deals. Does the business track paid amounts and debt in custom fields, in
   invoices, in a separate system, or not in Bitrix24 at all? Until this is
   answered the provider reports `PAYMENTS: false` and the API returns
   *unavailable* rather than zero.
8. **Sources.** Which field is the lead source, and what is its value list?
9. **History depth.** How far back should the initial import go?
10. **Deletions.** When a deal is deleted in Bitrix24, should it disappear from
    the dashboard or be retained for historical accuracy?

    The machinery exists: a full sync can sweep records the source no longer
    reports (`sweepDeleted: true`), guarded so it never runs on an incremental
    read, after a failed or partial run, or on an empty read. It is **enabled
    for the demo seed and off for Bitrix24** until this is answered.

    The trade-off is real either way. Leaving it off means a deleted deal
    counts toward revenue forever. Turning it on means anything hidden from the
    webhook's scope — a restricted pipeline, a permissions change — reads as a
    deletion and is removed. Answer this before the first production sync.

## Rate limits and safety

Bitrix24 throttles per portal, and exceeding the limit can block the portal for
its real users — not just for us. `BITRIX24_RATE_LIMIT_RPS` defaults to 2, which
is conservative. Raise it only with evidence.

Retries use full jitter so that several failing workers do not retry in
lockstep.

## Credential handling

- The webhook URL is a secret. It is never logged, never returned by the API,
  and never sent to the browser.
- `redact()` strips URL paths and token-shaped strings from every error before
  it reaches a log.
- The pino logger redacts `webhookUrl`, `token`, `authorization`, `password`
  and related keys.
- `.env` is gitignored; `.env.example` carries no real values.
