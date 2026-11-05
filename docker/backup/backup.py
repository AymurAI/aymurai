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
import signal
import sqlite3
import sys
import tempfile
import time
from collections.abc import Callable, Mapping
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

    The timestamp in the name is fixed-width and zero-padded, and a
    same-second collision gets a `_NN` suffix that sorts after the bare
    name (`.` < `_`), so the last name in sorted order is the newest.
    """
    backups = sorted(dest_dir.glob("database_*.db"))
    return backups[-1] if backups else None


def _sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _publish(tmp_path: Path, dest_dir: Path, timestamp: str) -> Path:
    """Gives a finished copy its final name without ever overwriting a backup.

    Timestamps have 1-second resolution, and two runs can land in the same
    second (db-restore's pre-restore `--once` snapshot followed by the
    restarted loop's first run; `make db-backup` while the loop runs).
    `os.link` fails if the name is taken, so a collision moves on to
    `database_<ts>_01.db`, `_02`, ... -- names that still match the
    `database_*.db` glob and sort after the bare name and before the next
    second, keeping name order equal to time order.
    """
    for n in range(100):
        suffix = "" if n == 0 else f"_{n:02d}"
        candidate = dest_dir / f"database_{timestamp}{suffix}.db"
        try:
            os.link(tmp_path, candidate)
        except FileExistsError:
            continue
        tmp_path.unlink()
        return candidate
    raise FileExistsError(f"no free backup name for timestamp {timestamp}")


def run_backup(
    source_db: Path,
    dest_dir: Path,
    *,
    strict: bool = False,
    now: Callable[[], datetime] = _utc_now,
) -> Path | None:
    """Writes one dated backup of `source_db` into `dest_dir`.

    Writes to a temporary file outside the `database_*.db` glob first, and
    only gives it its final name once the copy finishes -- so a backup that
    fails partway through never leaves a 0-byte `.db` file that looks like
    a valid backup, never consumes a retention slot, and never shows up as
    a restore candidate. The temporary name is unique per run (`mkstemp`),
    so concurrent runs never write to -- or clean up -- each other's file,
    and the final name never replaces an existing backup (see `_publish`).

    Args:
        source_db: The live database to copy.
        dest_dir: Directory the dated backup is written to (created if missing).
        strict: Re-raise a failed backup instead of logging it -- a manual
            `--once` run must fail loudly, not report success.
        now: Clock for the UTC timestamp in the name (injectable for tests).

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
    timestamp = now().strftime("%Y%m%d%H%M%S")
    tmp_path: Path | None = None

    try:
        fd, tmp_name = tempfile.mkstemp(
            prefix=f".database_{timestamp}_", suffix=".db.partial", dir=dest_dir
        )
        os.close(fd)
        tmp_path = Path(tmp_name)
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
        dest_path = _publish(tmp_path, dest_dir, timestamp)
    except (sqlite3.Error, OSError) as exc:
        if tmp_path is not None:
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


def remove_stale_partials(dest_dir: Path) -> None:
    """Deletes `.database_*.db.partial` files left by a killed earlier run.

    A partial copy is never a usable backup (it never got its final name),
    so it is only clutter. Called once when the loop starts -- never from a
    `--once` run, which may be executing while the loop is mid-backup and
    must not delete that in-progress file.
    """
    for path in sorted(dest_dir.glob(".database_*.db.partial")):
        path.unlink(missing_ok=True)
        log(f"removed stale {path}")


class Shutdown:
    """Records a SIGTERM/SIGINT so the loop exits cleanly *between* backups.

    The signal handler only records the signal -- it does no I/O, since a
    `print` from a handler that interrupted another `print` raises
    `RuntimeError: reentrant call`; the loop logs it instead. A backup
    already in progress runs to completion (and gets published or
    discarded) instead of being cut off and leaving a `.partial` behind.
    The interval sleep polls the flag so the process still exits within
    about a second, well inside `docker compose stop`'s 10s grace period.
    """

    def __init__(self) -> None:
        self.requested = False
        self.signum: int | None = None

    def request(self, signum: int, frame: object) -> None:
        del frame
        self.signum = signum
        self.requested = True

    def sleep(self, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while not self.requested:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(remaining, 1.0))


def run(
    config: BackupConfig,
    *,
    once: bool,
    shutdown: Shutdown | None = None,
    now: Callable[[], datetime] = _utc_now,
) -> None:
    """Runs one backup+prune cycle, or loops on `config.interval_seconds`.

    `once` selects the single-cycle mode `make db-backup` and `db-restore`'s
    pre-restore safety snapshot use: it always takes its backup -- even if
    a signal already arrived, since a caller relying on that snapshot must
    never get exit 0 without one -- and makes a failed backup raise. The
    loop first clears stale `.partial` files, then runs until `shutdown`
    is requested.
    """
    if once:
        run_backup(config.source_db, config.dest_dir, strict=True, now=now)
        prune_old_backups(config.dest_dir, config.retention)
        return
    shutdown = Shutdown() if shutdown is None else shutdown
    remove_stale_partials(config.dest_dir)
    while not shutdown.requested:
        run_backup(config.source_db, config.dest_dir, now=now)
        prune_old_backups(config.dest_dir, config.retention)
        log(f"sleeping {config.interval_seconds}s")
        shutdown.sleep(config.interval_seconds)
    log(f"received signal {shutdown.signum}, stopped")


def main() -> None:
    """Entrypoint: reads the config from env and `--once` from the command line.

    Installs SIGTERM/SIGINT handlers so `docker compose stop` ends the
    process cleanly between backups. Without them, how SIGTERM lands
    depends on what PID 1 is: with `init: true` (the compose default here)
    tini is PID 1 and forwards the signal, and Python, as an ordinary
    process, would die on the spot (exit -15), possibly mid-copy; if Python
    itself were PID 1 the kernel would drop the signal, so `docker compose
    stop` would wait out the 10s grace period and SIGKILL it.
    """
    shutdown = Shutdown()
    signal.signal(signal.SIGTERM, shutdown.request)
    signal.signal(signal.SIGINT, shutdown.request)
    # A single boolean flag; a CLI framework would be a new dependency for
    # a stdlib-only image.
    # ast-grep-ignore: cli-typed-framework
    run(BackupConfig.from_env(), once="--once" in sys.argv[1:], shutdown=shutdown)


if __name__ == "__main__":
    main()
