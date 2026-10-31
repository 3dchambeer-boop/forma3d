# FORMA·3D — Phase 9 acceptance report

Branch `phase-9-verification` (6 commits on top of Phase 8). Run date 2026-10-30.

## 1. Verdict

**Not yet production-ready, by the Final Rule.** The Next.js production build, Prisma generation and migrations, the
app-wide typecheck and lint, and the HTTP-level unauthorized-access smoke run could not run here: the npm registry is
blocked in this environment. Everything else that can be tested locally was run against the real components:
- **OpenCascade 7.8.1:** built from source.
- **OrcaSlicer 2.1.1:** the real CLI.
- **The CAD kernel, drawings, assemblies, calibration, payments and notifications logic.**
- **Chromium end-to-end runs.**

`scripts/verify-production.sh --strict`, run by `.github/workflows/ci.yml`, is the gate. It fails while any of those
steps is unverified. Real Claude, Tripo, ZainCash, FIB and WhatsApp need credentials or merchant approval. Their
integration code is finished and tested against labelled test doubles.

## 2. Completion matrix: before (end of Phase 8) → after (Phase 9)

| # | Item | Before | After | Evidence |
|---|---|---|---|---|
| 1 | OpenCascade B-Rep: fillet, chamfer, shell, offset, draft | IMPLEMENTED_BUT_UNVERIFIED | **IMPLEMENTED_AND_TESTED** (native backend) | 28 tests on OCCT 7.8.1. Exact against closed forms: Steiner fillet box, chamfer box, Pappus, offset, shell, draft frustum |
| 2 | STEP export and reopen | IMPLEMENTED_BUT_UNVERIFIED | **IMPLEMENTED_AND_TESTED** | AP214 written, re-read with STEPControl_Reader, volume, bounds and faces compared |
| 3 | CAD HTTP service | IMPLEMENTED_BUT_UNVERIFIED | **IMPLEMENTED_AND_TESTED** (stdlib server); FastAPI app IMPLEMENTED_BUT_UNVERIFIED | Service tests, plus the browser STEP button run in Chromium against the running service |
| 3b | CadQuery backend (`occ.py`) | IMPLEMENTED_BUT_UNVERIFIED | IMPLEMENTED_BUT_UNVERIFIED | CadQuery not installable here; shares the plan, and the sweep bug was fixed there too |
| 4 | Server export route `/api/generations/[id]/export` | IMPLEMENTED_BUT_UNVERIFIED | IMPLEMENTED_BUT_UNVERIFIED | Its client (`CadClient`) runs against the real service in workflow step 12; the route needs the Next build |
| 5 | Next build, Prisma, migrations, lint, app typecheck | IMPLEMENTED_BUT_UNVERIFIED | **BLOCKED_BY_EXTERNAL_DEPENDENCY** (npm registry) | Gate script and CI ready; libraries typecheck (54 files, TS 7.0.2 strict, 0 errors) |
| 6 | Real Claude API | IMPLEMENTED_BUT_UNVERIFIED | **BLOCKED_BY_EXTERNAL_DEPENDENCY** (no `ANTHROPIC_API_KEY`) | Client, errors, retries and usage ledger tested against a simulated Messages API |
| 7 | Real Tripo | BLOCKED_BY_EXTERNAL_DEPENDENCY | BLOCKED_BY_EXTERNAL_DEPENDENCY | Host blocked here; adapter simulator-tested (Phase 8) |
| 8 | OrcaSlicer slicing | IMPLEMENTED_BUT_UNVERIFIED | **IMPLEMENTED_AND_TESTED** | Real CLI: 20 mm cube = 100 layers; part height = G-code height; oversize part refused |
| 9 | Drawings: section, GD&T, feature dims, horizontal holes, placement, validation | NOT_IMPLEMENTED | **IMPLEMENTED_AND_TESTED** | Exact section area 608.4 mm²; datums A, B and C; flatness and position frames; front and right-view holes; no overlaps on 5 starters |
| 10 | Assemblies: rotational constraints | NOT_IMPLEMENTED | **IMPLEMENTED_AND_TESTED** | `concentric`, `angle`, `revolute`; swept range of motion finds the exact 144 mm³ collision at 90° |
| 11 | Assembly approval with per-component approval; print and exports | NOT_IMPLEMENTED | **IMPLEMENTED_AND_TESTED** | Chromium run: 2/2 parts approved, then the assembly; each part's STL SHA = approved SHA; rebuild reproduces it |
| 12 | Compensation: holes and outer, per axis, per material; never twice | PARTIALLY_IMPLEMENTED | **IMPLEMENTED_AND_TESTED** | Variant marker; a second compensation is refused; the approved file is unchanged (workflow step 16) |
| 13 | Printer overhang limit in DFM | NOT_IMPLEMENTED | **IMPLEMENTED_AND_TESTED** (bug fixed, see §4) | Single-fin test: flagged at 45° and 55°, not at 65° |
| 14 | WhatsApp: signatures, templates, delivery, retries | IMPLEMENTED_AND_TESTED (simulator) | Unchanged; live **BLOCKED_BY_EXTERNAL_DEPENDENCY** (Meta business account) | |
| 15 | E-mail verification | NOT_IMPLEMENTED | **IMPLEMENTED_AND_TESTED** (library); route IMPLEMENTED_BUT_UNVERIFIED | |
| 16 | ZainCash and FIB live | BLOCKED_BY_EXTERNAL_DEPENDENCY | BLOCKED_BY_EXTERNAL_DEPENDENCY (merchant accounts) | Callbacks, idempotency, inquiry before PAID and reconciliation tested on simulators |
| 17 | Refunds | PARTIALLY_IMPLEMENTED | **IMPLEMENTED_AND_TESTED** (service and offline UI) | ZainCash reverse; FIB manual transfer with reference; REFUNDED only after confirmation |
| 18 | Invoice PDF | NOT_IMPLEMENTED | **IMPLEMENTED_AND_TESTED** | |
| 19 | Server payment and notification routes, Prisma stores | IMPLEMENTED_BUT_UNVERIFIED | IMPLEMENTED_BUT_UNVERIFIED (needs the Next build) | |
| 20 | Server If-Match route | IMPLEMENTED_BUT_UNVERIFIED | IMPLEMENTED_BUT_UNVERIFIED | Conflict logic tested (`versions.js`) |
| 21 | Live multi-device sync of the offline file | NOT_IMPLEMENTED | NOT_IMPLEMENTED (by design; backup merge kept) | |
| 22 | Signed downloads | NOT_IMPLEMENTED | **IMPLEMENTED_AND_TESTED** (library); route wiring IMPLEMENTED_BUT_UNVERIFIED | HMAC, expiry, bound to file and user |
| 23 | Rate limiting beyond sign-in | NOT_IMPLEMENTED | **IMPLEMENTED_AND_TESTED** (library); route wiring IMPLEMENTED_BUT_UNVERIFIED | |
| 24 | RLS | NOT_IMPLEMENTED | NOT_IMPLEMENTED | SQLite has no RLS; ownership is enforced in tested access rules; PostgreSQL path documented |
| 25 | Unauthorized-access tests | PARTIALLY_IMPLEMENTED | **PARTIALLY_IMPLEMENTED** | Access rules tested explicitly; the HTTP smoke (401/403 on 4 protected routes) is in the gate and needs the build |
| 26 | Docker Compose, deployment, backups, monitoring | PARTIALLY_IMPLEMENTED | Compose and backups **IMPLEMENTED_AND_TESTED**; images IMPLEMENTED_BUT_UNVERIFIED | `docker compose config` valid and refuses missing secrets; backup/restore tested under live writes; no Docker daemon to build images |
| 27 | AI usage and cost tracking, budget | NOT_IMPLEMENTED | **IMPLEMENTED_AND_TESTED** (simulated API) | API-reported tokens; cost only from configured prices; budget stop; JSONL log |
| 28 | 3 concepts, Arabic and English, failure handling | IMPLEMENTED_AND_TESTED (mocked replies) | Unchanged; real-model run BLOCKED (no key) | Workflow steps 2–4 |

