"""End-to-end pipelines.

``generate_parametric``  text → spec → exact CAD → STL → re-open → validate.
``process_mesh``         provider/upload file (GLB/OBJ/STL) → normalised,
                         repaired STL in millimetres → re-open → validate.

Both return a ``PipelineResult`` with the STL bytes and a full record of what
was done to the geometry (scale factors, axis changes, repairs), so nothing is
applied silently.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import asdict, dataclass, field

import numpy as np

from .geometry.io import MeshFormatError, load_mesh, read_stl, write_stl
from .geometry.mesh import Mesh
from .spec.parser import DesignSpec
from .templates.library import TEMPLATES
from .validation.mesh_validation_service import (
    INVALID,
    VALIDATION_FAILED,
    PrintConstraints,
    ValidationReport,
    validate,
)

SOURCE_UNITS_TO_MM = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "in": 25.4}


class PipelineError(Exception):
    def __init__(self, code: str, message: str, details: object | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


@dataclass
class PipelineResult:
    status: str  # validation status of the exported STL
    stl: bytes = field(repr=False)
    stl_sha256: str = ""
    size_mm: dict | None = None
    triangles: int = 0
    validation: dict = field(default_factory=dict)
    post_export_validation: dict = field(default_factory=dict)
    transforms: list[str] = field(default_factory=list)
    spec: dict | None = None
    source_format: str | None = None
    duration_ms: int = 0

    def metadata(self) -> dict:
        d = asdict(self)
        d.pop("stl")
        d["stl_bytes"] = len(self.stl)
        return d


def _place_on_bed(mesh: Mesh) -> tuple[Mesh, list[str]]:
    b = mesh.bounds()
    offset = np.array([-b[0][0], -b[0][1], -b[0][2]])
    if np.allclose(offset, 0, atol=1e-9):
        return mesh, []
    return mesh.translated(offset), [f"translated by ({offset[0]:.3f}, {offset[1]:.3f}, {offset[2]:.3f}) mm to sit on the build plate at the origin"]


def _export_and_recheck(mesh: Mesh, constraints: PrintConstraints) -> tuple[bytes, ValidationReport]:
    """Write STL, read it back from bytes, and validate the *re-opened* mesh without repairs."""
    data = write_stl(mesh)
    reopened = read_stl(data)
    _, report = validate(reopened, constraints, attempt_repair=False)
    return data, report


def generate_parametric(spec: DesignSpec, constraints: PrintConstraints | None = None) -> PipelineResult:
    t0 = time.perf_counter()
    c = constraints or PrintConstraints()
    if spec.template is None:
        raise PipelineError("NO_TEMPLATE", "No parametric template matches this description.", spec.clarifications)
    if spec.errors:
        raise PipelineError("INVALID_PARAMETERS", "Some parameters are outside the allowed range.", spec.errors)
    template = TEMPLATES[spec.template]
    try:
        solid = template.build(spec.values())
    except ValueError as exc:
        raise PipelineError("INVALID_PARAMETERS", str(exc)) from exc
    mesh = solid.to_mesh()
    mesh, transforms = _place_on_bed(mesh)
    mesh, report = validate(mesh.as_float32(), c, attempt_repair=True)
    if report.status in (INVALID, VALIDATION_FAILED):
        raise PipelineError("GEOMETRY_INVALID", "The generated geometry failed validation.", report.to_dict())
    stl, post = _export_and_recheck(mesh, c)
    result = PipelineResult(
        status=post.status,
        stl=stl,
        stl_sha256=hashlib.sha256(stl).hexdigest(),
        size_mm=post.stats.get("size_mm"),
        triangles=post.stats.get("triangles", 0),
        validation=report.to_dict(),
        post_export_validation=post.to_dict(),
        transforms=transforms,
        spec=spec.to_dict(),
        source_format="parametric",
    )
    _note_size_vs_request(result, spec)
    result.duration_ms = int((time.perf_counter() - t0) * 1000)
    return result


def _note_size_vs_request(result: PipelineResult, spec: DesignSpec) -> None:
    """Say plainly when the built part differs from a requested dimension (e.g. a derived base depth)."""
    if not result.size_mm or not spec.params:
        return
    axis_of = {"phone_stand": {"width": "x", "height": "z", "base_depth": "y"},
               "open_box": {"length": "x", "width": "y", "height": "z"},
               "wall_hook": {"width": "x"},
               "spacer": {"outer_diameter": "x", "height": "z"}}.get(spec.template or "", {})
    for name, axis in axis_of.items():
        pv = spec.params.get(name)
        if pv is None:
            continue
        actual = result.size_mm[axis]
        if abs(actual - pv.value) > 0.05:
            result.transforms.append(
                f"{name}: requested {pv.value:g} mm ({pv.source}), built {actual:g} mm on {axis.upper()} — "
                "derived from other parameters to keep the part stable/valid"
            )


def process_mesh(
    data: bytes,
    filename: str | None = None,
    source_units: str | None = None,
    up_axis: str | None = None,
    target_longest_mm: float | None = None,
    constraints: PrintConstraints | None = None,
    max_bytes: int = 200 * 1024 * 1024,
) -> PipelineResult:
    """Convert a provider or uploaded mesh to a validated, millimetre STL.

    * glTF is defined in metres with +Y up (glTF 2.0 spec §3.4), so GLB input
      defaults to ``source_units="m"`` and ``up_axis="y"``. STL/OBJ default to
      millimetres, +Z up. Callers override when they know better.
    * ``target_longest_mm`` uniformly rescales so the longest side matches the
      user's requested size. The factor is recorded in ``transforms``.
    """
    t0 = time.perf_counter()
    c = constraints or PrintConstraints()
    if len(data) > max_bytes:
        raise PipelineError("FILE_TOO_LARGE", f"File is {len(data)} bytes; limit is {max_bytes}.")
    try:
        mesh, fmt = load_mesh(data, filename)
    except (MeshFormatError, ValueError, KeyError, IndexError) as exc:
        raise PipelineError("UNREADABLE_MESH", f"Could not read mesh: {exc}") from exc
    transforms: list[str] = []
    units = source_units or ("m" if fmt == "glb" else "mm")
    up = up_axis or ("y" if fmt == "glb" else "z")
    if units not in SOURCE_UNITS_TO_MM:
        raise PipelineError("BAD_UNITS", f"Unknown source units {units!r}")
    factor = SOURCE_UNITS_TO_MM[units]
    if factor != 1.0:
        mesh = mesh.scaled(factor)
        transforms.append(f"converted units {units} → mm (×{factor:g})")
    if up == "y":
        rot = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], dtype=float)  # +Y up → +Z up
        mesh = mesh.transformed(rot)
        transforms.append("rotated +90° about X (Y-up → Z-up for printing)")
    elif up != "z":
        raise PipelineError("BAD_AXIS", f"Unknown up axis {up!r}")
    if target_longest_mm:
        longest = float(mesh.extents().max())
        if longest <= 0:
            raise PipelineError("GEOMETRY_INVALID", "Mesh has zero size; cannot scale.")
        s = target_longest_mm / longest
        mesh = mesh.scaled(s)
        transforms.append(f"uniformly scaled ×{s:.6g} so the longest side is {target_longest_mm:g} mm (user request)")
    mesh, placed = _place_on_bed(mesh)
    transforms += placed
    mesh, report = validate(mesh.as_float32(), c, attempt_repair=True)
    if report.status in (INVALID, VALIDATION_FAILED):
        raise PipelineError("GEOMETRY_INVALID", "The mesh failed validation.", report.to_dict())
    stl, post = _export_and_recheck(mesh, c)
    return PipelineResult(
        status=post.status,
        stl=stl,
        stl_sha256=hashlib.sha256(stl).hexdigest(),
        size_mm=post.stats.get("size_mm"),
        triangles=post.stats.get("triangles", 0),
        validation=report.to_dict(),
        post_export_validation=post.to_dict(),
        transforms=transforms,
        source_format=fmt,
        duration_ms=int((time.perf_counter() - t0) * 1000),
    )
