# FORMA·3D by CMG

**Intelligent Design. Precision Engineering. Real Manufacturing.**

منصة تحوّل فكرة المستخدم (نص عربي أو إنجليزي، أو صورة) إلى مجسم ثلاثي الأبعاد قابل للطباعة. يراجعه مصمم بشري
ويوافق عليه، ثم يُقطَّع بـ OrcaSlicer ويُطبع عبر OctoPrint بعد تأكيد صريح.

A user describes a part ("حامل هاتف بعرض 90 مم وارتفاع 110 مم وزاوية ميل 65 درجة"). The platform turns it into a
structured spec, builds exact geometry, exports and re-validates an STL, sends it to a designer for approval, slices it
with OrcaSlicer and prints it through OctoPrint after explicit confirmation.

**Live demo (runs in your browser):** https://3dchambeer-boop.github.io/forma3d/

Verification status of every part: [docs/AUDIT.md](docs/AUDIT.md) · [docs/MASTER_AUDIT.md](docs/MASTER_AUDIT.md) ·
Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Architecture

```
browser ──▶ Next.js 16 app (auth, RBAC, API, UI)  ──▶ SQLite via Prisma
                │ enqueue                               ▲
                ▼                                       │ job state (source of truth)
        generation worker (npm run worker) ─────────────┘
                │ providers: PARAMETRIC | AI_DESIGNER (Claude) | TRIPO | MESHY | RODIN | SELF_HOSTED
                ▼
        ai_3d_engine (Python, internal)   text→spec→CAD→STL, GLB/OBJ→STL, mesh validation
        cad_engine   (OpenCascade 7.8.1)  B-Rep, STEP import/export
                │
        private storage (STORAGE_DIR)  STL / GLB / G-code, served only via access-checked routes
                │
        OrcaSlicer CLI ──▶ G-code ──▶ OctoPrint ──▶ printer
```

| Path | What |
|---|---|
| `src/` | Next.js app: UI (Arabic RTL / English), ~55 API routes, auth (sessions, admin MFA/TOTP, Google), RBAC |
| `src/lib/generation/` | Provider contract, providers, worker, state machine, SSRF-safe downloads, AI usage ledger |
| `src/lib/payments/` | ZainCash and FIB, invoices, refunds, reconciliation |
| `src/lib/printing/`, `src/lib/orcaslicer.ts` | OctoPrint client and print flow, OrcaSlicer CLI adapter |
| `services/ai_3d_engine/` | Python geometry engine (FastAPI) + the browser CAD kernel / offline platform |
| `services/cad_engine/` | OpenCascade B-Rep service (STEP, fillet, chamfer, shell, offset, draft) |
| `prisma/` | Database schema and seed |

## Quick start (local)

Requirements: Node.js ≥ 22, Python 3.12 (for the engines).

```bash
npm ci
cp .env.example .env            # fill SESSION_SECRET, DOWNLOAD_SIGNING_SECRET, SEED_ADMIN_* ...
npx prisma db push              # create the database
npm run db:seed                 # organization + first administrator

# geometry engine (separate terminal)
pip install -r services/ai_3d_engine/requirements.txt
npm run engine:dev              # http://127.0.0.1:8100/docs

npm run worker                  # generation worker (separate terminal)
npm run dev                     # http://localhost:3000
```

## Production (Docker)

```bash
cp .env.example .env && chmod 600 .env    # fill it in (openssl rand -hex 32 for each secret)
docker compose up -d --build
docker compose exec app npx tsx prisma/seed.ts   # first administrator (SEED_* variables)
curl -fsS http://127.0.0.1:3000/api/health
```

The app listens on `127.0.0.1:3000` only. Put a TLS reverse proxy in front of it (see `Caddyfile` and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). Engine, CAD service and worker stay on the internal network.

## Tests and checks

```bash
npm run typecheck && npm run lint && npm run build
npm run test:node               # Node tests (libraries, providers on simulators, workflow)
npm run test:engine             # Python engine tests (sandbox tests need Linux)
scripts/verify-production.sh --strict   # full release gate (also run by GitHub Actions)
```

Simulator tests prove the adapters follow the documented APIs. They are not evidence that the real services work.
Real acceptance needs credentials: see docs/PRINTING.md, docs/SELF_HOSTED_AI.md and docs/COMMERCE.md.

## Rules enforced on the server

* Every generated revision goes to designer review. Nothing is sliced or printed before APPROVED.
* A paid provider task is submitted at most once per job. Unknown outcomes are never resubmitted.
* Progress shown to users comes from the provider, or is not shown. There are no animated estimates.
* STL is validated after export by re-reading the file. `REPAIR_REQUIRED` meshes cannot be sliced.
* Starting a print needs `{"confirm": true}` and a live printer readiness check.
* Files and G-code live outside `public/` and are served only after an ownership or role check.
* Integrations without credentials report "not configured". Nothing is simulated in production.

## Configuration

Every variable is documented in [`.env.example`](.env.example). Secrets are never committed. Printer API keys are
referenced by environment-variable name.
