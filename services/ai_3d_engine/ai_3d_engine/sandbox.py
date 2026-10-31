"""Run geometry work in a separate, resource-limited process.

Uploaded meshes and provider downloads are untrusted. Parsing and repairing
them runs in a child process with an address-space cap, a CPU-time cap and a
wall-clock timeout, so a pathological file cannot exhaust the service.
The child receives plain data and returns plain data; nothing from the input
is ever executed.
"""

from __future__ import annotations

import multiprocessing as mp
import os
import resource
import traceback
from dataclasses import dataclass


@dataclass(frozen=True)
class Limits:
    memory_mb: int = int(os.environ.get("ENGINE_JOB_MEMORY_MB", "2048"))
    cpu_seconds: int = int(os.environ.get("ENGINE_JOB_CPU_SECONDS", "120"))
    wall_seconds: float = float(os.environ.get("ENGINE_JOB_WALL_SECONDS", "180"))


class SandboxError(Exception):
    def __init__(self, code: str, message: str, details: object | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


def _child(conn, task: str, kwargs: dict, limits: Limits) -> None:
    try:
        resource.setrlimit(resource.RLIMIT_AS, (limits.memory_mb * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (limits.cpu_seconds, limits.cpu_seconds + 5))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        from . import tasks  # imported after limits are in place

        conn.send(("ok", getattr(tasks, task)(**kwargs)))
    except MemoryError:
        conn.send(("error", ("OUT_OF_MEMORY", f"job exceeded {limits.memory_mb} MB", None)))
    except Exception as exc:  # noqa: BLE001 — everything is reported, nothing is swallowed
        code = getattr(exc, "code", "ENGINE_ERROR")
        message = getattr(exc, "message", str(exc))
        details = getattr(exc, "details", None)
        if code == "ENGINE_ERROR":
            details = traceback.format_exc(limit=5)
        conn.send(("error", (code, message, details)))
    finally:
        conn.close()


def run_isolated(task: str, kwargs: dict, limits: Limits | None = None) -> dict:
    lim = limits or Limits()
    ctx = mp.get_context("spawn")  # fresh interpreter: no inherited state or open files
    parent, child = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_child, args=(child, task, kwargs, lim), daemon=True)
    proc.start()
    child.close()
    try:
        if not parent.poll(lim.wall_seconds):
            raise SandboxError("TIMEOUT", f"job exceeded {lim.wall_seconds:g} s wall-clock limit")
        try:
            status, payload = parent.recv()
        except EOFError:
            raise SandboxError("CRASHED", f"worker process died (exit code {proc.exitcode}); likely CPU/memory limit") from None
    finally:
        if proc.is_alive():
            proc.kill()
        proc.join(5)
        parent.close()
    if status == "ok":
        return payload
    code, message, details = payload
    raise SandboxError(code, message, details)
