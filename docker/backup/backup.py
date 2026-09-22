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
    no es un error del sidecar.

    Escribe primero a un archivo temporal fuera del glob `database_*.db` y
    lo renombra recién al terminar: así un respaldo que falla a mitad de
    camino nunca deja un `.db` de 0 bytes con pinta de respaldo válido, ni
    consume un lugar de retención ni aparece como candidato de restore."""
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
    """Conserva las RETENTION copias fechadas más recientes, borra el resto.
    Ordenar por nombre de archivo alcanza para ordenar cronológicamente: el
    timestamp es de ancho fijo con ceros a la izquierda. Sin más lógica que
    "las más viejas primero" -- ver el docstring del módulo.

    RETENTION <= 0 significa "no podar nada" -- la dirección segura, en vez
    de interpretarlo como "podar todo" (que borraría el respaldo recién
    escrito)."""
    if RETENTION <= 0:
        return
    backups = sorted(DEST_DIR.glob("database_*.db"))
    for path in backups[:-RETENTION]:
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
