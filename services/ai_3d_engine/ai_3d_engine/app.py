"""ai_3d_engine HTTP API (FastAPI).

Internal service: it is called by the web app's job worker, never by browsers.
Every request must carry ``X-Engine-Token``; the service refuses to start
without ``ENGINE_SERVICE_TOKEN`` unless ``ENGINE_ALLOW_NO_AUTH=1`` (local dev).

OpenAPI docs: ``/docs`` and ``/openapi.json``.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import os
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import __version__
from .artifacts import ArtifactStore
from .sandbox import SandboxError, run_isolated
from .spec import llm
from .templates.library import TEMPLATES

TOKEN = os.environ.get("ENGINE_SERVICE_TOKEN", "")
ALLOW_NO_AUTH = os.environ.get("ENGINE_ALLOW_NO_AUTH") == "1"
if not TOKEN and not ALLOW_NO_AUTH:
    raise RuntimeError("ENGINE_SERVICE_TOKEN is required (set ENGINE_ALLOW_NO_AUTH=1 only for local development)")

MAX_UPLOAD_BYTES = int(os.environ.get("ENGINE_MAX_UPLOAD_MB", "100")) * 1024 * 1024
STORE = ArtifactStore(os.environ.get("ENGINE_ARTIFACT_DIR", "/tmp/ai_3d_engine_artifacts"),
                      ttl_seconds=int(os.environ.get("ENGINE_ARTIFACT_TTL_SECONDS", "3600")))
SLOTS = asyncio.Semaphore(int(os.environ.get("ENGINE_MAX_CONCURRENT_JOBS", "2")))

app = FastAPI(
    title="ai_3d_engine",
    version=__version__,
    description="Text → parametric CAD → validated STL, and provider/upload mesh → validated STL. Units: millimetres.",
)


def require_token(x_engine_token: str | None = Header(default=None)) -> None:
    if ALLOW_NO_AUTH and not TOKEN:
        return
    if not x_engine_token or not hmac.compare_digest(x_engine_token, TOKEN):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "invalid engine token"})


# ------------------------------------------------------------------ schemas


class Constraints(BaseModel):
    build_volume_mm: tuple[float, float, float] | None = Field(None, description="Printer build volume X, Y, Z (mm)")
    min_wall_thickness_mm: float | None = Field(None, gt=0, le=20)
    nozzle_diameter_mm: float | None = Field(None, gt=0, le=2)
    max_triangles: int | None = Field(None, gt=0, le=5_000_000)


class ParametricRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=2000, examples=["حامل هاتف بعرض 90 مم وارتفاع 110 مم وزاوية ميل 65 درجة"])
    user_fields: dict[str, float] = Field(default_factory=dict, description="Form values that override the prompt (mm/deg/count)")
    template: str | None = Field(None, description="Force a template key; otherwise chosen from the prompt")
    intended_use: Literal["functional", "artistic", "prototype"] | None = None
    constraints: Constraints = Field(default_factory=Constraints)
    use_llm: bool = Field(True, description="Use the LLM extractor when ANTHROPIC_API_KEY is configured")


class SpecRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=2000)
    user_fields: dict[str, float] = Field(default_factory=dict)
    template: str | None = None
    intended_use: Literal["functional", "artistic", "prototype"] | None = None
    use_llm: bool = True


class JobResponse(BaseModel):
    artifact_id: str = Field(..., description="Fetch the STL from GET /v1/artifacts/{artifact_id}; expires after the TTL")
    metadata: dict


# ------------------------------------------------------------------ helpers


async def _run(task: str, kwargs: dict) -> dict:
    async with SLOTS:
        try:
            return await asyncio.to_thread(run_isolated, task, kwargs)
        except SandboxError as exc:
            status = {"TIMEOUT": 504, "CRASHED": 500, "OUT_OF_MEMORY": 507, "ENGINE_ERROR": 500}.get(exc.code, 422)
            raise HTTPException(status_code=status, detail={"code": exc.code, "message": exc.message, "details": exc.details})


# ------------------------------------------------------------------ routes


@app.get("/healthz", tags=["ops"])
def healthz() -> dict:
    return {"status": "ok", "version": __version__}


@app.get("/v1/capabilities", tags=["ops"], dependencies=[Depends(require_token)])
def capabilities() -> dict:
    return {
        "version": __version__,
        "geometry_kernel": "bsp-csg (exact, numpy)",
        "spec_extractor": "llm" if llm.is_configured() else "rules",
        "templates": [t.schema() for t in TEMPLATES.values()],
        "input_formats": ["stl", "glb", "obj"],
        "output_formats": ["stl"],
        "max_upload_mb": MAX_UPLOAD_BYTES // (1024 * 1024),
    }


@app.post("/v1/spec/parse", tags=["generation"], dependencies=[Depends(require_token)])
async def spec_parse(req: SpecRequest) -> dict:
    return await _run("spec_only", req.model_dump())


@app.post("/v1/generate/parametric", tags=["generation"], response_model=JobResponse, dependencies=[Depends(require_token)])
async def generate(req: ParametricRequest) -> JobResponse:
    STORE.sweep()
    kwargs = req.model_dump()
    kwargs["constraints"] = req.constraints.model_dump(exclude_none=True)
    out = await _run("parametric", kwargs)
    return JobResponse(artifact_id=STORE.put(out["stl"]), metadata=out["metadata"])


@app.post("/v1/mesh/process", tags=["conversion"], response_model=JobResponse, dependencies=[Depends(require_token)])
async def mesh_process(
    file: UploadFile = File(..., description="STL, GLB or OBJ"),
    source_units: Literal["mm", "cm", "m", "in"] | None = Form(None),
    up_axis: Literal["y", "z"] | None = Form(None),
    target_longest_mm: float | None = Form(None, gt=0, le=2000),
    constraints: str | None = Form(None, description="JSON-encoded Constraints"),
) -> JobResponse:
    STORE.sweep()
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, detail={"code": "FILE_TOO_LARGE", "message": f"limit is {MAX_UPLOAD_BYTES} bytes"})
    try:
        c = Constraints.model_validate(json.loads(constraints)) if constraints else Constraints()
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(422, detail={"code": "BAD_CONSTRAINTS", "message": str(exc)})
    out = await _run("mesh", {
        "data": data,
        "filename": os.path.basename(file.filename or "upload"),
        "source_units": source_units,
        "up_axis": up_axis,
        "target_longest_mm": target_longest_mm,
        "constraints": c.model_dump(exclude_none=True),
    })
    return JobResponse(artifact_id=STORE.put(out["stl"]), metadata=out["metadata"])


@app.get("/v1/artifacts/{artifact_id}", tags=["artifacts"], dependencies=[Depends(require_token)])
def get_artifact(artifact_id: str) -> FileResponse:
    path = STORE.path(artifact_id)
    if not path:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "artifact not found or expired"})
    return FileResponse(path, media_type="model/stl", filename=f"{artifact_id}.stl")


@app.delete("/v1/artifacts/{artifact_id}", tags=["artifacts"], dependencies=[Depends(require_token)])
def delete_artifact(artifact_id: str) -> dict:
    return {"deleted": STORE.delete(artifact_id)}
