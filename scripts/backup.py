#!/usr/bin/env python3
"""FORMA·3D backup / verify / restore (Python 3 standard library only).

  backup.py create  --db data/db/custom.db --dir data/storage --dir data/logs --out backups [--keep 14]
  backup.py verify  backups/forma-backup-20261030T120000Z.tar.gz
  backup.py restore backups/forma-backup-....tar.gz --db data/db/custom.db --dir data/storage --dir data/logs [--force]

- The database is copied with SQLite's online backup API, so a backup taken while the app is writing is consistent;
  the copy must pass PRAGMA integrity_check before it is archived.
- Every file in the archive is listed in manifest.json with its SHA-256; verify and restore re-check all of them.
- Restore verifies first, refuses to overwrite existing data unless --force, and then moves the old data aside
  (<path>.pre-restore-<time>) instead of deleting it. Stop the app and worker before restoring.
- Secrets (.env) are not backed up: keep them in your secret store.
With Docker Compose: run it on the host against the app-data volume's mount point
(docker volume inspect <project>_app-data --format '{{.Mountpoint}}'): db/custom.db, storage/ and logs/ inside it.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import sqlite3
import sys
import tarfile
import tempfile
import time
from pathlib import Path

FORMAT = 1


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def sqlite_copy(src: Path, dst: Path) -> dict:
    s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    d = sqlite3.connect(dst)
    try:
        s.backup(d)  # online, page-by-page, consistent snapshot
    finally:
        s.close()
    try:
        ok = d.execute("PRAGMA integrity_check").fetchone()[0]
        if ok != "ok":
            raise SystemExit(f"backup copy failed integrity_check: {ok}")
        tables = [r[0] for r in d.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        counts = {t: d.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
    finally:
        d.close()
    return counts


def create(a) -> Path:
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    name = f"forma-backup-{stamp}.tar.gz"
    files: list[dict] = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        stage: list[tuple[Path, str]] = []
        db_counts = None
        if a.db:
            src = Path(a.db)
            if not src.exists():
                raise SystemExit(f"database not found: {src}")
            copy = tmp / "db.sqlite"
            db_counts = sqlite_copy(src, copy)
            stage.append((copy, "db/" + src.name))
        for d in a.dir or []:
            root = Path(d)
            if not root.is_dir():
                print(f"note: {root} does not exist, skipped", file=sys.stderr)
                continue
            for p in sorted(root.rglob("*")):
                if p.is_file() and not p.is_symlink():
                    stage.append((p, f"dirs/{root.name}/{p.relative_to(root).as_posix()}"))
        for p, arc in stage:
            files.append({"path": arc, "bytes": p.stat().st_size, "sha256": sha256_file(p)})
        manifest = {"format": FORMAT, "created_utc": stamp, "db": {"name": Path(a.db).name, "rows": db_counts} if a.db else None,
                    "dirs": [Path(d).name for d in a.dir or []], "files": files}
        part = out / (name + ".part")
        with tarfile.open(part, "w:gz") as t:
            b = json.dumps(manifest, indent=1, ensure_ascii=False).encode()
            ti = tarfile.TarInfo("manifest.json"); ti.size = len(b); ti.mtime = int(time.time()); ti.mode = 0o600
            t.addfile(ti, io.BytesIO(b))
            for p, arc in stage:
                t.add(p, arcname=arc, recursive=False)
        os.chmod(part, 0o600)
        part.rename(out / name)  # a crash never leaves a half archive under the final name
    if a.keep:
        old = sorted(out.glob("forma-backup-*.tar.gz"))[: -a.keep]
        for p in old:
            p.unlink()
    print(json.dumps({"archive": str(out / name), "files": len(files), "db_rows": db_counts}, ensure_ascii=False))
    return out / name


def _safe_members(t: tarfile.TarFile):
    for m in t.getmembers():
        p = Path(m.name)
        if p.is_absolute() or ".." in p.parts or not (m.isfile()):
            raise SystemExit(f"unsafe archive member refused: {m.name}")
        yield m


def verify(archive: str, quiet=False) -> dict:
    with tarfile.open(archive, "r:gz") as t:
        members = {m.name: m for m in _safe_members(t)}
        if "manifest.json" not in members:
            raise SystemExit("no manifest.json: not a FORMA backup")
        man = json.loads(t.extractfile(members["manifest.json"]).read())
        if man.get("format") != FORMAT:
            raise SystemExit(f"unsupported backup format {man.get('format')}")
        listed = {f["path"]: f for f in man["files"]}
        extra = set(members) - set(listed) - {"manifest.json"}
        if extra:
            raise SystemExit(f"files not in the manifest: {sorted(extra)[:5]}")
        for path, f in listed.items():
            if path not in members:
                raise SystemExit(f"missing from archive: {path}")
            h = hashlib.sha256(t.extractfile(members[path]).read()).hexdigest()
            if h != f["sha256"]:
                raise SystemExit(f"checksum mismatch: {path}")
        if man.get("db"):
            with tempfile.TemporaryDirectory() as tmp:
                dbp = Path(tmp) / "db.sqlite"
                dbp.write_bytes(t.extractfile(members["db/" + man["db"]["name"]]).read())
                c = sqlite3.connect(dbp)
                try:
                    ok = c.execute("PRAGMA integrity_check").fetchone()[0]
                finally:
                    c.close()
                if ok != "ok":
                    raise SystemExit(f"database in the archive failed integrity_check: {ok}")
    if not quiet:
        print(json.dumps({"archive": archive, "ok": True, "files": len(listed), "created_utc": man["created_utc"]}))
    return man


def restore(a) -> None:
    man = verify(a.archive, quiet=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    targets: list[tuple[str, Path]] = []
    if man.get("db"):
        if not a.db:
            raise SystemExit("the archive holds a database: pass --db <path>")
        targets.append(("db/" + man["db"]["name"], Path(a.db)))
    dir_by_name = {Path(d).name: Path(d) for d in a.dir or []}
    for n in man["dirs"]:
        if n not in dir_by_name:
            raise SystemExit(f"the archive holds directory '{n}': pass --dir <path>/{n}")
    existing = [p for _, p in targets if p.exists()] + [p for p in dir_by_name.values() if p.exists() and any(p.iterdir())]
    if existing and not a.force:
        raise SystemExit(f"refusing to overwrite existing data {[str(p) for p in existing]} (stop the app, then use --force; old data is kept aside)")
    for p in existing:
        p.rename(p.with_name(p.name + f".pre-restore-{stamp}"))
    with tarfile.open(a.archive, "r:gz") as t:
        for m in _safe_members(t):
            if m.name == "manifest.json":
                continue
            if m.name.startswith("db/"):
                dst = Path(a.db)
            else:
                _, dname, rel = m.name.split("/", 2)
                dst = dir_by_name[dname] / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            with t.extractfile(m) as src, open(dst, "wb") as out:
                shutil.copyfileobj(src, out)
    if a.db:
        c = sqlite3.connect(a.db)
        try:
            ok = c.execute("PRAGMA integrity_check").fetchone()[0]
        finally:
            c.close()
        if ok != "ok":
            raise SystemExit(f"restored database failed integrity_check: {ok}")
    print(json.dumps({"restored": a.archive, "moved_aside": [str(p) for p in existing]}))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create"); c.add_argument("--db"); c.add_argument("--dir", action="append"); c.add_argument("--out", required=True); c.add_argument("--keep", type=int, default=0)
    v = sub.add_parser("verify"); v.add_argument("archive")
    r = sub.add_parser("restore"); r.add_argument("archive"); r.add_argument("--db"); r.add_argument("--dir", action="append"); r.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "create":
        create(a)
    elif a.cmd == "verify":
        verify(a.archive)
    else:
        restore(a)
    return 0


if __name__ == "__main__":
    sys.exit(main())
