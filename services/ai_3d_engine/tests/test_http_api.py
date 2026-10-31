"""HTTP API tests; they need FastAPI (installed in the Docker image, absent in minimal environments)."""

from __future__ import annotations

import pytest

from ai_3d_engine.geometry.io import read_stl

EXAMPLE = "حامل هاتف بعرض 90 مم وارتفاع 110 مم وفتحة شحن وزاوية ميل 65 درجة"

fastapi = pytest.importorskip("fastapi", reason="FastAPI not installed in this environment")


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("ENGINE_SERVICE_TOKEN", "test-token")
    monkeypatch.setenv("ENGINE_ARTIFACT_DIR", str(tmp_path))
    import importlib

    from fastapi.testclient import TestClient

    import ai_3d_engine.app as app_module

    importlib.reload(app_module)
    return TestClient(app_module.app)


def test_http_requires_token(client):
    assert client.post("/v1/generate/parametric", json={"prompt": EXAMPLE}).status_code == 401


def test_http_generate_then_download(client):
    h = {"X-Engine-Token": "test-token"}
    r = client.post("/v1/generate/parametric", json={"prompt": EXAMPLE, "use_llm": False}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["metadata"]["status"] == "VALIDATED"
    stl = client.get(f"/v1/artifacts/{body['artifact_id']}", headers=h)
    assert stl.status_code == 200 and read_stl(stl.content).extents()[2] == pytest.approx(110, abs=1e-3)


def test_http_invalid_params_is_422(client):
    r = client.post("/v1/generate/parametric", json={"prompt": "phone stand 900 mm wide", "use_llm": False},
                    headers={"X-Engine-Token": "test-token"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "INVALID_PARAMETERS"
