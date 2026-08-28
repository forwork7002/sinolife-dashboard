# Security

What protects this dashboard, what does not, and what to do on a bad day.

Everything here is written for the situation that actually exists: **one
person, one account, no administrator behind them.** That single fact decides
most of the trade-offs below, and it decides them differently from how a
multi-user product would. There is nobody to lift a lock, nobody to verify an
identity over the phone, nobody to press a reset button. A measure that would
be a mild inconvenience for a team — a long lockout, a mandatory reset, a
hard-fail on an unreachable third party — is here a way to lock the owner out
of their own company's numbers permanently. So: strong where it costs the owner
nothing, and never so strong that it can become the thing standing between them
and their data.

What is being defended is worth stating plainly, because it is the reason for
the length of this document: **upwards of 420 000 deals, some 320 000 customer
records with phone numbers, around 290 000 call records, every seller's
performance, and a year of revenue.** One password on one account is the front
door to all of it at once.

---

## 1. The password

`src/lib/passwordPolicy.ts`, enforced in a `before` hook on every
password-setting route in `src/server/auth/auth.ts`. Five rules, each answering
a specific way that a password gets guessed:

| Rule | What it stops |
|---|---|
| **12 characters minimum** | Length is the only property that scales against offline guessing. Eight characters of anything is an afternoon on a rented GPU |
| **3 of 4 character classes** | Requiring all four is what produces `Parol123!`. Three of four leaves room for a long passphrase — far stronger — while still refusing a bare dictionary word |
| **No banned fragment** | A short, local list: the product names, the portal, `parol`, `password`, `admin`, keyboard walks, the city names. These are the first things anyone who knows the company tries |
| **No repeat run, no keyboard run** | `aaaaaaaaaaaa` is twelve characters and one guess. So is `qwertyuiop12` |
| **Not the email, not the name** | Both are known to anyone who has ever received an email from this company |

Two properties of the implementation matter more than the list:

- **The rules are checked on the server.** The strength meter on `/account` is
  a courtesy that explains a refusal before the round trip. It is not the
  boundary — the boundary has to hold for a request that never went near the
  form.
- **The file is one copy.** It lives in `lib/` rather than `server/` because
  both sides need it and client code may not import `@/server/*`. Two copies
  would eventually disagree, and the one that disagreed quietly would be the
  client's.

### The breach check

A password that passes the policy is checked against the Have I Been Pwned
corpus before it is accepted (`haveIBeenPwned`, wrapped in `auth.ts`).

**The password does not leave the server.** The plugin takes SHA-1 of the
candidate, sends the **first five hex characters** of that hash, and receives
back every suffix sharing that prefix — tens of thousands of them — then
compares locally. The service learns that somebody, somewhere, has a password
whose hash starts with those five characters. That is true of roughly one
password in a million and identifies nothing. This is worth being explicit
about, because "it checks your password against a website" is the natural
reading, and it would be a good reason to delete the feature.

**It fails open, deliberately.** The stock plugin turns a network failure into
a 500 — meaning HIBP being down would stop the owner changing their password.
The reason a person changes a password in a hurry is that they think it is
compromised; a third party's outage must never be what prevents it. So the
wrapper keeps exactly one outcome and discards the rest:

- `PASSWORD_COMPROMISED` → rethrown, the password is refused;
- timeout (4 s), DNS failure, 503, anything unforeseen → fall through, hash it
  unchecked.

The house policy above ran first and needs no network, so a failed-open change
is still a policy-compliant password.

---

## 2. Two-factor

TOTP — an authenticator app on the phone. No email codes (the mailbox is on the
same laptop as the browser, so the second factor would be the first factor
again) and no SMS (there is no provider in this deployment, and SIM swaps are
not exotic).

**It is opt-in and must stay that way.** `user.twoFactorEnabled` defaults to
false, so nothing about a deploy can arm it and nothing about a deploy can lock
anyone out. The owner turns it on while standing at the setup screen with their
phone in their hand.

**Arming is two steps, on purpose.**

1. `POST /api/auth/two-factor/enable` — requires the password. Returns the TOTP
   URI (rendered as a QR code) **and the ten backup codes**. Changes nothing
   about how sign-in works.