## 3. Commands and results (this environment)

| Command | Result |
|---|---|
| `scripts/build-occt-native.sh` equivalent (OCCT V7_8_1 from GitHub, 1981 build steps) | Built; `forma_occ` compiled with no warnings |
| `cd services/cad_engine && python3 -m pytest -q` | 55 passed, 1 skipped (CadQuery backend) |
| `python3 -m pytest -q tests/test_native.py` | 28 passed, on the real kernel |
| `cd services/ai_3d_engine && python3 -m pytest -q` | 48 passed, 1 skipped |
| `node --test tests/node/*.test.ts` (with OCCT and OrcaSlicer) | **194 passed, 0 failed** |
| `tsc -p tests/node/tsconfig.json` (TypeScript 7.0.2, strict) | 0 errors in 54 files |
| `python3 -m pytest -q tests/ops` (backup and restore) | 4 passed |
| `python3 tests/e2e/step_real_kernel.py` (Chromium → service → OCCT) | STEP AP214, 43 faces, 1 solid, re-read OK; wrong token → 401 message; no page errors |
| `python3 tests/e2e/assembly_workflow.py` (Chromium) | Per-component then assembly approval; print files' SHA = approved SHA; no page errors; no horizontal scroll at 390 px |
| `scripts/verify-production.sh` | 10 passed, 0 failed, 7 skipped (all skips: npm registry) |
| `docker compose config -q` | Valid with secrets; refuses without them |

