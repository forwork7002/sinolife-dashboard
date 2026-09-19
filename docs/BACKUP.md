# Backups — two years, off-site

The live database never forgets on its own: nothing prunes deals, payments or
stage history, and a deal deleted in Bitrix24 stays here (the deletion sweep is
opt-in, [DATABASE.md](DATABASE.md#upstream-deletions)). If Bitrix24 stops
answering, the sync stops and the dashboard keeps showing the last state it
had. What that does NOT cover is losing the database itself — a deleted
cluster, a lost or suspended DigitalOcean account, a bad write found a month
late. DigitalOcean's own backups reach back **seven days** and live in the same
account, so they cover none of those.

The `backup` job in [`.do/app.yaml`](../.do/app.yaml) covers them. Every night
at **04:30 Tashkent** it runs [`backup/backup.sh`](../backup/backup.sh):

1. `pg_dump` of the whole database — every table, custom format, compressed;
2. refuses to upload a dump under 1 MB, or one `pg_restore` cannot read, or
   one with no `deal` table;
3. uploads it to an S3-compatible bucket at a **different provider** and checks
   the size that arrived;
4. keeps the first good dump of each month as that month's long-term copy;
5. only then prunes: daily copies after **60 days**, monthly copies after
   **760 days** (two years plus slack);
6. writes `last-success.json` with the day, the size and the finish time.

```
<bucket>/sinolife/daily/2026-09-19.dump     one per night, 60 days
<bucket>/sinolife/monthly/2026-09.dump      one per month, two years
<bucket>/sinolife/last-success.json
```

The newest dump always holds the **whole** history, because the database does.
The older ones answer "what did it look like on that day".

---

## Setting it up (once)

The bucket is somewhere other than DigitalOcean on purpose. Backblaze B2 is
the suggested one: S3-compatible and about $6 per TB-month. Two years of
dumps of this database is tens of GB, so a few dollars a month.

1. **Create a private bucket** — Backblaze → Buckets → Create, *Private*,
   e.g. `sinolife-zaxira`. Turn on *Default Encryption* (SSE-B2).
   Set *Lifecycle Settings* to "Keep only the last version of the file":
   B2 otherwise keeps every deleted dump as a hidden version, forever, and
   the pruning below would free nothing.
2. **Create an application key limited to that bucket** — Application Keys →
   Add, *Allow access to bucket:* `sinolife-zaxira`, *Read and Write*. Note
   the `keyID` and `applicationKey` (shown once) and the bucket's *Endpoint*,
   e.g. `s3.eu-central-003.backblazeb2.com`.
3. **Add the job to the LIVE spec** (never re-apply the committed file — see
   [DEPLOY.md](DEPLOY.md)):
   ```bash
   doctl apps spec get "$APP" > /tmp/live.yaml
   # paste the `- name: backup` job from .do/app.yaml under `jobs:`
   $EDITOR /tmp/live.yaml
   doctl apps update "$APP" --spec /tmp/live.yaml
   ```
   or add it in the console: **Create → Job → Scheduled**, Dockerfile path
   `backup/Dockerfile`.
4. **Set the job's variables** (App → `backup` component → Settings →
   Environment Variables), then **Encrypt** the two keys:

   | Variable | Example |
   |---|---|
   | `BACKUP_S3_ENDPOINT` | `https://s3.eu-central-003.backblazeb2.com` |
   | `BACKUP_S3_REGION` | `eu-central-003` |
   | `BACKUP_S3_BUCKET` | `sinolife-zaxira` |
   | `BACKUP_S3_PREFIX` | `sinolife` |
   | `BACKUP_S3_ACCESS_KEY_ID` | the `keyID` |
   | `BACKUP_S3_SECRET_ACCESS_KEY` | the `applicationKey` |

   `DATABASE_URL` and `DATABASE_CA_CERT` come from app level; nothing to add.
   Optional: `BACKUP_DAILY_DAYS` (60), `BACKUP_MONTHLY_DAYS` (760),
   `BACKUP_MIN_BYTES` (1000000).
5. **Check the first night** — the job's *Runs* tab in the console, or
   `doctl apps list-job-invocations "$APP" --job-name backup`, and the bucket
   should hold `daily/<date>.dump`, `monthly/<month>.dump` and
   `last-success.json`. A healthy log ends with
   `backup: done in … s — N daily, M monthly in the bucket`.

**How to notice it stopped:** `last-success.json`'s `day` is older than
yesterday. A failed run exits non-zero with a `backup: FAILED — <reason>` line.

---

## Getting the data back

You need `pg_restore` of version 18 or newer (the dump is made with 18) and
any empty Postgres database: a new DigitalOcean cluster, or one on a laptop.

```bash
# 1. Download one dump (Backblaze web UI works too). The endpoint is quoted
#    because it contains a colon.
rclone copyto ":s3,provider=Other,endpoint='https://s3.eu-central-003.backblazeb2.com',access_key_id=$KEY,secret_access_key=$SECRET:sinolife-zaxira/sinolife/daily/2026-09-19.dump" ./zaxira.dump

# 2. Restore into an EMPTY database. No roles are needed — the dump carries no
#    owners or grants.
createdb -h 127.0.0.1 -p 5433 sinolife_zaxira
pg_restore --no-owner --no-privileges -d "postgresql://…@127.0.0.1:5433/sinolife_zaxira" ./zaxira.dump
```

Restored into a Postgres **16** server, `pg_restore` 18 reports one error,
`unrecognized configuration parameter "transaction_timeout"`, and exits 1.
That is the only one, and it is harmless — every table and row is restored.
Any other error is real.

**To look at it through the dashboard**, point a checkout's `DATABASE_URL` at
the restored database and run `npm run build && npm run start` (see
[DEVELOPMENT.md](DEVELOPMENT.md)). Do **not** start the sync worker against a
copy you want to keep frozen — it would pull today's portal into it. Users,
passwords and 2FA come back with the data; 2FA seeds only decrypt under the
same `BETTER_AUTH_SECRET`, so a restore elsewhere signs in with the password
and re-arms 2FA.

**To replace production** with a restored cluster, create the new cluster,
restore into it, attach it to the app in place of `db`, and redeploy. The
worker resumes from the watermarks in `sync_cursor` and catches up whatever
changed in Bitrix24 since that dump.

**Tested** 2026-09-19 against the local database and a local S3 server: dump,
upload, size check, the monthly copy, same-day re-run, pruning (a 100-day
daily and an 800-day monthly removed, a 49-day daily and a 600-day monthly
kept, a non-dump file untouched), and a restore whose row counts matched the
source table for table. **Not yet run on DigitalOcean** — the first real run is
the first night after the job is added; check it (step 5).
