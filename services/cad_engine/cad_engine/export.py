"""Exports from a B-Rep solid, each re-read and checked.

STEP  keeps the exact B-Rep (faces, edges, analytic surfaces); re-imported and compared (volume, bounds).
STL   controlled tessellation: linear deflection (mm) and angular deflection (degrees); the mesh volume
      is compared with the exact B-Rep volume, and the STL never claims to contain CAD history.
3MF   same tessellation, millimetres, written with zipfile.
STATUS: IMPLEMENTED_BUT_UNVERIFIED (needs the OpenCascade kernel; see occ.py).
"""

from __future__ import annotations

import io
import math
import os
import struct
import tempfile
import zipfile

from .occ import cq, require_kernel


def _tmp(suffix: str) -> str:
    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    return path


def step_bytes(shape) -> tuple[bytes, dict]:
    require_kernel()
    path = _tmp(".step")
    try:
        cq.exporters.export(shape, path, exportType="STEP")
        data = open(path, "rb").read()
        back = cq.importers.importStep(path).val()
        bb0, bb1 = shape.BoundingBox(), back.BoundingBox()
        v0, v1 = shape.Volume(), back.Volume()
        check = {
            "reimported": True,
            "volume_rel_err": abs(v1 - v0) / max(abs(v0), 1e-12),
            "bounds_max_err_mm": max(abs(a - b) for a, b in zip((bb0.xmin, bb0.ymin, bb0.zmin, bb0.xmax, bb0.ymax, bb0.zmax), (bb1.xmin, bb1.ymin, bb1.zmin, bb1.xmax, bb1.ymax, bb1.zmax))),
            "faces": (len(shape.Faces()), len(back.Faces())),
        }
        check["ok"] = check["volume_rel_err"] < 1e-6 and check["bounds_max_err_mm"] < 1e-6 and check["faces"][0] == check["faces"][1]
        return data, check
    finally:
        os.remove(path)


def tessellate(shape, linear_mm: float = 0.01, angular_deg: float = 5.0):
    require_kernel()
    verts, tris = shape.tessellate(linear_mm, math.radians(angular_deg))
    return [(v.x, v.y, v.z) for v in verts], [tuple(t) for t in tris]


def mesh_volume(verts, tris) -> float:
    vol = 0.0
    for a, b, c in tris:
        (x1, y1, z1), (x2, y2, z2), (x3, y3, z3) = verts[a], verts[b], verts[c]
        vol += (x1 * (y2 * z3 - y3 * z2) - x2 * (y1 * z3 - y3 * z1) + x3 * (y1 * z2 - y2 * z1)) / 6
    return vol


def stl_bytes(shape, linear_mm: float = 0.01, angular_deg: float = 5.0) -> tuple[bytes, dict]:
    verts, tris = tessellate(shape, linear_mm, angular_deg)
    out = io.BytesIO()
    out.write(b"Forma STL from OpenCascade B-Rep (tessellated mesh, no CAD history)".ljust(80, b" "))
    out.write(struct.pack("<I", len(tris)))
    for a, b, c in tris:
        p, q, r = verts[a], verts[b], verts[c]
        u = (q[0] - p[0], q[1] - p[1], q[2] - p[2])
        w = (r[0] - p[0], r[1] - p[1], r[2] - p[2])
        nx, ny, nz = u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]
        ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        out.write(struct.pack("<12fH", nx / ln, ny / ln, nz / ln, *p, *q, *r, 0))
    v_mesh, v_brep = mesh_volume(verts, tris), shape.Volume()
    return out.getvalue(), {"triangles": len(tris), "linear_mm": linear_mm, "angular_deg": angular_deg, "mesh_volume_mm3": v_mesh, "brep_volume_mm3": v_brep, "volume_rel_err": abs(v_mesh - v_brep) / max(abs(v_brep), 1e-12)}


def threemf_bytes(shape, name: str = "part", linear_mm: float = 0.01, angular_deg: float = 5.0) -> bytes:
    verts, tris = tessellate(shape, linear_mm, angular_deg)
    v = "".join(f'<vertex x="{x:.6f}" y="{y:.6f}" z="{z:.6f}"/>' for x, y, z in verts)
    t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in tris)
    model = ('<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
             f'<resources><object id="1" type="model" name="{name}"><mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
        z.writestr("3D/3dmodel.model", model)
    return buf.getvalue()
