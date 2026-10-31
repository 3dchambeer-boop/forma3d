"""FormaCAD -> evaluated operation tree (no geometry kernel needed).

Accepts the same JSON language as the browser kernel (services/ai_3d_engine/browser/cad.js) and
evaluates every expression, checks every limit and every fillet/chamfer that can be checked in 2D,
and turns profiles with rounded corners into exact line + circular-arc wires. The output is a plain
tree that occ.py executes in OpenCascade, so everything here is unit-tested without the kernel.

B-Rep-only operations (not available in the mesh kernel):
  {"fillet_edges":  {"r": 2,   "edges": SELECTOR, "child": node}}   true constant-radius edge fillets
  {"chamfer_edges": {"d": 1,   "edges": SELECTOR, "child": node}}
  {"shell":         {"thickness": 2, "open": ">Z" | null, "child": node}}   hollow with uniform wall
  {"offset":        {"distance": 1, "child": node}}                 grow (+) or shrink (-) every face
  {"draft":         {"angle": 2, "faces": "#Z", "neutral_z": 0, "child": node}}   mould draft on side faces
SELECTOR := "all" | "|X" "|Y" "|Z" (parallel) | ">X" "<X" ">Y" "<Y" ">Z" "<Z" (extreme) | "#Z" (perpendicular)
            For faces the direction is the face normal (CadQuery semantics): "|Z" = top/bottom, "#Z" = side faces.
            | {"near": [[x, y, z], ...]}  (the edge nearest each point)
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any

LIMITS = {"nodes": 600, "arrayCount": 200, "booleans": 400, "size": 2000.0, "pathPoints": 500, "profilePoints": 2000}
TRANSFORM_KEYS = {"translate", "rotate", "mirror", "scale", "name", "comment"}
SELECTORS = {"all", "|X", "|Y", "|Z", ">X", "<X", ">Y", "<Y", ">Z", "<Z", "#X", "#Y", "#Z"}
BREP_ONLY = {"fillet_edges", "chamfer_edges", "shell", "offset", "draft"}


class CadError(ValueError):
    """An error that names the exact place in the model, like the browser kernel's CadError."""

    def __init__(self, path: str, message: str):
        super().__init__(f"{path}: {message}")
        self.path = path


# ------------------------------------------------------------------ expressions (same grammar as cad.js)
FUNCS = {
    "sin": lambda d: math.sin(math.radians(d)), "cos": lambda d: math.cos(math.radians(d)), "tan": lambda d: math.tan(math.radians(d)),
    "asin": lambda x: math.degrees(math.asin(x)), "acos": lambda x: math.degrees(math.acos(x)), "atan": lambda x: math.degrees(math.atan(x)),
    "atan2": lambda y, x: math.degrees(math.atan2(y, x)), "sqrt": math.sqrt, "abs": abs, "min": min, "max": max,
    "floor": math.floor, "ceil": math.ceil, "round": lambda x: math.floor(x + 0.5), "pow": math.pow,
}
CONSTS = {"pi": math.pi, "PI": math.pi}
_TOKEN = re.compile(r"\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),%]|\S")


