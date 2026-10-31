"""OpenCascade integration tests — exact analytic checks on real B-Rep geometry.

Skipped automatically when cadquery/OCP is not installed. Run on the target machine:
    pip install -r services/cad_engine/requirements.txt
    cd services/cad_engine && python -m pytest -q
Until these pass there, the OpenCascade service is IMPLEMENTED_BUT_UNVERIFIED.
"""

import json
import math
from pathlib import Path

import pytest

cq = pytest.importorskip("cadquery")

from cad_engine import export, occ  # noqa: E402
from cad_engine.plan import CadError, design_plan, plan  # noqa: E402

STARTERS = json.loads((Path(__file__).parent / "fixtures" / "starters_js.json").read_text())


def solid(model, params=None):
    return occ.build(plan(model, params)["tree"])


def vol(model):
    s = solid(model)
    r = occ.solid_report(s)
    assert r["valid"] and r["solids"] == 1, r
    return r["volume_mm3"], s


def close(a, b, rel=1e-6):
    assert math.isclose(a, b, rel_tol=rel), (a, b)


def test_fillet_box_is_exactly_the_steiner_volume():
    a, b, c, r = 40, 30, 20, 5
    x, y, z = a - 2 * r, b - 2 * r, c - 2 * r
    v, _ = vol({"fillet_box": {"size": [a, b, c], "r": r}})
    close(v, x * y * z + 2 * (x * y + y * z + x * z) * r + math.pi * (x + y + z) * r * r + 4 / 3 * math.pi * r ** 3)


def test_profile_fillet_and_chamfer_are_exact():
    sq = [[0, 0], [40, 0], [40, 40], [0, 40]]
    close(vol({"extrude": {"points": sq, "h": 10, "fillet": 5}})[0], (1600 - (4 - math.pi) * 25) * 10)
    close(vol({"extrude": {"points": sq, "h": 10, "chamfer": 5}})[0], 15500)


def test_edge_fillet_on_vertical_edges_equals_rounded_box():
    v1, _ = vol({"fillet_edges": {"r": 4, "edges": "|Z", "child": {"box": {"size": [40, 30, 20]}}}})
    close(v1, 40 * 30 * 20 - (4 - math.pi) * 16 * 20)


def test_single_edge_chamfer_removes_a_triangular_prism():
    v, _ = vol({"chamfer_edges": {"d": 2, "edges": {"near": [[20, 0, 0]]}, "child": {"box": {"size": [40, 30, 20]}}}})
    close(v, 24000 - 2 * 40)


def test_impossible_fillet_fails_with_its_path():
    with pytest.raises(CadError, match=r"model\.fillet_edges"):
        solid({"fillet_edges": {"r": 6, "edges": "all", "child": {"box": {"size": [10, 10, 10]}}}})


def test_shell_closed_and_open():
    close(vol({"shell": {"thickness": 2, "child": {"box": {"size": [40, 30, 20]}}}})[0], 24000 - 36 * 26 * 16)
    close(vol({"shell": {"thickness": 2, "open": ">Z", "child": {"box": {"size": [40, 30, 20]}}}})[0], 24000 - 36 * 26 * 18)


def test_offset_of_a_cube_is_the_steiner_body():
    v, _ = vol({"offset": {"distance": 1, "child": {"box": {"size": [10, 10, 10]}}}})
    close(v, 1000 + 600 + math.pi * 30 + 4 / 3 * math.pi, rel=1e-5)


def test_draft_tilts_the_side_faces_by_the_angle():
    _, s = vol({"draft": {"angle": 5, "faces": "#Z", "neutral_z": 0, "child": {"box": {"size": [40, 40, 20]}}}})
    bb = s.BoundingBox()
    top = cq.Workplane().add(s).faces(">Z").val().BoundingBox()
    shrink = 2 * 20 * math.tan(math.radians(5))
    assert math.isclose(abs(bb.xlen - top.xlen), shrink, rel_tol=1e-4) or math.isclose(abs(top.xlen - 40), shrink, rel_tol=1e-4)


def test_loft_sweep_revolve_are_exact():
    sq, small = [[0, 0], [40, 0], [40, 40], [0, 40]], [[10, 10], [30, 10], [30, 30], [10, 30]]
    close(vol({"loft": {"sections": [{"points": sq, "z": 0}, {"points": small, "z": 30}]}})[0], 10 * (1600 + 400 + 800))
    P = [[-3, -3], [3, -3], [3, 3], [-3, 3]]
    close(vol({"sweep": {"profile": P, "path": [[0, 0, 3], [50, 0, 3], [50, 40, 3]]}})[0], 36 * 90)
    close(vol({"revolve": {"profile": [[0, 0], [10, 0], [10, 20], [0, 20]]}})[0], math.pi * 100 * 20)


def test_hex_prism_is_exact():
    v, _ = vol({"cylinder": {"d": "13.2/cos(30)", "h": 6, "segments": 6}})
    close(v, (math.sqrt(3) / 2) * 13.2 ** 2 * 6)


def test_step_round_trip_and_controlled_stl():
    _, s = vol({"fillet_box": {"size": [40, 30, 20], "r": 5}})
    data, check = export.step_bytes(s)
    assert data.startswith(b"ISO-10303-21") and check["ok"], check
    stl, info = export.stl_bytes(s, 0.01, 5)
    assert info["volume_rel_err"] < 1e-3 and len(stl) == 84 + 50 * info["triangles"]
    coarse = export.stl_bytes(s, 0.5, 30)[1]
    assert coarse["triangles"] < info["triangles"]


@pytest.mark.parametrize("key", sorted(STARTERS))
def test_starter_parity_with_the_browser_kernel(key):
    shape, _ = occ.build_design(STARTERS[key]["design"])
    r = occ.solid_report(shape)
    assert r["valid"] and r["solids"] == 1, r
    # the browser mesh is a polygonal approximation of the same design: within 1.5 %
    assert math.isclose(r["volume_mm3"], STARTERS[key]["mesh_volume_mm3"], rel_tol=0.015), (r["volume_mm3"], STARTERS[key]["mesh_volume_mm3"])
    for ax in "xyz":
        assert abs(r["size_mm"][ax] - STARTERS[key]["size_mm"][ax]) < 0.5
