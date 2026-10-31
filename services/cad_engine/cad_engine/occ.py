"""Execute a plan (plan.py) in OpenCascade through CadQuery/OCP -> one B-Rep solid.

STATUS: IMPLEMENTED_BUT_UNVERIFIED. Written against the CadQuery 2.4 / OCP 7.7 APIs; it has not been
run in the environment where it was written (no package access there). tests/test_occ.py exercises
every operation with exact analytic checks; run it after `pip install -r requirements.txt`.

Every operation is wrapped so a kernel failure (StdFail_NotDone, invalid result, empty boolean)
becomes a CadError naming the model path instead of a corrupted or silent result.
"""

from __future__ import annotations

import math
from typing import Any

try:  # the kernel is optional at import time so plan.py tests and the API's /health work without it
    import cadquery as cq
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepOffsetAPI import BRepOffsetAPI_DraftAngle, BRepOffsetAPI_MakeOffsetShape
    from OCP.gp import gp_Dir, gp_Pln, gp_Pnt

    KERNEL = f"cadquery {cq.__version__}"
except ImportError as _e:  # pragma: no cover - depends on the machine
    cq = None
    KERNEL = None
    _IMPORT_ERROR = _e

from .plan import CadError

PLANE_OF_AXIS = {"x": "YZ", "y": "XZ", "z": "XY"}


def require_kernel() -> None:
    if cq is None:
        raise RuntimeError(
            "OpenCascade is not installed: pip install -r services/cad_engine/requirements.txt "
            "(or conda install -c conda-forge cadquery). See docs/CAD_ENGINE.md."
        )


def _v(p) -> "cq.Vector":
    return cq.Vector(float(p[0]), float(p[1]), float(p[2]) if len(p) > 2 else 0.0)


def _wire(profile: dict, plane: Any = "XY") -> "cq.Workplane":
    """Closed wire from a plan profile (lines + exact three-point arcs) on a workplane."""
    wp = cq.Workplane(plane).moveTo(*profile["start"])
    segs = list(profile["segs"])
    if segs and segs[-1][0] == "line" and math.dist(segs[-1][1], profile["start"]) < 1e-9:
        segs = segs[:-1]  # close() draws the final edge back to the start
    for s in segs:
        if s[0] == "line":
            wp = wp.lineTo(*s[1])
        else:
            wp = wp.threePointArc(tuple(s[1]), tuple(s[2]))
    return wp.close()


def _clean(shape):
    try:
        return shape.clean()
    except Exception:  # noqa: BLE001 - clean() is a cosmetic step; keep the raw result
        return shape


def _check(shape, path: str, what: str):
    if shape is None or shape.isNull():
        raise CadError(path, f"{what} produced no geometry")
    if not BRepCheck_Analyzer(shape.wrapped).IsValid():
        raise CadError(path, f"{what} produced invalid geometry")
    return shape


def _select_edges(shape, sel, path: str):
    wp = cq.Workplane("XY").add(shape)
    if isinstance(sel, dict):
        edges = [wp.edges(cq.selectors.NearestToPointSelector(tuple(p))).val() for p in sel["near"]]
    elif sel == "all":
        edges = wp.edges().vals()
    else:
        edges = wp.edges(sel).vals()
    if not edges:
        raise CadError(path, f"selector {sel!r} matched no edges")
    return edges


def _select_faces(shape, sel, path: str):
    wp = cq.Workplane("XY").add(shape)
    faces = wp.faces().vals() if sel == "all" else wp.faces(sel).vals()
    if not faces:
        raise CadError(path, f"selector {sel!r} matched no faces")
    return faces


def _apply_tf(shape, tf: dict):
    if not tf:
        return shape
    if "scale" in tf:
        shape = shape.scale(tf["scale"])
    if "mirror" in tf:
        shape = shape.mirror(PLANE_OF_AXIS[tf["mirror"]], (0, 0, 0))
    if "rotate" in tf:
        for axis, ang in zip(((1, 0, 0), (0, 1, 0), (0, 0, 1)), tf["rotate"]):
            if ang:
                shape = shape.rotate(cq.Vector(0, 0, 0), cq.Vector(*axis), ang)
    if "translate" in tf:
        shape = shape.translate(_v(tf["translate"]))
    return shape


