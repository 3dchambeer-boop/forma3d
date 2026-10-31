"""Engine tests: everything here runs real geometry code, no mocks."""

from __future__ import annotations

import math
import struct
from pathlib import Path

import numpy as np
import pytest

from ai_3d_engine.geometry.csg import Solid
from ai_3d_engine.geometry.io import MeshFormatError, load_mesh, read_glb, read_obj, read_stl, write_stl
from ai_3d_engine.geometry.mesh import Mesh
from ai_3d_engine.geometry.primitives import box, cylinder, hole
from ai_3d_engine.pipeline import PipelineError, generate_parametric, process_mesh
from ai_3d_engine.spec.parser import parse
from ai_3d_engine.templates.library import TEMPLATES
from ai_3d_engine.validation.mesh_validation_service import (
    INVALID,
    REPAIR_REQUIRED,
    VALID_WITH_WARNINGS,
    VALIDATED,
    PrintConstraints,
    analyse,
    validate,
)

REPO = Path(__file__).resolve().parents[3]
EXAMPLE_AR = (
    "صمّم حامل هاتف مكتبي قابلًا للطباعة ثلاثية الأبعاد، بعرض 90 مم، وارتفاع 110 مم، "
    "وقاعدة مستقرة، وفتحة لشحن الهاتف، وزاوية ميل 65 درجة."
)

# ---------------------------------------------------------------- spec parsing


def test_example_prompt_is_parsed_to_exact_spec():
    spec = parse(EXAMPLE_AR)
    v = spec.values()
    assert spec.template == "phone_stand"
    assert spec.language == "ar"
    assert (v["width"], v["height"], v["tilt_angle"], v["charging_slot"]) == (90, 110, 65, 1)
    assert spec.params["width"].source == "prompt"
    assert not spec.errors
    assert any("65" in r for r in spec.requirements)


@pytest.mark.parametrize(
    "prompt,template,expected",
    [
        ("Design a phone stand 8 cm wide, 12cm tall, tilt angle 70 degrees", "phone_stand", {"width": 80, "height": 120, "tilt_angle": 70}),
        ("phone stand, width: 3.5 inches", "phone_stand", {"width": 88.9}),
        ("علبة منظم 120x80x40 مم بسماكة جدار 2.5 مم و 3 فواصل", "open_box", {"length": 120, "width": 80, "height": 40, "wall": 2.5, "dividers": 3}),
        ("shelf bracket width 40mm, thickness 6 mm, 2 holes, hole diameter 5 mm", "l_bracket", {"width": 40, "thickness": 6, "holes_per_leg": 2, "hole_diameter": 5}),
        ("وردة فاصل قطر خارجي ٢٢ ملم وقطر داخلي ٨ ملم وارتفاع ١٠ ملم", "spacer", {"outer_diameter": 22, "inner_diameter": 8, "height": 10}),
        ("علاقة جدارية لاصقة بعرض 3 سم", "wall_hook", {"width": 30, "screw_diameter": 0}),
    ],
)
def test_parser_reads_values_in_both_languages(prompt, template, expected):
    spec = parse(prompt)
    assert spec.template == template
    for k, val in expected.items():
        assert spec.values()[k] == pytest.approx(val), k


def test_user_fields_override_prompt_and_missing_key_params_are_flagged():
    spec = parse("حامل هاتف بعرض 90 مم", user_fields={"width": 100})
    assert spec.values()["width"] == 100 and spec.params["width"].source == "user_field"
    assert spec.params["height"].source == "default"
    assert spec.clarifications, "missing height/angle must produce clarification questions"


def test_out_of_range_values_are_errors_not_silently_clamped():
    spec = parse("phone stand 500 mm wide")
    assert spec.errors and "width" in spec.errors[0]
    with pytest.raises(PipelineError) as exc:
        generate_parametric(spec)
    assert exc.value.code == "INVALID_PARAMETERS"


def test_unmatched_description_has_no_template():
    spec = parse("تمثال فني لحصان عربي")
    assert spec.template is None and spec.intended_use == "artistic"
    with pytest.raises(PipelineError) as exc:
        generate_parametric(spec)
    assert exc.value.code == "NO_TEMPLATE"


# ---------------------------------------------------------------- CSG kernel


def test_csg_difference_is_watertight_with_exact_volume():
    solid = box(40, 30, 10) - box(10, 10, 20, origin=(15, 10, -5))
    mesh = solid.to_mesh()
    info = analyse(mesh)
    assert info["watertight"] and info["inconsistent_winding_edges"] == 0
    assert mesh.signed_volume() == pytest.approx(40 * 30 * 10 - 10 * 10 * 10, rel=1e-9)


