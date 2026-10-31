# FORMA·3D — Phase 8 Engineering Report

Date: 2026-10-30. Environment: Linux sandbox. No npm/PyPI/CDN access. OpenCascade (CadQuery/OCP) cannot be installed here.
Every result below was produced in this environment unless the status says otherwise.

## Status legend
| Status | Meaning |
|---|---|
| IMPLEMENTED_AND_TESTED | Code exists and automated tests (and, where there is UI, a browser run) pass here. |
| IMPLEMENTED_BUT_UNVERIFIED | Code exists but could not be executed here (missing kernel, framework build, or database). |
| PARTIALLY_IMPLEMENTED | Part of the requirement works and is tested; the rest is listed. |
| BLOCKED_BY_EXTERNAL_DEPENDENCY | Needs an account, credential or approval that does not exist yet. |
| NOT_IMPLEMENTED | Not built. |

## Test results (actual runs)
| Suite | Result |
|---|---|
| Node (`node --test tests/node/*.test.ts`) | **141 passed, 0 failed** (37 suites) |
| — kernel / exporters (8.1) | 16 |
| — drawings (8.2) | 12 |
| — calibration (8.3) | 9 |
| — assemblies + multi-concept (8.4) | 12 |
| — notifications (8.5) | 9 |
| — payments (8.5) | 10 |
| — platform commerce (8.5) | 4 |
| — versions / sync (8.6) | 6 |
| — earlier phases (designer, generation, OctoPrint, engine parity, cad-client) | 63 |
| Python `services/cad_engine` | 27 passed, 1 skipped (`test_occ.py` skips because there is no OpenCascade kernel) |
| Python `services/ai_3d_engine` | 48 passed, 1 skipped |
| TypeScript typecheck of the server libraries (`tsc -p tests/node/tsconfig.json`) | clean |

These browser runs used Chromium/Playwright against the built single-file pages:
- **Drawing tab.** Built a drawing and checked the PDF: pdf-lib re-opens it, A3 is 1190.6×841.9 pt, and Arabic renders correctly when rasterised. Ran ISO and ASME. Exported 3MF (fine), GLB and OBJ.
- **STEP client.** Ran it against a mock of the CAD-service contract. A failed re-import check is refused and a passing one is saved.
- **Calibration.** Entered measurements; a typo was rejected. Got a high-confidence fit. A job ZIP held the original STL, whose SHA-256 equals the approved one, plus a separate compensated STL and `compensation.json`.
- **Assemblies.** The ready-made case+lid assembly built with a 0.2986 mm clearance and no interference. The AI assembly, using mocked model replies, was repaired after a measured 9.251 mm³ interference. AI concepts, also mocked: 3 built, the duplicate flagged and one selected.
- **Invoices.** Generated a quote and invoice. Fractional prices and a wrong amount were refused. An admin recorded a manual payment, and the WhatsApp link uses the configured number.
- **Versions.** Ran history, compare, restore-as-new and duplicate, and downloaded an old revision. A concurrent write was detected and the work saved as a separate project. A backup merge reported its conflict and kept the losing edit as a copy.
- **Regressions.** Full offline flow (local AI mock, OctoPrint simulator) and online platform flow (runtime stub): no page errors, and no horizontal scroll at 390 px.

