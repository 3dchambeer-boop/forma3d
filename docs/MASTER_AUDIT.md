# FORMA·3D: master build specification audit

Audited 2026-10-30 against the "Ultimate Master Build Prompt", starting from branch `phase-9-verification`.
Statuses follow §22 of the specification. "Here" means the build environment, which has:
- **No access to:** the npm registry, PostgreSQL, Redis, or a Docker daemon.
- **Access to:** GitHub (OpenCascade and OrcaSlicer were built or downloaded from it), and Chromium for browser tests.

## What is actually demonstrable

The product runs in two forms:

1. **The offline platform and studio (`forma-offline.html`, published as artifacts).** It runs the full lifecycle in a
   browser:
   - roles: customer, designer, operator and admin
   - CAD kernel, viewer, drawings, assemblies, calibration, quotes and invoices, versions
   - **status: verified in Chromium**
2. **The server application:** the Next.js 16 app, plus `ai_3d_engine` (FastAPI), `cad_engine` (OpenCascade 7.8.1),
   the worker, Prisma and SQLite.
   - **Verified:** its libraries and services, by tests.
   - **Not verified:** the Next.js app itself has never been built or run, because npm is blocked here.
     `scripts/verify-production.sh --strict` and the CI workflow are the gate for it.

## Acceptance checklist (§21)

### Application
| Item | Status | Evidence / gap |
|---|---|---|
| Public website (home, about, pricing, FAQ, legal…) | PARTIALLY_IMPLEMENTED | `landing.tsx` exists; About, How it works, Pricing, Contact, FAQ, Privacy and Terms pages do not; the app is not built here |
| Customer dashboard | IMPLEMENTED_BUT_UNVERIFIED | `user-dashboard.tsx` (Next, not built); offline platform home: tested in Chromium |
| Administrator dashboard | IMPLEMENTED_BUT_UNVERIFIED | `admin-analytics.tsx` (Recharts, DB queries), `/api/analytics/ai-usage`; not built |
| Designer dashboard | IMPLEMENTED_BUT_UNVERIFIED | `designer-queue/review.tsx`; offline review and approval flow: tested in Chromium |
| Farm manager dashboard | IMPLEMENTED_BUT_UNVERIFIED | `farm-dashboard`, `printer-fleet`, `slicing-dispatch`; offline print view: tested |
| Arabic and English interfaces | PARTIALLY_IMPLEMENTED | Next i18n (`i18n.ts`, ar + en). The offline platform is Arabic RTL only |
| Responsive layouts | IMPLEMENTED_AND_TESTED (offline) | No horizontal scroll at 390 px in every browser run |
| Dark and light modes | IMPLEMENTED_BUT_UNVERIFIED | Next: dark default, a light/dark switch in Settings (`next-themes` + `.dark` tokens), not built here; offline file follows the system setting |

### AI
| Item | Status | Evidence / gap |
|---|---|---|
| Real text-to-3D | BLOCKED_BY_EXTERNAL_DEPENDENCY | Adapters: Claude (AI designer), Tripo, **Meshy, Rodin (new)**. All simulator-tested; no keys here |
| Real image-to-3D | BLOCKED_BY_EXTERNAL_DEPENDENCY | Tripo, **Meshy, Rodin**; images checked by content first (**new**) |
| Arabic prompt understanding | IMPLEMENTED_BUT_UNVERIFIED | Prompts and parsing tested with simulated replies; needs `ANTHROPIC_API_KEY` |
| Multiple alternatives (3 concepts) | IMPLEMENTED_AND_TESTED (simulated model) | Real kernel builds and distinctness check |
| Real STL generation | IMPLEMENTED_AND_TESTED | FormaCAD kernel + OpenCascade; STL re-opened and validated |
| Mesh validation | IMPLEMENTED_AND_TESTED | Manifold, normals, components, wall thickness, re-open |
| Generation history | IMPLEMENTED_BUT_UNVERIFIED | Prisma models plus repository (memory version tested) |
| Provider fallback | IMPLEMENTED_AND_TESTED | Worker switches only when no paid task can exist |
| Usage and cost tracking | IMPLEMENTED_AND_TESTED (simulated API) | Ledger, budget stop |
| Self-hosted model (TRELLIS etc.) | NOT_IMPLEMENTED (interface only) | `SELF_HOSTED` adapter + `docs/SELF_HOSTED_AI.md`; no weights installed, so nothing is claimed |