def test_csg_union_of_overlapping_boxes_volume():
    mesh = (box(20, 20, 20) | box(20, 20, 20, origin=(10, 10, 10))).to_mesh()
    assert analyse(mesh)["watertight"]
    assert mesh.signed_volume() == pytest.approx(2 * 8000 - 1000, rel=1e-9)


def test_hole_is_never_undersized():
    d = 5.0
    mesh = (box(20, 20, 5) - hole(d, 7, center=(10, 10, -1))).to_mesh()
    # the inscribed radius of the cut polygon is d/2: every bore vertex sits at r >= d/2
    v = mesh.vertices
    r = np.hypot(v[:, 0] - 10, v[:, 1] - 10)
    bore = r[r < 5]
    assert bore.min() >= d / 2 - 1e-9


# ---------------------------------------------------------------- templates


@pytest.mark.parametrize("key", sorted(TEMPLATES))
def test_every_template_builds_a_validated_mesh_at_defaults(key):
    spec = parse(TEMPLATES[key].title_en, template_key=key)
    result = generate_parametric(spec)
    assert result.status == VALIDATED, result.post_export_validation["issues"]
    assert result.triangles > 0


def test_phone_stand_example_end_to_end_produces_exact_stl():
    result = generate_parametric(parse(EXAMPLE_AR))
    assert result.status == VALIDATED
    assert result.size_mm == {"x": 90.0, "y": 80.0, "z": 110.0}
    reopened = read_stl(result.stl)
    info = analyse(reopened)
    assert info["watertight"] and info["bodies"] == 1
    ext = reopened.extents()
    assert ext[0] == pytest.approx(90, abs=1e-3) and ext[2] == pytest.approx(110, abs=1e-3)
    # the charging slot removes material from the front lip in the middle only
    lip_tops = reopened.vertices[(reopened.vertices[:, 1] < 6) & (reopened.vertices[:, 2] > 16.9)]
    xs = lip_tops[:, 0]
    assert xs.min() < 10 and xs.max() > 80
    assert not np.any((xs > 45 - 6.9) & (xs < 45 + 6.9)), "slot region must have no lip-top vertices"


def test_phone_stand_slot_reduces_volume():
    base = parse("phone stand", template_key="phone_stand")
    with_slot = parse("phone stand with cable slot", template_key="phone_stand")
    v0 = read_stl(generate_parametric(base).stl).signed_volume()
    v1 = read_stl(generate_parametric(with_slot).stl).signed_volume()
    assert v1 < v0


def test_derived_dimension_is_reported_not_silent():
    spec = parse("phone stand tilt angle 45 degrees base depth 60 mm")
    result = generate_parametric(spec)
    assert result.size_mm["y"] > 60
    assert any("base_depth" in t for t in result.transforms)


def test_build_volume_warning():
    spec = parse("box 200x200x150 mm")
    result = generate_parametric(spec, PrintConstraints(build_volume_mm=(180, 180, 180)))
    assert result.status == VALID_WITH_WARNINGS
    codes = [i["code"] for i in result.post_export_validation["issues"]]
    assert "EXCEEDS_BUILD_VOLUME" in codes


def test_thin_wall_warning():
    spec = parse("box 60x40x30 mm", user_fields={"wall": 1.2})
    result = generate_parametric(spec, PrintConstraints(min_wall_thickness_mm=1.6))
    assert result.status == VALID_WITH_WARNINGS
    assert "THIN_WALLS" in [i["code"] for i in result.post_export_validation["issues"]]


# ---------------------------------------------------------------- validation & repair


def _cube_mesh() -> Mesh:
    return box(10, 10, 10).to_mesh()


def test_open_mesh_requires_repair():
    m = _cube_mesh()
    opened = Mesh(m.vertices, m.faces[2:])
    _, report = validate(opened)
    assert report.status == REPAIR_REQUIRED
    assert "OPEN_EDGES" in [i.code for i in report.issues]


def test_flipped_faces_are_repaired():
    m = _cube_mesh()
    faces = m.faces.copy()
    faces[:3] = faces[:3, ::-1]
    fixed, report = validate(Mesh(m.vertices, faces))
    assert report.status == VALIDATED
    assert any("re-oriented" in r for r in report.repairs_applied)
    assert fixed.signed_volume() == pytest.approx(1000)


def test_inside_out_mesh_is_flipped():
    m = _cube_mesh()
    fixed, report = validate(Mesh(m.vertices, m.faces[:, ::-1]))
    assert report.status == VALIDATED and fixed.signed_volume() > 0


def test_triangle_soup_is_welded():
    m = _cube_mesh()
    soup = Mesh(m.triangles().reshape(-1, 3), np.arange(len(m.faces) * 3).reshape(-1, 3))
    _, report = validate(soup)
    assert report.status == VALIDATED
    assert any("welded" in r for r in report.repairs_applied)


