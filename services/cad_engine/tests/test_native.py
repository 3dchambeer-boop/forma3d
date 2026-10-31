"""OpenCascade (real OCCT kernel) through the native executor — exact analytic checks on B-Rep geometry.

Skipped when the forma_occ binary is not built (see docs/CAD_ENGINE.md). These are the same checks as
test_occ.py (CadQuery backend), run on the same plans.
"""

import base64
import json
import math
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from cad_engine import kernel, native
from cad_engine.plan import CadError, plan

if not native.binary():
    pytest.skip("forma_occ (native OpenCascade executor) is not built", allow_module_level=True)

STARTERS = json.loads((Path(__file__).parent / "fixtures" / "starters_js.json").read_text())


def run(model, formats=(), params=None, place=False, quality=None):
    return native.run({"tree": plan(model, params)["tree"], "place_on_bed": place, "formats": list(formats), "quality": quality or {"linear_mm": 0.01, "angular_deg": 5}})


def vol(model):
    r = run(model)["report"]
    assert r["valid"] and r["solids"] == 1, r
    return r["volume_mm3"], r


def close(a, b, rel=1e-6):
    assert math.isclose(a, b, rel_tol=rel), (a, b)


def test_kernel_is_real_occt():
    assert native.kernel_name().startswith("OCCT 7.")


def test_fillet_box_is_exactly_the_steiner_volume():
    a, b, c, r = 40, 30, 20, 5
    x, y, z = a - 2 * r, b - 2 * r, c - 2 * r
    v, rep = vol({"fillet_box": {"size": [a, b, c], "r": r}})
    close(v, x * y * z + 2 * (x * y + y * z + x * z) * r + math.pi * (x + y + z) * r * r + 4 / 3 * math.pi * r ** 3)
    assert rep["faces"] == 26  # 6 planes + 12 cylinders + 8 spheres


def test_chamfer_box_volume():
    # box minus 12 edge wedges (d^2/2 * L each); at each of the 8 corners the wedges overlap (inclusion-exclusion:
    # -3 * d^3/3 + d^3/4), and OCCT closes the corner with a flat triangle through (d,0,0),(0,d,0),(0,0,d), which also
    # removes the small pyramid between that triangle and the point (d/2,d/2,d/2) where the three edge planes meet:
    # (1/3) * (sqrt(3)/2 d^2) * (d / (2 sqrt(3))) = d^3/12.  Net per corner: 6d^3/8 - d^3/12.  (Measured on OCCT 7.8.1.)
    a, b, c, d = 40, 30, 20, 2
    v, _ = vol({"chamfer_box": {"size": [a, b, c], "d": d}})
    close(v, a * b * c - 2 * d * d * (a + b + c) + 6 * d ** 3 - 8 * d ** 3 / 12, rel=1e-9)


def test_profile_fillet_and_chamfer_are_exact():
    sq = [[0, 0], [40, 0], [40, 40], [0, 40]]
    close(vol({"extrude": {"points": sq, "h": 10, "fillet": 5}})[0], (1600 - (4 - math.pi) * 25) * 10)
    close(vol({"extrude": {"points": sq, "h": 10, "chamfer": 5}})[0], 15500)


def test_edge_fillet_on_vertical_edges_equals_rounded_box():
    close(vol({"fillet_edges": {"r": 4, "edges": "|Z", "child": {"box": {"size": [40, 30, 20]}}}})[0], 40 * 30 * 20 - (4 - math.pi) * 16 * 20)


def test_single_edge_chamfer_removes_a_triangular_prism():
    close(vol({"chamfer_edges": {"d": 2, "edges": {"near": [[20, 0, 0]]}, "child": {"box": {"size": [40, 30, 20]}}}})[0], 24000 - 2 * 40)


def test_shell_closed_and_open():
    close(vol({"shell": {"thickness": 2, "child": {"box": {"size": [40, 30, 20]}}}})[0], 24000 - 36 * 26 * 16)
    close(vol({"shell": {"thickness": 2, "open": ">Z", "child": {"box": {"size": [40, 30, 20]}}}})[0], 24000 - 36 * 26 * 18)


def test_offset_of_a_cube_is_the_steiner_body():
    close(vol({"offset": {"distance": 1, "child": {"box": {"size": [10, 10, 10]}}}})[0], 1000 + 600 + math.pi * 30 + 4 / 3 * math.pi, rel=1e-5)


