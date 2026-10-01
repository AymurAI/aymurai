"""Tests for the db-backup sidecar (`docker/backup/backup.py`).

The sidecar is a standalone script outside the `aymurai` package, so it is
loaded by path. Every test runs against a real SQLite database in WAL mode
under `tmp_path` -- no mocks: the point is that the copy is consistent under
WAL, which only a real database can show.
"""

import hashlib
import importlib.util
import os
import re
import signal
import subprocess
import sys
import time
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest

BACKUP_SCRIPT = Path(__file__).resolve().parents[2] / "docker" / "backup" / "backup.py"


def _load_backup_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "aymurai_backup_sidecar", BACKUP_SCRIPT
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


backup = _load_backup_module()


@pytest.fixture
def dest_dir(tmp_path: Path) -> Path:
    return tmp_path / "backups"


@pytest.fixture
def wal_db(tmp_path: Path) -> Iterator[tuple[Path, sqlite3.Connection]]:
    """A WAL-mode database whose committed rows are still only in the -wal file.

    Auto-checkpointing is off and the writer connection stays open for the
    whole test, so nothing is folded back into the main file: a naive file
    copy of `database.db` would miss these rows.
    """
    path = tmp_path / "database.db"
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA wal_autocheckpoint=0")
    conn.execute("CREATE TABLE recommendation (id INTEGER PRIMARY KEY, body TEXT)")
    conn.executemany(
        "INSERT INTO recommendation (body) VALUES (?)", [(f"r{i}",) for i in range(50)]
    )
    conn.commit()
    yield path, conn
    conn.close()


def _backups(dest_dir: Path) -> list[Path]:
    return sorted(dest_dir.glob("database_*.db"))


def _partials(dest_dir: Path) -> list[Path]:
    return sorted(dest_dir.glob(".database_*.db.partial"))


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _fake_backup(dest_dir: Path, timestamp: str, content: bytes = b"old") -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    path = dest_dir / f"database_{timestamp}.db"
    path.write_bytes(content)
    return path


def test_backup_is_consistent_with_uncheckpointed_wal_data(wal_db, dest_dir):
    source, _writer = wal_db
    assert Path(f"{source}-wal").stat().st_size > 0  # rows live only in the WAL

    written = backup.run_backup(source, dest_dir)

    assert written is not None
    assert written in _backups(dest_dir)
    with sqlite3.connect(written) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert conn.execute("SELECT COUNT(*) FROM recommendation").fetchone() == (50,)
    assert _partials(dest_dir) == []


def test_missing_source_is_skipped_without_error(tmp_path, dest_dir):
    assert backup.run_backup(tmp_path / "nope.db", dest_dir) is None
    assert _backups(dest_dir) == []


def test_identical_content_is_not_written_twice(wal_db, dest_dir):
    source, _writer = wal_db
    first = backup.run_backup(source, dest_dir)

    second = backup.run_backup(source, dest_dir)

    assert first is not None
    assert second is None
    assert _backups(dest_dir) == [first]
    assert _partials(dest_dir) == []


def test_only_the_latest_backup_counts_as_unchanged(wal_db, dest_dir):
    """Content equal to an *older* backup (e.g. after a restore) is still written."""
    source, _writer = wal_db
    older = backup.run_backup(source, dest_dir)
    assert older is not None
    older = older.rename(dest_dir / "database_20000101000000.db")
    newer = _fake_backup(dest_dir, "20000101000001", b"a later, different state")

    written = backup.run_backup(source, dest_dir)

    assert written is not None
    assert _backups(dest_dir) == [older, newer, written]


def test_changed_content_is_written(wal_db, dest_dir):
    source, _writer = wal_db
    older = _fake_backup(dest_dir, "20000101000000", b"not the same bytes")

    written = backup.run_backup(source, dest_dir)

    assert written is not None
    assert _backups(dest_dir) == [older, written]
    assert _sha256(written) != _sha256(older)


def test_prune_keeps_the_newest_n(dest_dir):
    paths = [_fake_backup(dest_dir, f"2026010100000{i}") for i in range(5)]

    backup.prune_old_backups(dest_dir, retention=2)

    assert _backups(dest_dir) == paths[-2:]


