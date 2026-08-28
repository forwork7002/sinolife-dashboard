# Deploying to DigitalOcean

One web service, one sync worker, one managed Postgres, one administrator
account, one domain.

App Platform rather than a Droplet: TLS, the domain, deploys and database
backups come with it, and Next.js needs no special handling. A Droplet would
mean owning nginx, certbot and systemd for no benefit at this size.

The spec lives in [`.do/app.yaml`](../.do/app.yaml). What protects the
deployment once it is up — and what does not — is [SECURITY.md](SECURITY.md).

The app is called **`meridian-61c3bf`**, so its default address is
`meridian-61c3bf-xxxxx.ondigitalocean.app`. The name is deliberately neutral:
an app name becomes a DNS record and lands in public certificate-transparency
logs the moment TLS is issued, and `sinolife-dashboard` would have announced
both the company and the purpose to anyone reading those logs. It buys
obscurity and nothing else — the boundary is the password, the second factor
and the lockout, not the hostname.

> **Do not blindly re-apply the committed spec.** `doctl apps update --spec`
> replaces the whole spec, and the committed one says `CHANGE_ME` where the
> secrets go — applying it over a running app overwrites them. To change
> something later, edit the **live** spec, which carries the secrets back as
> encrypted `EV[1:...]` values:
>
> ```bash
> doctl apps spec get "$APP" > /tmp/live.yaml
> $EDITOR /tmp/live.yaml
> doctl apps update "$APP" --spec /tmp/live.yaml
> ```

---

## 1. Before you start

You need:

| | |
|---|---|
| A GitHub repository | App Platform builds from it. Make it **private** — the spec, the schema and the queries are all in it |
| The Bitrix24 webhook URL | with `crm`, `user`, `department`, `telephony`, `catalog` |
| A domain | pointed at DigitalOcean's nameservers, or ready for a CNAME |
| `doctl` | `snap install doctl`, then `doctl auth init` |

Generate the session-signing secret now — it is the only value that cannot be
derived from anything else:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Rotating it later signs everyone out — and, once two-factor is armed, makes
every enrolled authenticator unreadable, because the TOTP seeds and the backup
codes are encrypted under this same value. A rotation is therefore always
followed by "sign in with the password, arm 2FA again" (§5). That is the whole
consequence, and it is a manageable one; it is not a reason to avoid rotating
after a suspected compromise.

---

## 2. Create the app

```bash
# Point the spec at your repository first — five github: blocks, one owner/name.
sed -i 's|forwork7002/sinolife-dashboard|<your-github-user>/<repo>|g' .do/app.yaml

doctl apps create --spec .do/app.yaml
APP=$(doctl apps list --format ID,Spec.Name --no-header | grep meridian | cut -f1)
```

The repository name is **not** the hostname and does not need renaming to match
the app: a private repository's name appears in no public log. Only `name:` at
the top of the spec becomes DNS.

The first deploy **will fail**: every secret still says `CHANGE_ME`, and
`src/server/config/env.ts` refuses to start rather than run half-configured.
That is the intended behaviour, not a problem to work around.

Set the secrets under **Settings → App-Level Environment Variables**, where
they are write-only once saved:

| Variable | Value |
|---|---|
| `BETTER_AUTH_SECRET` | the 32 random bytes from step 1 |
| `BITRIX24_WEBHOOK_URL` | `https://obey.bitrix24.kz/rest/8868/<token>/` |
| `ADMIN_EMAIL` | the one account that will exist |
| `ADMIN_PASSWORD` | 12+ characters; the seed refuses anything shorter |
| `DATABASE_CA_CERT` | see below — **skip it and the app cannot connect at all** |

They are declared at **app level**, so all four components — web, worker and
the two jobs — inherit one copy. Setting the same key on a component overrides
the app-level value, which is how a stale `CHANGE_ME` used to beat a real
secret; there is nothing to override now.