## 8.1 Advanced CAD
| Feature | Status | Evidence / notes |
|---|---|---|
| OpenCascade service: B-Rep fillet/chamfer (profile + edge selectors), shell, offset, draft, booleans, loft, sweep, revolve | IMPLEMENTED_BUT_UNVERIFIED | `services/cad_engine`. Planner: 27 tests pass. `test_occ.py` (exact Steiner volume, STEP round trip, starter parity ≤1.5 %) is prepared and skipped here. Install and verify on Windows following `docs/CAD_ENGINE.md`. |
| STEP export with re-import check; controlled STL/3MF from B-Rep | IMPLEMENTED_BUT_UNVERIFIED | Same service. Its HTTP contract is exercised by `cad-client.test.ts` and by the browser STEP client (mock service). |
| Browser kernel: exact profile fillets/chamfers, `fillet_box`, `chamfer_box`, `loft`, `sweep`, `mirror_copy`, chord-tolerance tessellation | IMPLEMENTED_AND_TESTED | Checked against closed-form values (Steiner volume, Pappus, polygon factors). |
| OBJ / GLB / 3MF export (standard / fine) | IMPLEMENTED_AND_TESTED | Round-trip parsers and a browser download. "Fine" only affects curves that have no explicit `segments`. |
| Server export route `GET /api/generations/[id]/export?format=step` | IMPLEMENTED_BUT_UNVERIFIED | No `node_modules` and no Next build here. |

## 8.2 Engineering drawings
| Feature | Status | Notes |
|---|---|---|
| Front/top/right + isometric, hidden lines, ISO first-angle / ASME third-angle, A4–A1, standard scales | IMPLEMENTED_AND_TESTED | Too large for the sheet is reported, not squeezed. |
| Overall dimensions and hole table (centre, Ø, THRU/depth, opens from top or bottom), each checked against a probe through the solid | IMPLEMENTED_AND_TESTED | Bosses and rectangles are not mistaken for holes (angular-coverage test). |
| Title block (ISO 7200-style), projection symbol, measured-checks table, vector PDF + SVG | IMPLEMENTED_AND_TESTED | Text longer than a cell is condensed to fit. |
| Section views, GD&T frames, per-feature dimensioning beyond overall + holes, holes on non-vertical axes | NOT_IMPLEMENTED | |

## 8.3 Printer calibration
| Feature | Status | Notes |
|---|---|---|
| 8 calibration objects (XYZ cube, steps, holes/pins, walls, overhang, bridges, first layer, flow) | IMPLEMENTED_AND_TESTED | All build VALIDATED/VALID_WITH_WARNINGS on the bed. |
| Measurement entry with typo guard; history per printer+material (stored on the printer record) | IMPLEMENTED_AND_TESTED | |
| Least squares per axis (scale + offset), hole offset, standard errors, leave-one-out outliers, confidence | IMPLEMENTED_AND_TESTED | Exact recovery, closed-form standard errors, and the seeded-noise fit lies within 3 SE. |
| Compensated manufacturing variant (approved file unchanged), refusals when calibration is unusable | IMPLEMENTED_AND_TESTED | Predicted print matches nominal within 0.01 mm (outer) and 0.02 mm (holes). |
| Outer bleed compensation | PARTIALLY_IMPLEMENTED | Delivered as a slicer setting (X-Y contour compensation −b/2), not as a mesh offset. |
| Feeding overhang/bridge results into DFM thresholds | NOT_IMPLEMENTED | They are shown as advice only. |

## 8.4 Multi-concept AI and assemblies
| Feature | Status | Notes |
|---|---|---|
| Up to 3 concepts → one full design loop each → measured comparison → choose | IMPLEMENTED_AND_TESTED (mocked AI) | Distinctness uses 16³ occupancy IoU plus size ratio. The quality of real Claude concepts is unverified. |
| Assemblies: mate / flush / align (axis-aligned translation), clearance (exact mesh distance, contact-plane exclusion), interference (exact boolean volume), BOM, exploded view, per-part STL + assembly 3MF | IMPLEMENTED_AND_TESTED | |
| AI-generated assemblies with automatic repair from measured problems | IMPLEMENTED_AND_TESTED (mocked AI) | |
| Rotational constraints, assemblies in the approval → print workflow | NOT_IMPLEMENTED | Assemblies are downloaded; each part can be saved as its own project. |

