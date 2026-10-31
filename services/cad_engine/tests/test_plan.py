"""Planner tests — run anywhere (no OpenCascade needed)."""

import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

from cad_engine.plan import CadError, design_plan, eval_expr, plan, round_corners

ROOT = Path(__file__).resolve().parents[3]
STARTERS = json.loads((Path(__file__).parent / "fixtures" / "starters_js.json").read_text())


def test_expressions_match_the_browser_kernel():
    cases = ["w/2 - t", "2+3*4^2", "sin(30)*2", "max(2, t*1.5)", "-(w)", "atan2(1, 1)", "round(2.5)", "w%7", "sqrt(w)*cos(60)"]
    vars_ = {"w": 90, "t": 5}
    py = [eval_expr(c, vars_, "x") for c in cases]
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    js_src = f"const C=require({json.dumps(str(ROOT / 'services/ai_3d_engine/browser/cad.js'))});console.log(JSON.stringify({json.dumps(cases)}.map(c=>C.evalExpr(c,{json.dumps(vars_)},'x'))))"
    js = json.loads(subprocess.check_output([node, "-e", js_src], text=True))
    for c, a, b in zip(cases, py, js):
        assert math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-12), (c, a, b)


@pytest.mark.parametrize("bad", ["alert(1)", "w;t", "constructor", "w*", "(w", "1/0", "this.x", "__import__('os')"])
def test_expressions_refuse_code(bad):
    with pytest.raises(CadError):
        eval_expr(bad, {"w": 1, "t": 1}, "p")


SQ = [[0, 0], [40, 0], [40, 40], [0, 40]]


def test_fillet_profile_is_exact():
    prof = round_corners(SQ, 5, "fillet", "p")
    assert sum(1 for s in prof.segs if s[0] == "arc") == 4
    assert math.isclose(prof.area(), 1600 - (4 - math.pi) * 25, rel_tol=1e-12)


def test_chamfer_and_mixed_reflex_fillets_are_exact():
    assert math.isclose(round_corners(SQ, 5, "chamfer", "p").area(), 1600 - 50, rel_tol=1e-12)
    L = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30]]
    k = 1 - math.pi / 4
    area = round_corners(L, [0, 3, 3, 6, 2, 2], "fillet", "p").area()
    assert math.isclose(area, 600 - k * (9 + 9 + 4 + 4) + k * 36, rel_tol=1e-12)


def test_fillet_that_does_not_fit_names_the_edge_like_the_browser():
    with pytest.raises(CadError, match=r"fillet radius too large between points 0 and 1: needs 12\.000 mm of a 10\.000 mm edge"):
        round_corners([[0, 0], [10, 0], [10, 10], [0, 10]], 6, "fillet", "model.extrude.fillet")


def test_arc_midpoints_lie_on_their_circles():
    prof = round_corners([[0, 0], [30, 0], [30, 20], [12, 20], [12, 35], [0, 35]], [2, 4, 3, 5, 3, 2], "fillet", "p")
    for s in prof.segs:
        if s[0] == "arc":
            _, mid, end, c, r = s
            assert math.isclose(math.dist(mid, c), r, rel_tol=1e-12)
            assert math.isclose(math.dist(end, c), r, rel_tol=1e-12)


@pytest.mark.parametrize("key", sorted(STARTERS))
def test_every_starter_design_plans(key):
    p = design_plan(STARTERS[key]["design"])
    assert p["tree"]["op"]
    assert p["stats"]["nodes"] >= 1


def test_six_segment_cylinder_becomes_an_exact_hex_prism():
    p = plan({"cylinder": {"d": 15.24, "h": 6, "segments": 6}})
    assert p["tree"]["op"] == "prism" and p["tree"]["n"] == 6


def test_brep_only_operations_and_their_checks():
    t = plan({"shell": {"thickness": 2, "open": ">Z", "child": {"fillet_edges": {"r": 3, "edges": "|Z", "child": {"box": {"size": [40, 30, 20]}}}}}})["tree"]
    assert t["op"] == "shell" and t["open"] == ">Z" and t["child"]["op"] == "fillet_edges" and t["child"]["edges"] == "|Z"
    t = plan({"chamfer_edges": {"d": 1, "edges": {"near": [[20, 0, 0]]}, "child": {"box": {"size": [40, 30, 20]}}}})["tree"]
    assert t["edges"] == {"near": [[20.0, 0.0, 0.0]]}
    with pytest.raises(CadError, match="unknown edge/face selector"):
        plan({"fillet_edges": {"r": 1, "edges": "top", "child": {"box": {"size": [1, 1, 1]}}}})
    with pytest.raises(CadError, match="non-uniform scale"):
        plan({"box": {"size": [1, 1, 1]}, "scale": [1, 2, 1]})
    with pytest.raises(CadError, match="draft angle"):
        plan({"draft": {"angle": 60, "child": {"box": {"size": [1, 1, 1]}}}})
    with pytest.raises(CadError, match=r"model\.union\[0\]\.box\.size"):
        plan({"union": [{"box": {"size": [1, 2]}}]})


def test_limits():
    with pytest.raises(CadError, match="count"):
        plan({"linear_array": {"count": 5000, "step": [1, 0, 0], "child": {"box": {"size": [1, 1, 1]}}}})
    with pytest.raises(CadError, match="larger than 2000"):
        plan({"cylinder": {"d": 5000, "h": 1}})