Everything else — `DATABASE_URL`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` — is
bound to what the platform already knows and needs no typing.

> The webhook URL is a key to the entire Bitrix24 portal. It belongs in the
> secret store and nowhere else: not in the repository, not in a chat message,
> not in a screenshot.

### The database certificate

DigitalOcean signs its clusters with its own CA and hands out a URL ending in
`?sslmode=require`. `pg` reads that as *verify against the system trust store*
— libpq reads it as *encrypt, do not verify* — so without a CA every
connection is refused with `self-signed certificate in certificate chain`, and
the symptom is an app that builds cleanly and then answers 503 to everything.

**Databases → your cluster → Connection details → Download CA certificate.**
Paste the whole PEM into `DATABASE_CA_CERT`; literal `\n` instead of real
newlines is fine.

Left unset, `src/server/db/poolConfig.ts` encrypts without verifying — which is
exactly what `sslmode=require` means everywhere else, and no less than libpq
would do. Setting it is strictly better: an interceptor without the CA's key
cannot pass.

---

## 3. Attach the domain

**Settings → Domains → Add Domain.** DigitalOcean issues the certificate and
renews it. If the domain's nameservers are elsewhere, add the CNAME it shows
you.

`BETTER_AUTH_URL` is bound to `${APP_URL}`, which follows the **primary**
domain — so the session cookie is issued for the address people actually
visit, with no second edit.

The catch: once the custom domain is primary, the original
`*.ondigitalocean.app` address is no longer the auth origin, and signing in
there returns 403 with no cookie set. If anyone still uses it, add it to
`APP_TRUSTED_ORIGINS` (comma-separated, full origins with scheme). This is the
same failure that made every section bounce back to the login page in local
development.

---

## 4. First import

Nothing to run. The `sync` worker does it.

On an empty database no entity has a watermark yet, so the worker's first tick
reads **everything** — about sixteen minutes — and every tick after it reads
only what changed. Migrations run ahead of it as a `PRE_DEPLOY` job, and the
administrator account is created by a `POST_DEPLOY` job.

Watch the first import land:

```bash
doctl apps logs "$APP" --type run --follow sync
```

Expect roughly:

| | |
|---|---|
| Deals | ~420 000 across nine pipelines |
| Contacts | ~318 000 |
| Stage transitions | ~190 000 |
| Calls | ~286 000 (one month) |
| Duration | 15–20 minutes |
| Database afterwards | ~850 MB, of 10 GB |

Then open the dashboard and check the **overview total against the portal**.
The one number that matters is revenue: the `countsAsRevenue` guard keeps about
4.97 billion so'm of База duplicates out of it, and if that guard ever stops
working every revenue figure is roughly double the truth. `npm run bitrix:import`
prints the excluded total explicitly — run it from a console session (§8) if
you want the number rather than the comparison.

---

## 5. First sign-in: the password, then two-factor

Open the dashboard and sign in as `ADMIN_EMAIL` with `ADMIN_PASSWORD`. Then,
in this order, on `/account`:

**1. Change the password.** The value in the platform's secret store was typed
into a web form and is now sitting in the deploy history; the password the
owner actually uses should never have been anywhere but their head and their
password manager. The house policy applies — twelve characters, three of four
character classes, nothing built around the company's own words — and the
password is also checked against the Have I Been Pwned corpus, which never
sees the password itself (only a five-character hash prefix; see
[SECURITY.md](SECURITY.md#the-breach-check)).

**2. Arm two-factor.** This is part of first-run, not an optional extra. Until
it is done, one password is the only thing between the whole commercial
position of the company and anyone who guesses or phishes it.

- **Setup → scan the QR code** with an authenticator app (Google
  Authenticator, Aegis, 1Password — any TOTP app).
- **Type a live code back in.** Nothing is armed until this succeeds: the
  enrolment and the arming are two separate steps precisely so that walking
  away halfway leaves the account exactly as it was.
- If the code is rejected repeatedly, check the **phone's clock**. TOTP is
  arithmetic over the time of day, and a handset a minute out of sync produces
  wrong codes indefinitely. "Set time automatically" fixes it.

> ### Write the ten backup codes down. On paper.
>
> They are shown **once**, at setup, and they are the only recovery path there
> is. There is no administrator, no reset email and no support desk — this is
> one account with nobody behind it.
>
> Storing them in the password manager on the same laptop as the browser is not
> a backup; it is the same basket. Paper, in a different place.
>
> Lose both the phone and the codes and the only way back in is a **database
> edit** by whoever holds `DATABASE_URL` — the exact SQL is in
> [SECURITY.md](SECURITY.md#if-the-phone-and-the-codes-are-both-gone). It
> works, and it is not something to be relying on.

Rotating `BETTER_AUTH_SECRET` later invalidates the enrolment and the codes
together. After any rotation, repeat step 2 and write down the new codes.

---

## 6. Staying current

The `sync` worker pulls changed records every sixty seconds and re-reads
reference data — employees, products, pipelines — every thirtieth tick. A
typical tick moves a dozen rows in about thirty-five seconds, so the dashboard
is never more than about ninety seconds behind the portal. The browser
refetches on the same cadence, so a screen left open on a wall updates itself.

A worker rather than a scheduled job on purpose: a job pays Node and Prisma
startup on every run, which at a one-minute cadence is most of the minute.

**Exactly one instance.** The worker holds a Postgres advisory lock on a
connection checked out for the life of the process — not a pooled one, which
goes back to the pool and drops the lock the moment the query returns, looking
like it works and enforcing nothing. A second copy **waits** for the lock
rather than exiting: during a rolling deploy the new worker starts before the
old one has stopped, and a worker that exits is a worker the platform
restarts, so exiting would produce a restart loop until the old process
happened to go away.

It is quiet by design: a tick that changed nothing prints nothing, so what you
see in the log is what actually moved. That means **an idle worker and a
wedged worker look identical**. To tell them apart, ask the database:

```sql
SELECT entity, status, "finishedAt", "recordsRead"
FROM sync_log ORDER BY "startedAt" DESC LIMIT 10;
```

A `finishedAt` older than a few minutes is a worker that has stopped working,
whatever the log says.

To pause it — during a manual migration, say — scale it to zero in the
dashboard rather than deleting it.

### Tuning

| Variable | Default | Effect |
|---|---|---|
| `SYNC_INTERVAL_SEC` | 60 | Seconds between ticks |
| `SYNC_REFERENCE_EVERY` | 30 | Ticks between reference-data refreshes |
| `BITRIX24_CALL_MONTHS` | 1 | How much telephony history the first import reads |

Going below about thirty seconds is not useful: a tick already takes half a
minute, most of it waiting on the portal's two-requests-per-second limit.

---

## 7. Health and backups

`/api/health` opens a database connection and returns 503 if it cannot. The
platform's health check points at it. The login page was the check before, and
it answers 200 out of the build output with the database gone — a green light
over an app that cannot serve a single number.

Managed Postgres takes a daily backup with seven days of point-in-time
recovery, on by default. Nothing to configure; check it exists under
**Databases → your cluster → Backups** before you trust it.

---

## 8. Running a command against the deployment

There is no `doctl apps run`. Open a shell in a running component instead:

```bash
doctl apps console "$APP" web
```

From that shell:

```bash
# Change the password away from whatever was set during setup.
npm run db:seed:users -- --reset-password