def eval_expr(src: Any, variables: dict[str, float], path: str) -> float:
    if isinstance(src, bool):
        raise CadError(path, f"expected a number or expression, got {src!r}")
    if isinstance(src, (int, float)):
        if not math.isfinite(src):
            raise CadError(path, "number is not finite")
        return float(src)
    if not isinstance(src, str):
        raise CadError(path, f"expected a number or expression, got {src!r}")
    toks = _TOKEN.findall(src)
    pos = 0

    def peek():
        return toks[pos] if pos < len(toks) else None

    def nxt():
        nonlocal pos
        t = peek()
        pos += 1
        return t

    def expect(t):
        if nxt() != t:
            raise CadError(path, f'expected "{t}" in "{src}"')

    def primary():
        t = nxt()
        if t is None:
            raise CadError(path, f'unexpected end of "{src}"')
        if t[0].isdigit():
            return float(t)
        if t == "(":
            v = total()
            expect(")")
            return v
        if t == "-":
            return -factor()
        if t == "+":
            return factor()
        if re.match(r"[A-Za-z_]", t):
            if peek() == "(":
                nxt()
                f = FUNCS.get(t)
                if f is None:
                    raise CadError(path, f'unknown function {t}() in "{src}"')
                args = []
                if peek() != ")":
                    args.append(total())
                    while peek() == ",":
                        nxt()
                        args.append(total())
                expect(")")
                try:
                    return float(f(*args))
                except (ValueError, ZeroDivisionError, OverflowError) as e:
                    raise CadError(path, f'"{src}": {e}') from None
            if t in variables:
                return variables[t]
            if t in CONSTS:
                return CONSTS[t]
            raise CadError(path, f'unknown parameter "{t}" in "{src}"')
        raise CadError(path, f'unexpected "{t}" in "{src}"')

    def factor():
        v = primary()
        while peek() == "^":
            nxt()
            v = v ** primary()
        return v

    def term():
        v = factor()
        while peek() in ("*", "/", "%"):
            o = nxt()
            r = factor()
            if o == "*":
                v *= r
            elif r == 0:
                raise CadError(path, f'"{src}" divides by zero')
            elif o == "/":
                v /= r
            else:
                v = math.fmod(v, r)
        return v

    def total():
        v = term()
        while peek() in ("+", "-"):
            o = nxt()
            r = term()
            v = v + r if o == "+" else v - r
        return v

    v = total()
    if pos != len(toks):
        raise CadError(path, f'unexpected "{toks[pos]}" in "{src}"')
    if not math.isfinite(v):
        raise CadError(path, f'"{src}" evaluates to {v}')
    return v


# ------------------------------------------------------------------ 2D profiles with exact arcs
def signed_area(pts: list[list[float]]) -> float:
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2


def clean(pts: list[list[float]]) -> list[list[float]]:
    out: list[list[float]] = []
    for p in pts:
        if not out or math.dist(p, out[-1]) > 1e-9:
            out.append([float(p[0]), float(p[1])])
    if len(out) > 1 and math.dist(out[0], out[-1]) < 1e-9:
        out.pop()
    return out


@dataclass
class Profile:
    """Closed 2D wire: start point, then segments ("line", end) or ("arc", mid, end, centre, r)."""

    start: list[float]
    segs: list[tuple]

    def to_json(self) -> dict:
        return {"start": self.start, "segs": [list(s) for s in self.segs]}

    def area(self) -> float:
        """Exact enclosed area: shoelace over the chord polygon + the circular segments of the arcs."""
        pts = [self.start] + [s[-1] if s[0] == "line" else s[2] for s in self.segs]
        a = signed_area(pts[:-1] if math.dist(pts[0], pts[-1]) < 1e-12 else pts)
        p = self.start
        for s in self.segs:
            if s[0] == "arc":
                _, mid, end, c, r = s
                chord = math.dist(p, end)
                theta = 2 * math.asin(min(1.0, chord / (2 * r)))
                seg_area = 0.5 * r * r * (theta - math.sin(theta))
                # bulge outward (convex corner: arc lies outside the chord? no — inside) decided by side of mid
                side = (end[0] - p[0]) * (mid[1] - p[1]) - (end[1] - p[1]) * (mid[0] - p[0])
                a += -seg_area if side > 0 else seg_area  # CCW wire: mid left of chord => arc bulges inward
            p = s[-1] if s[0] == "line" else s[2]
        return a