def test_draft_turns_a_box_into_a_square_frustum():
    v, rep = vol({"draft": {"angle": 5, "faces": "#Z", "neutral_z": 0, "child": {"box": {"size": [40, 40, 20], "center": False}}}})
    a1 = 40 * 40
    for top in (40 - 2 * 20 * math.tan(math.radians(5)), 40 + 2 * 20 * math.tan(math.radians(5))):
        a2 = top * top
        if math.isclose(v, 20 / 3 * (a1 + a2 + math.sqrt(a1 * a2)), rel_tol=1e-6):
            break
    else:
        pytest.fail(f"draft volume {v} is neither frustum")


def test_loft_sweep_revolve_and_prisms_are_exact():
    sq, small = [[0, 0], [40, 0], [40, 40], [0, 40]], [[10, 10], [30, 10], [30, 30], [10, 30]]
    close(vol({"loft": {"sections": [{"points": sq, "z": 0}, {"points": small, "z": 30}]}})[0], 10 * (1600 + 400 + 800))
    P = [[-3, -3], [3, -3], [3, 3], [-3, 3]]
    close(vol({"sweep": {"profile": P, "path": [[0, 0, 3], [50, 0, 3], [50, 40, 3]]}})[0], 36 * 90)
    close(vol({"revolve": {"profile": [[0, 0], [10, 0], [10, 20], [0, 20]]}})[0], math.pi * 100 * 20)
    close(vol({"cylinder": {"d": "13.2/cos(30)", "h": 6, "segments": 6}})[0], (math.sqrt(3) / 2) * 13.2 ** 2 * 6)
    close(vol({"cylinder": {"d": 20, "h": 10}})[0], math.pi * 100 * 10)  # true cylinder, not a polygon
    close(vol({"torus": {"R": 20, "r": 5}})[0], 2 * math.pi ** 2 * 20 * 25)


def test_booleans_and_patterns():
    close(vol({"difference": [{"box": {"size": [40, 40, 10]}}, {"cylinder": {"d": 10, "h": 12}, "translate": [20, 20, -1]}]})[0], 16000 - math.pi * 25 * 10)
    # overlapping copies fuse into one solid (disjoint copies would be several solids, which vol() refuses)
    close(vol({"linear_array": {"count": 3, "step": [8, 0, 0], "child": {"box": {"size": [10, 10, 10]}}}})[0], 10 * 10 * 26)
    close(vol({"mirror_copy": {"axis": "x", "child": {"box": {"size": [10, 10, 10]}, "translate": [-2, 0, 0]}}})[0], 16 * 10 * 10)


def test_invalid_geometry_is_refused_with_its_model_path():
    with pytest.raises(CadError, match=r"model\.fillet_edges"):
        run({"fillet_edges": {"r": 6, "edges": "all", "child": {"box": {"size": [10, 10, 10]}}}})
    with pytest.raises(CadError, match=r"left no material"):
        run({"difference": [{"box": {"size": [10, 10, 10]}}, {"box": {"size": [20, 20, 20]}, "translate": [-5, -5, -5]}]})
    with pytest.raises(CadError, match=r"matched nothing"):
        run({"draft": {"angle": 3, "faces": "#Z", "child": {"sphere": {"r": 10}}}})
    with pytest.raises(CadError, match=r"model\.shell"):
        run({"shell": {"thickness": 6, "open": ">Z", "child": {"box": {"size": [10, 10, 10]}}}})


def test_step_round_trip_and_controlled_stl():
    out = run({"fillet_box": {"size": [40, 30, 20], "r": 5}}, formats=["step", "stl"], place=True)
    step, stl = out["exports"]["step"], out["exports"]["stl"]
    assert step["data"].startswith(b"ISO-10303-21") and step["check"]["ok"], step["check"]
    assert step["check"]["faces"] == [26, 26] and step["check"]["valid"]
    info = stl["check"]
    assert info["volume_rel_err"] < 1e-3 and len(stl["data"]) == 84 + 50 * info["triangles"]
    coarse = run({"fillet_box": {"size": [40, 30, 20], "r": 5}}, formats=["stl"], quality={"linear_mm": 0.5, "angular_deg": 30})["exports"]["stl"]["check"]
    assert coarse["triangles"] < info["triangles"]
    assert out["report"]["bounds"]["min"] == pytest.approx([0, 0, 0], abs=1e-7)


@pytest.mark.parametrize("key", sorted(STARTERS))
def test_starter_parity_with_the_browser_kernel(key):
    out = native.build_design(STARTERS[key]["design"], formats=[])
    r = out["report"]
    assert r["valid"] and r["solids"] == 1, r
    assert math.isclose(r["volume_mm3"], STARTERS[key]["mesh_volume_mm3"], rel_tol=0.015), (r["volume_mm3"], STARTERS[key]["mesh_volume_mm3"])
    for ax in "xyz":
        assert abs(r["size_mm"][ax] - STARTERS[key]["size_mm"][ax]) < 0.5