2. `POST /api/auth/two-factor/verify-totp` with a live code from the app. Only
   this flips `twoFactorEnabled`, and only now is the second factor real.

The gap between the two steps is the whole safety of the flow: the backup codes
are already in the owner's hands before the lock closes, and a setup abandoned
halfway leaves the account exactly as it was. `skipVerificationOnEnable` would
collapse the two steps and arm 2FA for a secret nobody has proved they can
generate — which is precisely how people lock themselves out of their own
systems. It stays `false`.

**At rest.** The TOTP seed and the backup codes are AES-encrypted under
`BETTER_AUTH_SECRET` before they are written to `two_factor`. A database dump
therefore does not hand over the second factor. The plugin's schema wants an
index on the secret column; we do not create one — nothing queries by secret,
so it would buy nothing and put a searchable structure over the most sensitive
column in the database.

**Backup codes.** Ten of them, each usable once; verifying one rewrites the
column without it. Ten rather than a handful because they are the only recovery
path, and a person who loses their phone and burns three getting back in should
not then be one bad week from a database edit. They are short enough to write
on paper, **which is where they belong** — a copy in the password manager on
the same laptop as the browser is not a backup, it is the same basket.

**Second-factor lockout.** Ten consecutive failed codes earn fifteen minutes
(`accountLockout` in the plugin, counted in `two_factor` so a redeploy does not
clear it). Looser than the password lockout on purpose: a six-digit code is one
guess in a million, the plugin already caps a single challenge at five
attempts, and backup codes share this budget — locking the *recovery* path
after five typos is the dangerous direction to be wrong in when there is nobody
to call.

**"Trust this device" lasts one session, not thirty days.** The library default
would have the weaker factor outliving the stronger one: the password re-asked
every seven days when the session expires, the second factor skipped for a
month. Matching the two means 2FA is asked for exactly as often as the
password.

### If the phone and the codes are both gone

There is no self-service recovery, and inventing one would be dishonest. Any
"email me a link" path would be a second, weaker way in, living in the same
mailbox on the same laptop — and there is no administrator to verify anyone.

The real answer is **a database edit**, by whoever holds `DATABASE_URL`:

```sql
UPDATE "user" SET "twoFactorEnabled" = false WHERE email = '<address>';
DELETE FROM "two_factor" WHERE "userId" = (
  SELECT id FROM "user" WHERE email = '<address>'
);
```

After that the account signs in with the password alone and can enrol again
from `/account`.

Run it wherever you can reach the database — the connection string is under
**Databases → your cluster → Connection details**, and `doctl apps console
"$APP" web` puts you into a container that already has it in the environment
(`npx prisma db execute --stdin --url "$DATABASE_URL"` takes the SQL on
standard input — there is no `psql` in the image).

This is the honest shape of the thing: whoever can reach the database can
remove the second factor. It is a reason to protect `DATABASE_URL` as
carefully as the password, and it is the reason the setup screen makes the
owner confirm they have stored the ten codes somewhere that is not this laptop.

---

## 3. The sign-in lockout

`src/server/auth/lockout.ts`, plus the `sign_in_lockout` table.

Rate limiting caps how **fast** someone can guess. It does nothing about how
**long** they are willing to: five attempts a minute, kept up quietly for a
week, is fifty thousand guesses — and the rate limiter's counters live in this
process's memory, so every deploy hands the guesser a clean slate. Throttling
limits the rate; only a lockout limits the total.

```
5 consecutive failures → 15 min      7 → 60 min
6                      → 30 min      8+ → 60 min (ceiling)
```

A correct password clears the record. So does simply not trying for 24 hours —
without that decay, four mistyped passwords spread over a year would leave the
owner one typo away from a lock they would never understand.

**Why the ceiling is an hour and not a day.** Every minute of lockout is a
minute the owner cannot see their own business, and there is nobody to lift it
early. An hour is long enough to make guessing pointless against a
twelve-character policy password — 24 tries a day — and short enough that the
honest answer to "what do I do" is "have a coffee". Nothing here is permanent:
every lock expires on its own.

