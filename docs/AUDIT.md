# FORMA·3D — Audit and implementation report

Date: 2026-10-28. Scope: the repository as uploaded (15 commits, Next.js 16 + Prisma/SQLite, single app),
the engineering brief (MASTER ENGINEERING PROMPT) and the research notes on LLM-driven manufacturing.

## الخلاصة بالعربي

* **أخطر ما وُجد:** مفتاح Tripo مرفوع داخل `.env` في Git منذ أول commit؛ صفحة الدخول تعرض كلمة مرور مشتركة
  وأزرار دخول فوري لكل الأدوار ومنها ADMIN؛ ملفات المجسمات داخل `public/` مكشوفة دون تسجيل دخول؛
  سرّ الجلسة الاحتياطي مكتوب في الكود؛ مسار الإرسال للطابعة يكتب `PRINTING` دون أي اتصال بـ OctoPrint؛
  أوامر OrcaSlicer تستخدم خيارات غير موجودة في واجهته؛ وقاعدة البيانات تُملأ ببيانات وهمية تظهر في التحليلات.
* **ما بُني واختُبر فعليًا هنا:** محرك `ai_3d_engine` (نص عربي/إنكليزي ← مواصفات ← CAD دقيق ← STL ← إعادة فتح وفحص)،
  وخدمة فحص الشبكات وتحويل GLB/OBJ، وطبقة المزودين والعامل الخلفي بسياسة عدم تكرار المهام المدفوعة،
  وعميل OctoPrint مع بوابة تأكيد صريحة. ‏48 اختبار Python و27 اختبار Node ناجحة.
* **ما كُتب ولم يُبنَ هنا:** كود Next.js وPrisma وواجهات FastAPI وDocker، لأن البيئة لا تصل إلى npm وPyPI.
  فحصته نحويًا وبأنواع بديلة فقط، والمطلوب تشغيل `bun install && bun run typecheck && bun run build` على جهازك.

## 1. Environment constraints (why some parts are unverified)

The authoring sandbox had no access to npm, PyPI, apt or GitHub releases (proxy policy 403). Consequences:

| Could run here | Could not run here |
|---|---|
| Python 3.13 + numpy/scipy/pytest → the whole geometry engine and its tests | `bun install`, `next build`, Prisma client generation, ESLint |
| Node 22 (`--experimental-transform-types`) + TypeScript → provider layer, worker, OctoPrint client, their tests | FastAPI (the HTTP layer of the engine), trimesh/manifold3d/CadQuery |
| Local HTTP simulators of the Tripo and OctoPrint APIs | Real Tripo API (host blocked), real OctoPrint/printer, OrcaSlicer binary, GPU models |
| Syntax check of all 55 changed TS/TSX files; type check of API routes + libs against stubs | Type check against real `next`/`@prisma/client` types |

Python 3.12 is the target (Dockerfile); tests ran on 3.13.

## 2. Feature classification

Before = state of the uploaded repo. After = state of this change set.

