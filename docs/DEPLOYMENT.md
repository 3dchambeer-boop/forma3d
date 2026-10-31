# Deploying FORMA·3D

Status: the compose file validates and the backup, the CAD service and the release gate were run in the Phase 9
environment. The Docker images themselves have **not** been built there (no Docker daemon, no registry access), and the
Next.js production build has not run there (no npm registry). Run `scripts/verify-production.sh --strict` (or the
`verify` GitHub Actions workflow) before the first release: it fails on anything left unverified.

## 1. Services

| Service | What | Port | Exposure |
|---|---|---|---|
| `app` | Next.js app + API (`bun server.js`) | 3000 | `127.0.0.1` only; put a TLS reverse proxy in front |
| `worker` | generation worker (`scripts/generation-worker.ts`) | none | internal |
| `engine` | AI 3D engine (FastAPI) | 8100 | internal network only |
| `cad` | OpenCascade 7.8.1 B-Rep service (STEP) | 8200 | internal network only |

`engine` and `cad` run read-only, with no Linux capabilities and `no-new-privileges`; each has a health check, and the
app waits for both to be healthy. Logs rotate (`json-file`, 5 × 10 MB per service).

## 2. Secrets and configuration

All secrets live in `.env` on the server (mode 600), never in git or in an image. Start from `.env.example`.
Required for `docker compose config` to pass: `ENGINE_SERVICE_TOKEN`, `CAD_SERVICE_TOKEN`
(generate each with `openssl rand -hex 32`). The app also needs `SESSION_SECRET` and `DOWNLOAD_SIGNING_SECRET`
(≥ 32 characters each).

| Integration | Variables | Without them |
|---|---|---|
| Claude (AI designer) | `ANTHROPIC_API_KEY`, `AI_DESIGNER_MODEL_*`, `AI_PRICING_JSON`, `AI_MONTHLY_BUDGET_USD`, `AI_USAGE_LOG` | AI designer reports "not configured"; nothing is simulated |
| Tripo | `TRIPO_API_KEY` | provider disabled |
| Meshy | `MESHY_API_KEY`, `MESHY_AI_MODEL` | provider disabled |
| Hyper3D Rodin | `RODIN_API_KEY`, `RODIN_TIER`, `RODIN_DOWNLOAD_HOSTS` (confirm the file host on the first real run) | provider disabled |
| ZainCash | `ZAINCASH_*` (see `docs/COMMERCE.md`) | online payment hidden; manual payment recording still works |
| FIB | `FIB_*` | same |
| WhatsApp Cloud API | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | in-app and e-mail notifications only |
| E-mail | `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_API_URL` | in-app only |
| OctoPrint | per printer: URL in the database, API key in the env var the printer row names | printer shown as not configured |
| OrcaSlicer | `ORCASLICER_BIN`, `ORCASLICER_PROFILE_DIR` (`scripts/orcaslicer-headless-setup.sh`) | slicing unavailable |

**Rotate before going live:** Tripo API keys used during development were exposed in the old repository history (this repository starts with a clean history). Revoke them in the Tripo dashboard.

## 3. First start

```
cp .env.example .env && chmod 600 .env       # fill it in
docker compose config -q                     # must print nothing
docker compose up -d --build
docker compose exec app bunx prisma db push  # creates the SQLite schema in the app-data volume
curl -fsS http://127.0.0.1:3000/api/health   # {"status":"ok",...}
```
Database migrations: the schema is applied with `prisma db push` (no migrations folder yet). Before the first
production data, create a baseline with `bunx prisma migrate dev --name init` on a development machine, commit
`prisma/migrations`, and from then on deploy with `bunx prisma migrate deploy`.

Reverse proxy (Caddy example):
```
forma.example.com {
  reverse_proxy 127.0.0.1:3000
  header Strict-Transport-Security "max-age=31536000"
}
```
Webhook URLs to register with the providers: `https://<host>/api/webhooks/zaincash`, `/api/webhooks/fib`,
`/api/webhooks/whatsapp`.

## 4. Backups

`scripts/backup.py` (Python standard library) takes a consistent copy of the SQLite database while the app is running
(SQLite online backup API), checks it with `PRAGMA integrity_check`, archives it with the storage and log directories,
and lists every file's SHA-256 in a manifest.

```
VOL=$(docker volume inspect forma_app-data --format '{{.Mountpoint}}')
python3 scripts/backup.py create --db $VOL/db/custom.db --dir $VOL/storage --dir $VOL/logs --out /srv/backups --keep 14
python3 scripts/backup.py verify /srv/backups/forma-backup-<time>.tar.gz
```
cron (daily, 03:17): `17 3 * * * python3 /srv/forma/scripts/backup.py create ... >> /var/log/forma-backup.log 2>&1`.
Copy the archives off the server (they contain customer data: encrypt them, e.g. `age` or `gpg`, before upload).

Restore (stop writers first):
```
docker compose stop app worker
python3 scripts/backup.py restore <archive> --db $VOL/db/custom.db --dir $VOL/storage --dir $VOL/logs --force
docker compose start app worker
```
Restore verifies every checksum and the database before writing, refuses to overwrite without `--force`, and moves
the current data aside (`*.pre-restore-<time>`) instead of deleting it. Practise a restore into an empty directory
once a month (`restore` without `--force` into new paths).

## 5. Health, logs, monitoring

- `GET /api/health`: anonymous callers get liveness only. An admin session gets every dependency actually probed:
  database, engine, CAD service, OrcaSlicer, storage and providers. Nothing is reported healthy without a real check.
- Container health: `docker compose ps` (engine, cad and app have health checks).
- Logs: `docker compose logs -f app worker`. The CAD service logs one line per request (method, path, status, origin)
  and never logs design bodies. The AI ledger (`AI_USAGE_LOG`) holds token counts only, never prompts or replies.
- AI cost: `GET /api/analytics/ai-usage` (admin) gives month-to-date and all-time tokens, priced cost and unpriced
  calls. Set `AI_MONTHLY_BUDGET_USD` to stop new AI calls once the month's priced cost reaches it.
- What to alert on (external uptime monitor plus a log watcher):
  - `/api/health` failing for 2 minutes
  - container restarts
  - payment reconciliation errors (`reconcile` returns `errors > 0`)
  - WhatsApp deliveries in `failed`
  - disk usage of the app-data volume above 80 %
  - a backup older than 26 hours

## 6. Release checklist

1. `scripts/verify-production.sh --strict` passes. The CI workflow runs it with the real OpenCascade build and OrcaSlicer.
2. `docker compose config -q` passes with the production `.env`.
3. Backup taken and verified before upgrading. `docker compose up -d --build`, then `/api/health` as admin is all healthy.
4. Payment providers: a sandbox payment end to end (callback reaches `/api/webhooks/...`, invoice becomes PAID only after
   the server inquiry), then switch to production credentials.
