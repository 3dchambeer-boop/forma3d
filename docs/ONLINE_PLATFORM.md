# Online platform (artifact build)

`services/ai_3d_engine/browser/platform.html` (built by `build.py` from `designer.template.html`
via `make_platform.py` + `platform.js`) is the whole platform as one page hosted on claude.ai:

| Role | Can do |
|---|---|
| Customer | describe an idea → AI designer asks questions → design is built, measured, DFM-checked → save / submit for review → request a print (material, quantity) → follow status |
| Designer (reviewer) | review queue, edit parameters or ask the AI to revise, save a new revision, approve (failed checks need a written reason, recorded) or request changes |
| Print operator | accept requests onto a printer, download the approved files (STL rebuilt from the approved source and compared to its SHA-256, print sheet, report), pre-start checklist + explicit confirmation, mark done (actual grams) or failed (reason) |
| Admin (artifact owner/editors) | everything above, people & roles, material prices, statistics, activity, "view as" any role |

Data (artifact db): `projects/{id}` (+ `revisions/r{n}`), `jobs/{id}`, `printers/{id}`, `roles/{userId}`,
`people/{userId}`, `settings/main`. Access rules: roles, settings and people are admin-write
(each person may register only themselves in `people`). Workflow rules are enforced in the page;
the Next.js server build enforces RBAC per request.

The STL is not stored: the approved FormaCAD source is, and the deterministic kernel rebuilds the
identical file (hash checked before printing).

**Printer link:** the artifact sandbox blocks network calls to any host, and browsers block an
https page from reaching a LAN printer, so this build cannot drive OctoPrint. The operator uploads the
G-code in OctoPrint (link from the printer row) and confirms each step on the platform. Direct
upload/start with confirmation is implemented in the server build (`src/lib/printing`, docs/PRINTING.md).