### Engineering
| Item | Status | Evidence / gap |
|---|---|---|
| FormaCAD | IMPLEMENTED_AND_TESTED | |
| OpenCascade, real B-Rep, fillet, chamfer, shell, offset, draft | IMPLEMENTED_AND_TESTED | OCCT 7.8.1 built from source, 33 kernel tests |
| STEP export | IMPLEMENTED_AND_TESTED | Re-read and compared; browser button verified in Chromium |
| STEP import | **IMPLEMENTED_AND_TESTED (new)** | Units converted to mm, healed, several solids, limits; HTTP endpoint; app route unverified (Next) |
| Engineering drawings, PDF | IMPLEMENTED_AND_TESTED | ISO/ASME, A4–A1, sections, GD&T, hole tables, vector PDF; **detail views NOT_IMPLEMENTED** |
| Multi-part assemblies, BOM | IMPLEMENTED_AND_TESTED | **New:** slider (travel sweep), cylindrical, planar, fixed joints next to mate/flush/align/concentric/revolute |
| Dimensional validation | IMPLEMENTED_AND_TESTED | Measured requirement checks on the exported mesh |

### Manufacturing
| Item | Status | Evidence / gap |
|---|---|---|
| OrcaSlicer, real G-code | IMPLEMENTED_AND_TESTED | Real CLI 2.1.1; G-code checked |
| OctoPrint (upload, select, start, pause, resume, cancel, temperatures) | IMPLEMENTED_AND_TESTED (simulated) | Documented REST API; no printer here |
| Printer fleet, calibration, compensation | IMPLEMENTED_AND_TESTED | Never compensated twice; approved STL immutable |
| Manufacturing history | IMPLEMENTED_AND_TESTED (offline) / UNVERIFIED (server) | |
| Real print status | BLOCKED_BY_EXTERNAL_DEPENDENCY | Needs a printer running OctoPrint |

### Business
| Item | Status | Evidence / gap |
|---|---|---|
| Orders, quotations, invoices, manual payments, refunds | IMPLEMENTED_AND_TESTED | |
| ZainCash and FIB | BLOCKED_BY_EXTERNAL_DEPENDENCY | Merchant accounts; simulator-tested to the documented APIs |
| Stripe | NOT_IMPLEMENTED | Iraq is not a Stripe merchant country; left out on purpose |
| Discounts | NOT_IMPLEMENTED | |
| E-mail and WhatsApp notifications | BLOCKED_BY_EXTERNAL_DEPENDENCY | Simulator-tested |
| Customer–support messaging | NOT_IMPLEMENTED | Review notes and a WhatsApp click-to-chat contact exist |

### Platform
| Item | Status | Evidence / gap |
|---|---|---|
| RBAC | IMPLEMENTED_AND_TESTED (rules) | Route enforcement needs the Next build |
| RLS | NOT_IMPLEMENTED | SQLite has none. PostgreSQL is not available here, so a policy file would be untested and was not written |
| Secure storage, signed URLs | IMPLEMENTED_AND_TESTED (library) | |
| Upload validation by content | **IMPLEMENTED_AND_TESTED (new)** | Magic bytes, header dimensions (decompression bomb), declared-type match, STL/3MF/STEP/GLB/OBJ |
| Project versioning, conflict resolution | IMPLEMENTED_AND_TESTED | Offline and library; server If-Match route unverified |
| Multi-device synchronization | PARTIALLY_IMPLEMENTED | Server-side projects sync; the offline file has backup merge only |
| Audit logs | IMPLEMENTED_BUT_UNVERIFIED | `logAuditSafe` on privileged routes |
| Database backups | IMPLEMENTED_AND_TESTED | `scripts/backup.py` |
| Production build | BLOCKED_BY_EXTERNAL_DEPENDENCY | npm |
| Deployment documentation | IMPLEMENTED | `docs/DEPLOYMENT.md` |

### 3D viewer (§6.4)
- **Rotate, pan, zoom, fit, measure, DFM overlay:** existing.
- **Section clipping, wireframe, orthographic projection, reset (new):** IMPLEMENTED_AND_TESTED, verified in Chromium
  by pixel counts. The cut colour appears only with a section on; wireframe edges change 13,520 pixels.
- **Exploded view:** assemblies.
- **Material preview:** NOT_IMPLEMENTED.

## Specification choices not followed, and why

- **PostgreSQL, RLS, Redis and Supabase.** The repository uses SQLite and in-process workers. None of these can be
  installed here, and switching databases without being able to run a migration would put existing data at risk
  (§3: "Do not introduce incompatible database changes"). The PostgreSQL path is documented, and the switch belongs
  where it can be tested.
- **Hosted Next.js pages added without a build.** Writing pages that can never be compiled or rendered here would
  produce exactly the "UI without a functioning backend" that §22 rules out. New interface work went into the
  offline platform, which can be verified.