def _prism(n: int, r1: float, r2: float, h: float):
    poly = lambda r: [(r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n)) for k in range(n)]  # noqa: E731
    if abs(r1 - r2) < 1e-12:
        return cq.Workplane("XY").polyline(poly(r1)).close().extrude(h).val()
    return cq.Workplane("XY").polyline(poly(r1)).close().workplane(offset=h).polyline(poly(max(r2, 1e-6))).close().loft(ruled=True).val()


def build(node: dict):
    """Build one plan node into a cadquery Shape (Solid or Compound)."""
    require_kernel()
    op, path = node["op"], node.get("path", "model")
    try:
        shape = _build(node, op, path)
    except CadError:
        raise
    except Exception as e:  # kernel failures: StdFail_NotDone, Standard_Failure, ValueError from cadquery
        raise CadError(path, f"{op} failed in OpenCascade: {type(e).__name__}: {e}") from None
    shape = _apply_tf(shape, node.get("tf") or {})
    return _check(shape, path, op)


def _build(n: dict, op: str, path: str):
    if op == "box":
        return cq.Workplane("XY").box(*n["size"], centered=n["center"]).val()
    if op == "fillet_box":
        return cq.Workplane("XY").box(*n["size"], centered=n["center"]).edges().fillet(n["r"]).val()
    if op == "chamfer_box":
        return cq.Workplane("XY").box(*n["size"], centered=n["center"]).edges().chamfer(n["d"]).val()
    if op == "cylinder":
        base = cq.Vector(0, 0, -n["h"] / 2 if n["center"] else 0)
        if abs(n["r1"] - n["r2"]) < 1e-12:
            return cq.Solid.makeCylinder(n["r1"], n["h"], base, cq.Vector(0, 0, 1))
        return cq.Solid.makeCone(n["r1"], n["r2"], n["h"], base, cq.Vector(0, 0, 1))
    if op == "prism":
        s = _prism(n["n"], n["r1"], n["r2"], n["h"])
        return s.translate(cq.Vector(0, 0, -n["h"] / 2)) if n["center"] else s
    if op == "sphere":
        return cq.Workplane("XY").sphere(n["r"]).val()
    if op == "torus":
        return cq.Workplane("XZ").moveTo(n["R"], 0).circle(n["r"]).revolve(360, (0, 0, 0), (0, 1, 0)).val()
    if op == "extrude":
        z0 = n.get("z0", 0.0)
        solid = _wire(n["profile"], cq.Plane(origin=(0, 0, z0), xDir=(1, 0, 0), normal=(0, 0, 1))).extrude(n["h"]).val()
        for hp in n["holes"]:
            cut = _wire(hp, cq.Plane(origin=(0, 0, z0 - 1), xDir=(1, 0, 0), normal=(0, 0, 1))).extrude(n["h"] + 2).val()
            solid = solid.cut(cut)
        return _clean(solid)
    if op == "revolve":
        return _wire(n["profile"], "XZ").revolve(360, (0, 0, 0), (0, 1, 0)).val()
    if op == "loft":
        secs = n["sections"]
        wp = cq.Workplane(cq.Plane(origin=(0, 0, secs[0]["z"]), xDir=(1, 0, 0), normal=(0, 0, 1))).polyline(secs[0]["points"]).close()
        for prev, sec in zip(secs, secs[1:]):
            wp = wp.workplane(offset=sec["z"] - prev["z"]).polyline(sec["points"]).close()
        return wp.loft(ruled=True, combine=True).val()
    if op == "sweep":
        pts = n["spine"]
        d0 = (cq.Vector(*pts[1]) - cq.Vector(*pts[0])).normalized()
        ref = cq.Vector(0, 0, 1) if abs(d0.z) < 0.9 else cq.Vector(1, 0, 0)
        u = ref.cross(d0).normalized()  # same frame as the browser kernel: profile x along u, y along d0 x u
        plane = cq.Plane(origin=_v(pts[0]), xDir=u, normal=d0)
        path_wire = cq.Wire.makePolygon([_v(p) for p in pts])
        return _wire(n["profile"], plane).sweep(path_wire, transition="right").val()
    if op in ("union", "difference", "intersection"):
        kids = [build(c) for c in n["children"]]
        acc = kids[0]
        for k in kids[1:]:
            acc = acc.fuse(k) if op == "union" else acc.cut(k) if op == "difference" else acc.intersect(k)
        acc = _clean(acc)
        if acc.Volume() <= 1e-9:
            raise CadError(path, f"{op} left no material (check the order of a difference, or that intersecting parts overlap)")
        return acc
    if op == "linear_array":
        base, acc = build(n["child"]), None
        for k in range(n["count"]):
            c = base.translate(cq.Vector(*(s * k for s in n["step"])))
            acc = c if acc is None else acc.fuse(c)
        return _clean(acc)
    if op == "polar_array":
        base, acc = build(n["child"]), None
        for k in range(n["count"]):
            c = base.rotate(cq.Vector(0, 0, 0), cq.Vector(0, 0, 1), n["step_deg"] * k)
            acc = c if acc is None else acc.fuse(c)
        return _clean(acc)
    if op == "mirror_copy":
        base = build(n["child"])
        return _clean(base.fuse(base.mirror(PLANE_OF_AXIS[n["axis"]], (0, 0, 0))))
    if op == "fillet_edges":
        base = build(n["child"])
        edges = _select_edges(base, n["edges"], path)
        try:
            out = base.fillet(n["r"], edges)
        except Exception as e:  # noqa: BLE001
            raise CadError(path, f"fillet r={n['r']} mm failed on {len(edges)} edge(s): the radius is larger than the adjacent faces allow ({type(e).__name__})") from None
        return out
    if op == "chamfer_edges":
        base = build(n["child"])
        edges = _select_edges(base, n["edges"], path)
        try:
            out = base.chamfer(n["d"], None, edges)
        except Exception as e:  # noqa: BLE001
            raise CadError(path, f"chamfer d={n['d']} mm failed on {len(edges)} edge(s): the distance is larger than the adjacent faces allow ({type(e).__name__})") from None
        return out
    if op == "shell":
        base = build(n["child"])
        faces = _select_faces(base, n["open"], path) if n["open"] else []
        try:
            return base.shell(faces, -n["thickness"])
        except Exception as e:  # noqa: BLE001
            raise CadError(path, f"shell {n['thickness']} mm failed: the wall is thicker than the part allows or a fillet is smaller than the wall ({type(e).__name__})") from None
    if op == "offset":
        base = build(n["child"])
        mk = BRepOffsetAPI_MakeOffsetShape()
        mk.PerformByJoin(base.wrapped, n["distance"], 1e-4)
        if not mk.IsDone():
            raise CadError(path, f"offset {n['distance']} mm failed")
        return cq.Shape.cast(mk.Shape())
    if op == "draft":
        base = build(n["child"])
        faces = _select_faces(base, n["faces"], path)
        da = BRepOffsetAPI_DraftAngle(base.wrapped)
        pln = gp_Pln(gp_Pnt(0, 0, n["neutral_z"]), gp_Dir(0, 0, 1))
        for f in faces:
            da.Add(f.wrapped, gp_Dir(0, 0, 1), math.radians(n["angle"]), pln, True)
            if not da.AddDone():
                raise CadError(path, "draft could not be added to a selected face (only planar or ruled side faces can be drafted)")
        da.Build()
        if not da.IsDone():
            raise CadError(path, "draft failed")
        return cq.Shape.cast(da.Shape())
    raise CadError(path, f'operation "{op}" is not supported by the OpenCascade service')


def solid_report(shape) -> dict:
    bb = shape.BoundingBox()
    return {
        "valid": bool(BRepCheck_Analyzer(shape.wrapped).IsValid()),
        "solids": len(shape.Solids()),
        "faces": len(shape.Faces()),
        "edges": len(shape.Edges()),
        "volume_mm3": shape.Volume(),
        "area_mm2": shape.Area(),
        "size_mm": {"x": bb.xlen, "y": bb.ylen, "z": bb.zlen},
        "bounds": {"min": [bb.xmin, bb.ymin, bb.zmin], "max": [bb.xmax, bb.ymax, bb.zmax]},
        "kernel": KERNEL,
    }


def build_design(design: dict, overrides: dict | None = None, place_on_bed: bool = True):
    """Plan + build + place the part with its minimum corner at the origin (like the browser kernel)."""
    from .plan import design_plan

    p = design_plan(design, overrides)
    shape = build(p["tree"])
    if place_on_bed:
        bb = shape.BoundingBox()
        shape = shape.translate(cq.Vector(-bb.xmin, -bb.ymin, -bb.zmin))
    return shape, p
