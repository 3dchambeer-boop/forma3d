"""Short-lived artifact store for engine outputs.

The engine is not the system of record. It keeps each STL just long enough
for the web app's worker to fetch it into private storage, then deletes it.
IDs are random 128-bit hex strings; anything else is rejected, so a request
can never name a path outside the store.
"""

from __future__ import annotations

import os
import re
import secrets
import time
from pathlib import Path

_ID = re.compile(r"^[0-9a-f]{32}$")


class ArtifactStore:
    def __init__(self, root: str | os.PathLike, ttl_seconds: int = 3600):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.ttl = ttl_seconds

    def put(self, data: bytes, suffix: str = ".stl") -> str:
        if suffix not in (".stl",):
            raise ValueError("unsupported artifact type")
        artifact_id = secrets.token_hex(16)
        path = self.root / f"{artifact_id}{suffix}"
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        os.chmod(tmp, 0o600)
        tmp.replace(path)
        return artifact_id

    def path(self, artifact_id: str) -> Path | None:
        if not _ID.match(artifact_id or ""):
            return None
        p = self.root / f"{artifact_id}.stl"
        return p if p.is_file() else None

    def delete(self, artifact_id: str) -> bool:
        p = self.path(artifact_id)
        if p:
            p.unlink(missing_ok=True)
            return True
        return False

    def sweep(self) -> int:
        cutoff = time.time() - self.ttl
        removed = 0
        for p in self.root.iterdir():
            try:
                if p.stat().st_mtime < cutoff:
                    p.unlink()
                    removed += 1
            except FileNotFoundError:
                pass
        return removed
