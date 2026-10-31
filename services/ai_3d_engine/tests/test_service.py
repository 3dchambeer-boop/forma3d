"""Sandbox, artifact store and (when FastAPI is installed) HTTP API tests."""

from __future__ import annotations

import os

import pytest

from ai_3d_engine.artifacts import ArtifactStore
from ai_3d_engine.geometry.io import read_stl
from ai_3d_engine.sandbox import Limits, SandboxError, run_isolated

EXAMPLE = "حامل هاتف بعرض 90 مم وارتفاع 110 مم وفتحة شحن وزاوية ميل 65 درجة"


def test_sandbox_runs_parametric_job_and_returns_real_stl():
    out = run_isolated("parametric", {"prompt": EXAMPLE, "use_llm": False})
    assert out["metadata"]["status"] == "VALIDATED"
    mesh = read_stl(out["stl"])
    assert mesh.extents()[0] == pytest.approx(90, abs=1e-3)


def test_sandbox_reports_pipeline_errors_with_codes():
    with pytest.raises(SandboxError) as exc:
        run_isolated("parametric", {"prompt": "phone stand 900 mm wide", "use_llm": False})
    assert exc.value.code == "INVALID_PARAMETERS"


def test_sandbox_enforces_wall_clock_timeout():
    with pytest.raises(SandboxError) as exc:
        run_isolated("parametric", {"prompt": EXAMPLE, "use_llm": False}, Limits(wall_seconds=0.01))
    assert exc.value.code == "TIMEOUT"


def test_sandbox_enforces_memory_limit():
    # 40 MB of address space is not enough to import numpy and run the job
    with pytest.raises(SandboxError) as exc:
        run_isolated("parametric", {"prompt": EXAMPLE, "use_llm": False}, Limits(memory_mb=40))
    assert exc.value.code in ("OUT_OF_MEMORY", "CRASHED", "ENGINE_ERROR")


def test_artifact_store_rejects_path_traversal_and_expires(tmp_path):
    store = ArtifactStore(tmp_path, ttl_seconds=0)
    aid = store.put(b"solid x\nendsolid x\n")
    assert store.path(aid) is not None
    for bad in ("../etc/passwd", aid + "/..", "A" * 32, "", aid[:-1]):
        assert store.path(bad) is None
    os.utime(store.path(aid), (0, 0))
    assert store.sweep() == 1 and store.path(aid) is None
