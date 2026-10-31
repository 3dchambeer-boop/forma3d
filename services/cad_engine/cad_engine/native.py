"""OpenCascade through the native executor (services/cad_engine/native/forma_occ, C++ against OCCT).

Same plan, same reports and the same export checks as the CadQuery backend (occ.py/export.py), but no
Python bindings are needed: only the OCCT shared libraries and the compiled `forma_occ` binary.
Binary location: $FORMA_OCC_BIN, else services/cad_engine/native/build/forma_occ[.exe].
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from .plan import CadError, design_plan

HERE = Path(__file__).resolve().parent.parent


def binary() -> str | None:
    env = os.environ.get("FORMA_OCC_BIN")
    if env and Path(env).is_file():
        return env
    for name in ("forma_occ", "forma_occ.exe"):
        p = HERE / "native" / "build" / name
        if p.is_file():
            return str(p)
    return shutil.which("forma_occ")


def kernel_name() -> str | None:
    b = binary()
    if not b:
        return None
    try:
        out = run({"tree": {"op": "box", "size": [1, 1, 1], "center": False, "path": "health"}, "formats": []})
        return out["report"]["kernel"] + " (native)"
    except Exception:  # noqa: BLE001 - a broken install reports as missing
        return None


def run(request: dict, timeout: float = 300, step_input: bytes | None = None) -> dict:
    b = binary()
    if not b:
        raise RuntimeError("forma_occ is not built; see docs/CAD_ENGINE.md (native executor)")
    with tempfile.TemporaryDirectory(prefix="forma_occ_") as d:
        request = dict(request, out_dir=d)
        if step_input is not None:  # the file to import is written inside the private temp dir, never a caller path
            src = Path(d) / "input.step"
            src.write_bytes(step_input)
            request["import"] = dict(request.get("import") or {}, step=str(src))
        p = subprocess.run([b], input=json.dumps(request).encode(), capture_output=True, timeout=timeout)
        try:
            out = json.loads(p.stdout.decode() or "{}")
        except json.JSONDecodeError:
            raise RuntimeError(f"forma_occ crashed (exit {p.returncode}): {p.stderr.decode()[:500]}") from None
        if not out.get("ok"):
            err = out.get("error") or {}
            raise CadError(err.get("path", "model"), err.get("message") or f"forma_occ failed (exit {p.returncode})")
        for fmt, e in (out.get("exports") or {}).items():
            e["data"] = Path(e.pop("file")).read_bytes()
        return out


def build_design(design: dict, overrides: dict | None = None, formats=("step",), quality: dict | None = None) -> dict:
    p = design_plan(design, overrides)
    out = run({"tree": p["tree"], "place_on_bed": True, "formats": list(formats), "quality": quality or {"linear_mm": 0.01, "angular_deg": 5}})
    out["stats"] = p["stats"]
    return out


def import_step(data: bytes, formats=("stl",), quality: dict | None = None, place_on_bed: bool = True, max_faces: int = 200_000) -> dict:
    """Read a STEP file with OpenCascade: millimetres, healed, one or more valid closed solids; then export."""
    head = data[:2048].lstrip()
    if not head.startswith(b"ISO-10303-21"):
        raise CadError("import", "not a STEP file (ISO-10303-21 header missing)")
    return run({"import": {"max_faces": int(max_faces)}, "place_on_bed": place_on_bed, "formats": list(formats),
                "quality": quality or {"linear_mm": 0.01, "angular_deg": 5}}, step_input=data)
