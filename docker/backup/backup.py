#!/usr/bin/env python3
"""Periodic backup sidecar for AymurAI's internal SQLite database.

Runs `sqlite3.Connection.backup()` on an interval -- the correct method
under WAL, unlike copying the file with `cp` (which can capture the
database mid-checkpoint and produce a corrupt copy). Writes a new dated
file on every run and prunes down to the configured retention count --
oldest first, no other logic (deliberately "dumb" retention: see
ADR-0014 and the design session that decided it).

Not part of the `aymurai` package: runs as a standalone entrypoint in its
own lightweight image, which is why it reads its env vars directly via
`os.environ` instead of through `aymurai.settings` -- that module isn't
available here, and there's no need for it to be.

Usage:
    python backup.py            # infinite loop, one backup per BACKUP_INTERVAL_SECONDS
    python backup.py --once     # a single backup and exit (used by `make db-backup`)
"""

import os
import sqlite3
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

SOURCE_DB = Path(
    os.environ.get("BACKUP_SOURCE_DB", "/resources/cache/sqlite/database.db")
)
DEST_DIR = Path(os.environ.get("BACKUP_DEST_DIR", "/backups"))
INTERVAL_SECONDS = int(os.environ.get("BACKUP_INTERVAL_SECONDS", "3600"))
RETENTION = int(os.environ.get("BACKUP_RETENTION", "30"))


def run_backup() -> Path | None:
    """Writes one dated backup.

    Writes to a temporary file outside the `database_*.db` glob first, and
    only renames it once the copy finishes -- so a backup that fails
    partway through never leaves a 0-byte `.db` file that looks like a
    valid backup, never consumes a retention slot, and never shows up as a
    restore candidate.

    Returns:
        Path | None: The written backup's path, or `None` if there was no
            source database yet -- a machine that has never run the API
            has nothing to back up, and that's not an error for the
            sidecar.
    """
    if not SOURCE_DB.exists():
        print(f"[backup] no hay base en {SOURCE_DB}, se salta esta corrida", flush=True)
        return None

    DEST_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    dest_path = DEST_DIR / f"database_{timestamp}.db"
    tmp_path = DEST_DIR / f".database_{timestamp}.db.partial"

    try:
        source_conn = sqlite3.connect(str(SOURCE_DB))
        try:
            dest_conn = sqlite3.connect(str(tmp_path))
            try:
                source_conn.backup(dest_conn)
            finally:
                dest_conn.close()
        finally:
            source_conn.close()
        tmp_path.replace(dest_path)  # atomic: only a complete copy gets the real name
    except (sqlite3.Error, OSError) as exc:
        tmp_path.unlink(missing_ok=True)
        print(f"[backup] FALLÓ el respaldo de {SOURCE_DB}: {exc}", flush=True)
        if "--once" in sys.argv:
            raise  # a manual run must fail loudly, not report success
        return None  # the loop keeps running and pruning continues

    print(f"[backup] escrito {dest_path}", flush=True)
    return dest_path


def prune_old_backups() -> None:
    """Keeps the RETENTION most recent dated copies, deletes the rest.

    Sorting by filename is enough to sort chronologically: the timestamp
    is fixed-width, zero-padded. No logic beyond "oldest first" -- see the
    module docstring.

    `RETENTION <= 0` means "don't prune anything" -- the safe direction,
    rather than reading it as "prune everything" (which would delete the
    backup just written).
    """
    if RETENTION <= 0:
        return
    backups = sorted(DEST_DIR.glob("database_*.db"))
    for path in backups[:-RETENTION]:
        path.unlink()
        print(f"[backup] podado {path}", flush=True)


def main() -> None:
    """Entrypoint: runs one backup+prune cycle, or loops forever on an interval.

    `--once` in `sys.argv` selects the single-cycle mode `make db-backup`
    and `db-restore`'s pre-restore safety snapshot use; otherwise this
    loops until the container is stopped.
    """
    once = "--once" in sys.argv
    while True:
        run_backup()
        prune_old_backups()
        if once:
            return
        print(f"[backup] durmiendo {INTERVAL_SECONDS}s", flush=True)
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
