# Deploying

The app runs on one server with Docker Compose: the API, MongoDB, and Caddy, which serves the client
and gets HTTPS certificates from Let's Encrypt. MongoDB is only on an internal network and needs a
password. The database and images are backed up to Cloudflare R2 every night.

Nothing here has been deployed yet. These steps were tested by running the stack locally.

## Before you start

- A server with Docker and the Compose plugin, at least 2 GB of memory (each login uses about 128 MB
  briefly), and enough disk for the images (about 6.4 GB per 100,000 crops).
- A domain name pointing at the server.
- An SMTP service for email, such as Postmark, Amazon SES, or your email provider's SMTP.
- A Cloudflare R2 bucket and an API token that can write to it.
- **Fonts:** the images leave out `client/src/fonts/`, because those fonts are all rights reserved.
  Users get Noto Sans Mongolian, and can add font files of their own, which stay in their browser.

## First setup

1. Allow only SSH, HTTP, and HTTPS through the server's firewall, for example with
   `ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable`. Docker's published ports are
   only 80 and 443.
2. Clone the repository on the server, and copy `deploy/.env.example` to `deploy/.env`. Fill it in,
   making each secret with `openssl rand -base64 48`. Keep a copy of `.env` somewhere safe and
   private: without `SECRETS_KEY`, two-factor logins stop working.
3. Start everything from the `deploy` folder:

   ```sh
   cd deploy
   docker compose up -d --build
   docker compose logs -f api   # "Server listening on port 3001" means it is up
   ```

4. Create the first admin. The password is asked for, so it stays out of shell history:

   ```sh
   docker compose exec api node server/src/scripts/create-user.ts you@example.com --admin
   ```

5. Log in at `https://<your domain>`, open **Account**, and turn on two-factor authentication.
   Admin and reviewer tools refuse to work until you do.
6. Invite people from the **Admin** tab. Each link works once, for 14 days.

## Images and data

Volumes, crops, and quiz images are prepared on your own machine with the pipeline, as in development.
To move them to the server:

1. Copy the image files to the server's `storage` volume, for example:

   ```sh
   rsync -a data/storage/ server:/tmp/storage/
   ssh server 'docker run --rm -v manchu-labelling_storage:/storage -v /tmp/storage:/from alpine cp -an /from/. /storage/'
   ```

2. Run the import scripts against the server's database. The simplest way is to copy the files they
   read to the server and run them in the API container as root, since they write to the image
   volume, for example `docker compose exec --user root api node server/src/scripts/import-segments.ts ...`.

Images are served from the server's disk and synced to R2 each night. Serving them straight from R2
would need a storage adapter in the API, which is not built yet.

## Backups

`backup.sh` dumps the database to `backups/mongo-<time>.archive.gz` in the bucket and syncs the images
to `storage/`. Run it nightly from cron:

```sh
crontab -e
# 30 3 * * * /path/to/manchu-labelling/deploy/backup.sh >> /var/log/manchu-backup.log 2>&1
```

Set a lifecycle rule on the bucket to delete old dumps, such as after 90 days, and try a restore now
and then:

```sh
aws s3 cp s3://<bucket>/backups/<file> - --endpoint-url https://<account>.r2.cloudflarestorage.com |
  docker compose exec -T mongo sh -c 'mongorestore --username root --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip --drop'
```

## Updating

```sh
git pull
cd deploy
docker compose up -d --build
```

The API updates its indexes when it starts. Sessions survive restarts, since they are in MongoDB.

## Security alerts

Repeated failed logins, account deletions, and changes to two-factor settings are logged as JSON lines
with `"level":"alert"`, and emailed to `ALERT_EMAIL` if it is set:

```sh
docker compose logs api | grep '"level":"alert"'
```

## Releases

Releases are made where the database is, with `ANNOTATOR_ID_SECRET` set. It must be the same for
every release, so store it with the other secrets:

```sh
docker compose exec -e ANNOTATOR_ID_SECRET=... api node server/src/scripts/export-release.ts 0.1.0 --out /tmp/release-0.1.0
docker compose cp api:/tmp/release-0.1.0 ./release-0.1.0
```

Then copy the folder off the server, upload it to Zenodo or Hugging Face, and record the DOI with
`set-release-doi`.