| Feature | Before | After |
|---|---|---|
| Text → structured spec (AR/EN, units, sources, clarifications) | NOT_IMPLEMENTED | IMPLEMENTED_AND_TESTED (rule parser); LLM extractor IMPLEMENTED_BUT_UNVERIFIED (needs `ANTHROPIC_API_KEY`) |
| Text → exact CAD geometry (5 parametric templates) | NOT_IMPLEMENTED | IMPLEMENTED_AND_TESTED |
| STL export + re-open + re-validate | NOT_IMPLEMENTED (GLB only) | IMPLEMENTED_AND_TESTED |
| `mesh_validation_service` (watertight, manifold, winding, bodies, volume, size, build volume, wall-thickness estimate, safe repairs, 5 status levels) | NOT_IMPLEMENTED (`'passed:download,passed:format-glb'` string) | IMPLEMENTED_AND_TESTED |
| GLB/OBJ → mm STL (units, Y-up→Z-up, explicit scaling, recorded transforms) | NOT_IMPLEMENTED | IMPLEMENTED_AND_TESTED (incl. the 7 real Tripo GLBs in the repo) |
| Engine sandbox (separate process, memory/CPU/wall limits) | NOT_IMPLEMENTED | IMPLEMENTED_AND_TESTED |
| Engine HTTP API (FastAPI, token auth, OpenAPI) | NOT_IMPLEMENTED | IMPLEMENTED_BUT_UNVERIFIED (tests exist, skipped without FastAPI) |
| Tripo text/image-to-3D | IMPLEMENTED (synchronous inside the HTTP request, 5-min block, files written to `public/`) | Provider adapter IMPLEMENTED_AND_TESTED against a local simulator; real API BLOCKED_BY_EXTERNAL_DEPENDENCY here |
| Meshy / Rodin | NOT_IMPLEMENTED (selectable in UI anyway) | NOT_IMPLEMENTED (removed from UI; enum values kept for old rows) |
| SelfHostedProvider + inference contract | NOT_IMPLEMENTED | IMPLEMENTED_BUT_UNVERIFIED (no inference server/GPU) |
| Job queue: idempotency, retries, no duplicate paid tasks, fallback, cancel, crash recovery | NOT_IMPLEMENTED | Worker logic IMPLEMENTED_AND_TESTED (in-memory repo); Prisma repository IMPLEMENTED_BUT_UNVERIFIED |
| Honest progress in UI | BROKEN (timer-animated fake progress, procedural shape shown as preview, failures toasted as success) | IMPLEMENTED_BUT_UNVERIFIED (UI not built here) |
| Private file storage + per-revision access checks | BROKEN (files in `public/`, any user could read any model) | IMPLEMENTED_BUT_UNVERIFIED |
| Auth: JWT cookie sessions, bcrypt | IMPLEMENTED_BUT_UNVERIFIED | kept; hard-coded secret fallback removed; brute-force brake; algorithm pinned |
| Sign-up | BROKEN (form called sign-in) | IMPLEMENTED_BUT_UNVERIFIED (END_USER only, role never from client, closed unless `SIGNUP_ORG_SLUG`) |
| Public demo logins (shared password shown on login page, incl. ADMIN) | present | removed |
| RBAC on routes | IMPLEMENTED_BUT_UNVERIFIED | kept + ownership checks on files, jobs, print requests |
| Designer approve/reject/request changes | IMPLEMENTED_BUT_UNVERIFIED | unchanged |
| Designer uploads a repaired model version | NOT_IMPLEMENTED | NOT_IMPLEMENTED |
| End user requests a print | NOT_IMPLEMENTED (print jobs only from seed) | IMPLEMENTED_BUT_UNVERIFIED (`POST /api/print-jobs`, approval required) |
| OrcaSlicer slicing | BROKEN (undocumented flags `--load-printer/--load-process/--load-filament`; G-code written to `public/`) | Re-implemented per CLI docs (`--load-settings`, `--load-filaments`, 3MF extraction); IMPLEMENTED_BUT_UNVERIFIED — no binary here |
| OctoPrint dispatch | BROKEN ("real" path set `PRINTING` without contacting OctoPrint) | Client IMPLEMENTED_AND_TESTED against simulator; flow upload → explicit confirm → start → live status IMPLEMENTED_BUT_UNVERIFIED with real hardware |
| Analytics | IMPLEMENTED_BUT_UNVERIFIED, fed by fake seed rows, utilisation capped at 95 % | real providers, geometry-quality KPIs, no cap; seed no longer invents data |
| Health endpoint | public, leaked binary paths and Tripo credits, hard-coded "HEALTHY" | anonymous: liveness only; admin: every check actually probed |
| Realtime WebSocket service | BROKEN in practice (polls auth-protected APIs without a session → empty) | unchanged; generation status uses authenticated polling of `/api/generations/{id}` instead |
| PostgreSQL 16 / Supabase RLS / Redis | NOT_IMPLEMENTED (SQLite) | NOT_IMPLEMENTED — see §5 |
| CI/CD | NOT_IMPLEMENTED | NOT_IMPLEMENTED |

## 3. Security findings and fixes

