#!/usr/bin/env python3
"""Sidecar de respaldo periódico para la SQLite interna de AymurAI.

Corre `sqlite3.Connection.backup()` en un intervalo -- el método correcto
bajo WAL, a diferencia de copiar el archivo con `cp` (que puede capturar la
base a mitad de un checkpoint y producir una copia corrupta). Escribe un
archivo nuevo fechado en cada corrida y poda hasta la cantidad de retención
configurada -- el más viejo primero, sin ninguna otra lógica (retención
"tonta" a propósito: ver ADR-0014 y la sesión de diseño que la decidió).

No es parte del paquete `aymurai`: corre como entrypoint standalone en su
propia imagen liviana, por eso lee sus env vars directo con `os.environ` en
vez de por `aymurai.settings` -- no tiene ese módulo disponible ni falta que
lo tenga.

Uso:
    python backup.py            # loop infinito, un respaldo por BACKUP_INTERVAL_SECONDS
    python backup.py --once     # un solo respaldo y termina (lo usa `make db-backup`)
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
    """Escribe un respaldo fechado. None si todavía no hay base fuente --
    una máquina que nunca corrió la API no tiene nada que respaldar, y eso
    no es un error del sidecar."""
    if not SOURCE_DB.exists():
        print(f"[backup] no hay base en {SOURCE_DB}, se salta esta corrida", flush=True)
        return None

    DEST_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    dest_path = DEST_DIR / f"database_{timestamp}.db"

    source_conn = sqlite3.connect(str(SOURCE_DB))
    try:
        dest_conn = sqlite3.connect(str(dest_path))
        try:
            source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        source_conn.close()

    print(f"[backup] escrito {dest_path}", flush=True)
    return dest_path


def prune_old_backups() -> None:
    """Conserva las RETENTION copias fechadas más recientes, borra el resto.
    Ordenar por nombre de archivo alcanza para ordenar cronológicamente: el
    timestamp es de ancho fijo con ceros a la izquierda. Sin más lógica que
    "las más viejas primero" -- ver el docstring del módulo."""
    backups = sorted(DEST_DIR.glob("database_*.db"))
    stale = backups[:-RETENTION] if RETENTION > 0 else backups
    for path in stale:
        path.unlink()
        print(f"[backup] podado {path}", flush=True)


def main() -> None:
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
