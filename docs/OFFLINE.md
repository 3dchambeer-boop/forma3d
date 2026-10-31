# Offline single file — `forma-offline.html`

Built by `services/ai_3d_engine/browser/build.py`. One HTML file, no external requests
(no CDN, no web fonts, no claude.ai). Double-click it in Chrome, Edge or Firefox.

| Part | Offline behaviour |
|---|---|
| CAD kernel, mesh validation, STL export | built in (same code as the server/online builds) |
| Measured checks, DFM, print estimate | built in |
| 3D viewer, measuring tool, DFM colouring | built-in WebGL viewer (`viewer.js`), no Three.js |
| Data | IndexedDB in this browser on this device; backup/restore as JSON from Admin |
| Accounts & roles | local accounts with optional PIN; first account is admin; customers can self-register on the device |
| AI designer | needs a model: offline = Ollama (`OLLAMA_ORIGINS=*`, a JSON-capable model such as `qwen2.5-coder:14b`), configured in Admin. Without it: 5 ready parametric designs, design-file import, direct FormaCAD editing |
| OctoPrint | direct REST from the page (enable CORS in OctoPrint → Settings → API). API key stored in this browser only, never in backups. Upload G-code (does not start), start only after checklist + confirm, live temperatures/progress, remote stop |
| Slicing | not in the browser: slice in OrcaSlicer, then upload the G-code from the job card |

Opened inside claude.ai the same file switches to the artifact runtime (shared database, Claude as designer).

Not verified against real hardware here: OctoPrint and Ollama were exercised against local simulators
implementing their documented REST APIs. Browsers may ask permission before a local file talks to
devices on the local network.
