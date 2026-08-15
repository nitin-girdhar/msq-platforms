# Postgres backup → Google Drive → restore

Two independent script pairs, deployed the same way `reports/` and
`retention/` are: dropped alongside `docker-compose.yml`/`.env` inside
whatever `INSTALL_DIR` each box uses (e.g. `/deployment` on the real servers,
`/opt/msq` per `deploy_linux.md`'s example).

```
pg-backup/     runs on the SOURCE box (headless Linux, has the live Postgres)
  backup.sh
  setup-cron.sh
pg-restore/    runs on the DESTINATION box (Ubuntu with GUI)
  restore.sh
  setup-cron.sh
```

`backup.sh` dumps **everything** in the cluster with `pg_dumpall --clean
--if-exists` — every database, every role, password hashes, globals — since
the data set is small enough right now that a full dump every run is cheap.
`restore.sh` downloads the newest backup and pipes it straight into `psql`;
because the dump has `--clean`, restoring is idempotent and fully replaces
whatever was in the destination's Postgres.

Both scripts double as the ad-hoc trigger — run them by hand any time and
they do exactly what the cron job does.

## One-time setup — source box (backup)

1. Copy `pg-backup/` next to the box's existing `docker-compose.yml`/`.env`
   (same directory `deploy.sh` installed to).
2. Install `rclone` and `gnupg`:
   ```bash
   sudo apt-get update && sudo apt-get install -y gnupg
   curl https://rclone.org/install.sh | sudo bash
   ```
3. Configure the Google Drive remote. The box has no browser, so use
   `rclone authorize` from a machine that does:
   - On the server: `rclone config` → `n` (new remote) → name it `gdrive` →
     type `drive` → leave client id/secret blank → scope `drive` → **no** to
     "Use auto config" (headless) → it prints a command to run elsewhere.
   - On a machine with a browser: install rclone, run the printed
     `rclone authorize "drive"` command, log in, copy the resulting token
     back into the server's prompt.
   - Confirm: `rclone lsd gdrive:` should list your Drive folders (create a
     `pg-backups` folder in Drive first, or let `rclone copy` create it).
4. Generate the GPG passphrase — this same value must be copied to the
   destination box, out-of-band (not through Drive):
   ```bash
   mkdir -p pg-backup/.secrets && chmod 700 pg-backup/.secrets
   openssl rand -base64 32 > pg-backup/.secrets/passphrase
   chmod 600 pg-backup/.secrets/passphrase
   ```
5. Test a manual run:
   ```bash
   RCLONE_REMOTE=gdrive:pg-backups ./pg-backup/backup.sh
   rclone ls gdrive:pg-backups   # should show the new *.sql.gz.gpg file
   ```
6. Install the daily 1 AM cron job:
   ```bash
   RCLONE_REMOTE=gdrive:pg-backups ./pg-backup/setup-cron.sh
   ```
   To change the schedule: `CRON_SCHEDULE="0 1 * * *" RCLONE_REMOTE=... ./pg-backup/setup-cron.sh`.
   To remove it: `./pg-backup/setup-cron.sh --remove`.

## One-time setup — destination box (restore)

1. Copy `pg-restore/` next to this box's own `docker-compose.yml`/`.env`
   (its Postgres container must run the **same major version** as the
   source — `pg_dumpall` output is not guaranteed to restore cleanly across
   versions).
2. Install `rclone` and `gnupg` (this box has a GUI/browser, so plain
   `rclone config` works without the `authorize` dance):
   ```bash
   sudo apt-get update && sudo apt-get install -y gnupg
   curl https://rclone.org/install.sh | sudo bash
   rclone config   # same gdrive: remote, pointed at the same Drive folder
   ```
3. Copy over the **same** GPG passphrase file the source box generated
   (scp/USB — never through Drive):
   ```bash
   mkdir -p pg-restore/.secrets && chmod 700 pg-restore/.secrets
   # copy the passphrase file content here
   chmod 600 pg-restore/.secrets/passphrase
   ```
4. Test a manual run:
   ```bash
   RCLONE_REMOTE=gdrive:pg-backups ./pg-restore/restore.sh
   docker exec -it "$DB_CONTAINER_NAME" psql -U "$POSTGRES_USER" -c '\l'
   docker exec -it "$DB_CONTAINER_NAME" psql -U "$POSTGRES_USER" -c '\du'
   ```
5. Install the daily 2 AM cron job:
   ```bash
   RCLONE_REMOTE=gdrive:pg-backups ./pg-restore/setup-cron.sh
   ```
   To remove it: `./pg-restore/setup-cron.sh --remove`.

## Verifying end-to-end

- `tail -f /var/log/pg-backup.log` / `/var/log/pg-restore.log` after each run.
- Decrypt one backup by hand to confirm it's real SQL, not an empty/failed
  dump: `gpg --batch --passphrase-file pg-backup/.secrets/passphrase -d FILE.sql.gz.gpg | gunzip | head`.
- After a week, confirm pruning is working: `rclone ls gdrive:pg-backups`
  and `ls /deployment/data/database_backup` should both show ≤ `RETENTION_DAYS`
  files (retention only applies on the backup side — the restore side's
  `WORK_DIR` is cleaned up after every run, nothing accumulates there).
