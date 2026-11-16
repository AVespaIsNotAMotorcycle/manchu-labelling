#!/bin/sh
# Copies the database and the images to Cloudflare R2. Run it nightly from cron (see README.md).
# Database dumps are kept by date. Images are synced, since they never change once made.
set -eu
cd "$(dirname "$0")"
set -a
. ./.env
set +a

stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
aws() {
  docker run --rm -i \
    -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    -e AWS_DEFAULT_REGION=auto "$@"
}

# The root password is read inside the container, so it never appears in this machine's process list.
docker compose exec -T mongo sh -c \
  'mongodump --username root --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db manchu-labelling --archive --gzip' |
  aws amazon/aws-cli:2.27.0 s3 cp - "s3://${R2_BUCKET}/backups/mongo-${stamp}.archive.gz" --endpoint-url "$endpoint"

aws -v manchu-labelling_storage:/storage:ro amazon/aws-cli:2.27.0 \
  s3 sync /storage "s3://${R2_BUCKET}/storage" --endpoint-url "$endpoint" --only-show-errors

echo "Backed up to ${R2_BUCKET} at ${stamp}"
