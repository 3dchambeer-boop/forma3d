# OpenCascade CAD service (`services/cad_engine`)

**Status (Phase 9):**
- **Native backend (`native/forma_occ.cpp` + `native.py`, stdlib HTTP service `server.py`): IMPLEMENTED_AND_TESTED**
  on OpenCascade 7.8.1 built from source: 28 tests on the real kernel (55 of the 56 CAD-engine tests pass; the skip is the CadQuery backend) (exact volumes against closed forms: Steiner
  fillet box, chamfer box, Pappus revolves, offset, shell, draft frustum, loft, sweep; STEP AP214 written, re-read and
  compared; invalid geometry refused with its model path; HTTP service auth/CORS), plus the browser STEP button driven
  end to end in Chromium against the running service.
- CadQuery backend (`occ.py`, `export.py`) and the FastAPI app (`app.py`): IMPLEMENTED_BUT_UNVERIFIED (CadQuery and
  FastAPI could not be installed in the build environment). Same plan, same contract; the kernel selector uses CadQuery
  when present, otherwise the native executor (`CAD_KERNEL=native|cadquery` forces one).

Bugs the real kernel found (all fixed, each with a regression test): sweep points were overwritten by the node's
error-location key (both backends); `ShapeUpgrade_UnifySameDomain` returned a valid-looking solid that had lost
1320 mm³ (now accepted only when valid and volume-preserving); OCCT printed STEP statistics into the JSON reply;
Chromium needs `Origin: file://` and Private Network Access answers for the offline file.

## What it adds over the browser kernel

| | Browser kernel (`cad.js`) | OpenCascade service |
|---|---|---|
| Geometry | polygon mesh (BSP CSG) | exact B-Rep (analytic faces) |
| Profile fillets / chamfers | exact arcs, then tessellated | exact arcs kept as circular edges |
| Fillet / chamfer of any edge (`fillet_edges`, `chamfer_edges`) | no | yes, by selector (`|Z`, `>Z`, `all`, `{"near":[[x,y,z]]}`) |
| `shell`, `offset`, `draft` | no | yes |
| STEP | no (a mesh has no B-Rep) | yes, re-opened and compared (volume, bounds, face count) |
| STL / 3MF | yes | yes, with linear and angular deflection you choose |

The same FormaCAD JSON drives both. Designs that use B-Rep-only operations build only in the service.

## Build the native backend (Linux, what Phase 9 ran)
```
scripts/build-occt-native.sh            # OCCT 7.8.1 from source (needed toolkits only) + forma_occ, ~25 min on 2 cores
export LD_LIBRARY_PATH=$PWD/.occt/build/lin64/gcc/lib
cd services/cad_engine && python3 -m pytest -q tests/test_native.py
CAD_SERVICE_TOKEN=<openssl rand -hex 32> python3 -m cad_engine serve-stdlib --host 127.0.0.1 --port 8200
```
Docker: `services/cad_engine/Dockerfile` (the `cad` service in docker-compose.yml) does the same build in an image.

## Install on Windows (one time, CadQuery backend)

Option A (recommended): Miniforge.
1. Install Miniforge from https://github.com/conda-forge/miniforge (Windows x86_64).
2. Open "Miniforge Prompt":
   ```
   conda create -n forma-cad -c conda-forge python=3.11 cadquery
   conda activate forma-cad
   pip install "fastapi>=0.110" "uvicorn[standard]>=0.29" "pydantic>=2.6" pytest
   ```

Option B: plain Python 3.11 (64-bit).
```
py -3.11 -m venv C:\forma-cad
C:\forma-cad\Scripts\activate
pip install -r services\cad_engine\requirements.txt pytest
```

## Verify (this is what moves it to IMPLEMENTED_AND_TESTED)
```
cd services\cad_engine
python -m pytest -q
```
Expected: every test passes, including `tests/test_occ.py` (fillet box = Steiner volume to 1e-6,
exact profile fillets and chamfers, edge fillets, shell, offset, draft, loft, sweep, hex prism,
STEP round trip, controlled STL, and the 11 ready designs within 1.5 % of the browser kernel).
Send the output back if anything fails.

## Run

Single user on this PC (the offline file talks to it):
```
set CAD_ALLOW_NO_AUTH=1
set CAD_ALLOWED_ORIGINS=null,http://localhost:3000
python -m cad_engine serve --port 8200
```
Then, in forma-offline.html: Admin → «خدمة CAD (OpenCascade)» → `http://127.0.0.1:8200` → test.
The studio's export menu then offers STEP.

Server (Next.js app):
```
CAD_SERVICE_TOKEN=<openssl rand -hex 32>   # same value in the app's .env
python -m cad_engine serve --host 127.0.0.1 --port 8200
```
App `.env`: `CAD_ENGINE_URL=http://127.0.0.1:8200` and `CAD_SERVICE_TOKEN=…`.
Download: `GET /api/generations/<job id>/export?format=step` (also `stl`, `3mf`; `&quality=fine`).

Command line:
```
python -m cad_engine build design.formacad.json --step part.step --stl part.stl --linear 0.01 --angular 5
```

## B-Rep-only operations (FormaCAD)
```
{"fillet_edges":  {"r": 2, "edges": "|Z", "child": node}}
{"chamfer_edges": {"d": 1, "edges": {"near": [[20, 0, 0]]}, "child": node}}
{"shell":         {"thickness": 2, "open": ">Z", "child": node}}
{"offset":        {"distance": 1, "child": node}}
{"draft":         {"angle": 2, "faces": "#Z", "neutral_z": 0, "child": node}}    side faces (normal ⟂ Z), the default
```
A fillet, chamfer or shell the geometry cannot take fails with the model path
(`model.fillet_edges: fillet r=6 mm failed on 12 edge(s) …`) instead of producing corrupted geometry.

## Licences
nlohmann/json (vendored in native/third_party): MIT. CadQuery: Apache-2.0. OCP: Apache-2.0. OpenCascade Technology: LGPL-2.1 with the OCCT exception
(used as a dynamically linked library by a separate service; no changes to OCCT).
