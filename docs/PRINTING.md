# Slicing and printing

```
designer APPROVES revision ──▶ owner: "Request print" (POST /api/print-jobs) ──▶ job APPROVED
farm manager: Slice      (POST /api/print-jobs/{id}/slice)     ──▶ SLICED        G-code in private storage, sha256 recorded
farm manager: Upload     (POST /api/print-jobs/{id}/dispatch)  ──▶ AWAITING_PRINT_CONFIRMATION  file on OctoPrint, size verified, selected
farm manager: Start      (POST /api/print-jobs/{id}/start {"confirm":true}) ──▶ PRINTING   readiness re-checked live
status                   (GET  /api/print-jobs/{id}/status)    ──▶ COMPLETED only when OctoPrint shows our file at 100 %
control                  (POST /api/print-jobs/{id}/control {"action":"cancel"|"pause"|"resume"})
```

Gates enforced on the server: designer approval; STL present and not `REPAIR_REQUIRED`; material, nozzle and
build volume match; G-code checksum equals the sliced file; G-code sanity check (motion + heater commands);
printer connected, operational, ready and idle. Every command and observed state change is written to
`PrinterEvent` and the audit log. A lost connection never marks a print failed or finished.

## OrcaSlicer

Status: implemented from the CLI documentation, **not yet run against a real binary**.

1. Install the OrcaSlicer build for the server OS and set `ORCASLICER_BIN` to the executable.
2. In OrcaSlicer (GUI), select your Ender-3 printer, PLA filament and a 0.20 mm process, then export the
   three presets as JSON (printer/machine, process, filament). Place them in
   `$ORCASLICER_PROFILE_DIR/ender3-pla-0.20/{machine,process,filament}.json` — the seed creates a slicing
   profile pointing at exactly these paths.
3. Acceptance check (outside the app):
   ```bash
   orca-slicer --slice 0 \
     --load-settings "$ORCASLICER_PROFILE_DIR/ender3-pla-0.20/machine.json;$ORCASLICER_PROFILE_DIR/ender3-pla-0.20/process.json" \
     --load-filaments "$ORCASLICER_PROFILE_DIR/ender3-pla-0.20/filament.json" \
     --outputdir /tmp/orca-out --export-3mf result.gcode.3mf phone_stand.stl
   ls /tmp/orca-out    # expect result.gcode.3mf (G-code at Metadata/plate_1.gcode) or a .gcode file
   ```
   If your build writes different file names, adjust `runOrcaSlicer` in `src/lib/orcaslicer.ts`; the
   adapter accepts either a loose `.gcode` or the `plate_N.gcode` inside the 3MF.
4. Isolation: the slicer runs with a minimal environment (no app secrets), its own temporary directory,
   a hard timeout (`ORCASLICER_TIMEOUT_MS`) and SIGKILL on expiry. For stronger isolation run it in its own
   container and call it through a small job runner; that container was not built here.

## OctoPrint (Raspberry Pi gateway)

1. In OctoPrint: Settings → Application Keys (or the global API key) → create a key for FORMA·3D.
2. On the server: `OCTOPRINT_KEY_ENDER3_01=<key>` in `.env`.
3. Printer row: `octoprintUrl=http://<pi-address>`, `octoprintApiKeyRef=OCTOPRINT_KEY_ENDER3_01`
   (`SEED_PRINTER_*` variables in `prisma/seed.ts` create it).
4. First real test: slice a small part (spacer template, 20 × 20 × 5 mm), upload, confirm start, watch
   `/api/print-jobs/{id}/status` until COMPLETED.

The client was verified against a local simulator of the documented REST API
(`tests/node/octoprint.test.ts`): authentication errors, upload size verification, refusal of unsafe file
names, readiness flags, start conflicts, completion detection and unreachable hosts.
