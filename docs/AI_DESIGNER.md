# AI designer (generative, any idea)

The template library is only a fast path. Any idea goes to the AI designer:

1. **Clarify** — `POST /api/designer/clarify` (or the browser studio) sends the idea to Claude,
   which returns what it understood plus up to ~5 precise questions (dimensions, the object it
   must fit, load, mounting, tolerances) with suggested answers. At most 2 rounds.
2. **Design** — Claude writes a parametric **FormaCAD** model (JSON data, never code):
   named parameters with min/max, shapes (box, cylinder, sphere, extrude, revolve, torus,
   rounded rect…), booleans, transforms, arrays, and print settings.
3. **Build** — the deterministic kernel (`services/ai_3d_engine/browser/cad.js`) evaluates
   expressions with a safe parser (no `eval`), applies hard limits, and runs BSP CSG.
4. **Validate** — watertight / manifold / single body / printer volume, then the exported
   STL is re-read and validated again.
5. **Repair** — any build or validation error goes back to Claude with the exact location
   (`model.union[0].box.size`), up to 2–3 times. If it still fails, the job fails honestly.
6. **Inspect** (browser studio) — 4 rendered views go to Claude for a visual review; a fix is
   kept only if it still validates.
7. **Edit** — parameters change size without calling the model; a text request revises the design.

## Where it runs
- Published studio artifact “مصمّم فورما”: runs entirely in the browser and calls Claude through
  the artifact `sample` capability (the viewer's own Claude account; no key in the page).
- Full site: mode “AI designer” in the new-project view → job provider `AI_DESIGNER`,
  server-side calls with `ANTHROPIC_API_KEY`.

## Tested vs not tested
- Tested: CAD language, 5+ non-template designs validate, repair loop, inspection logic, worker
  integration, Messages-API request format (against a local mock server). 45 Node + 48 Python tests.
- Not tested in the build sandbox: real Claude replies (no internet there) and the Three.js
  inspection renderer (CDN blocked). Quality of real designs depends on the model; verify before printing.

## Measured verification, manufacturability, estimate (`browser/analysis.js`)
Runs on the exported STL after every build (also when the customer changes a parameter):
- **Requirement checks** — the designer must emit `checks` (`size`, `gap`, `wall`, `empty`, `solid`)
  with points/expected values as parameter expressions. They are measured by ray casting
  through the final mesh (3 slightly offset rays, median). A failed check goes back to the
  designer for repair with expected vs measured numbers.
- **DFM** — local wall thickness per face (inward ray), overhangs > 45° away from the bed,
  bed contact area. Walls under 2 nozzle widths over > 5 mm² trigger repair. Faces are flagged
  for colouring in the viewer.
- **Print estimate** — plastic volume (3 perimeters + infill), mass by material density,
  filament length, layers, time for an Ender-3 class printer (±25%, no supports), cost
  from a price per kg the user sets. The slicer remains the authority.
- **Standard parts table** in the design prompt (ISO nuts/screws, bearings, pipes, batteries)
  so standard dimensions are never guessed.
The viewer adds a two-point measuring tool (snaps to nearby mesh vertices) and DFM colouring.
