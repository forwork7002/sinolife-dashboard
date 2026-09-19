# The nightly `backup` job in .do/app.yaml — see backup.sh for what it does
# and docs/BACKUP.md for getting the data back out.
#
# The official Postgres image rather than the Node buildpack the rest of the
# app builds with: the buildpack has no pg_dump, and a pg_dump OLDER than the
# server refuses to run at all. 18 dumps the 16 cluster today and keeps
# working if DigitalOcean's cluster is upgraded; its dumps restore into 16
# with one harmless `transaction_timeout` warning.
FROM postgres:18-alpine3.23

# rclone speaks S3 to any provider (Backblaze B2, DO Spaces, AWS, …) from
# environment variables alone. tzdata ships with the image (Asia/Tashkent).
RUN apk add --no-cache bash rclone

COPY backup/backup.sh /usr/local/bin/backup.sh

# Not the image's entrypoint, which would start a Postgres server.
USER postgres
ENTRYPOINT []
# Through bash explicitly, so a checkout that lost the executable bit still runs.
CMD ["bash", "/usr/local/bin/backup.sh"]
