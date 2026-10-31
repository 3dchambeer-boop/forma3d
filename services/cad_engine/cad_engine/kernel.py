"""One entry point for both OpenCascade backends: CadQuery/OCP (occ.py) or the native executor (native.py).

build(design, overrides, formats, quality) -> {"report", "stats", "exports": {fmt: {"check", "data"}}}
The backend is chosen by CAD_KERNEL=cadquery|native, otherwise whichever is installed (CadQuery first).
"""

from __future__ import annotations

import io
import os
import struct
import zipfile

from . import native


def available() -> dict:
    from . import occ

    return {"cadquery": occ.KERNEL, "native": native.kernel_name()}


def backend() -> str | None:
    want = os.environ.get("CAD_KERNEL", "").lower()
    av = available()
    if want in av:
        return want if av[want] else None
    return "cadquery" if av["cadquery"] else "native" if av["native"] else None


def stl_to_3mf(stl: bytes, name: str = "part") -> bytes:
    """Binary STL -> 3MF (millimetres), with shared vertices."""
    n = struct.unpack_from("<I", stl, 80)[0]
    verts, index, tris = [], {}, []
    for i in range(n):
        vals = struct.unpack_from("<12f", stl, 84 + 50 * i)
        ids = []
        for k in range(3):
            v = tuple(round(x, 6) for x in vals[3 + 3 * k: 6 + 3 * k])
            if v not in index:
                index[v] = len(verts)
                verts.append(v)
            ids.append(index[v])
        tris.append(ids)
    esc = name.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
    v = "".join(f'<vertex x="{x:.6f}" y="{y:.6f}" z="{z:.6f}"/>' for x, y, z in verts)
    t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in tris)
    model = ('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
             f'<resources><object id="1" type="model" name="{esc}"><mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
        z.writestr("3D/3dmodel.model", model)
    return buf.getvalue()


def build(design: dict, overrides: dict | None = None, formats=("step",), quality: dict | None = None) -> dict:
    q = quality or {"linear_mm": 0.01, "angular_deg": 5.0}
    which = backend()
    if which is None:
        raise RuntimeError("no OpenCascade backend: install CadQuery or build services/cad_engine/native (docs/CAD_ENGINE.md)")
    fmts = list(formats)
    if which == "native":
        need = sorted({("stl" if f == "3mf" else f) for f in fmts})
        out = native.build_design(design, overrides, need, q)
        exports = {}
        for f in fmts:
            if f == "3mf":
                exports["3mf"] = {"check": out["exports"]["stl"]["check"], "data": stl_to_3mf(out["exports"]["stl"]["data"], design.get("name_ar") or "part")}
            else:
                exports[f] = out["exports"][f]
        return {"report": out["report"], "stats": out["stats"], "exports": exports, "backend": "native"}
    from . import export, occ

    shape, p = occ.build_design(design, overrides)
    exports = {}
    for f in fmts:
        if f == "step":
            data, check = export.step_bytes(shape)
        elif f == "stl":
            data, check = export.stl_bytes(shape, q["linear_mm"], q["angular_deg"])
        else:
            data, check = export.threemf_bytes(shape, design.get("name_ar") or "part", q["linear_mm"], q["angular_deg"]), {}
        exports[f] = {"check": check, "data": data}
    return {"report": occ.solid_report(shape), "stats": p["stats"], "exports": exports, "backend": "cadquery"}


def import_step(data: bytes, formats=("stl",), quality: dict | None = None, place_on_bed: bool = True) -> dict:
    """STEP import runs on the native OpenCascade executor (the CadQuery backend has no import path here)."""
    if not native.binary():
        raise RuntimeError("STEP import needs the native OpenCascade executor (forma_occ)")
    fmts = [f for f in formats if f != "3mf"]
    out = native.import_step(data, fmts, quality, place_on_bed)
    if "3mf" in formats:
        stl = out["exports"].get("stl") or native.import_step(data, ["stl"], quality, place_on_bed)["exports"]["stl"]
        out["exports"]["3mf"] = {"check": stl["check"], "data": stl_to_3mf(stl["data"])}
    out["backend"] = "native"
    return out
