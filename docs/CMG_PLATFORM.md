# CMG × FORMA·3D: platform transformation (round 1)

Branch `phase-9-verification`, 2026-10-30. Statuses follow the directive's own scale.

## 1. Brand system

- **Parent brand:** CMG. **Product:** FORMA·3D. **Line:** "Intelligent Design. Precision Engineering. Real Manufacturing."
- **CMG mark: a typographic placeholder.** "CMG" is set in the display face with wide tracking, over a brand-colour
  rule with dimension ticks. No official logo file was supplied, so this is not presented as the official logo. The
  CMS editor says so, and the mark is replaced by uploading the real file (logo upload: NOT_IMPLEMENTED).
- **Colour:**
  - The welcome stage is graphite (`#0c1117` → `#111a23`), always dark.
  - The application keeps its light and dark tokens.
  - The brand accent defaults to `#c2410c`. An administrator can change it, but only to a `#rrggbb` value with at
    least 4.5:1 contrast against white (WCAG AA). A failing colour is refused, not applied.
- **Type:** the display face for headings and the body face for text. The welcome headline font is chosen from an
  approved list (IBM Plex Sans Arabic, Noto Kufi Arabic, Cairo, Tajawal, system).
- **Motion:**
  - A single 0.7 s entrance on the welcome page, staggered by 0.08 s.
  - The model on the welcome page turns slowly and pauses when the tab is hidden.
  - Everything is turned off under `prefers-reduced-motion`.

## 2. What was built and verified

| Directive item | Status | Evidence |
|---|---|---|
| Welcome experience: bilingual headlines, live 3D object, entry actions, reduced motion | IMPLEMENTED_AND_TESTED | `tests/e2e/welcome_cms.py`. The vase is built live by the FormaCAD kernel in the visitor's browser (caption gives its real size and triangle count). AR/EN switch flips direction. No horizontal scroll at 390 px |
| Website content management: text, pillars, FAQ, links, SEO, default language, accent, font, maintenance, preview, publish, revisions, rollback | IMPLEMENTED_AND_TESTED | `site.js` + `tests/node/site.test.ts`. Plain text only, https/mailto links only, contrast-checked colour, approved fonts. The draft is invisible until published. In the browser test, rollback to r1 was republished as r3 |
| Maintenance mode | IMPLEMENTED_AND_TESTED (UI-level) | Customers see only the message; the administrator sees a badge. Anyone can still switch user on a shared device |
| Customer Intelligence & Project Archive: directory (search, filters, sort, pagination, CSV), profile, projects in 9 business buckets, per-project timeline with source references, project record, account actions | IMPLEMENTED_AND_TESTED | `archive.js` + `tests/node/archive.test.ts`; `tests/e2e/customer_archive.py` with real local accounts and records |
| Account actions: edit contact, suspend, reactivate, archive (each with a reason, audited), admin notes, export (JSON) | IMPLEMENTED_AND_TESTED | Stored in the admin-only `roles/<id>` record. A suspended customer is read-only and told why |
| Project archive actions: record delivery, archive/unarchive (logged, never deletes) | IMPLEMENTED_AND_TESTED | |
| CMG Executive Control Center: real counts, project pipeline, activity centre with filter, CSV reports (customers, projects, revenue, manufacturing) | IMPLEMENTED_AND_TESTED | CSV cells starting with `= + - @` are neutralised (formula injection) |
| Global search (Ctrl/Cmd+K) across customers, projects, invoices, jobs, printers, designers | IMPLEMENTED_AND_TESTED | Results filtered by role: a customer finds only their own records. Keyboard navigation; focus kept in the dialog |
| Customers cannot register as administrators | IMPLEMENTED_AND_TESTED (offline) / existing (server) | Offline: only the first account on a device is the administrator. Server sign-up never reads a role |
| Separate administrator sign-in, MFA (TOTP), strict rate limit, audit | Libraries IMPLEMENTED_AND_TESTED; routes IMPLEMENTED_BUT_UNVERIFIED | TOTP matches the RFC 6238 vectors, with a replay guard. `/api/auth/admin/signin`, `/api/auth/mfa/setup`, `/api/auth/mfa/enable`. The customer sign-in refuses administrators |
| Administrator bootstrap (no password in code, git or front end) | Policy IMPLEMENTED_AND_TESTED; script IMPLEMENTED_BUT_UNVERIFIED | `scripts/create-admin.ts`: environment for one command, strong-password policy, bcrypt hash only, refuses a second administrator |
| Continue with Google | BLOCKED_BY_EXTERNAL_DEPENDENCY (needs a Google OAuth client) | Code flow with PKCE, signed state cookie, RS256 ID-token verification and key rotation. Tested with real RSA signatures against a simulated Google. Forged, foreign, expired and replayed tokens are refused. Linking never takes over an unverified, suspended or administrator account |
| Registration fields: name, e-mail, password + confirm, phone, country, language, terms | IMPLEMENTED_BUT_UNVERIFIED (server route) | Additive nullable columns: `googleSub`, `mfaSecret`, `mfaPending`, `mfaLastCounter`, `country`, `termsAcceptedAt` |
| Phone layout | IMPLEMENTED_AND_TESTED | Fixed a latent shell bug: the page grid column grew to its widest content (631 px on a 390 px phone). The navigation now scrolls inside its own row |

## 3. Not done in this round (honest list)

| Item | Status | Note |
|---|---|---|
| 18-state lifecycle (DRAFT → … → ARCHIVED) | PARTIALLY_IMPLEMENTED | The platform keeps its 9 tested statuses. The archive adds delivered/archived flags and files every project into 9 business buckets. Replacing the state machine would change stored projects, so it was not done without a migration |
| Executive sections 4, 6 (assign designer), 14 (materials inventory), 15–17 (AI providers, notifications, support centre), 19–20 (monitoring and audit viewer in the offline file) | PARTIALLY_IMPLEMENTED / NOT_IMPLEMENTED | Server-side pieces exist: AI usage endpoint, admin health, notification service, audit events. **Support tickets and materials inventory do not exist** |
| Customer workspace grid/list/timeline views, 3D thumbnails on cards | NOT_IMPLEMENTED | Cards show a size badge, not a rendered thumbnail |
| Logo upload, English for the whole application (only the welcome page is bilingual offline) | NOT_IMPLEMENTED | |
| PostgreSQL, RLS | NOT_IMPLEMENTED | Unavailable here (see `docs/MASTER_AUDIT.md`) |

## 4. Where enforcement happens

- **Server (Next.js app):** roles, ownership, admin sign-in, MFA and Google sign-in are enforced in the API routes.
  The Next.js build is still blocked here by npm, and `scripts/verify-production.sh --strict` is the gate.
- **Hosted artifact:** the shared database applies its access rules (roles, settings and people are writable only by
  the owner/admin). Suspension and maintenance mode are enforced by the page, not by the database. A determined user
  of the hosted artifact could bypass them with developer tools. Use the server application where that matters.
- **Offline file:** one device, one browser. Accounts and PINs separate people sharing a computer; they are not a
  security boundary against the device's owner.
