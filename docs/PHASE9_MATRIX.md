# Phase 9 completion matrix (written at the start of Phase 9)

**Final statuses: see docs/PHASE9_REPORT.md §2 (this file is the plan written at the start of Phase 9).**

Sources: `docs/PHASE8_REPORT.md`, `docs/AUDIT.md`, CAD/AI/printing/commerce docs, the source tree and `prisma/schema.prisma`.
"Before" is the status at the end of Phase 8. The plan column says what Phase 9 does about each gap, given that this environment has:
- **Reachable:** GitHub (git and release downloads) and `api.anthropic.com` (no key provided).
- **Not reachable:** npm, PyPI, conda, apt, Docker Hub, the Tripo API, the payment providers and Meta.

| # | Item | Before | Phase 9 plan |
|---|---|---|---|
| 1 | OpenCascade B-Rep (fillet, chamfer, shell, offset, draft) | IMPLEMENTED_BUT_UNVERIFIED | Build OCCT 7.8.1 from its GitHub source; native executor; exact tests on the real kernel |
| 2 | STEP export + re-import check | IMPLEMENTED_BUT_UNVERIFIED | Real STEP writer/reader round trip in tests and through the HTTP service |
| 3 | CAD HTTP service | IMPLEMENTED_BUT_UNVERIFIED (FastAPI missing) | Same contract on the Python stdlib; test it; drive it from the browser STEP button |
| 4 | Server export route `/api/generations/[id]/export` | IMPLEMENTED_BUT_UNVERIFIED | Needs Next build. BLOCKED here (no npm) → CI workflow + verify script |
| 5 | Next.js build, Prisma generate/migrate, lint, typecheck of app | IMPLEMENTED_BUT_UNVERIFIED | BLOCKED here (no npm) → `scripts/verify-production.sh` + GitHub Actions |
| 6 | Real Claude API (server) | IMPLEMENTED_BUT_UNVERIFIED | Needs `ANTHROPIC_API_KEY`. Usage/cost tracking to be added and tested against a simulator. The artifact build uses the real Claude runtime |
| 7 | Real Tripo | BLOCKED_BY_EXTERNAL_DEPENDENCY | Host blocked here; adapter stays simulator-tested |
| 8 | OrcaSlicer slicing | IMPLEMENTED_BUT_UNVERIFIED | Download the real CLI from GitHub releases, run it headless, test real slices |
| 9 | Drawings: section views, GD&T, detailed dimensions, horizontal holes | NOT_IMPLEMENTED | Implement + tests |
| 10 | Assemblies: rotational constraints | NOT_IMPLEMENTED | Implement + tests |
| 11 | Assemblies in approval/print workflow | NOT_IMPLEMENTED | Implement in the platform + browser test |
| 12 | Outer-bleed compensation | PARTIALLY_IMPLEMENTED (slicer setting) | Keep the slicer setting. Prevent double compensation (variant marker) + test |
| 13 | Overhang/bridge results → DFM | NOT_IMPLEMENTED | Use the printer profile in the job's DFM advice + test |
| 14 | WhatsApp/e-mail delivery | IMPLEMENTED_AND_TESTED (simulator), live BLOCKED | Unchanged (needs Meta account) |
| 15 | E-mail verification flow | NOT_IMPLEMENTED | Signed verification tokens + tests |
| 16 | Payments live | BLOCKED_BY_EXTERNAL_DEPENDENCY | Unchanged (merchant accounts) |
| 17 | Refund workflow | PARTIALLY_IMPLEMENTED | Service refund (ZainCash reverse; FIB manual) + tests + admin UI |
| 18 | Invoice PDF | NOT_IMPLEMENTED | PDF via the vendored pdf-lib; platform download + test |
| 19 | Server payment/notification routes + Prisma models | IMPLEMENTED_BUT_UNVERIFIED | BLOCKED here (no npm) |
| 20 | Server If-Match route | IMPLEMENTED_BUT_UNVERIFIED | Same |
| 21 | Live multi-device sync for the offline file | NOT_IMPLEMENTED | Sync via a self-hosted sync endpoint is outside the single-file design; document + backup merge stays |
| 22 | Signed downloads | NOT_IMPLEMENTED | HMAC-signed, expiring, scope-bound URLs + tests |
| 23 | Rate limiting beyond sign-in | NOT_IMPLEMENTED | Limiter for webhooks/expensive routes + tests |
| 24 | RLS | NOT_IMPLEMENTED (SQLite) | Not applicable to SQLite; documented with the PostgreSQL path |
| 25 | Unauthorized-access tests | partial (unit) | Explicit tests of access rules |
| 26 | Docker Compose / deployment docs / backups / monitoring | partial | Compose validation (`docker compose config`), backup/restore scripts, deployment guide |
