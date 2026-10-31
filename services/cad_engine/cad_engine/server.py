"""The same HTTP contract as app.py, on the Python standard library only (no FastAPI/uvicorn needed).

    python -m cad_engine serve-stdlib --port 8200
POST /v1/cad/build {design, overrides?, formats, quality?} -> {report, stats, backend, exports: {fmt: {check, bytes, base64}}}
POST /v1/cad/import?formats=stl,3mf  (body: a STEP file) -> {report, import, backend, exports}
GET  /v1/cad/health -> {ok, kernel, backends}
Auth and CORS follow the same environment variables as app.py (CAD_SERVICE_TOKEN / CAD_ALLOW_NO_AUTH,
CAD_ALLOWED_ORIGINS). Requests are limited in size and handled one build at a time.
"""

from __future__ import annotations

import base64
import hmac
import json
import os
import threading
from urllib.parse import parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__, kernel
from .plan import CadError

MAX_BODY = 2 * 1024 * 1024
LOCK = threading.Lock()


def make_handler(token: str, allow_no_auth: bool, origins: list[str], max_export: int, max_import: int = 25 * 1024 * 1024):
    class H(BaseHTTPRequestHandler):
        server_version = "cad_engine/" + __version__

        def log_message(self, fmt, *args):  # one line per request, no bodies (they may hold customer designs)
            print(f"{self.address_string()} {self.command} {self.path} {args[1] if len(args) > 1 else ''} origin={self.headers.get('Origin')!r}", flush=True)

        def _cors(self):
            o = self.headers.get("Origin")
            if o and (o in origins or "*" in origins):
                self.send_header("Access-Control-Allow-Origin", o)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-CAD-Token")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                # Chromium "Private Network Access": a page (or file://) calling a service on localhost/LAN is refused
                # unless the preflight answers this header (measured: without it the browser STEP button fails)
                if self.headers.get("Access-Control-Request-Private-Network") == "true":
                    self.send_header("Access-Control-Allow-Private-Network", "true")

        def _send(self, code: int, obj: dict):
            b = json.dumps(obj).encode()
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            if self.path != "/v1/cad/health":
                return self._send(404, {"detail": {"code": "NOT_FOUND"}})
            av = kernel.available()
            b = kernel.backend()
            self._send(200, {"ok": b is not None, "kernel": av.get(b) if b else None, "backends": av, "version": __version__})

        def _drain(self, n: int) -> None:
            # read (and drop) a moderately oversized body so the client receives the 413 instead of a broken pipe;
            # anything larger is not read at all and the connection is closed after the answer
            self.close_connection = True
            if 0 < n <= 64 * 1024 * 1024:
                left = n
                while left > 0:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    left -= len(chunk)

        def _authorized(self) -> bool:
            if allow_no_auth and not token:
                return True
            got = self.headers.get("X-CAD-Token") or ""
            return bool(token) and hmac.compare_digest(got, token)

        def _exports(self, out) -> dict | None:
            exports = {}
            for f, e in out["exports"].items():
                if len(e["data"]) > max_export:
                    self._send(413, {"detail": {"code": "TOO_LARGE", "message": f"{f} export is larger than {max_export} bytes"}})
                    return None
                exports[f] = {"check": e["check"], "bytes": len(e["data"]), "base64": base64.b64encode(e["data"]).decode()}
            return exports

        def do_POST(self):
            path, _, query = self.path.partition("?")
            if path == "/v1/cad/import":
                return self._import(query)
            if path != "/v1/cad/build":
                return self._send(404, {"detail": {"code": "NOT_FOUND"}})
            if not self._authorized():
                return self._send(401, {"detail": {"code": "UNAUTHORIZED", "message": "invalid CAD service token"}})
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > MAX_BODY:
                self._drain(n)
                return self._send(413, {"detail": {"code": "TOO_LARGE", "message": "request body missing or larger than 2 MB"}})
            try:
                req = json.loads(self.rfile.read(n))
                design = req["design"]
                assert isinstance(design, dict)
            except Exception:  # noqa: BLE001
                return self._send(400, {"detail": {"code": "BAD_REQUEST", "message": "expected JSON {design, overrides?, formats?, quality?}"}})
            formats = req.get("formats") or ["step"]
            if not isinstance(formats, list) or set(formats) - {"step", "stl", "3mf"}:
                return self._send(400, {"detail": {"code": "BAD_FORMAT", "message": f"unknown formats {formats}"}})
            q = req.get("quality") or {}
            try:
                q = {"linear_mm": float(q.get("linear_mm", 0.01)), "angular_deg": float(q.get("angular_deg", 5.0))}
                assert 0 < q["linear_mm"] <= 1 and 0 < q["angular_deg"] <= 45
            except Exception:  # noqa: BLE001
                return self._send(400, {"detail": {"code": "BAD_QUALITY", "message": "linear_mm in (0, 1], angular_deg in (0, 45]"}})
            if kernel.backend() is None:
                return self._send(503, {"detail": {"code": "KERNEL_MISSING", "message": "OpenCascade is not installed on this server"}})
            try:
                with LOCK:
                    out = kernel.build(design, req.get("overrides") or {}, formats, q)
            except CadError as e:
                return self._send(422, {"detail": {"code": "CAD_ERROR", "message": str(e), "path": e.path}})
            except Exception as e:  # noqa: BLE001
                return self._send(500, {"detail": {"code": "KERNEL_FAILURE", "message": str(e)[:300]}})
            r = out["report"]
            if not r["valid"] or r["solids"] != 1:
                return self._send(422, {"detail": {"code": "GEOMETRY_INVALID", "message": "the B-Rep is not one valid solid", "report": r}})
            exports = self._exports(out)
            if exports is not None:
                self._send(200, {"report": r, "stats": out["stats"], "backend": out["backend"], "exports": exports})

        # POST /v1/cad/import?formats=stl,3mf&linear_mm=0.05&angular_deg=10   body: the STEP file itself
        def _import(self, query: str):
            if not self._authorized():
                return self._send(401, {"detail": {"code": "UNAUTHORIZED", "message": "invalid CAD service token"}})
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > max_import:
                self._drain(n)
                return self._send(413, {"detail": {"code": "TOO_LARGE", "message": f"STEP body missing or larger than {max_import // (1024 * 1024)} MB"}})
            qs = parse_qs(query)
            formats = [f for f in ",".join(qs.get("formats", ["stl"])).split(",") if f]
            if not formats or set(formats) - {"step", "stl", "3mf"}:
                return self._send(400, {"detail": {"code": "BAD_FORMAT", "message": f"unknown formats {formats}"}})
            try:
                q = {"linear_mm": float(qs.get("linear_mm", ["0.05"])[0]), "angular_deg": float(qs.get("angular_deg", ["10"])[0])}
                assert 0 < q["linear_mm"] <= 1 and 0 < q["angular_deg"] <= 45
            except Exception:  # noqa: BLE001
                return self._send(400, {"detail": {"code": "BAD_QUALITY", "message": "linear_mm in (0, 1], angular_deg in (0, 45]"}})
            data = self.rfile.read(n)
            try:
                with LOCK:
                    out = kernel.import_step(data, formats, q)
            except CadError as e:
                return self._send(422, {"detail": {"code": "CAD_ERROR", "message": str(e), "path": e.path}})
            except RuntimeError as e:
                return self._send(503, {"detail": {"code": "KERNEL_MISSING", "message": str(e)}})
            except Exception as e:  # noqa: BLE001
                return self._send(500, {"detail": {"code": "KERNEL_FAILURE", "message": str(e)[:300]}})
            exports = self._exports(out)
            if exports is not None:
                self._send(200, {"report": out["report"], "import": out.get("import", {}), "backend": out["backend"], "exports": exports})

    return H


def serve(host: str = "127.0.0.1", port: int = 8200) -> ThreadingHTTPServer:
    token = os.environ.get("CAD_SERVICE_TOKEN", "")
    allow = os.environ.get("CAD_ALLOW_NO_AUTH") == "1"
    if not token and not allow:
        raise SystemExit("CAD_SERVICE_TOKEN is required (or CAD_ALLOW_NO_AUTH=1 for a local single-user machine)")
    origins = [o.strip() for o in os.environ.get("CAD_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    if "null" in origins:  # the offline file: browsers send "null", Chromium with file access flags sends "file://"
        origins.append("file://")
    max_export = int(os.environ.get("CAD_MAX_EXPORT_MB", "50")) * 1024 * 1024
    max_import = int(os.environ.get("CAD_MAX_IMPORT_MB", "25")) * 1024 * 1024
    return ThreadingHTTPServer((host, port), make_handler(token, allow, origins, max_export, max_import))
