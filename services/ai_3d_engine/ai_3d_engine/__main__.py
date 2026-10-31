"""Command line: the same pipelines the HTTP API runs, for local use and acceptance tests.

  python -m ai_3d_engine generate "حامل هاتف بعرض 90 مم ..." -o stand.stl
  python -m ai_3d_engine convert model.glb --target-longest 120 -o model.stl
  python -m ai_3d_engine validate part.stl
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .sandbox import SandboxError, run_isolated


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ai_3d_engine")
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("generate", help="text → validated STL via a parametric template")
    g.add_argument("prompt")
    g.add_argument("-o", "--output", required=True)
    g.add_argument("--template")
    g.add_argument("--field", action="append", default=[], metavar="NAME=VALUE", help="override a parameter")
    g.add_argument("--no-llm", action="store_true")

    c = sub.add_parser("convert", help="GLB/OBJ/STL → validated millimetre STL")
    c.add_argument("input")
    c.add_argument("-o", "--output", required=True)
    c.add_argument("--units", choices=["mm", "cm", "m", "in"])
    c.add_argument("--up", choices=["y", "z"])
    c.add_argument("--target-longest", type=float)

    v = sub.add_parser("validate", help="report only, no file written")
    v.add_argument("input")

    args = ap.parse_args(argv)
    try:
        if args.cmd == "generate":
            fields = {}
            for item in args.field:
                k, _, val = item.partition("=")
                fields[k] = float(val)
            out = run_isolated("parametric", {"prompt": args.prompt, "user_fields": fields,
                                              "template": args.template, "use_llm": not args.no_llm})
        elif args.cmd == "convert":
            out = run_isolated("mesh", {"data": Path(args.input).read_bytes(), "filename": Path(args.input).name,
                                        "source_units": args.units, "up_axis": args.up,
                                        "target_longest_mm": args.target_longest})
        else:
            out = run_isolated("mesh", {"data": Path(args.input).read_bytes(), "filename": Path(args.input).name,
                                        "source_units": "mm", "up_axis": "z"})
            out.pop("stl")
            print(json.dumps(out["metadata"], ensure_ascii=False, indent=2))
            return 0
    except SandboxError as exc:
        print(json.dumps({"error": exc.code, "message": exc.message, "details": exc.details}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 2
    Path(args.output).write_bytes(out["stl"])
    md = out["metadata"]
    summary = {k: md.get(k) for k in ("status", "size_mm", "triangles", "stl_sha256", "transforms", "duration_ms")}
    summary["output"] = str(args.output)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