def test_kernel_selector_and_3mf():
    out = kernel.build({"model": {"box": {"size": [10, 20, 30]}}}, formats=["step", "3mf"])
    assert out["backend"] in ("native", "cadquery") and out["exports"]["step"]["check"]["ok"]
    import io
    import zipfile

    z = zipfile.ZipFile(io.BytesIO(out["exports"]["3mf"]["data"]))
    assert 'unit="millimeter"' in z.read("3D/3dmodel.model").decode()


def test_stdlib_http_service(monkeypatch):
    from cad_engine.server import serve

    monkeypatch.setenv("CAD_SERVICE_TOKEN", "t0k-for-tests")
    monkeypatch.setenv("CAD_ALLOWED_ORIGINS", "null")
    srv = serve("127.0.0.1", 0)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    try:
        health = json.loads(urllib.request.urlopen(base + "/v1/cad/health").read())
        assert health["ok"] and "OCCT" in health["kernel"]

        def post(body, token="t0k-for-tests"):
            req = urllib.request.Request(base + "/v1/cad/build", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "X-CAD-Token": token, "Origin": "null"})
            try:
                r = urllib.request.urlopen(req)
                return r.status, json.loads(r.read()), r.headers
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read()), e.headers

        code, _, _ = post({"design": {"model": {"box": {"size": [1, 1, 1]}}}}, token="wrong")
        assert code == 401
        code, body, hdr = post({"design": {"model": {"fillet_box": {"size": [40, 30, 20], "r": 5}}}, "formats": ["step", "stl"]})
        assert code == 200 and body["exports"]["step"]["check"]["ok"] and hdr["Access-Control-Allow-Origin"] == "null"
        assert base64.b64decode(body["exports"]["step"]["base64"]).startswith(b"ISO-10303-21")
        code, body, _ = post({"design": {"model": {"fillet_edges": {"r": 6, "edges": "all", "child": {"box": {"size": [10, 10, 10]}}}}}})
        assert code == 422 and body["detail"]["code"] == "CAD_ERROR" and "fillet_edges" in body["detail"]["path"]
        code, _, _ = post({"design": {"model": {"box": {"size": [1, 1, 1]}}}, "formats": ["dwg"]})
        assert code == 400
    finally:
        srv.shutdown()


def test_boolean_identities_hold_on_a_revolve_with_ribs():
    # regression (OCCT 7.8.1): UnifySameDomain after this fuse returned a valid-looking solid that had lost 1320 mm3;
    # the executor now keeps the cleaned shape only when it is valid and keeps the volume.
    r, h = 35, 120
    outer = {"revolve": {"profile": [[0, 0], [r, 0], [r * 1.15, h * 0.35], [r * 0.7, h * 0.8], [r * 0.8, h], [0, h]], "segments": 72}}
    ribs = {"polar_array": {"count": 12, "child": {"cylinder": {"d": 5, "h": 84}, "translate": [r * 0.97, 0, 2]}}}
    def anyvol(m):  # the ribs alone (and the parts of them outside the body) are several separate solids
        r = run(m)["report"]
        assert r["valid"], r
        return r["volume_mm3"]

    o, u, d = vol(outer)[0], vol({"union": [outer, ribs]})[0], anyvol({"difference": [ribs, outer]})
    close(u - o, d, rel=1e-7)
    close(anyvol(ribs), 12 * math.pi * 2.5 ** 2 * 84, rel=1e-9)
    # Pappus for the revolved polyline
    pr = outer["revolve"]["profile"]
    close(o, sum(math.pi * (z2 - z1) / 3 * (r1 * r1 + r1 * r2 + r2 * r2) for (r1, z1), (r2, z2) in zip(pr, pr[1:])), rel=1e-9)


