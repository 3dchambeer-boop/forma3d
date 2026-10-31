"""mesh_validation_service — printability checks and *safe* automatic repairs.

Status levels (most to least favourable):

  VALIDATED            closed, consistently oriented, single body, positive
                       volume, fits the build volume, walls not below minimum.
  VALID_WITH_WARNINGS  closed and orientable, but something deserves a human
                       look (several bodies, thin walls, too large for printer…).
  REPAIR_REQUIRED      not closed or not manifold after safe repairs; a slicer
                       may guess wrong. Needs a designer or a mesh tool.
  INVALID              no usable geometry (empty, NaN, zero volume).
  VALIDATION_FAILED    the checker itself failed; nothing can be claimed.

What this module does *not* claim: a VALIDATED mesh is printable as far as
these checks can tell. Self-intersections are not detected here (listed under
``checks_not_performed``) and overhang/support analysis belongs to the slicer.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

from ..geometry.mesh import Mesh

VALIDATED = "VALIDATED"
VALID_WITH_WARNINGS = "VALID_WITH_WARNINGS"
REPAIR_REQUIRED = "REPAIR_REQUIRED"
INVALID = "INVALID"
VALIDATION_FAILED = "VALIDATION_FAILED"


@dataclass
class PrintConstraints:
    build_volume_mm: tuple[float, float, float] = (220.0, 220.0, 250.0)  # Ender-3 class default
    min_wall_thickness_mm: float = 0.8  # two perimeters with a 0.4 mm nozzle
    nozzle_diameter_mm: float = 0.4
    max_triangles: int = 2_000_000


@dataclass
class Issue:
    code: str
    severity: str  # "error" | "warning" | "info"
    message: str
    count: int | None = None


@dataclass
class ValidationReport:
    status: str
    checks: dict = field(default_factory=dict)
    issues: list[Issue] = field(default_factory=list)
    repairs_applied: list[str] = field(default_factory=list)
    checks_not_performed: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)
    duration_ms: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------- analysis


def _edge_table(faces: np.ndarray):
    """Return (half_edges (3M,2), face_of_half_edge, unique_edge_index, counts)."""
    he = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    face_of = np.tile(np.arange(len(faces)), 3)
    key = np.sort(he, axis=1)
    _, inv, counts = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    return he, face_of, inv.reshape(-1), counts


def analyse(mesh: Mesh) -> dict:
    faces = mesh.faces
    out: dict = {"vertex_count": int(len(mesh.vertices)), "triangle_count": int(len(faces))}
    if len(faces) == 0:
        return out
    he, face_of, inv, counts = _edge_table(faces)
    out["edge_count"] = int(len(counts))
    out["boundary_edges"] = int(np.sum(counts == 1))
    out["non_manifold_edges"] = int(np.sum(counts > 2))

    # winding: on a 2-manifold edge the two half-edges must run in opposite directions
    manifold = counts[inv] == 2
    order = np.argsort(inv[manifold], kind="stable")
    pairs = he[manifold][order].reshape(-1, 2, 2)
    out["inconsistent_winding_edges"] = int(np.sum(np.all(pairs[:, 0] == pairs[:, 1], axis=1)))

    f = faces
    degenerate = (f[:, 0] == f[:, 1]) | (f[:, 1] == f[:, 2]) | (f[:, 0] == f[:, 2])
    areas = mesh.face_areas()
    out["degenerate_faces"] = int(np.sum(degenerate | (areas <= 1e-12)))
    out["duplicate_faces"] = int(len(f) - len(np.unique(np.sort(f, axis=1), axis=0)))

    # bodies = connected components over shared vertices
    n = len(mesh.vertices)
    rows = np.repeat(np.arange(len(f)), 3)
    adj = coo_matrix((np.ones(len(rows)), (rows, f.reshape(-1))), shape=(len(f), n)).tocsr()
    vv = (adj.T @ adj).tocsr()
    n_comp, labels = connected_components(vv, directed=False)
    used = np.unique(f)
    out["bodies"] = int(len(np.unique(labels[used])))

    b = mesh.bounds()
    ext = b[1] - b[0]
    out["bounds_min_mm"] = [round(float(x), 4) for x in b[0]]
    out["bounds_max_mm"] = [round(float(x), 4) for x in b[1]]
    out["size_mm"] = {"x": round(float(ext[0]), 3), "y": round(float(ext[1]), 3), "z": round(float(ext[2]), 3)}
    out["surface_area_mm2"] = round(float(areas.sum()), 3)
    out["watertight"] = out["boundary_edges"] == 0 and out["non_manifold_edges"] == 0
    vol = mesh.signed_volume()
    out["signed_volume_mm3"] = round(vol, 3)
    out["volume_mm3"] = round(abs(vol), 3) if out["watertight"] else None
    return out


# ---------------------------------------------------------------------- repairs


def _orient_consistently(mesh: Mesh) -> tuple[Mesh, int]:
    """Flip faces so neighbours agree on winding (BFS over manifold edges)."""
    faces = mesh.faces.copy()
    he, face_of, inv, counts = _edge_table(faces)
    manifold = np.where(counts[inv] == 2)[0]
    order = manifold[np.argsort(inv[manifold], kind="stable")].reshape(-1, 2)
    neighbours: list[list[tuple[int, bool]]] = [[] for _ in range(len(faces))]
    for h1, h2 in order:
        f1, f2 = int(face_of[h1]), int(face_of[h2])
        same_dir = bool(np.all(he[h1] == he[h2]))  # same direction ⇒ inconsistent
        neighbours[f1].append((f2, same_dir))
        neighbours[f2].append((f1, same_dir))
    flip = np.zeros(len(faces), dtype=bool)
    seen = np.zeros(len(faces), dtype=bool)
    flipped = 0
    for start in range(len(faces)):
        if seen[start]:
            continue
        seen[start] = True
        stack = [start]
        while stack:
            cur = stack.pop()
            for nb, same in neighbours[cur]:
                want = flip[cur] ^ same
                if not seen[nb]:
                    seen[nb] = True
                    flip[nb] = want
                    stack.append(nb)
    if flip.any():
        faces[flip] = faces[flip][:, ::-1]
        flipped = int(flip.sum())
    return Mesh(mesh.vertices, faces), flipped


def _remove_cancelling_pairs(mesh: Mesh) -> tuple[Mesh, int]:
    """Remove pairs of identical faces with opposite winding (zero-thickness internal walls)."""
    key = np.sort(mesh.faces, axis=1)
    _, inv, counts = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    inv = inv.reshape(-1)
    dup = counts[inv] > 1
    if not dup.any():
        return mesh, 0
    keep = ~dup
    # for groups with an odd count keep exactly one face so the surface is not opened
    for g in np.unique(inv[dup]):
        members = np.where(inv == g)[0]
        if len(members) % 2 == 1:
            keep[members[0]] = True
    return Mesh(mesh.vertices, mesh.faces[keep]), int((~keep).sum())


def repair(mesh: Mesh, weld_tolerance: float = 1e-4) -> tuple[Mesh, list[str]]:
    applied: list[str] = []
    before_v = len(mesh.vertices)
    m = mesh.merged_vertices(weld_tolerance)
    if len(m.vertices) != before_v:
        applied.append(f"welded {before_v - len(m.vertices)} duplicate vertices (tol {weld_tolerance} mm)")
    before_f = len(m.faces)
    m = m.without_degenerate_faces()
    if len(m.faces) != before_f:
        applied.append(f"removed {before_f - len(m.faces)} degenerate faces")
    m, removed = _remove_cancelling_pairs(m)
    if removed:
        applied.append(f"removed {removed} duplicate/cancelling faces")
    if m.is_empty:
        return m, applied
    m, flipped = _orient_consistently(m)
    if flipped:
        applied.append(f"re-oriented {flipped} faces for consistent winding")
    info = analyse(m)
    if info.get("watertight") and m.signed_volume() < 0:
        m = Mesh(m.vertices, m.faces[:, ::-1].copy())
        applied.append("flipped all normals (mesh was inside-out)")
    return m, applied


# ---------------------------------------------------------------------- wall thickness


def estimate_min_wall_thickness(mesh: Mesh, samples: int = 400, seed: int = 0) -> float | None:
    """Ray-cast inward from sampled faces and return the 2nd-percentile thickness (mm).

    Sampling keeps this bounded (samples × faces work). It is an *estimate*:
    reported as such, and only meaningful on a closed, outward-oriented mesh.
    """
    if mesh.is_empty or len(mesh.faces) > 400_000:
        return None
    rng = np.random.default_rng(seed)
    areas = mesh.face_areas()
    if areas.sum() <= 0:
        return None
    pick = rng.choice(len(mesh.faces), size=min(samples, len(mesh.faces)), replace=False, p=areas / areas.sum())
    tri = mesh.triangles()
    n_raw = mesh.face_normals_raw()
    normals = n_raw / np.maximum(np.linalg.norm(n_raw, axis=1, keepdims=True), 1e-30)
    v0, e1, e2 = tri[:, 0], tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    hits = []
    for fi in pick:
        origin = tri[fi].mean(axis=0) - normals[fi] * 1e-4
        d = -normals[fi]
        p = np.cross(d, e2)
        det = np.einsum("ij,ij->i", e1, p)
        ok = np.abs(det) > 1e-12
        inv_det = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
        s = origin - v0
        u = np.einsum("ij,ij->i", s, p) * inv_det
        q = np.cross(s, e1)
        v = (q @ d) * inv_det
        t = np.einsum("ij,ij->i", e2, q) * inv_det
        mask = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-6)
        mask[fi] = False
        if mask.any():
            hits.append(float(t[mask].min()))
    if not hits:
        return None
    return round(float(np.percentile(hits, 2)), 3)


# ---------------------------------------------------------------------- entry point


def validate(mesh: Mesh, constraints: PrintConstraints | None = None, attempt_repair: bool = True) -> tuple[Mesh, ValidationReport]:
    """Check (and optionally safely repair) a mesh. Returns the possibly repaired mesh and the report."""
    t0 = time.perf_counter()
    c = constraints or PrintConstraints()
    report = ValidationReport(status=VALIDATION_FAILED)
    report.checks_not_performed = [
        "self_intersections: not detected by this checker; the slicer and designer review must catch them",
        "overhangs_and_supports: evaluated by the slicer, not here",
    ]
    try:
        if mesh.is_empty or len(mesh.vertices) == 0:
            report.status = INVALID
            report.issues.append(Issue("EMPTY_MESH", "error", "The file contains no triangles."))
            return mesh, _finish(report, t0)
        if not np.all(np.isfinite(mesh.vertices)):
            report.status = INVALID
            report.issues.append(Issue("NON_FINITE", "error", "Vertex coordinates contain NaN or infinity."))
            return mesh, _finish(report, t0)
        if len(mesh.faces) > c.max_triangles:
            report.status = INVALID
            report.issues.append(Issue("TOO_COMPLEX", "error", f"{len(mesh.faces)} triangles exceeds limit {c.max_triangles}."))
            return mesh, _finish(report, t0)

        report.checks["before_repair"] = analyse(mesh)
        if attempt_repair:
            mesh, report.repairs_applied = repair(mesh)
        info = analyse(mesh)
        report.checks["final"] = info
        report.stats = {
            "triangles": info.get("triangle_count", 0),
            "vertices": info.get("vertex_count", 0),
            "size_mm": info.get("size_mm"),
            "volume_mm3": info.get("volume_mm3"),
            "surface_area_mm2": info.get("surface_area_mm2"),
            "bodies": info.get("bodies"),
        }
        if mesh.is_empty:
            report.status = INVALID
            report.issues.append(Issue("EMPTY_AFTER_REPAIR", "error", "Nothing left after removing degenerate faces."))
            return mesh, _finish(report, t0)

        errors = warnings = 0
        if info["boundary_edges"]:
            errors += 1
            report.issues.append(Issue("OPEN_EDGES", "error", "Surface has holes (open edges); it does not enclose a volume.", info["boundary_edges"]))
        if info["non_manifold_edges"]:
            errors += 1
            report.issues.append(Issue("NON_MANIFOLD_EDGES", "error", "Edges shared by more than two faces.", info["non_manifold_edges"]))
        if info["inconsistent_winding_edges"]:
            errors += 1
            report.issues.append(Issue("INCONSISTENT_NORMALS", "error", "Face orientation could not be made consistent.", info["inconsistent_winding_edges"]))
        if info["watertight"] and info["signed_volume_mm3"] <= 0:
            report.status = INVALID
            report.issues.append(Issue("ZERO_VOLUME", "error", "Closed surface encloses no positive volume."))
            return mesh, _finish(report, t0)

        if info["bodies"] > 1:
            warnings += 1
            report.issues.append(Issue("MULTIPLE_BODIES", "warning", "Mesh has several separate bodies; confirm this is intended.", info["bodies"]))
        size = info["size_mm"]
        dims = sorted([size["x"], size["y"], size["z"]])
        bv = sorted(c.build_volume_mm)
        if size["x"] > c.build_volume_mm[0] or size["y"] > c.build_volume_mm[1] or size["z"] > c.build_volume_mm[2]:
            warnings += 1
            fits_rotated = all(d <= v for d, v in zip(dims, bv))
            report.issues.append(Issue(
                "EXCEEDS_BUILD_VOLUME", "warning",
                f"Size {size['x']}×{size['y']}×{size['z']} mm exceeds build volume {c.build_volume_mm}"
                + (" in this orientation (fits if rotated)." if fits_rotated else "."),
            ))
        if dims[0] < c.nozzle_diameter_mm * 2:
            warnings += 1
            report.issues.append(Issue("FEATURE_TOO_THIN", "warning", f"Thinnest overall dimension {dims[0]} mm is below two nozzle widths."))

        if info["watertight"] and not errors:
            wall = estimate_min_wall_thickness(mesh)
            info["estimated_min_wall_mm"] = wall
            report.stats["estimated_min_wall_mm"] = wall
            if wall is not None and wall < c.min_wall_thickness_mm:
                warnings += 1
                report.issues.append(Issue(
                    "THIN_WALLS", "warning",
                    f"Estimated thinnest wall ≈{wall} mm is below the {c.min_wall_thickness_mm} mm minimum (sampled estimate).",
                ))
        else:
            report.checks_not_performed.append("wall_thickness: needs a closed surface")

        report.status = REPAIR_REQUIRED if errors else (VALID_WITH_WARNINGS if warnings else VALIDATED)
        return mesh, _finish(report, t0)
    except Exception as exc:  # the checker must never claim success when it crashed
        report.status = VALIDATION_FAILED
        report.issues.append(Issue("CHECKER_ERROR", "error", f"{type(exc).__name__}: {exc}"))
        return mesh, _finish(report, t0)


def _finish(report: ValidationReport, t0: float) -> ValidationReport:
    report.duration_ms = int((time.perf_counter() - t0) * 1000)
    return report
