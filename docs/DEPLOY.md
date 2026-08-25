# Deploying to DigitalOcean

One web service, one managed Postgres, one administrator account, one domain.

App Platform rather than a Droplet: TLS, the domain, deploys and database
backups come with it, and Next.js needs no special handling. A Droplet would
mean owning nginx, certbot and systemd for no benefit at this size.

The spec lives in [`.do/app.yaml`](../.do/app.yaml). It is the source of truth —
edit it and re-apply rather than clicking in the dashboard, so the deployment
can be rebuilt from the repository.

---

## 1. Before you start

You need:

| | |
|---|---|
| A GitHub repository | App Platform builds from it |
| The Bitrix24 webhook URL | with `crm`, `user`, `department`, `telephony`, `catalog` |
| A domain | pointed at DigitalOcean's nameservers, or ready for a CNAME |
| `doctl` | `snap install doctl` then `doctl auth init` |

Generate the session-signing secret now — it is the only value that cannot be
derived from anything else:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Rotating it later signs everyone out. That is the only consequence.

---

## 2. Create the app

```bash
# Point the spec at your repository first.
sed -i 's|CHANGE_ME/sinolife-dashboard|<your-github-user>/<repo>|g' .do/app.yaml

doctl apps create --spec .do/app.yaml
```

The spec declares a `basic-xs` web service and a managed PostgreSQL 16 cluster.
It will fail its first deploy: every secret still says `CHANGE_ME`.

Set them:

```bash
APP=$(doctl apps list --format ID,Spec.Name --no-header | grep sinolife | cut -f1)

doctl apps update "$APP" --spec .do/app.yaml   # after editing the values in place
```

or, more safely, in the dashboard under **Settings → App-Level Environment
Variables**, where secrets are write-only once saved:

| Variable | Value |
|---|---|
| `BETTER_AUTH_SECRET` | the 32 random bytes from step 1 |
| `BITRIX24_WEBHOOK_URL` | `https://obey.bitrix24.kz/rest/8868/<token>/` |
| `ADMIN_EMAIL` | the one account that will exist |
| `ADMIN_PASSWORD` | 12+ characters; the seed refuses anything shorter |

Everything else — `DATABASE_URL`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` — is
bound to what the platform already knows and needs no typing.

> The webhook URL is a key to the entire Bitrix24 portal. It belongs in the
> secret store and nowhere else: not in the repository, not in a chat message,
> not in a screenshot.

---

## 3. Attach the domain

**Settings → Domains → Add Domain.** DigitalOcean issues the certificate and
renews it. If the domain's nameservers are elsewhere, add the CNAME it shows
you.

`BETTER_AUTH_URL` is bound to `${APP_URL}`, which follows the primary domain —
so the session cookie is issued for the address people actually visit, with no
second edit. Getting this wrong is the classic symptom of "login succeeds and
then bounces straight back to the login page".

---

## 4. First import

Migrations run automatically as a `PRE_DEPLOY` job, and the administrator
account is created by a `POST_DEPLOY` job. The Bitrix24 import is **not** a job
and deliberately so: the first full read takes about sixteen minutes, and a
deploy step that long would block every release afterwards.

Run it once, by hand:

```bash
doctl apps run "$APP" --command "npm run bitrix:import -- --full"
```

Expect roughly:

| | |
|---|---|
| Deals | ~420 000 across nine pipelines |
| Contacts | ~318 000 |
| Stage transitions | ~190 000 |
| Calls | ~286 000 (one month) |
| Duration | 15–20 minutes |

The run prints a per-pipeline table at the end. **Check the last line**: it
reports how much won revenue was deliberately excluded as duplicate. If that
number is zero, the `countsAsRevenue` guard has stopped working and every
revenue figure is roughly double the truth.

---

## 5. Keep it current

Incremental syncs read only what changed and take a couple of minutes.
Add a scheduled job in the dashboard (**Create → Job → on a schedule**) or run
it from anywhere with cron:

```bash
doctl apps run "$APP" --command "npm run bitrix:import"
```

Every fifteen minutes is comfortable. The sync is idempotent — two overlapping
runs cannot double anything, because every write is an upsert on the source
record's own id.

---

## 6. After the first login

```bash
# Change the password away from whatever was set during setup.
doctl apps run "$APP" --command "npm run db:seed:users -- --reset-password"
```

To confirm nothing else can sign in:

```bash
doctl apps run "$APP" --command "npm run db:seed:users"
```

It lists any account other than the administrator, and `--remove-others`
deletes them.

---

## What can go wrong

| Symptom | Cause |
|---|---|
| Login succeeds, then redirects back to login | `BETTER_AUTH_URL` does not match the host in the browser's address bar |
| `DATA_SOURCE=bitrix24 requires BITRIX24_WEBHOOK_URL` at boot | The secret is unset. This is deliberate: a half-configured integration fails loudly rather than serving demo data as live |
| Import stops with `OPERATION_TIME_LIMIT` | The portal blocked a method for ~10 minutes. Wait and re-run; the sync resumes from its cursor |
| Revenue looks about double | `countsAsRevenue` filtering was bypassed somewhere. Compare against the import summary's excluded total |
| "Ombor qoldigʻi yuritilmaydi" on the warehouse page | Correct. The portal keeps no stock balances — see docs/SUPERDASHBOARD.md |

---

## Cost

| | |
|---|---|
| `basic-xs` web service | $12/month |
| Managed PostgreSQL, 1 GB | $15/month |
| Domain + TLS | included |

The database holds roughly 1.5 GB after a full import with a month of call
records. Raising `BITRIX24_CALL_MONTHS` grows it by about 400 MB per month of
telephony.