## 4. Defects found by real-component testing (all fixed, each with a regression test)

1. **Sweep was broken in both CAD backends.** The plan stored each node's error location under `"path"`, which
   overwrote the sweep's path points. They are renamed `spine`.
2. **OpenCascade lost material without complaint.** `ShapeUpgrade_UnifySameDomain` returned a solid that passed
   BRepCheck but had lost 1320 mm³: the vase starter's revolve fused with 12 ribs. The executor now keeps the cleaned
   shape only when it is valid and has the same volume.
3. **Volumes were imprecise.** Default Gauss integration differed by about 1e-4 on revolved faces. It is now adaptive
   to 1e-9 relative. The identity V(A∪B) − V(A) = V(B∖A) now holds to 1e-7.
4. **OCCT printed STEP statistics to stdout**, corrupting the JSON reply. Messages now go to stderr.
5. **The browser STEP button could not reach a local service.** Chromium sends `Origin: file://` and a Private
   Network Access preflight; the service now answers both, for allowed origins only.
6. **A chamfer-box test expectation was wrong.** OCCT closes each corner with a triangle, which removes d³/12 more per
   corner. The kernel was right and the formula was corrected.
7. **The printer overhang limit was inverted** away from 45°. A printer calibrated to 60° was checked at 30°.
8. **Model names were read at import time**, so configuration changes did not apply. They are now read per call.

## 5. The 19-step workflow (`tests/node/workflow-e2e.test.ts`)

The original numbered list was not available in the session's retained context. These steps follow the platform's
lifecycle from sign-up to the "print finished" message. REAL = our code with the real component. SIMULATED = a local
test double of an external API that cannot be reached here. NOT RUN = the real component is absent (never faked).

