"""Plain-data task entry points executed inside the sandbox process."""

from __future__ import annotations

from .pipeline import generate_parametric, process_mesh
from .spec.llm import parse_with_llm
from .spec.parser import parse
from .templates.library import TEMPLATES
from .validation.mesh_validation_service import PrintConstraints


def _constraints(c: dict | None) -> PrintConstraints:
    c = c or {}
    base = PrintConstraints()
    return PrintConstraints(
        build_volume_mm=tuple(c.get("build_volume_mm") or base.build_volume_mm),
        min_wall_thickness_mm=float(c.get("min_wall_thickness_mm") or base.min_wall_thickness_mm),
        nozzle_diameter_mm=float(c.get("nozzle_diameter_mm") or base.nozzle_diameter_mm),
        max_triangles=int(c.get("max_triangles") or base.max_triangles),
    )


def parametric(prompt: str, user_fields: dict | None = None, template: str | None = None,
               intended_use: str | None = None, constraints: dict | None = None, use_llm: bool = True) -> dict:
    if use_llm and not template:
        spec = parse_with_llm(prompt, user_fields, intended_use)
    else:
        spec = parse(prompt, user_fields, template, intended_use)
    result = generate_parametric(spec, _constraints(constraints))
    return {"metadata": result.metadata(), "stl": result.stl}


def mesh(data: bytes, filename: str | None = None, source_units: str | None = None, up_axis: str | None = None,
         target_longest_mm: float | None = None, constraints: dict | None = None) -> dict:
    result = process_mesh(data, filename, source_units, up_axis, target_longest_mm, _constraints(constraints))
    return {"metadata": result.metadata(), "stl": result.stl}


def spec_only(prompt: str, user_fields: dict | None = None, template: str | None = None,
              intended_use: str | None = None, use_llm: bool = True) -> dict:
    spec = parse_with_llm(prompt, user_fields, intended_use) if use_llm and not template else parse(prompt, user_fields, template, intended_use)
    out = spec.to_dict()
    # units, labels and limits so a form can let the user review every value before building
    out["template_schema"] = TEMPLATES[spec.template].schema() if spec.template else None
    return out
