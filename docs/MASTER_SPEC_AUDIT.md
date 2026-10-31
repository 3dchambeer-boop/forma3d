# Master build specification — audit against the repository (Stage A)

Date: 2026-10-30. Baseline: branch `phase-9-verification` (see `docs/PHASE9_REPORT.md`).
The repository has two applications that share the CAD, analysis, drawing, assembly, calibration and commerce code
in `services/ai_3d_engine/browser/`:

- **The online platform** (`src/`): Next.js 16, Prisma, 47 API routes, 15 views in one client shell.
  - It cannot be built or run in this environment because the npm registry is blocked.
  - Its library layer is typechecked and tested. Its pages and routes are IMPLEMENTED_BUT_UNVERIFIED until CI runs
    `scripts/verify-production.sh --strict`.
- **The offline platform** (`forma-offline.html`, also published as the claude.ai platform artifact):
  - It is a complete role-based app: customer, designer, operator and admin.
  - Everything in it is tested in Chromium. It is Arabic only.

Status words as in §22. "Plan" is what this round does about a gap. Items with no plan are not testable here or
need an outside account.

## §21 checklist

### Application

| Item | Status | Evidence / plan |
|---|---|---|
| Public website | IMPLEMENTED_BUT_UNVERIFIED | `views/landing.tsx` (Next app). No fabricated testimonials or statistics |
| Customer dashboard | IMPLEMENTED_AND_TESTED (offline); online unverified | Offline home: projects, notifications, actions |
| Admin dashboard | IMPLEMENTED_AND_TESTED (offline); online unverified | Online `admin-analytics.tsx` reads real DB queries; AI cost endpoint added in Phase 9 |
| Designer dashboard | IMPLEMENTED_AND_TESTED (offline) | Review queue, approval with reasons, per-component approval, drawings |
| Farm manager dashboard | PARTIALLY_IMPLEMENTED | Printers, queue, calibration, OctoPrint, G-code upload done. **Material inventory missing** |
| Arabic and English interfaces | PARTIALLY_IMPLEMENTED | Online: `src/lib/i18n.ts` (ar/en). Offline: Arabic only |
| Responsive layouts | IMPLEMENTED_AND_TESTED (offline) | No horizontal scroll at 390 px in every browser run |
| Dark and light modes | IMPLEMENTED_AND_TESTED | Theme tokens with `prefers-color-scheme` and `data-theme` |

### AI

| Item | Status | Evidence / plan |
|---|---|---|
| Real text-to-3D | BLOCKED_BY_EXTERNAL_DEPENDENCY | AI designer (Claude → FormaCAD) and Tripo adapter tested on simulators; no API keys here |
| Real image-to-3D | BLOCKED_BY_EXTERNAL_DEPENDENCY | Tripo image-to-3D adapter. **Plan: Meshy and Rodin adapters** from official docs, simulator-tested |
| Arabic prompt understanding | IMPLEMENTED_AND_TESTED (simulated replies) | Workflow steps 2–3; the real model run needs a key |
| Multiple design alternatives | IMPLEMENTED_AND_TESTED | 3 concepts, distinctness measured on real meshes |
| Real STL generation | IMPLEMENTED_AND_TESTED | FormaCAD kernel + exported-file re-validation; OCCT STL with volume check |
| Mesh validation | IMPLEMENTED_AND_TESTED | Watertight, manifold, components, normals, wall thickness, re-read after export |
| Generation history | IMPLEMENTED_BUT_UNVERIFIED (Prisma) | `AIGenerationJob` + `GenerationProviderAttempt` models |
| Provider fallback | IMPLEMENTED_AND_TESTED | No fallback while a paid task may exist (Phase 8 tests) |
| Usage and cost tracking | IMPLEMENTED_AND_TESTED (simulated API) | Phase 9 ledger |
| Prompt sanitisation | NOT_IMPLEMENTED | **Plan:** sanitiser for user text entering prompts (control characters, length, injection markers) |