def round_corners(points: list[list[float]], radii: float | list[float], mode: str, path: str) -> Profile:
    """Exact fillet ("fillet") or chamfer ("chamfer") of polygon corners; radii per vertex (0 = sharp)."""
    pts = clean(points)
    if len(pts) < 3:
        raise CadError(path, "profile needs at least 3 distinct points")
    if abs(signed_area(pts)) < 1e-9:
        raise CadError(path, "profile has zero area")
    if signed_area(pts) < 0:
        pts = pts[::-1]
        if isinstance(radii, list):
            radii = [radii[0]] + radii[1:][::-1]
    n = len(pts)
    rs = radii if isinstance(radii, list) else [radii] * n
    if len(rs) != n:
        raise CadError(path, f"needs {n} radii (one per point), got {len(rs)}")
    info = []
    for i, p in enumerate(pts):
        a, b, rad = pts[i - 1], pts[(i + 1) % n], rs[i] or 0.0
        u = (a[0] - p[0], a[1] - p[1])
        v = (b[0] - p[0], b[1] - p[1])
        lu, lv = math.hypot(*u), math.hypot(*v)
        cos_t = max(-1.0, min(1.0, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))
        theta = math.acos(cos_t)
        if rad <= 0 or theta > math.pi - 1e-6:
            info.append({"p": p, "t": 0.0})
            continue
        t = rad if mode == "chamfer" else rad / math.tan(theta / 2)
        convex = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]) > 0  # p right of chord a->b => convex corner (CCW)
        info.append({"p": p, "t": t, "u": (u[0] / lu, u[1] / lu), "v": (v[0] / lv, v[1] / lv), "rad": rad, "theta": theta, "convex": convex})
    for i in range(n):
        j = (i + 1) % n
        edge = math.dist(pts[i], pts[j])
        if info[i]["t"] + info[j]["t"] > edge + 1e-9:
            which = "chamfer distance" if mode == "chamfer" else "fillet radius"
            raise CadError(path, f"{which} too large between points {i} and {j}: needs {info[i]['t'] + info[j]['t']:.3f} mm of a {edge:.3f} mm edge")
    nodes: list[tuple] = []  # sequence of ("pt", P) and ("arc", A, mid, B, C, r) in order
    for c in info:
        p = c["p"]
        if not c["t"]:
            nodes.append(("pt", p))
            continue
        A = [p[0] + c["u"][0] * c["t"], p[1] + c["u"][1] * c["t"]]
        B = [p[0] + c["v"][0] * c["t"], p[1] + c["v"][1] * c["t"]]
        if mode == "chamfer":
            nodes += [("pt", A), ("pt", B)]
            continue
        bis = (c["u"][0] + c["v"][0], c["u"][1] + c["v"][1])
        bl = math.hypot(*bis)
        d = c["rad"] / math.sin(c["theta"] / 2)
        C = [p[0] + bis[0] / bl * d, p[1] + bis[1] / bl * d]
        to_p = (p[0] - C[0], p[1] - C[1])
        lp = math.hypot(*to_p)
        mid = [C[0] + to_p[0] / lp * c["rad"], C[1] + to_p[1] / lp * c["rad"]]
        nodes.append(("arc", A, mid, B, C, c["rad"]))
    # build the wire: start at the first node's first point
    first = nodes[0]
    start = first[1]
    segs: list[tuple] = []
    for k, nd in enumerate(nodes):
        if nd[0] == "arc":
            if k > 0:
                segs.append(("line", nd[1]))
            segs.append(("arc", nd[2], nd[3], nd[4], nd[5]))
        elif k > 0:
            segs.append(("line", nd[1]))
    segs.append(("line", start))
    # drop zero-length lines (fillet tangent points that meet exactly)
    out, cur = [], start
    for s in segs:
        end = s[1] if s[0] == "line" else s[2]
        if s[0] == "line" and math.dist(cur, end) < 1e-9:
            continue
        out.append(s)
        cur = end
    return Profile(start=start, segs=out)


def plain_profile(points: list[list[float]], path: str) -> Profile:
    pts = clean(points)
    if len(pts) < 3:
        raise CadError(path, "profile needs at least 3 distinct points")
    if abs(signed_area(pts)) < 1e-9:
        raise CadError(path, "profile has zero area")
    if signed_area(pts) < 0:
        pts = pts[::-1]
    return Profile(start=pts[0], segs=[("line", p) for p in pts[1:]] + [("line", pts[0])])


