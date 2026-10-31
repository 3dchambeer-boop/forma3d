"""cad_engine HTTP API (FastAPI) — B-Rep builds and STEP/STL/3MF exports.

POST /v1/cad/build   {design, overrides?, formats: ["step","stl","3mf"], quality: {linear_mm, angular_deg}}
                     -> {report, exports: {step: {check, base64}, stl: {check, base64}, ...}}
GET  /v1/cad/health  -> {ok, kernel}

Auth: X-CAD-Token must equal CAD_SERVICE_TOKEN. For a single-user Windows machine you may set
CAD_ALLOW_NO_AUTH=1 and bind to 127.0.0.1 only (the default in __main__).
CORS: CAD_ALLOWED_ORIGINS (comma separated). "null" admits the offline forma-offline.html file.
Kernel: CadQuery (occ.py) or the native OCCT executor (native.py), see kernel.py. server.py serves the same
contract without FastAPI.
"""

from __future__ import annotations

import base64
import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import __version__
from .plan import CadError

TOKEN = os.environ.get("CAD_SERVICE_TOKEN", "")
ALLOW_NO_AUTH = os.environ.get("CAD_ALLOW_NO_AUTH") == "1"
if not TOKEN and not ALLOW_NO_AUTH:
    raise RuntimeError("CAD_SERVICE_TOKEN is required (or CAD_ALLOW_NO_AUTH=1 for a local single-user machine)")
MAX_EXPORT_BYTES = int(os.environ.get("CAD_MAX_EXPORT_MB", "50")) * 1024 * 1024

app = FastAPI(title="cad_engine", version=__version__, description="FormaCAD -> OpenCascade B-Rep -> STEP / STL / 3MF")
origins = [o.strip() for o in os.environ.get("CAD_ALLOWED_ORIGINS", "").split(",") if o.strip()]
if "null" in origins:  # the offline file: browsers send "null", Chromium with file access flags sends "file://"
    origins.append("file://")
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-CAD-Token"])

    @app.middleware("http")
    async def private_network_access(request, call_next):
        # Chromium Private Network Access preflight (same rule as server.py, where it is tested in a real browser)
        resp = await call_next(request)
        if request.method == "OPTIONS" and request.headers.get("access-control-request-private-network") == "true" and (request.headers.get("origin") in origins or "*" in origins):
            resp.headers["Access-Control-Allow-Private-Network"] = "true"
        return resp


def require_token(x_cad_token: str | None = Header(default=None)) -> None:
    if ALLOW_NO_AUTH and not TOKEN:
        return
    if not x_cad_token or not hmac.compare_digest(x_cad_token, TOKEN):
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "invalid CAD service token"})


class Quality(BaseModel):
    linear_mm: float = Field(0.01, gt=0, le=1)
    angular_deg: float = Field(5.0, gt=0, le=45)


class BuildRequest(BaseModel):
    design: dict
    overrides: dict = Field(default_factory=dict)
    formats: list[str] = Field(default_factory=lambda: ["step"])
    quality: Quality = Field(default_factory=Quality)


@app.get("/v1/cad/health")
def health():
    from . import kernel

    av = kernel.available()
    b = kernel.backend()
    return {"ok": b is not None, "kernel": av.get(b) if b else None, "backends": av, "version": __version__}


@app.post("/v1/cad/build", dependencies=[Depends(require_token)])
def build(req: BuildRequest):
    from . import kernel

    bad = set(req.formats) - {"step", "stl", "3mf"}
    if bad:
        raise HTTPException(400, {"code": "BAD_FORMAT", "message": f"unknown formats {sorted(bad)}"})
    if kernel.backend() is None:
        raise HTTPException(503, {"code": "KERNEL_MISSING", "message": "OpenCascade is not installed on this server"})
    try:
        out = kernel.build(req.design, req.overrides, req.formats, {"linear_mm": req.quality.linear_mm, "angular_deg": req.quality.angular_deg})
    except CadError as e:
        raise HTTPException(422, {"code": "CAD_ERROR", "message": str(e), "path": e.path}) from None
    report = out["report"]
    if not report["valid"] or report["solids"] != 1:
        raise HTTPException(422, {"code": "GEOMETRY_INVALID", "message": "the B-Rep is not one valid solid", "report": report})
    exports = {}
    for fmt, e in out["exports"].items():
        if len(e["data"]) > MAX_EXPORT_BYTES:
            raise HTTPException(413, {"code": "TOO_LARGE", "message": f"{fmt} export is larger than {MAX_EXPORT_BYTES} bytes; lower the mesh quality"})
        exports[fmt] = {"check": e["check"], "bytes": len(e["data"]), "base64": base64.b64encode(e["data"]).decode()}
    return {"report": report, "stats": out["stats"], "backend": out["backend"], "exports": exports}