def test_cors_preflight_for_the_offline_file_and_private_network(monkeypatch):
    # found in the real-browser run: Chromium sends Origin "file://" (not only "null") and a Private Network Access
    # preflight; without these two answers the STEP button failed with "Failed to fetch"
    from cad_engine.server import serve

    monkeypatch.setenv("CAD_SERVICE_TOKEN", "t0k-for-tests")
    monkeypatch.setenv("CAD_ALLOWED_ORIGINS", "null")
    srv = serve("127.0.0.1", 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        def preflight(origin):
            req = urllib.request.Request(f"http://127.0.0.1:{srv.server_address[1]}/v1/cad/build", method="OPTIONS", headers={"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Private-Network": "true"})
            return urllib.request.urlopen(req).headers
        for o in ("null", "file://"):
            h = preflight(o)
            assert h["Access-Control-Allow-Origin"] == o and h["Access-Control-Allow-Private-Network"] == "true"
        h = preflight("https://evil.example")
        assert h["Access-Control-Allow-Origin"] is None and h["Access-Control-Allow-Private-Network"] is None
    finally:
        srv.shutdown()


# ---------------------------------------------------------------- STEP import (real OpenCascade reader)
def _step_of(model):
    return native.build_design({"model": model}, formats=["step"])["exports"]["step"]["data"]


def test_step_import_round_trip_keeps_the_exact_solid():
    data = _step_of({"fillet_box": {"size": [40, 30, 20], "r": 5}})
    out = kernel.import_step(data, ["stl", "3mf"], {"linear_mm": 0.01, "angular_deg": 5})
    r = out["report"]
    assert r["valid"] and r["solids"] == 1 and r["faces"] == 26
    close(r["volume_mm3"], vol({"fillet_box": {"size": [40, 30, 20], "r": 5}})[0], rel=1e-9)
    assert out["import"]["file_length_unit"].upper() in ("MM", "MILLIMETRE", "MILLIMETER")
    stl = out["exports"]["stl"]
    assert stl["check"]["volume_rel_err"] < 1e-3 and len(stl["data"]) == 84 + 50 * stl["check"]["triangles"]
    assert out["exports"]["3mf"]["data"][:2] == b"PK"


def test_step_import_converts_units_to_millimetres():
    data = _step_of({"box": {"size": [10, 20, 30]}})
    assert b"SI_UNIT(.MILLI.,.METRE.)" in data
    cm = data.replace(b"SI_UNIT(.MILLI.,.METRE.)", b"SI_UNIT(.CENTI.,.METRE.)")
    r = kernel.import_step(cm, ["stl"])["report"]
    assert r["size_mm"] == pytest.approx({"x": 100, "y": 200, "z": 300}, rel=1e-9)
    close(r["volume_mm3"], 6000 * 1000, rel=1e-9)


def test_step_import_keeps_several_solids_and_enforces_limits():
    data = _step_of({"linear_array": {"count": 3, "step": [20, 0, 0], "child": {"box": {"size": [10, 10, 10]}}}})
    r = kernel.import_step(data, ["stl"])["report"]
    assert r["solids"] == 3 and r["valid"]
    close(r["volume_mm3"], 3000, rel=1e-9)
    with pytest.raises(CadError, match="more than 10 faces"):
        native.import_step(data, ["stl"], max_faces=10)


def test_step_import_refuses_what_is_not_a_step_solid():
    with pytest.raises(CadError, match="not a STEP file"):
        kernel.import_step(b"solid x\nendsolid x\n", ["stl"])
    with pytest.raises(CadError, match="not a readable STEP file|no shape|no transferable"):
        kernel.import_step(b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n", ["stl"])


def test_step_import_over_http(monkeypatch):
    from cad_engine.server import serve

    monkeypatch.setenv("CAD_SERVICE_TOKEN", "t0k-for-tests")
    monkeypatch.setenv("CAD_MAX_IMPORT_MB", "1")
    srv = serve("127.0.0.1", 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/v1/cad/import"
    data = _step_of({"cylinder": {"d": 20, "h": 10}})

    def post(body, qs="formats=stl", token="t0k-for-tests"):
        req = urllib.request.Request(f"{base}?{qs}", data=body, headers={"Content-Type": "application/step", "X-CAD-Token": token})
        try:
            r = urllib.request.urlopen(req)
            return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    try:
        assert post(data, token="bad")[0] == 401
        code, body = post(data, "formats=stl,3mf&linear_mm=0.02&angular_deg=5")
        assert code == 200 and body["report"]["faces"] == 3
        close(body["report"]["volume_mm3"], math.pi * 100 * 10, rel=1e-9)
        assert set(body["exports"]) == {"stl", "3mf"} and body["exports"]["stl"]["check"]["volume_rel_err"] < 2e-3
        assert post(b"not a step", "formats=stl")[0] == 422
        assert post(data, "formats=dwg")[0] == 400
        assert post(b"ISO-10303-21;" + b" " * (1024 * 1024 + 10))[0] == 413
    finally:
        srv.shutdown()