### Engineering

| Item | Status | Evidence / plan |
|---|---|---|
| FormaCAD | IMPLEMENTED_AND_TESTED | |
| OpenCascade, real B-Rep, fillet and chamfer | IMPLEMENTED_AND_TESTED | OCCT 7.8.1, 28 kernel tests |
| STEP export | IMPLEMENTED_AND_TESTED | |
| STEP import | NOT_IMPLEMENTED | **Plan:** OCCT reader, healing, validity, volume, STL tessellation, service endpoint, tests |
| Engineering drawings + PDF | IMPLEMENTED_AND_TESTED | A4–A1, ISO/ASME, section, GD&T, hole tables |
| Multi-part assemblies, BOM | IMPLEMENTED_AND_TESTED | |
| Joints: fixed, slider, cylindrical, planar | NOT_IMPLEMENTED (only mate/flush/align/concentric/revolute) | **Plan:** add them, with motion-range sweeps |
| Dimensional validation | IMPLEMENTED_AND_TESTED | Requirements measured on the exported mesh |

### Manufacturing

| Item | Status | Evidence / plan |
|---|---|---|
| OrcaSlicer + real G-code | IMPLEMENTED_AND_TESTED | Real CLI 2.1.1 |
| OctoPrint integration | IMPLEMENTED_AND_TESTED (simulator) | Real printer not available |
| Printer fleet, calibration, compensation | IMPLEMENTED_AND_TESTED | |
| Manufacturing history | IMPLEMENTED_AND_TESTED (offline) | Job events |
| Real print status | BLOCKED_BY_EXTERNAL_DEPENDENCY | Needs a printer |

### Business

| Item | Status | Evidence / plan |
|---|---|---|
| Orders, quotations, invoices, manual payments, refunds | IMPLEMENTED_AND_TESTED | |
| Payment integrations (ZainCash, FIB) | BLOCKED_BY_EXTERNAL_DEPENDENCY | Merchant accounts |
| E-mail and WhatsApp notifications | IMPLEMENTED_AND_TESTED (simulators); live BLOCKED | |

### Platform

| Item | Status | Evidence / plan |
|---|---|---|
| RBAC, ownership | IMPLEMENTED_AND_TESTED (rules); routes unverified | |
| RLS | NOT_IMPLEMENTED | SQLite has none. The spec asks for PostgreSQL 16 + RLS: a migration path, not a locally testable item here |
| Secure storage, signed URLs | IMPLEMENTED_AND_TESTED (library) | |
| Upload validation by content | NOT_IMPLEMENTED | **Plan:** content sniffing for STL/3MF/OBJ/GLB/STEP/images, size limits, zip-bomb guard, wired into upload routes |
| Security headers | NOT_IMPLEMENTED | **Plan:** CSP, frame, referrer, permissions and HSTS headers in `next.config.ts` |
| Project versioning, conflict detection | IMPLEMENTED_AND_TESTED | |
| Multi-device synchronisation | PARTIALLY_IMPLEMENTED | Online: If-Match. Offline: backup merge |
| Audit logs | IMPLEMENTED_BUT_UNVERIFIED | `AuditEvent` model; the offline file keeps per-project event logs |
| Database backups | IMPLEMENTED_AND_TESTED | `scripts/backup.py` |
| Production build | BLOCKED_BY_EXTERNAL_DEPENDENCY | npm registry |
| Deployment documentation | IMPLEMENTED_AND_TESTED | `docs/DEPLOYMENT.md`, compose validated |

## Order of work this round

The order puts testable items first and, among them, the ones that close a spec requirement outright:

1. STEP import
2. Upload validation
3. Assembly joints
4. Meshy and Rodin adapters
5. Security headers and prompt sanitisation
6. Material inventory (offline farm view)

Everything is re-verified at the end with the same suites and browser runs as Phase 9.
