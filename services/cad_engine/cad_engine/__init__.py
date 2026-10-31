"""cad_engine — B-Rep CAD service for Forma (OpenCascade through CadQuery/OCP).

Layers:
  plan.py  FormaCAD JSON -> evaluated operation tree (pure Python, no kernel needed)
  occ.py   operation tree -> OpenCascade B-Rep solid (needs cadquery / OCP)
  export.py STEP / STL (controlled tessellation) / 3MF, with re-import checks
  app.py   HTTP API (FastAPI)

The browser kernel (services/ai_3d_engine/browser/cad.js) stays the default; this service adds
true B-Rep: exact fillets and chamfers on any edges, shell, offset, draft, and STEP export.
"""

__version__ = "0.1.0"