# List any account other than the administrator. --remove-others deletes them.
npm run db:seed:users

# Data sanity: row counts, revenue totals, the duplicate guard.
npm run db:check
```

Disarming a lost second factor is a database edit rather than a script — there
is deliberately no `npm run` that turns 2FA off, because a command that removes
the second factor is a second way past it. The SQL is in
[SECURITY.md](SECURITY.md#if-the-phone-and-the-codes-are-both-gone).

`tsx`, `prisma` and `dotenv` are runtime dependencies rather than dev ones
precisely so these work in a deployed container — a production install prunes
devDependencies, and the worker and both jobs would go with them.

Job output is not in the app log; each run is its own invocation:

```bash
doctl apps list-job-invocations "$APP"
doctl apps logs "$APP" --type run migrate
```

---

## What can go wrong

| Symptom | Cause |
|---|---|
| Build fails on `Cannot find module '@tailwindcss/postcss'` | `NODE_ENV=production` is scoped to build time, so `npm ci` skipped devDependencies. It must be `scope: RUN_TIME` |
| Everything answers 503; the log says `self-signed certificate in certificate chain` | `DATABASE_CA_CERT` is unset **and** something re-enabled verification. See §2 |
| App boots then dies with `Invalid environment configuration` | A secret is still `CHANGE_ME`, or was added with an empty value. An empty value counts as set and fails exactly like this — delete the variable rather than blanking it |
| Login succeeds, then redirects back to login | The host in the address bar is not the auth origin. Either it is not the primary domain, or it needs to be in `APP_TRUSTED_ORIGINS` |
| "Juda koʻp muvaffaqiyatsiz urinish…" and sign-in refuses a password you are sure of | The sign-in lockout, after five consecutive failures. Wait the stated minutes out — it expires on its own, and there is nothing to reset. It escalates to a one-hour ceiling if the budget is spent again |
| The authenticator's code is always rejected | The phone's clock, not the app. TOTP is computed from the time of day; turn on automatic time sync |
| Phone lost, backup codes lost | A database edit against `two_factor`, by whoever holds `DATABASE_URL`. See [SECURITY.md](SECURITY.md#if-the-phone-and-the-codes-are-both-gone) |
| Signed out everywhere and the authenticator no longer works | `BETTER_AUTH_SECRET` was rotated. Expected: sign in with the password alone, then re-arm 2FA (§5) |
| `too many clients already` during a deploy | The pools exceed the cluster's 22 connections. Web holds 8, the worker 5 plus one for its lock, and a deploy briefly adds two jobs |
| Import stops with `OPERATION_TIME_LIMIT` | The portal blocked a method for ~10 minutes. The worker backs off on its own and resumes from its cursor; nothing to do |
| Revenue looks about double | The `countsAsRevenue` guard was bypassed. Compare against `npm run db:check` |
| "Ombor qoldigʻi yuritilmaydi" on the warehouse page | Correct. The portal keeps no stock balances — see docs/SUPERDASHBOARD.md |

---

## Cost

| | |
|---|---|
| `basic-xs` web service | $12/month |
| `basic-xxs` sync worker | $5/month |
| Managed PostgreSQL — 1 GB RAM, 1 vCPU, 10 GB disk | $15/month |
| `basic-xxs` deploy jobs | billed per run, cents |
| Domain + TLS | included |
| | **~$32/month** |

The database holds about 850 MB after a full import with a month of call
records. Raising `BITRIX24_CALL_MONTHS` grows it by roughly 120 MB per extra
month of telephony — the 10 GB disk is the limit, and it is a long way off.