@pytest.mark.parametrize("retention", [0, -1])
def test_non_positive_retention_never_prunes(dest_dir, retention):
    paths = [_fake_backup(dest_dir, f"2026010100000{i}") for i in range(5)]

    backup.prune_old_backups(dest_dir, retention=retention)

    assert _backups(dest_dir) == paths


def test_failed_backup_leaves_no_partial_and_loop_mode_swallows(tmp_path, dest_dir):
    corrupt = tmp_path / "database.db"
    corrupt.write_bytes(b"this is not a sqlite database" * 200)

    assert backup.run_backup(corrupt, dest_dir) is None
    assert _partials(dest_dir) == []
    assert _backups(dest_dir) == []


def test_once_reraises_a_failed_backup(tmp_path, dest_dir):
    corrupt = tmp_path / "database.db"
    corrupt.write_bytes(b"this is not a sqlite database" * 200)
    config = backup.BackupConfig(
        source_db=corrupt, dest_dir=dest_dir, interval_seconds=3600, retention=5
    )

    with pytest.raises(sqlite3.DatabaseError):
        backup.run(config, once=True)
    assert _partials(dest_dir) == []


def test_once_backs_up_and_prunes(wal_db, dest_dir):
    source, _writer = wal_db
    for i in range(3):
        _fake_backup(dest_dir, f"2000010100000{i}", f"old{i}".encode())
    config = backup.BackupConfig(
        source_db=source, dest_dir=dest_dir, interval_seconds=3600, retention=2
    )

    backup.run(config, once=True)

    kept = _backups(dest_dir)
    assert len(kept) == 2
    assert kept[0].name == "database_20000101000002.db"
    with sqlite3.connect(kept[1]) as conn:
        assert conn.execute("SELECT COUNT(*) FROM recommendation").fetchone() == (50,)


def test_from_env_reads_overrides_and_defaults():
    config = backup.BackupConfig.from_env(
        {"BACKUP_DEST_DIR": "/elsewhere", "BACKUP_RETENTION": "7"}
    )

    assert config.dest_dir == Path("/elsewhere")
    assert config.retention == 7
    assert config.source_db == Path("/resources/cache/sqlite/database.db")
    assert config.interval_seconds == 3600


def test_default_retention_spans_weeks_and_matches_compose():
    compose = (BACKUP_SCRIPT.parents[2] / "docker-compose.yml").read_text()
    match = re.search(r"BACKUP_RETENTION:-(\d+)", compose)

    assert match is not None
    assert backup.BackupConfig.from_env({}).retention == int(match.group(1)) == 336


def test_remove_stale_partials(dest_dir):
    real = _fake_backup(dest_dir, "20260101000000")
    stale = dest_dir / ".database_20260101000001.db.partial"
    stale.write_bytes(b"half a copy")

    backup.remove_stale_partials(dest_dir)

    assert not stale.exists()
    assert _backups(dest_dir) == [real]


def test_remove_stale_partials_tolerates_missing_dir(tmp_path):
    backup.remove_stale_partials(tmp_path / "does-not-exist")


def test_loop_cleans_stale_partials_and_exits_cleanly_on_sigterm(wal_db, dest_dir):
    source, _writer = wal_db
    dest_dir.mkdir()
    stale = dest_dir / ".database_20000101000000.db.partial"
    stale.write_bytes(b"left behind by a SIGKILL")
    env = {
        **os.environ,
        "BACKUP_SOURCE_DB": str(source),
        "BACKUP_DEST_DIR": str(dest_dir),
        "BACKUP_INTERVAL_SECONDS": "3600",
        "BACKUP_RETENTION": "5",
    }
    proc = subprocess.Popen(
        [sys.executable, str(BACKUP_SCRIPT)],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        deadline = time.monotonic() + 15
        while not _backups(dest_dir) and time.monotonic() < deadline:
            time.sleep(0.05)
        assert _backups(dest_dir), "the loop never wrote its first backup"

        proc.send_signal(signal.SIGTERM)
        output, _ = proc.communicate(timeout=5)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()

    assert proc.returncode == 0, output
    assert not stale.exists()
    assert _partials(dest_dir) == []