def resample(pts: list[list[float]], n: int) -> list[list[float]]:
    L = [0.0]
    for i in range(len(pts)):
        L.append(L[-1] + math.dist(pts[i], pts[(i + 1) % len(pts)]))
    total, out = L[-1], []
    for k in range(n):
        s, i = total * k / n, 0
        while L[i + 1] < s:
            i += 1
        a, b = pts[i], pts[(i + 1) % len(pts)]
        f = (s - L[i]) / ((L[i + 1] - L[i]) or 1)
        out.append([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
    return out


# ------------------------------------------------------------------ the planner
def plan(model: Any, params: dict[str, Any] | None = None) -> dict:
    variables: dict[str, float] = {}
    for k, v in (params or {}).items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k):
            raise CadError("parameters", f'bad name "{k}"')
        variables[k] = eval_expr(v, variables, f"parameters.{k}")
    counters = {"nodes": 0, "booleans": 0}
    ev = lambda x, p: eval_expr(x, variables, p)  # noqa: E731

    def pos(x, p):
        v = ev(x, p)
        if v <= 0:
            raise CadError(p, f"must be > 0 (got {round(v, 4)})")
        if v > LIMITS["size"]:
            raise CadError(p, f"{v} mm is larger than {LIMITS['size']} mm")
        return v

    def vec3(v, p):
        if not isinstance(v, list) or len(v) != 3:
            raise CadError(p, "expected [x, y, z]")
        return [ev(x, f"{p}[{i}]") for i, x in enumerate(v)]

    def points(arr, p, limit=LIMITS["profilePoints"]):
        if not isinstance(arr, list) or len(arr) < 3:
            raise CadError(p, "expected at least 3 [x, y] points")
        if len(arr) > limit:
            raise CadError(p, "too many points")
        out = []
        for i, pt in enumerate(arr):
            if not isinstance(pt, list) or len(pt) != 2:
                raise CadError(f"{p}[{i}]", "expected [x, y]")
            out.append([ev(pt[0], f"{p}[{i}][0]"), ev(pt[1], f"{p}[{i}][1]")])
        return out

    def profile(pts, o, p) -> Profile:
        if "fillet" in o and "chamfer" in o:
            raise CadError(p, 'use either "fillet" or "chamfer" on one profile')
        for key in ("fillet", "chamfer"):
            if key in o:
                val = o[key]
                radii = [ev(x, f"{p}.{key}[{i}]") for i, x in enumerate(val)] if isinstance(val, list) else ev(val, f"{p}.{key}")
                return round_corners(pts, radii, key, f"{p}.{key}")
        return plain_profile(pts, p)

    def selector(s, p):
        if isinstance(s, str):
            if s not in SELECTORS:
                raise CadError(p, f'unknown edge/face selector "{s}" (use {", ".join(sorted(SELECTORS))} or {{"near": [[x,y,z]]}})')
            return s
        if isinstance(s, dict) and isinstance(s.get("near"), list) and s["near"]:
            return {"near": [vec3(q, f"{p}.near[{i}]") for i, q in enumerate(s["near"])]}
        raise CadError(p, 'expected a selector string or {"near": [[x, y, z], ...]}')

    def transforms(n, p) -> dict:
        tf: dict[str, Any] = {}
        if "scale" in n:
            s = n["scale"]
            vals = [ev(x, f"{p}.scale[{i}]") for i, x in enumerate(s)] if isinstance(s, list) else [ev(s, f"{p}.scale")] * 3
            if any(v == 0 for v in vals):
                raise CadError(f"{p}.scale", "scale cannot be zero")
            if max(vals) - min(vals) > 1e-12:
                raise CadError(f"{p}.scale", "non-uniform scale is not supported for B-Rep solids (it would turn analytic faces into splines); change the dimensions instead")
            tf["scale"] = vals[0]
        if "mirror" in n:
            if n["mirror"] not in ("x", "y", "z"):
                raise CadError(f"{p}.mirror", 'must be "x", "y" or "z"')
            tf["mirror"] = n["mirror"]
        if "rotate" in n:
            tf["rotate"] = vec3(n["rotate"], f"{p}.rotate")
        if "translate" in n:
            tf["translate"] = vec3(n["translate"], f"{p}.translate")
        return tf

    def bump(p, k):
        counters["booleans"] += k
        if counters["booleans"] > LIMITS["booleans"]:
            raise CadError(p, f"more than {LIMITS['booleans']} boolean operations")

    def node(n, path) -> dict:
        if not isinstance(n, dict):
            raise CadError(path, "expected a node object")
        counters["nodes"] += 1
        if counters["nodes"] > LIMITS["nodes"]:
            raise CadError(path, f"model has more than {LIMITS['nodes']} nodes")
        kinds = [k for k in n if k not in TRANSFORM_KEYS]
        if len(kinds) != 1:
            raise CadError(path, f"expected exactly one shape/operation key, got [{', '.join(kinds)}]")
        kind = kinds[0]
        out = shape(kind, n[kind], f"{path}.{kind}")
        out["path"] = f"{path}.{kind}"
        tf = transforms(n, path)
        if tf:
            out["tf"] = tf
        return out

    def children(arr, p, minimum):
        if not isinstance(arr, list) or len(arr) < minimum:
            raise CadError(p, f"expected a list of at least {minimum} nodes")
        return [node(c, f"{p}[{i}]") for i, c in enumerate(arr)]

    def radius(o, p, rk="r", dk="d"):
        if rk in o:
            return pos(o[rk], f"{p}.{rk}")
        if dk in o:
            return pos(o[dk], f"{p}.{dk}") / 2
        raise CadError(p, f'needs "{rk}" or "{dk}"')

    def shape(kind, o, p) -> dict:
        if kind in ("box", "rounded_box", "fillet_box", "chamfer_box"):
            size = [v for v in vec3(o.get("size"), f"{p}.size")]
            for i, v in enumerate(size):
                if v <= 0:
                    raise CadError(f"{p}.size[{i}]", "must be > 0")
            out = {"op": kind, "size": size, "center": bool(o.get("center", False))}
            if kind == "rounded_box":
                # same rule as the browser kernel: r is clamped to half the shorter side (a stadium end)
                r = min(ev(o.get("r", 0), f"{p}.r"), size[0] / 2, size[1] / 2)
                cx, cy = (-size[0] / 2, -size[1] / 2) if out["center"] else (0.0, 0.0)
                rect = [[cx, cy], [cx + size[0], cy], [cx + size[0], cy + size[1]], [cx, cy + size[1]]]
                prof = round_corners(rect, r, "fillet", f"{p}.r") if r > 0 else plain_profile(rect, p)
                return {"op": "extrude", "profile": prof.to_json(), "h": size[2], "holes": [], "z0": -size[2] / 2 if out["center"] else 0.0}
            if kind in ("fillet_box", "chamfer_box"):
                key = "r" if kind == "fillet_box" else "d"
                v = ev(o.get(key), f"{p}.{key}")
                lim = min(size) / 2
                if not v > 0:
                    raise CadError(f"{p}.{key}", "must be > 0")
                if v >= lim - 1e-9:
                    raise CadError(f"{p}.{key}", f"{v} mm does not fit: must be smaller than half the smallest side ({lim} mm)")
                out[key] = v
            return out
        if kind == "cylinder":
            r1, h = radius(o, p), pos(o.get("h"), f"{p}.h")
            r2 = ev(o["r2"], f"{p}.r2") if "r2" in o else ev(o["d2"], f"{p}.d2") / 2 if "d2" in o else r1
            if r2 < 0:
                raise CadError(f"{p}.r2", "must be >= 0")
            out = {"op": "cylinder", "r1": r1, "r2": r2, "h": h, "center": bool(o.get("center", False))}
            if "segments" in o:  # a low segment count in FormaCAD means an exact prism (hexagon nut traps)
                seg = int(round(ev(o["segments"], f"{p}.segments")))
                if 3 <= seg <= 12:
                    out = {"op": "prism", "n": seg, "r1": r1, "r2": r2, "h": h, "center": out["center"]}
            return out
        if kind == "sphere":
            return {"op": "sphere", "r": radius(o, p)}
        if kind == "torus":
            R, r = pos(o.get("R"), f"{p}.R"), pos(o.get("r"), f"{p}.r")
            if r >= R:
                raise CadError(p, "minor radius r must be smaller than R")
            return {"op": "torus", "R": R, "r": r}
        if kind == "extrude":
            prof = profile(points(o.get("points"), f"{p}.points"), o, p)
            holes = []
            if "holes" in o:
                if not isinstance(o["holes"], list):
                    raise CadError(f"{p}.holes", "expected a list of polygons")
                for i, hp in enumerate(o["holes"]):
                    bump(p, 1)
                    holes.append(plain_profile(points(hp, f"{p}.holes[{i}]"), f"{p}.holes[{i}]").to_json())
            return {"op": "extrude", "profile": prof.to_json(), "h": pos(o.get("h"), f"{p}.h"), "holes": holes}
        if kind == "revolve":
            pts = [[max(0.0, x), z] for x, z in points(o.get("profile"), f"{p}.profile")]
            return {"op": "revolve", "profile": profile(pts, o, p).to_json()}
        if kind == "loft":
            secs = o.get("sections")
            if not isinstance(secs, list) or len(secs) < 2:
                raise CadError(f"{p}.sections", "needs at least 2 sections [{points, z}]")
            raw = [(points(s.get("points"), f"{p}.sections[{i}].points"), ev(s.get("z"), f"{p}.sections[{i}].z")) for i, s in enumerate(secs)]
            for i in range(1, len(raw)):
                if not raw[i][1] > raw[i - 1][1]:
                    raise CadError(f"{p}.sections[{i}].z", "section heights must increase")
            n = max(len(r[0]) for r in raw)
            out_secs = []
            for (pts, z) in raw:
                pts = clean(pts)
                if signed_area(pts) < 0:
                    pts = pts[::-1]
                out_secs.append({"points": pts if len(pts) == n else resample(pts, n), "z": z})
            return {"op": "loft", "sections": out_secs}
        if kind == "sweep":
            path_pts = o.get("path")
            if not isinstance(path_pts, list) or len(path_pts) < 2:
                raise CadError(f"{p}.path", "needs at least 2 [x, y, z] points")
            if len(path_pts) > LIMITS["pathPoints"]:
                raise CadError(f"{p}.path", "too many points")
            return {"op": "sweep", "profile": profile(points(o.get("profile"), f"{p}.profile"), o, p).to_json(), "spine": [vec3(q, f"{p}.path[{i}]") for i, q in enumerate(path_pts)]}  # not "path": that key holds the node's error location
        if kind in ("union", "difference", "intersection"):
            c = children(o, p, 2 if kind == "intersection" else 1)
            bump(p, len(c) - 1)
            return {"op": kind, "children": c}
        if kind == "linear_array":
            count = int(round(ev(o.get("count"), f"{p}.count")))
            if not 1 <= count <= LIMITS["arrayCount"]:
                raise CadError(f"{p}.count", f"must be 1..{LIMITS['arrayCount']}")
            child = node(o.get("child"), f"{p}.child")
            bump(p, count - 1)
            return {"op": "linear_array", "count": count, "step": vec3(o.get("step"), f"{p}.step"), "child": child}
        if kind == "polar_array":
            count = int(round(ev(o.get("count"), f"{p}.count")))
            if not 1 <= count <= LIMITS["arrayCount"]:
                raise CadError(f"{p}.count", f"must be 1..{LIMITS['arrayCount']}")
            angle = ev(o.get("angle", 360), f"{p}.angle")
            child = node(o.get("child"), f"{p}.child")
            bump(p, count - 1)
            step = 360 / count if abs(angle - 360) < 1e-9 else (angle / (count - 1) if count > 1 else 0)
            return {"op": "polar_array", "count": count, "step_deg": step, "child": child}
        if kind == "mirror_copy":
            if o.get("axis") not in ("x", "y", "z"):
                raise CadError(f"{p}.axis", 'must be "x", "y" or "z"')
            child = node(o.get("child"), f"{p}.child")
            bump(p, 1)
            return {"op": "mirror_copy", "axis": o["axis"], "child": child}
        if kind in ("fillet_edges", "chamfer_edges"):
            key = "r" if kind == "fillet_edges" else "d"
            return {"op": kind, key: pos(o.get(key), f"{p}.{key}"), "edges": selector(o.get("edges", "all"), f"{p}.edges"), "child": node(o.get("child"), f"{p}.child")}
        if kind == "shell":
            t = pos(o.get("thickness"), f"{p}.thickness")
            return {"op": "shell", "thickness": t, "open": selector(o["open"], f"{p}.open") if o.get("open") else None, "child": node(o.get("child"), f"{p}.child")}
        if kind == "offset":
            d = ev(o.get("distance"), f"{p}.distance")
            if d == 0 or abs(d) > 50:
                raise CadError(f"{p}.distance", "must be non-zero and within ±50 mm")
            return {"op": "offset", "distance": d, "child": node(o.get("child"), f"{p}.child")}
        if kind == "draft":
            a = ev(o.get("angle"), f"{p}.angle")
            if not 0 < abs(a) < 45:
                raise CadError(f"{p}.angle", "draft angle must be between 0 and 45 degrees")
            return {"op": "draft", "angle": a, "faces": selector(o.get("faces", "#Z"), f"{p}.faces"), "neutral_z": ev(o.get("neutral_z", 0), f"{p}.neutral_z"), "child": node(o.get("child"), f"{p}.child")}
        raise CadError(p, f'unknown shape or operation "{kind}"')

    tree = node(model, "model")
    return {"tree": tree, "stats": dict(counters), "params": variables}


def design_plan(design: dict, overrides: dict[str, Any] | None = None) -> dict:
    if not isinstance(design, dict) or "model" not in design:
        raise CadError("design", "design has no model")
    params = {}
    for p in design.get("parameters") or []:
        name = p.get("name")
        params[name] = (overrides or {}).get(name, p.get("value"))
    return plan(design["model"], params)
