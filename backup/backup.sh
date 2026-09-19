#!/usr/bin/env bash
# Nightly off-site copy of the whole database, kept for two years.
#
# Why this exists at all: DigitalOcean's own backups of the managed cluster go
# back seven days and live in the same account as the cluster. That covers
# "the database broke last night" and nothing else. This copy covers the rest:
# a lost or suspended account, a deleted cluster, a bad write noticed a month
# later, or simply wanting to open the numbers as they stood a year ago.
#
# The live database itself never forgets — nothing prunes old rows, and deals
# deleted in Bitrix24 stay (sweepDeleted is opt-in, docs/DATABASE.md). So the
# NEWEST dump always holds the full history; the older ones are there for
# "what did it look like on that day".
#
# Layout in the bucket:
#   daily/2026-09-19.dump     one per night, kept BACKUP_DAILY_DAYS (60)
#   monthly/2026-09.dump      the first good dump of each month, kept
#                             BACKUP_MONTHLY_DAYS (760, i.e. two years + slack)
#
# Format is pg_dump's custom format: compressed, and restorable table by table
# with pg_restore. Restoring is docs/BACKUP.md.
set -euo pipefail

log() { printf '%s backup: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "FAILED — $*"; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is not set}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is not set}"
: "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID is not set}"
: "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY is not set}"

# Scratch space for the dump itself (the container's /tmp by default).
WORK="${BACKUP_WORKDIR:-/tmp}"

DAILY_DAYS="${BACKUP_DAILY_DAYS:-60}"
MONTHLY_DAYS="${BACKUP_MONTHLY_DAYS:-760}"
# A dump smaller than this is not a backup of this database — it is an empty
# or half-migrated one, and uploading it would push a real copy out of the
# retention window a day earlier than it should. Production (a ~1 GB
# database) dumps to far more than this.
MIN_BYTES="${BACKUP_MIN_BYTES:-1000000}"
# Optional folder inside the bucket, so one bucket can hold more than one app.
PREFIX="${BACKUP_S3_PREFIX:-}"
PREFIX="${PREFIX:+${PREFIX%/}/}"

# rclone reads its remote from the environment; its config file is an empty
# one so it neither looks for nor writes a real one.
: > "$WORK/rclone.conf"
export RCLONE_CONFIG="$WORK/rclone.conf"
export RCLONE_CONFIG_ZAXIRA_TYPE=s3
export RCLONE_CONFIG_ZAXIRA_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_ZAXIRA_ENDPOINT="$BACKUP_S3_ENDPOINT"
export RCLONE_CONFIG_ZAXIRA_REGION="${BACKUP_S3_REGION:-}"
export RCLONE_CONFIG_ZAXIRA_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export RCLONE_CONFIG_ZAXIRA_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
# Without this rclone tries to create the bucket on every upload, which a
# key scoped to one bucket is (rightly) not allowed to do.
export RCLONE_CONFIG_ZAXIRA_NO_CHECK_BUCKET=true
REMOTE="zaxira:${BACKUP_S3_BUCKET}/${PREFIX}"

# Same certificate the app verifies against (src/server/db/poolConfig.ts).
# Unset, libpq's sslmode=require encrypts without verifying — no worse than the
# app does in the same situation.
if [[ -n "${DATABASE_CA_CERT:-}" ]]; then
  printf '%b\n' "$DATABASE_CA_CERT" > "$WORK/db-ca.pem"
  export PGSSLROOTCERT="$WORK/db-ca.pem" PGSSLMODE=verify-full
fi

# Dates in Tashkent, like every reporting window in the app.
DAY="$(TZ=Asia/Tashkent date +%F)"
MONTH="${DAY:0:7}"
FILE="$WORK/${DAY}.dump"

log "dumping into ${FILE}"
started=$SECONDS
# --no-owner / --no-privileges: the copy must restore into any database, under
# any role — a laptop, a new cluster — not only into one that has doadmin.
pg_dump --format=custom --compress=6 --no-owner --no-privileges \
  --file="$FILE" "$DATABASE_URL" || die "pg_dump exited $?"

bytes="$(stat -c %s "$FILE")"
(( bytes >= MIN_BYTES )) || die "dump is only ${bytes} bytes (floor ${MIN_BYTES}); not uploading"

# Read the archive's table of contents back. A truncated or corrupt file fails
# here, before it can replace anything.
pg_restore --list "$FILE" > "$WORK/toc.txt" || die "pg_restore cannot read the dump"
grep -q 'TABLE DATA public deal ' "$WORK/toc.txt" || die "the dump has no deal table"
log "dump ok: $(( bytes / 1024 / 1024 )) MB in $(( SECONDS - started )) s, $(grep -c 'TABLE DATA' "$WORK/toc.txt") tables"

rclone copyto "$FILE" "${REMOTE}daily/${DAY}.dump" --s3-upload-concurrency 4 \
  || die "upload to daily/ failed"
remote_bytes="$(rclone lsf --format s "${REMOTE}daily/${DAY}.dump")"
[[ "$remote_bytes" == "$bytes" ]] \
  || die "daily/${DAY}.dump in the bucket is '${remote_bytes}' bytes, expected ${bytes}"
log "uploaded daily/${DAY}.dump"

# The first good dump of a month becomes that month's long-term copy. "First
# good", not "the 1st": a night that failed on the 1st must not cost a whole
# month of the two years.
if ! rclone lsf "${REMOTE}monthly/${MONTH}.dump" | grep -q .; then
  rclone copyto "${REMOTE}daily/${DAY}.dump" "${REMOTE}monthly/${MONTH}.dump" \
    || die "copy to monthly/ failed"
  log "kept monthly/${MONTH}.dump"
fi

# Retention runs only after tonight's copy is safely up, so a broken night
# never shrinks what is already there. --min-age reads the upload time.
rclone delete "${REMOTE}daily/" --min-age "${DAILY_DAYS}d" --include '*.dump' \
  || log "warning: pruning daily/ failed (nothing lost, only kept longer)"
rclone delete "${REMOTE}monthly/" --min-age "${MONTHLY_DAYS}d" --include '*.dump' \
  || log "warning: pruning monthly/ failed (nothing lost, only kept longer)"

# A small marker a person (or a check) can read without downloading a dump.
printf '{"day":"%s","bytes":%s,"finishedAt":"%s"}\n' \
  "$DAY" "$bytes" "$(date -u +%FT%TZ)" | rclone rcat "${REMOTE}last-success.json"

rm -f "$FILE"
log "done in $(( SECONDS - started )) s — $(rclone lsf "${REMOTE}daily/" --include '*.dump' | wc -l) daily, $(rclone lsf "${REMOTE}monthly/" --include '*.dump' | wc -l) monthly in the bucket"