**Why the counter is in Postgres.** An in-memory counter is a reset button with
a deploy button on it.

**Why the key is a SHA-256 of the email, never the email.** Two reasons, the
first being the important one:

1. An address with **no account** must be lockable too. If only real users
   could be locked, "too many attempts" would be a yes/no oracle for "does this
   address have an account here" — exactly the disclosure the login page's
   vague error avoids.
2. The table is then not a list of who banks here. A dump of it yields opaque
   digests, not a target list.

Rows past the decay window are pruned on write, so cycling through addresses
cannot grow the table for free.

**The refusal is a 429 with code `ACCOUNT_LOCKED_OUT`, not a 401**, and it says
how many minutes are left. Not because the number is secret-free generosity —
it is — but because "try again later" with no number is what makes a person
retry every thirty seconds for an hour. The message names no address and
implies no account:

> Juda koʻp muvaffaqiyatsiz urinish. Kirish vaqtincha toʻxtatildi —
> N daqiqadan soʻng qayta urinib koʻring.

The check runs **before** the password is verified, so a locked account costs an
attacker a lookup rather than a password-hash comparison — which also stops the
login form being used as a CPU sink.

The password lockout and the second-factor lockout are **separate budgets**,
which is correct: they are separate factors. A right password followed by a
wrong code clears the password counter and charges the 2FA one.

---

## 4. Rate limits