def test_empty_and_flat_meshes_are_invalid():
    assert validate(Mesh.empty())[1].status == INVALID
    flat = Mesh(np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], float), np.array([[0, 1, 2], [0, 2, 1]]))
    assert validate(flat)[1].status in (INVALID, REPAIR_REQUIRED)


def test_two_bodies_warn():
    two = (box(10, 10, 10) | box(10, 10, 10, origin=(30, 0, 0))).to_mesh()
    _, report = validate(two)
    assert report.status == VALID_WITH_WARNINGS
    assert "MULTIPLE_BODIES" in [i.code for i in report.issues]


# ---------------------------------------------------------------- file formats


def test_stl_binary_roundtrip_and_ascii_read():
    m = _cube_mesh()
    data = write_stl(m)
    assert len(data) == 84 + 50 * len(m.faces)
    back = read_stl(data)
    assert back.signed_volume() == pytest.approx(1000)
    ascii_lines = ["solid t"]
    for tri in m.triangles():
        ascii_lines += ["facet normal 0 0 0", "outer loop"] + [f"vertex {x} {y} {z}" for x, y, z in tri] + ["endloop", "endfacet"]
    ascii_lines.append("endsolid t")
    assert read_stl("\n".join(ascii_lines).encode()).signed_volume() == pytest.approx(1000)


def test_stl_binary_starting_with_solid_is_read_as_binary():
    data = write_stl(_cube_mesh(), header="solid but actually binary")
    assert read_stl(data).signed_volume() == pytest.approx(1000)


def test_truncated_files_are_rejected():
    data = write_stl(_cube_mesh())
    with pytest.raises(MeshFormatError):
        read_stl(data[:-30])
    with pytest.raises(MeshFormatError):
        read_glb(b"glTF" + struct.pack("<II", 2, 9999) + b"\0" * 12)


def test_obj_reader_with_quads():
    obj = b"v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n"
    m = read_obj(obj)
    assert len(m.faces) == 2


def _make_glb(mesh: Mesh, scale: float = 1.0) -> bytes:
    import json
    pos = (mesh.vertices * scale).astype("<f4").tobytes()
    idx = mesh.faces.astype("<u4").tobytes()
    gltf = {
        "asset": {"version": "2.0"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "translation": [5, 0, 0]}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "buffers": [{"byteLength": len(pos) + len(idx)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos)},
                        {"buffer": 0, "byteOffset": len(pos), "byteLength": len(idx)}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": len(mesh.vertices), "type": "VEC3"},
                      {"bufferView": 1, "componentType": 5125, "count": mesh.faces.size, "type": "SCALAR"}],
    }
    js = json.dumps(gltf).encode()
    js += b" " * (-len(js) % 4)
    binc = pos + idx
    binc += b"\0" * (-len(binc) % 4)
    total = 12 + 8 + len(js) + 8 + len(binc)
    return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
            + struct.pack("<I4s", len(binc), b"BIN\x00") + binc)


def test_glb_in_metres_y_up_is_converted_to_mm_z_up():
    # a 0.02 × 0.05 × 0.01 m box, Y-up (glTF convention) → 20 mm wide, 50 mm tall, 10 mm deep
    glb = _make_glb(box(0.02, 0.05, 0.01).to_mesh())
    res = process_mesh(glb, "model.glb")
    assert res.status == VALIDATED
    assert res.size_mm == pytest.approx({"x": 20.0, "y": 10.0, "z": 50.0})
    assert any("m → mm" in t for t in res.transforms) and any("Y-up" in t for t in res.transforms)


def test_process_mesh_scales_only_on_explicit_request():
    glb = _make_glb(box(0.02, 0.05, 0.01).to_mesh())
    res = process_mesh(glb, "model.glb", target_longest_mm=120)
    assert res.size_mm["z"] == pytest.approx(120, abs=1e-3)
    assert any("uniformly scaled" in t for t in res.transforms)


def test_garbage_input_is_rejected():
    with pytest.raises(PipelineError) as exc:
        process_mesh(b"\x00\x01not a mesh at all" * 10, "x.bin")
    assert exc.value.code == "UNREADABLE_MESH"


# ---------------------------------------------------------------- real provider files in the repo


REAL_GLBS = sorted((REPO / "public" / "models").glob("*.glb")) + sorted((REPO / "storage" / "models").glob("*.glb"))


@pytest.mark.skipif(not REAL_GLBS, reason="no Tripo GLB fixtures present")
@pytest.mark.parametrize("path", REAL_GLBS, ids=lambda p: p.name[:24])
def test_real_tripo_glbs_convert_and_get_an_honest_status(path):
    res = process_mesh(path.read_bytes(), path.name, target_longest_mm=100)
    assert res.status in (VALIDATED, VALID_WITH_WARNINGS, REPAIR_REQUIRED)
    reopened = read_stl(res.stl)
    assert max(reopened.extents()) == pytest.approx(100, abs=0.01)
