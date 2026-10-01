#!/usr/bin/env python3
"""Periodic backup sidecar for AymurAI's internal SQLite database.

Runs `sqlite3.Connection.backup()` on an interval -- the correct method
under WAL, unlike copying the file with `cp` (which can capture the
database mid-checkpoint and produce a corrupt copy). Writes a new dated
file whenever the database changed since the latest backup -- a run whose
copy is byte-identical (sha256) to the latest one is discarded, so an idle
installation doesn't burn a retention slot every hour -- and prunes down to
the configured retention count, oldest first, no other logic (deliberately
"dumb" retention: see ADR-0014 and the design session that decided it).

Not part of the `aymurai` package: runs as a standalone entrypoint in its
own lightweight image, which is why it reads its env vars directly via
`os.environ` instead of through `aymurai.settings` -- that module isn't
available here, and there's no need for it to be. Env is read only in
`BackupConfig.from_env`; every other function takes its paths and limits
as parameters so tests can drive it against a temporary directory.

Usage:
    python backup.py            # infinite loop, one backup per BACKUP_INTERVAL_SECONDS
    python backup.py --once     # a single backup and exit (used by `make db-backup`)
"""

import hashlib
import os
import sqlite3
import sys
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


def log(message: str) -> None:
    """Writes one flushed line to stdout, which `docker compose logs` collects."""
    # Standalone sidecar script, not importable library code: there is no
    # house get_logger outside the `aymurai` package, and stdout is the log.
    # ast-grep-ignore: log-no-print
    print(f"[backup] {message}", flush=True)


@dataclass(frozen=True)
class BackupConfig:
    source_db: Path
    dest_dir: Path
    interval_seconds: int
    retention: int

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "BackupConfig":
        """Builds the config from `BACKUP_*` env vars (defaults match docker-compose.yml)."""
        # The sidecar image has no `aymurai.settings`; this is its only env read.
        # ast-grep-ignore: settings-module
        env = os.environ if env is None else env
        return cls(
            source_db=Path(
                env.get("BACKUP_SOURCE_DB", "/resources/cache/sqlite/database.db")
            ),
            dest_dir=Path(env.get("BACKUP_DEST_DIR", "/backups")),
            interval_seconds=int(env.get("BACKUP_INTERVAL_SECONDS", "3600")),
            retention=int(env.get("BACKUP_RETENTION", "336")),
        )


def latest_backup(dest_dir: Path) -> Path | None:
    """The most recent dated backup in `dest_dir`, or `None` if there is none.

    The timestamp in the name is fixed-width and zero-padded, so the last
    name in sorted order is the newest.
    """
    backups = sorted(dest_dir.glob("database_*.db"))
    return backups[-1] if backups else None


def _sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def run_backup(source_db: Path, dest_dir: Path, *, strict: bool = False) -> Path | None:
    """Writes one dated backup of `source_db` into `dest_dir`.

    Writes to a temporary file outside the `database_*.db` glob first, and
    only renames it once the copy finishes -- so a backup that fails
    partway through never leaves a 0-byte `.db` file that looks like a
    valid backup, never consumes a retention slot, and never shows up as a
    restore candidate.

    Args:
        source_db: The live database to copy.
        dest_dir: Directory the dated backup is written to (created if missing).
        strict: Re-raise a failed backup instead of logging it -- a manual
            `--once` run must fail loudly, not report success.

    Returns:
        Path | None: The written backup's path, or `None` if there was no
            source database yet (a machine that has never run the API has
            nothing to back up, and that's not an error for the sidecar),
            the copy was identical to the latest backup and was discarded,
            or the backup failed in non-strict mode.
    """
    if not source_db.exists():
        log(f"no database at {source_db}, skipping this run")
        return None

    dest_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    dest_path = dest_dir / f"database_{timestamp}.db"
    tmp_path = dest_dir / f".database_{timestamp}.db.partial"

    try:
        source_conn = sqlite3.connect(str(source_db))
        try:
            dest_conn = sqlite3.connect(str(tmp_path))
            try:
                source_conn.backup(dest_conn)
            finally:
                dest_conn.close()
        finally:
            source_conn.close()
        latest = latest_backup(dest_dir)
        if latest is not None and _sha256(latest) == _sha256(tmp_path):
            tmp_path.unlink()
            log(f"unchanged since {latest.name}, skipped")
            return None
        tmp_path.replace(dest_path)  # atomic: only a complete copy gets the real name
    except (sqlite3.Error, OSError) as exc:
        tmp_path.unlink(missing_ok=True)
        log(f"FAILED to back up {source_db}: {exc}")
        if strict:
            raise
        return None  # the loop keeps running and pruning continues

    log(f"wrote {dest_path}")
    return dest_path


def prune_old_backups(dest_dir: Path, retention: int) -> None:
    """Keeps the `retention` most recent dated copies, deletes the rest.

    Sorting by filename is enough to sort chronologically: the timestamp
    is fixed-width, zero-padded. No logic beyond "oldest first" -- see the
    module docstring.

    `retention <= 0` means "don't prune anything" -- the safe direction,
    rather than reading it as "prune everything" (which would delete the
    backup just written).
    """
    if retention <= 0:
        return
    backups = sorted(dest_dir.glob("database_*.db"))
    for path in backups[:-retention]:
        path.unlink()
        log(f"pruned {path}")


def run(config: BackupConfig, *, once: bool) -> None:
    """Runs one backup+prune cycle, or loops forever on `config.interval_seconds`.

    `once` selects the single-cycle mode `make db-backup` and `db-restore`'s
    pre-restore safety snapshot use; it also makes a failed backup raise.
    """
    while True:
        run_backup(config.source_db, config.dest_dir, strict=once)
        prune_old_backups(config.dest_dir, config.retention)
        if once:
            return
        log(f"sleeping {config.interval_seconds}s")
        time.sleep(config.interval_seconds)


def main() -> None:
    """Entrypoint: reads the config from env and `--once` from the command line."""
    # A single boolean flag; a CLI framework would be a new dependency for
    # a stdlib-only image.
    # ast-grep-ignore: cli-typed-framework
    run(BackupConfig.from_env(), once="--once" in sys.argv[1:])


if __name__ == "__main__":
    main()