| Route | Budget |
|---|---|
| Everything under `/api/auth/*` | 200 / minute |
| `/sign-in/email` | 5 / minute |
| `/forget-password` | 5 / minute |
| `/two-factor/*` | 3 / 10 seconds (the plugin's own rule, left alone) |

The general budget is generous because one open dashboard refetching every
minute makes a lot of legitimate requests. Sign-in was ten and is now **five**,
so that the per-IP throttle and the per-account lockout bite at the same scale:
an attacker working one address exhausts the account's five-failure budget in
the same minute the throttle starts refusing them. Nobody who knows their own
password types it wrong five times in sixty seconds.

`/forget-password` has a budget and nothing behind it: **no mail sender is
configured**, so the endpoint cannot send a reset link. That is deliberate (see
section 10) and the limit stays as a guard on a route that exists in the
library whether we use it or not.

Counters are in memory, which is correct for **exactly one web instance**.
Scaling the web service to two would silently double the effective ceiling —
that would need `storage: 'database'`. The lockout, being in Postgres, would
not have that problem.

---

## 5. The session and its cookie

Seven days, rolled once a day (`updateAge`), with a five-minute signed cookie
cache so navigation does not hit the database for every page.

**Seven days is deliberate, including now that 2FA exists.** The argument for a
short session is that a stolen cookie expires sooner. The argument against is
that this is one person on one laptop looking at their own company, and a
dashboard that signs them out daily trains them to type their password more
often, in more places, more hurriedly, with a 2FA code right behind it. More
authentications is not more security when there is one user; it is more
chances to be phished. What actually bounds a stolen cookie is not the clock —
it is that **a password change revokes every other session immediately**
(`revokeSessionsOnPasswordReset`), which is the lever a person reaches for when
they think something is wrong.

**`Secure` follows the URL scheme, not `NODE_ENV`.** This looks like a detail
and is a trap: `next start` sets `NODE_ENV=production` even on
`http://localhost`, so keying off it issues a `Secure` cookie that the browser
then refuses to send back — sign-in returns 200 and every subsequent request is
silently unauthenticated, forever redirecting to login with no error anywhere.
Deriving it from `BETTER_AUTH_URL` is self-correcting: https deployments get
`Secure` automatically, local http works without anyone remembering a flag.

**The cookie prefix is declared once**, in `src/server/auth/cookiePrefix.ts`,
and read by both the auth config and the edge middleware. When those two
drifted, the middleware looked for a cookie that did not exist and bounced
every signed-in user back to `/login` while the API happily accepted the same
session.

**The middleware is not the boundary.** `src/middleware.ts` checks only that a
session cookie is *present*, so a signed-out visitor gets a redirect instead of
a dashboard shell that flashes and then fails every request. It runs on the
edge with no database. A forged cookie gets past it and then receives 401 from
every endpoint, because every endpoint resolves and verifies the session
itself.

---

## 6. Authorisation

| Role | Scope |
|---|---|
| `ADMIN` | Everything, including sync and user management |
| `MANAGER` | All analytics and all employees; no admin operations |
| `SALES` | Own deals and own KPI only; no finance |

Two rules make this hold against a caller who skips the UI:

- **Scoping is a WHERE clause in the repository**, not a filter applied to
  results. There is no query shape that returns another seller's rows for a
  `SALES` caller.
- **Route handlers spread the authorisation scope *after* the parsed query**,
  so `?employeeIds=<someone-else>` narrows within the caller's scope instead of
  widening it. The order of those two spreads is the whole control.

**A resource the caller may not see returns 404, not 403.** A 403 confirms the
record exists, and existence is itself a disclosure — "there is a deal with
this id, you just cannot have it" tells an attacker their enumeration is
working. The 404 says nothing.

`input: false` on `role`, `isActive` and `employeeId` means no request body can
set them; role escalation by posting JSON is the failure mode that closes.
`twoFactorEnabled` carries the same protection from the plugin's own schema.

Public sign-up is disabled in code (`disableSignUp`). Accounts exist only
because `provisionUser()` made them.

---

## 7. Headers

Set in `next.config.ts` for every path.

| Header | Why |
|---|---|
| `Content-Security-Policy` | The load-bearing directives are `connect-src 'self'` and `form-action 'self'`: an injected script could not post the sales figures — or a session — anywhere off this origin. `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'` close the framing, `<base href>` and plugin tricks |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`, **only when the configured URL is https**. Sending it in local development would pin `localhost` to https in the browser's HSTS store for a year, which is genuinely painful to undo |
| `X-Frame-Options: DENY` | Clickjacking, for browsers that prefer the old header |
| `X-Content-Type-Options: nosniff` | No MIME guessing on anything served |
| `Referrer-Policy` | `strict-origin-when-cross-origin` — filtered dashboard URLs carry the period and the filters, and those should not travel |
| `X-Robots-Tag: noindex, nofollow` | An internal tool has no business in a search index |
| `Permissions-Policy` | Camera, microphone, geolocation, payment, USB all denied. Nothing here uses them; naming them denies them to anything that manages to run |

**`'unsafe-inline'` on scripts is a known, accepted gap.** Next.js inlines its
hydration bootstrap and flight data into the document; locking that down means
threading a per-request nonce through middleware, which cannot be done for
statically rendered routes. Styles are inline for the same reason (Tailwind's
critical CSS ships in the head). `'unsafe-eval'` is development-only — React
Refresh needs it, production does not, and leaving it on in production would
hand an injected script the one primitive CSP is best at removing.

---

## 8. The hostname

The app is named `meridian-61c3bf`, so the default address is
`meridian-61c3bf-xxxxx.ondigitalocean.app`.

An app name becomes a DNS record and lands in **public
certificate-transparency logs** the moment TLS is issued. Anyone can read those
logs. `sinolife-dashboard` would have announced both the company and what the
site is, to anyone scanning them.

**Be honest about what this buys.** It reduces casual discovery and nothing
more. It is **not access control**: someone handed the URL is exactly as close
to the data as they were before, and a scanner walking the whole
`ondigitalocean.app` namespace finds this as easily as any other name. The
boundary is sections 1–6 of this document. This section is not on that list.

---

## 9. If you think something is wrong

In order. Each step is useful on its own, so do them in sequence rather than
waiting until you are sure.

1. **Change the password**, from `/account`. It is first because it does two
   things at once: `revokeSessionsOnPasswordReset` means every other session —
   every other browser, every other device, anyone holding a stolen cookie —
   dies the moment the change lands. Your current browser stays signed in.
2. **Confirm the other sessions are gone** by checking that a second browser
   you were signed into is back at the login page.
3. **Rotate `BETTER_AUTH_SECRET`** if a *server-side* compromise is plausible —
   a leaked environment, a shared console session, a stolen deploy token.
   Rotating signs everyone out again, and it **also makes every enrolled
   authenticator undecryptable**, because the TOTP seeds and backup codes are
   encrypted under it. That is not a side effect to be surprised by; it is why
   step 4 exists.
4. **Re-arm 2FA** from `/account`, and store the new backup codes. The old ones
   died with the old secret.
5. **Rotate the Bitrix24 webhook** in the portal (Developer resources →
   Inbound webhook) and put the new URL in `BITRIX24_WEBHOOK_URL`. The old URL
   is a bearer token: if it was in a screenshot, a chat message or a repository
   that is no longer private, it is gone and only revocation fixes that.
6. **Rotate the database password** from the DigitalOcean console if the
   connection string could have leaked, and update the app.
7. **Look at what was read.** Be aware, before you go looking, that the answer
   is thin — see the next section.

The sign-in lockout is not part of this list because there is nothing to press:
it is already counting, and it clears itself.

---

## 10. What is NOT protected

The useful half of a security document. Nothing below is a bug report; each one
is a known limit, stated so that no one mistakes the sections above for more
than they are.

**Anyone with database access reads everything.** Every phone number, every
deal, every customer name is stored in plaintext. There is no column-level
encryption and no field-level masking. The only encrypted values in the whole
database are the TOTP seeds and the backup codes. The 2FA above is
authentication, not confidentiality: whoever holds `DATABASE_URL` — or a
backup, or a `doctl apps console` session, or the DigitalOcean account — has
the entire dataset, without touching the login page and without appearing
anywhere the app can see. **Protect `DATABASE_URL` exactly as carefully as the
password.**

**The Bitrix24 webhook is a key to the whole portal.**
`BITRIX24_WEBHOOK_URL` embeds a bearer token with `crm`, `user`, `department`,
`telephony` and `catalog` scope. It is not read-only and it is not scoped to
this app: anyone holding that URL can call the portal's REST API directly and
read — or write — everything this dashboard reads, plus everything else those
scopes cover. It belongs in the platform's secret store and **nowhere else**:
not in the repository, not in a chat message, not in a screenshot, not in a
support ticket. If it has ever been somewhere else, treat it as burned and
rotate it.

**Backups are as sensitive as the database and are not in our control.**
Managed Postgres takes a daily backup with seven days of point-in-time
recovery. Those backups hold the same 320 000 phone numbers, and they live in
the DigitalOcean account. Whoever can log into that account can restore one.

**There is no read audit trail.** An `AuditLog` model exists in the schema and
nothing writes to it. If someone signs in as the owner and reads every
customer's phone number, there is no record of it beyond the platform's HTTP
logs. "Look at what was read" in the step above is therefore a much weaker step
than it sounds, and it is honest to say so rather than imply a forensic
capability that does not exist.

**The laptop is the weakest link and always was.** A seven-day session cookie,
a password manager and — if the backup codes were saved to disk — the recovery
path too, all on one machine. Full-disk encryption and a screen lock do more
for this deployment than any change to this codebase would. If the laptop is
lost, do section 9 immediately.

**`'unsafe-inline'` scripts.** See section 7. If an injected script ever runs,
CSP restricts where it can send data, not whether it runs.

**No email is configured, so there is no self-service anything.** No password
reset link, no 2FA recovery mail, no alert when a new device signs in. This is
a deliberate trade — every one of those would be another way into the account,
gated by a mailbox on the same laptop — but it means recovery from a total loss
of both factors is a database edit (section 2) and nothing softer.

**One account, one role, no separation.** The owner's account is `ADMIN`.
There is no lower-privilege day-to-day account, so anything that compromises
the browser session compromises the highest privilege level. Given one user,
splitting it would be ceremony rather than defence — but it does mean the blast
radius of a session compromise is total.

**A second web instance would double the effective rate limit.** The counters
are in memory, so each instance would enforce the ceiling on its own and an
attacker would get both budgets. If the app is ever scaled out,
`rateLimit.storage` must move to the database in the same change — and the
`sign_in_lockout` table already works correctly under any number of instances,
because it is in Postgres.
