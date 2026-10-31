"""Backup / verify / restore on a real SQLite database with a writer running during the backup."""
import json
import sqlite3
import subprocess
import sys
import tarfile
import threading
import time
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "backup.py"


def run(*args, ok=True):
    p = subprocess.run([sys.executable, "-I", str(SCRIPT), *map(str, args)], capture_output=True, text=True)
    if ok:
        assert p.returncode == 0, p.stderr
    return p


@pytest.fixture
def data(tmp_path):
    db = tmp_path / "data/db/custom.db"
    db.parent.mkdir(parents=True)
    c = sqlite3.connect(db)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE Project (id INTEGER PRIMARY KEY, title TEXT, sha TEXT)")
    c.executemany("INSERT INTO Project (title, sha) VALUES (?, ?)", [(f"p{i}", f"{i:064x}") for i in range(2000)])
    c.commit(); c.close()
    st = tmp_path / "data/storage"
    (st / "models").mkdir(parents=True)
    (st / "models/a.stl").write_bytes(b"solid a\nendsolid a\n" * 1000)
    (st / "models/b.stl").write_bytes(bytes(range(256)) * 400)
    return tmp_path, db, st


def test_backup_while_writing_then_restore_elsewhere(data, tmp_path):
    root, db, st = data
    stop = threading.Event()

    def writer():  # the app keeps writing during the backup
        c = sqlite3.connect(db, timeout=10)
        n = 0
        while not stop.is_set():
            c.execute("INSERT INTO Project (title, sha) VALUES (?, ?)", (f"live{n}", "x")); c.commit(); n += 1
        c.close()

    t = threading.Thread(target=writer); t.start()
    time.sleep(0.05)
    out = json.loads(run("create", "--db", db, "--dir", st, "--out", root / "backups").stdout)
    stop.set(); t.join()
    rows = out["db_rows"]["Project"]
    assert rows >= 2000 and out["files"] == 3
    run("verify", out["archive"])
    # restore into an empty place: the snapshot's rows, files byte-identical
    db2, st2 = tmp_path / "r/db/custom.db", tmp_path / "r/storage"
    run("restore", out["archive"], "--db", db2, "--dir", st2)
    c = sqlite3.connect(db2)
    assert c.execute("SELECT COUNT(*) FROM Project").fetchone()[0] == rows
    assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    c.close()
    assert (st2 / "models/b.stl").read_bytes() == (st / "models/b.stl").read_bytes()


def test_restore_refuses_to_overwrite_without_force_and_keeps_old_data_aside(data):
    root, db, st = data
    arc = json.loads(run("create", "--db", db, "--dir", st, "--out", root / "b").stdout)["archive"]
    p = run("restore", arc, "--db", db, "--dir", st, ok=False)
    assert p.returncode != 0 and "refusing to overwrite" in p.stderr
    run("restore", arc, "--db", db, "--dir", st, "--force")
    assert list(db.parent.glob("custom.db.pre-restore-*")) and list(st.parent.glob("storage.pre-restore-*"))


def test_tampered_or_unsafe_archives_are_refused(data, tmp_path):
    root, db, st = data
    arc = Path(json.loads(run("create", "--db", db, "--dir", st, "--out", root / "b").stdout)["archive"])
    # change one byte of a stored file
    bad = tmp_path / "bad.tar.gz"
    with tarfile.open(arc) as src, tarfile.open(bad, "w:gz") as dst:
        for m in src.getmembers():
            b = src.extractfile(m).read()
            if m.name.endswith("a.stl"):
                b = b"X" + b[1:]
            import io
            dst.addfile(m, io.BytesIO(b))
    p = run("verify", bad, ok=False)
    assert p.returncode != 0 and "checksum mismatch" in p.stderr
    # path traversal
    evil = tmp_path / "evil.tar.gz"
    with tarfile.open(evil, "w:gz") as t:
        import io
        ti = tarfile.TarInfo("../../etc/x"); ti.size = 1; t.addfile(ti, io.BytesIO(b"x"))
    p = run("verify", evil, ok=False)
    assert "unsafe archive member" in p.stderr


def test_retention_keeps_the_newest(data):
    root, db, st = data
    for i in range(3):
        run("create", "--db", db, "--out", root / "k", "--keep", 2)
        time.sleep(1.1)  # names carry the second
    assert len(list((root / "k").glob("forma-backup-*.tar.gz"))) == 2
