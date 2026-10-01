"""Tests for the db-backup sidecar (`docker/backup/backup.py`).

The sidecar is a standalone script outside the `aymurai` package, so it is
loaded by path. Every test runs against a real SQLite database in WAL mode
under `tmp_path` -- no mocks: the point is that the copy is consistent under
WAL, which only a real database can show.
"""

import hashlib
import importlib.util
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