| # | Finding | Severity | Fix |
|---|---|---|---|
| S1 | `TRIPO_API_KEY` committed in `.env` (tracked since the first commit) | Critical | `.env` untracked; **the key must be revoked at Tripo** — it remains in git history |
| S2 | Login page displays shared password and one-click sign-in for all roles incl. ADMIN | Critical | demo panel, shared password and role switcher removed; seed requires per-install strong passwords |
| S3 | Hard-coded `SESSION_SECRET` fallback → anyone can mint ADMIN JWTs | Critical | no fallback; production refuses to run without ≥32-char secret; HS256 pinned |
| S4 | Models in `public/models` served statically without auth; API route allowed any logged-in user to read any file | High | files moved to private `storage/`; access checked per revision owner/role; `Cache-Control: private, no-store` |
| S5 | Caddy `?XTransformPort=*` proxied any visitor to any localhost port | High | restricted to the realtime port 3030 |
| S6 | Dispatch reported `PRINTING` without contacting a printer | High (safety/integrity) | real OctoPrint client; upload ≠ start; start needs `{"confirm": true}` and a live readiness check |
| S7 | Printer OctoPrint API keys stored in DB and returned by `/api/printers` | High | column deprecated and stripped from responses; keys referenced by env-var name |
| S8 | Provider output URLs downloaded without validation (SSRF) | Medium | https only, host allow-list, private-IP block, manual redirects, size cap |
| S9 | No brute-force protection on sign-in | Medium | per-email and per-IP failure limits (audit-log backed) |
| S10 | Public `/api/health` disclosed internals and spent a paid Tripo call per hit | Medium | liveness only for anonymous users |
| S11 | `db/custom.db` (users, hashes) committed | Medium | untracked |
| S12 | Seed wiped every table on each run | Medium | idempotent upserts only |

## 4. Real results produced here

* `صمّم حامل هاتف مكتبي … بعرض 90 مم، وارتفاع 110 مم، … وفتحة لشحن الهاتف، وزاوية ميل 65 درجة`
  → spec `{width: 90, height: 110, tilt_angle: 65, charging_slot: 1}` (all sourced from the prompt)
  → CSG solid → STL **90.000 × 80.000 × 110.000 mm**, 380 triangles, watertight, 1 body, status **VALIDATED**
  after re-opening the exported file.
* All 5 templates build VALIDATED meshes at default parameters; volumes match analytic values (e.g. box − box, union of overlapping boxes) to 1e-9.
* The repository's 7 real Tripo GLBs (scaled to 150 mm): 3 VALIDATED, 2 VALID_WITH_WARNINGS, 2 REPAIR_REQUIRED (open edges, 17–21 separate bodies), reported honestly.
* The 8 "demo" STL files the old seed described as `passed:manifold` were all open or zero-volume; they were deleted.

## 5. Not done, and what it needs

| Item | Needed |
|---|---|
| Real Tripo end-to-end | network access + a **new** key; run `TRIPO_API_KEY=… bun run worker` and generate in the studio |
| OrcaSlicer | install the CLI build; export Ender-3 presets to `ORCASLICER_PROFILE_DIR`; run one slice from the dispatch screen (docs/PRINTING.md) |
| OctoPrint / printer | the Raspberry Pi URL + API key in `OCTOPRINT_KEY_*`; printer row with `octoprintApiKeyRef` |
| Self-hosted model | ≥16 GB VRAM GPU; inference server implementing docs/SELF_HOSTED_AI.md |
| PostgreSQL 16 + RLS | switch `datasource` to postgresql, create migrations with `prisma migrate dev` (cannot be generated without the Prisma CLI). The app enforces access in code; RLS only adds value if the database is also reached by non-app clients (e.g. Supabase client in the browser), which this design avoids |
| Redis rate limiting | current limits are database-backed counts, valid across instances; Redis is an optimisation, not a correctness gap |
| CI | GitHub Actions running `bun run typecheck`, `bun run lint`, `bun run test` — not added because it could not be run here |
| Designer re-upload, build-volume overlay in viewer, money/wallet code from the research notes (no wallet exists in this repo) | not started |