| # | Step | Mode | Result |
|---|---|---|---|
| 1 | Sign-up + e-mail verification | REAL | Token accepted for its address, refused for another |
| 2 | Idea (Arabic) → clarifying questions | SIMULATED (Claude API) | Our prompt, client, JSON extraction and ledger are real |
| 3 | Idea (English) → same pipeline | SIMULATED | English text reaches the prompt unchanged |
| 4 | 3 concepts → built + distinctness | REAL + SIMULATED | Replies simulated; 3 meshes built and validated; 3 distinct |
| 5 | AI usage ledger | REAL | 6 calls, 7832 in / 2400 out tokens |
| 6 | Pick concept + parameter change | REAL | w 20 → 30 mm; no AI call |
| 7 | Validation + DFM + SHA-256 | REAL | VALIDATED |
| 8 | Save with conflict check | REAL | Stale base → NEW_REVISION |
| 9 | Submit for review + access rules | REAL | Customer cannot approve; operator cannot read contact |
| 10 | Drawing: section, GD&T, holes, PDF | REAL | Front-view Ø4.5 hole, section, datums ABC, vector PDF |
| 11 | Approval bound to SHA-256 | REAL | Rebuild reproduces the approved hash |
| 12 | STEP export | REAL (OCCT 7.8.1) | 11 faces, re-read OK, B-Rep volume 22432.8 mm³ (mesh within 0.2 %) |
| 13 | Signed download link | REAL | OK / wrong_file / expired |
| 14 | Quote + invoice | REAL | INV-2026-00001, 5,500 IQD |
| 15 | ZainCash payment | SIMULATED (gateway) | PAID only after server inquiry; replay changes nothing |
| 16 | Compensated variant | REAL | Scale 1.004/0.996/0.998, holes +0.25 mm; second compensation refused |
| 17 | Slicing | REAL (OrcaSlicer 2.1.1) | 299 layers, 76 min, 4.0 m filament |
| 18 | Upload to OctoPrint + start | SIMULATED (OctoPrint) | Real sliced G-code (858 kB) uploaded, size verified, started only by command |
| 19 | Notification + receipt | SIMULATED (WhatsApp Cloud API) | Template sent; delivered receipt recorded |

## 6. External dependencies and blockers

| Dependency | Needed for | Status |
|---|---|---|
| npm registry (or a machine with it) | Next build, Prisma, lint, app typecheck, HTTP smoke | Blocked here. The CI workflow runs all of them |
| `ANTHROPIC_API_KEY` | Real AI designer and clarifier runs | Not provided |
| Tripo API access | Tripo provider | Host blocked here; needs a rotated key |
| ZainCash and FIB merchant credentials (sandbox, then production) | Live payments | Merchant approval |
| Meta WhatsApp Business account + approved templates (`forma_*`) | Live WhatsApp | Business verification |
| Docker daemon + registry | Building and running the images | Not available here |
| A real printer with OctoPrint | Live printing | Simulated here |

## 7. Security findings

- **High: rotate the Tripo keys.** Two keys (`tsk_[REDACTED]…`, `tsk_[REDACTED]…`) remain in the git history. They are not in
  current files, and the release gate's secret scan passes on the current tree.
- **Fixed: CORS was too narrow.** The CAD service answered PNA and `file://` for nothing, so offline STEP failed.
  Both are now answered only for allowed origins, and a test checks that other origins get no CORS headers.
- **Hardened: compose.** The app port is bound to 127.0.0.1. The engine and CAD service are internal only, read-only,
  `cap_drop: ALL` and `no-new-privileges`. Compose refuses to start without both service tokens.
- **Privacy:** the AI ledger and CAD logs hold no prompts, replies, designs or keys, and a test checks this.
  Notification deliveries store no contact details (Phase 8 test).
- **Open: no HTTP-level tests yet.** Route-level unauthorized-access checks have not run (they are in the gate and
  need the build). There is no RLS: SQLite has none, so ownership rules are enforced in code and tested.

## 8. Remaining work, in priority order

1. Run the CI workflow (or `verify-production.sh --strict` on a machine with npm). Fix whatever the Next build, lint
   and app typecheck report. Commit a Prisma baseline migration.
2. Revoke the two Tripo keys.
3. Provide `ANTHROPIC_API_KEY` and run the AI designer for real: 3 concepts in Arabic and English. Set
   `AI_PRICING_JSON` from your plan.
4. Sandbox ZainCash and FIB, then a sandbox payment end to end through the webhooks. Then WhatsApp templates
   approved by Meta.
5. Build the images (`docker compose build`) and run the stack once with a real backup and restore drill.
6. Optional: install CadQuery on one machine to verify the second backend. The native backend already covers the
   service.