## 8.5 Notifications and payments
| Feature | Status | Notes |
|---|---|---|
| Notification service: preferences, opt-in WhatsApp, idempotency, retries with backoff, receipts, no contact data stored | IMPLEMENTED_AND_TESTED | `src/lib/notify`. |
| WhatsApp Cloud API client (templates), webhook HMAC-SHA256 + handshake | IMPLEMENTED_AND_TESTED (simulator) | Real sending is BLOCKED_BY_EXTERNAL_DEPENDENCY: it needs a Meta business account, a verified number, approved templates (names in `TEMPLATES`) and a token. |
| E-mail over HTTPS API | IMPLEMENTED_AND_TESTED (simulator) | Needs an API key. **E-mail verification flow: NOT_IMPLEMENTED**, so e-mail stays off until `emailVerified` is set. |
| WhatsApp click-to-chat with the platform number (in settings, default +964 782 267 8298) | IMPLEMENTED_AND_TESTED | |
| In-app notifications (platform home: new events on my projects) | IMPLEMENTED_AND_TESTED | Seen-marker is kept per device. |
| ZainCash v2 (OAuth, init, inquiry, HS256 tokens) and FIB (OAuth, create, status, cancel) clients; payment service (state machine, verified events only, idempotency, amount check, reconciliation, manual records by admin) | IMPLEMENTED_AND_TESTED (simulators) | Live payments are BLOCKED_BY_EXTERNAL_DEPENDENCY (merchant accounts; ZainCash production URL and webhook registration; FIB production credentials). |
| Server routes (webhooks, invoices, pay, manual, dispatch, reconcile) + Prisma models | IMPLEMENTED_BUT_UNVERIFIED | Needs `bun install`, `prisma db push` and a Next build. |
| Quotes, invoices, manual payment recording in the single-page platform | IMPLEMENTED_AND_TESTED | No online payment is taken there. |
| Refunds (ZainCash reverse exists in the client) | PARTIALLY_IMPLEMENTED | Not wired to a UI or workflow. |
| Qi Card | NOT_IMPLEMENTED | No public merchant API documentation was found; it is offered through aggregators. |
| PDF invoices | NOT_IMPLEMENTED | |

## 8.6 Versions and sync
| Feature | Status | Notes |
|---|---|---|
| Revision history: view, compare (parameters, model leaves, size, mass, checks), restore as a new revision, duplicate as a project, download an old revision with SHA check | IMPLEMENTED_AND_TESTED | |
| Immutable revisions; approved revision locked; optimistic conflict detection on save and on status changes | IMPLEMENTED_AND_TESTED | The online shared database is simulated by writing behind the page. |
| Offline backup merge with preview and conflict report (losing edits kept as "conflicting copy") | IMPLEMENTED_AND_TESTED | Replaces the earlier silent overwrite. |
| Server ETag / If-Match (409 stale, 428 missing) | IMPLEMENTED_AND_TESTED (helper) / IMPLEMENTED_BUT_UNVERIFIED (route) | |
| Live multi-device sync for the offline file | NOT_IMPLEMENTED | Devices exchange backup files. |

## Defects found and fixed during this phase
- The `arduino_case` starter had its four standoffs erased by the cavity cut. The drawing check exposed it; standoffs are now added after the cavity.
- Drawing hole detection: a rectangle's corners fit a circle; fixed with an angular-coverage test. Blind holes were reported as THRU; fixed by measuring from the rim.
- Job download: the compensated variant could be built with default parameters when no revision document existed. It now uses the approved values.
- Phone-width overflow from wide tables in the studio column.

## Known limitations of the mesh kernel
- BSP CSG degeneracy: six 64/72/96-segment cylinders with vertices on a shared line left one non-manifold edge. The validator reports it as REPAIR_REQUIRED, so it never passes silently. The calibration plate uses 60 segments. OpenCascade removes this class of problem.

## Configuration added
`.env.example` now lists:
- `CAD_ENGINE_URL` and `CAD_SERVICE_TOKEN`
- `PUBLIC_BASE_URL` and `NOTIFY_DISPATCH_TOKEN`
- the `WHATSAPP_*` variables
- the `EMAIL_*` variables
- the `ZAINCASH_*` variables
- the `FIB_*` variables

None has a value, and none is read by the browser.
