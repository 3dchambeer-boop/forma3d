"""Run the service:   python -m cad_engine serve [--port 8200]
Build from a file:   python -m cad_engine build design.json --step out.step --stl out.stl [--linear 0.01 --angular 5]
"""

from __future__ import annotations

import argparse
import json
import os
import sys


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="cad_engine")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8200)
    s2 = sub.add_parser("serve-stdlib", help="same API without FastAPI/uvicorn")
    s2.add_argument("--host", default="127.0.0.1")
    s2.add_argument("--port", type=int, default=8200)
    b = sub.add_parser("build")
    b.add_argument("design")
    b.add_argument("--step")
    b.add_argument("--stl")
    b.add_argument("--3mf", dest="threemf")
    b.add_argument("--linear", type=float, default=0.01)
    b.add_argument("--angular", type=float, default=5.0)
    a = ap.parse_args(argv)
    if a.cmd == "serve-stdlib":
        from .server import serve

        srv = serve(a.host, a.port)
        print(f"cad_engine (stdlib) on http://{a.host}:{a.port}", flush=True)
        srv.serve_forever()
        return 0
    if a.cmd == "serve":
        import uvicorn

        uvicorn.run("cad_engine.app:app", host=a.host, port=a.port)
        return 0
    from . import export, occ
    from .plan import CadError

    design = json.load(open(a.design, encoding="utf-8"))
    try:
        shape, _ = occ.build_design(design)
    except CadError as e:
        print(f"CAD error: {e}", file=sys.stderr)
        return 2
    print(json.dumps(occ.solid_report(shape), indent=2))
    if a.step:
        data, check = export.step_bytes(shape)
        open(a.step, "wb").write(data)
        print("STEP", a.step, json.dumps(check))
    if a.stl:
        data, check = export.stl_bytes(shape, a.linear, a.angular)
        open(a.stl, "wb").write(data)
        print("STL", a.stl, json.dumps(check))
    if a.threemf:
        open(a.threemf, "wb").write(export.threemf_bytes(shape, os.path.basename(a.design), a.linear, a.angular))
    return 0


if __name__ == "__main__":
    sys.exit(main())
