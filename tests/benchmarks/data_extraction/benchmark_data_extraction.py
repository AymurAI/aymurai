"""Benchmark de /llm/data-extraction contra un ground truth de destinatarios/sector.

Cualquier dev puede correr esto: poné tus PDFs en `data/pdfs/` y tu ground
truth en `data/documento_sector_ground_truth.xlsx` (ambos gitignored -- tienen
nombres/cargos reales, nunca se commitean), levantá la instancia de benchmark
de la API (ver README.md de esta carpeta) y corré:

    PYTHONPATH=. uv run --active python \\
        tests/benchmarks/data_extraction/benchmark_data_extraction.py

Todo el tracking de corridas vive en `benchmark_tracking.db` (gitignored,
junto a este script) -- separado a propósito de la base que usa la API de
benchmark (esa es la data real del organigrama/catálogos; esta es sólo
bookkeeping de corridas):

- ground_truth_version / ground_truth_row: versiona el ground truth por hash
  de contenido del archivo -- si no cambió desde la última corrida, no crea
  una versión nueva.
- benchmark_run / benchmark_extraction: una fila de run por (modelo, hash del
  prompt vigente, versión de ground truth). Si ya existe una corrida
  idéntica, se reusan sus extracciones guardadas en vez de volver a llamar al
  LLM. Dentro de una corrida, sólo se procesan los documentos que todavía no
  tienen una fila guardada para ese run_id -- una corrida interrumpida se
  retoma sola en la próxima invocación.

El reporte de cada corrida queda en `runs/run-<id>.md` (trackeado en git --
sólo tiene métricas agregadas, nunca nombres/cargos reales).

Con --model se fuerza el modelo a usar (se manda en el body de
/llm/data-extraction); sin eso, usa el que la instancia de benchmark ya tenga
configurado. Con --force-rerun se ignora una corrida idéntica ya guardada.
"""

import hashlib
import json
import mimetypes
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import openpyxl
import requests
import typer

app = typer.Typer(add_completion=False)

HERE = Path(__file__).resolve().parent
TRACKING_DB_PATH = HERE / "benchmark_tracking.db"
DEFAULT_GROUND_TRUTH = HERE / "data" / "documento_sector_ground_truth.xlsx"
DEFAULT_PDF_ROOT = HERE / "data" / "pdfs"
REPORTS_DIR = HERE / "runs"
PROMPT_PATH = Path("resources/llm/data_extraction.yml")
SECTORES_NO_GCBA = {"Empresa", "Organismos Nacionales", "Obra Social / Prepaga"}
NO_DEFINIDO = "no definido"


# -- Ground truth -------------------------------------------------------------


@dataclass
class GroundTruthRow:
    resolucion: str
    destinatario_idx: int
    nombre: str | None
    cargo: str | None
    sector_ground_truth: str | None


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _parse_ground_truth_xlsx(path: Path) -> list[GroundTruthRow]:
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = []
    for raw in ws.iter_rows(min_row=2, values_only=True):
        resolucion = raw[0]
        if not resolucion:
            continue
        rows.append(
            GroundTruthRow(
                resolucion=str(resolucion).strip(),
                destinatario_idx=int(raw[1]),
                nombre=raw[2],
                cargo=raw[3],
                sector_ground_truth=raw[4],
            )
        )
    return rows


def ensure_tracking_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ground_truth_version (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            loaded_at TEXT NOT NULL,
            source_path TEXT NOT NULL,
            content_hash TEXT NOT NULL UNIQUE,
            row_count INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ground_truth_row (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version_id INTEGER NOT NULL REFERENCES ground_truth_version(id),
            resolucion TEXT NOT NULL,
            destinatario_idx INTEGER NOT NULL,
            nombre TEXT,
            cargo TEXT,
            sector_ground_truth TEXT
        );

        CREATE TABLE IF NOT EXISTS benchmark_run (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_at TEXT NOT NULL,
            model TEXT,
            prompt_hash TEXT NOT NULL,
            ground_truth_version_id INTEGER NOT NULL REFERENCES ground_truth_version(id),
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS benchmark_extraction (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL REFERENCES benchmark_run(id),
            resolucion TEXT NOT NULL,
            document_id TEXT,
            status TEXT NOT NULL,
            error TEXT,
            response_json TEXT,
            UNIQUE(run_id, resolucion)
        );
    """)
    conn.commit()


def load_ground_truth(conn: sqlite3.Connection, xlsx_path: Path) -> int:
    """Returns the ground_truth_version id, reusing an identical prior load."""
    content_hash = _sha256_bytes(xlsx_path.read_bytes())
    existing = conn.execute(
        "SELECT id FROM ground_truth_version WHERE content_hash = ?",
        (content_hash,),
    ).fetchone()
    if existing:
        return existing[0]

    rows = _parse_ground_truth_xlsx(xlsx_path)
    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "INSERT INTO ground_truth_version "
        "(loaded_at, source_path, content_hash, row_count) VALUES (?, ?, ?, ?)",
        (now, str(xlsx_path), content_hash, len(rows)),
    )
    version_id = cursor.lastrowid
    conn.executemany(
        "INSERT INTO ground_truth_row "
        "(version_id, resolucion, destinatario_idx, nombre, cargo, sector_ground_truth) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        [
            (
                version_id,
                r.resolucion,
                r.destinatario_idx,
                r.nombre,
                r.cargo,
                r.sector_ground_truth,
            )
            for r in rows
        ],
    )
    conn.commit()
    typer.echo(f"Ground truth nuevo cargado: version {version_id}, {len(rows)} filas")
    return version_id


def read_ground_truth_rows(
    conn: sqlite3.Connection, version_id: int
) -> list[GroundTruthRow]:
    cur = conn.execute(
        "SELECT resolucion, destinatario_idx, nombre, cargo, sector_ground_truth "
        "FROM ground_truth_row WHERE version_id = ?",
        (version_id,),
    )
    return [GroundTruthRow(*row) for row in cur.fetchall()]


# -- Runs / extractions --------------------------------------------------------


def prompt_hash() -> str:
    return _sha256_bytes(PROMPT_PATH.read_bytes())


def find_or_create_run(
    conn: sqlite3.Connection,
    model: str | None,
    gt_version_id: int,
    force_rerun: bool,
) -> tuple[int, bool]:
    """Returns (run_id, reused). `reused=True` means an identical run already existed."""
    p_hash = prompt_hash()
    if not force_rerun:
        existing = conn.execute(
            "SELECT id FROM benchmark_run "
            "WHERE model IS ? AND prompt_hash = ? AND ground_truth_version_id = ? "
            "ORDER BY id DESC LIMIT 1",
            (model, p_hash, gt_version_id),
        ).fetchone()
        if existing:
            return existing[0], True

    now = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "INSERT INTO benchmark_run (run_at, model, prompt_hash, ground_truth_version_id) "
        "VALUES (?, ?, ?, ?)",
        (now, model, p_hash, gt_version_id),
    )
    conn.commit()
    return cursor.lastrowid, False


def _call_document_extract(
    session: requests.Session, api_base_url: str, file_path: Path
) -> dict:
    mime_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    with file_path.open("rb") as fh:
        response = session.post(
            f"{api_base_url}/api/misc/document-extract",
            files={"file": (file_path.name, fh, mime_type)},
            timeout=120,
        )
    response.raise_for_status()
    return response.json()


def _call_data_extraction(
    session: requests.Session, api_base_url: str, document: dict, model: str | None
) -> dict:
    payload: dict = {"document": document}
    if model:
        payload["model"] = model
    response = session.post(
        f"{api_base_url}/api/llm/data-extraction",
        json=payload,
        params={"use_cache": False},
        timeout=300,
    )
    response.raise_for_status()
    return response.json()


def run_extractions(
    conn: sqlite3.Connection,
    run_id: int,
    resoluciones: list[str],
    doc_by_name: dict[str, Path],
    api_base_url: str,
    model: str | None,
) -> None:
    already_done = {
        row[0]
        for row in conn.execute(
            "SELECT resolucion FROM benchmark_extraction WHERE run_id = ?", (run_id,)
        ).fetchall()
    }
    pendientes = [r for r in resoluciones if r not in already_done]
    if not pendientes:
        typer.echo("Todos los documentos ya estaban extraidos para esta corrida.")
        return

    typer.echo(
        f"Extrayendo {len(pendientes)} documentos (ya hechos: {len(already_done)})..."
    )
    session = requests.Session()
    for i, resolucion in enumerate(pendientes, start=1):
        doc_path = doc_by_name.get(resolucion)
        if doc_path is None:
            conn.execute(
                "INSERT OR REPLACE INTO benchmark_extraction "
                "(run_id, resolucion, document_id, status, error, response_json) "
                "VALUES (?, ?, NULL, 'error', ?, NULL)",
                (run_id, resolucion, "PDF no encontrado en pdf_root"),
            )
            conn.commit()
            continue

        try:
            start = time.perf_counter()
            document = _call_document_extract(session, api_base_url, doc_path)
            result = _call_data_extraction(session, api_base_url, document, model)
            elapsed = time.perf_counter() - start
            conn.execute(
                "INSERT OR REPLACE INTO benchmark_extraction "
                "(run_id, resolucion, document_id, status, error, response_json) "
                "VALUES (?, ?, ?, 'success', NULL, ?)",
                (
                    run_id,
                    resolucion,
                    result.get("document_id"),
                    json.dumps(result, ensure_ascii=False),
                ),
            )
            conn.commit()
            typer.echo(
                f"[{i}/{len(pendientes)}] {resolucion} ok ({elapsed:.1f}s)", err=True
            )
        except Exception as exc:  # noqa: BLE001 -- one bad document must not abort the run
            conn.execute(
                "INSERT OR REPLACE INTO benchmark_extraction "
                "(run_id, resolucion, document_id, status, error, response_json) "
                "VALUES (?, ?, NULL, 'error', ?, NULL)",
                (run_id, resolucion, str(exc)),
            )
            conn.commit()
            typer.echo(f"[{i}/{len(pendientes)}] {resolucion} ERROR: {exc}", err=True)


def read_extractions(conn: sqlite3.Connection, run_id: int) -> dict[str, dict]:
    cur = conn.execute(
        "SELECT resolucion, status, response_json FROM benchmark_extraction WHERE run_id = ?",
        (run_id,),
    )
    out = {}
    for resolucion, status, response_json in cur.fetchall():
        out[resolucion] = json.loads(response_json) if status == "success" else None
    return out


# -- Metrics --------------------------------------------------------------


def es_no_definido(valor: str | None) -> bool:
    return isinstance(valor, str) and valor.strip().lower() == NO_DEFINIDO


def macro_sector(sector_ground_truth: str) -> str:
    return sector_ground_truth if sector_ground_truth in SECTORES_NO_GCBA else "GCBA"


def _unit_labels(conn: sqlite3.Connection) -> dict[str, set[str]]:
    """sector_id (str) -> {name.lower(), acronym.lower() if any} for GT matching."""
    labels: dict[str, set[str]] = {}
    for unit_id, name, acronym in conn.execute(
        "SELECT id, name, acronym FROM organigram_unit"
    ).fetchall():
        values = {name.strip().lower()}
        if acronym:
            values.add(acronym.strip().lower())
        labels[unit_id] = values
    return labels


def _gt_matches_candidate(
    gt_label: str, unit_labels: dict[str, set[str]], sector_id: str | None
) -> bool:
    if sector_id is None:
        return False
    needle = gt_label.strip().lower()
    return needle in unit_labels.get(sector_id, set())


@dataclass
class Metrics:
    n_documentos: int
    n_con_extraccion: int
    n_errores: int
    conteo_correcto_pct: float
    conteo_discrepancias: list[dict]
    macro_evaluados: int
    macro_correcto_pct: float
    macro_confusion: dict[tuple[str, str], int]
    fino_evaluados: int
    fino_top1_pct: float
    fino_top3_pct: float
    fino_top5_pct: float


def compute_metrics(
    unit_labels: dict[str, set[str]],
    gt_rows: list[GroundTruthRow],
    extractions: dict[str, dict | None],
) -> Metrics:
    from collections import defaultdict

    por_resolucion: dict[str, list[GroundTruthRow]] = defaultdict(list)
    for row in gt_rows:
        por_resolucion[row.resolucion].append(row)

    n_errores = sum(1 for v in extractions.values() if v is None)
    conteo_discrepancias = []
    conteo_correctos = 0
    conteo_evaluados = 0
    macro_correctos = 0
    macro_evaluados = 0
    macro_confusion: dict[tuple[str, str], int] = defaultdict(int)
    fino_hits = {1: 0, 3: 0, 5: 0}
    fino_evaluados = 0

    for resolucion, filas in por_resolucion.items():
        result = extractions.get(resolucion)
        if result is None:
            continue
        destinatarios = result.get("recipients", [])
        conteo_evaluados += 1
        if len(destinatarios) == len(filas):
            conteo_correctos += 1
        else:
            conteo_discrepancias.append(
                {
                    "resolucion": resolucion,
                    "esperado": len(filas),
                    "extraido": len(destinatarios),
                }
            )

        for fila in filas:
            if es_no_definido(fila.sector_ground_truth):
                continue
            idx = fila.destinatario_idx
            macro_esperado = macro_sector(fila.sector_ground_truth)
            macro_obtenido = (
                destinatarios[idx].get("macro_sector")
                if idx < len(destinatarios)
                else None
            )
            macro_evaluados += 1
            macro_confusion[(macro_esperado, macro_obtenido or "None")] += 1
            if macro_obtenido == macro_esperado:
                macro_correctos += 1

            if macro_esperado != "GCBA" or idx >= len(destinatarios):
                continue
            candidatos = destinatarios[idx].get("sector_candidates", [])
            fino_evaluados += 1
            for k in (1, 3, 5):
                if any(
                    _gt_matches_candidate(
                        fila.sector_ground_truth, unit_labels, c.get("sector_id")
                    )
                    for c in candidatos[:k]
                ):
                    fino_hits[k] += 1

    def pct(n: int, total: int) -> float:
        return (n / total * 100) if total else float("nan")

    return Metrics(
        n_documentos=len(por_resolucion),
        n_con_extraccion=conteo_evaluados,
        n_errores=n_errores,
        conteo_correcto_pct=pct(conteo_correctos, conteo_evaluados),
        conteo_discrepancias=conteo_discrepancias,
        macro_evaluados=macro_evaluados,
        macro_correcto_pct=pct(macro_correctos, macro_evaluados),
        macro_confusion=dict(macro_confusion),
        fino_evaluados=fino_evaluados,
        fino_top1_pct=pct(fino_hits[1], fino_evaluados),
        fino_top3_pct=pct(fino_hits[3], fino_evaluados),
        fino_top5_pct=pct(fino_hits[5], fino_evaluados),
    )


# -- Report -----------------------------------------------------------------


def _history_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, run_at, model, prompt_hash, ground_truth_version_id FROM benchmark_run "
        "ORDER BY run_at ASC"
    ).fetchall()
    conn.row_factory = None
    return rows


def render_report(
    conn: sqlite3.Connection,
    run_id: int,
    reused: bool,
    model: str | None,
    gt_version_id: int,
    metrics: Metrics,
) -> str:
    lines = []
    lines.append(f"# Benchmark de extracción — corrida #{run_id}")
    lines.append("")
    lines.append(f"- Fecha: {datetime.now(timezone.utc).isoformat()}")
    lines.append(f"- Modelo: `{model or '(default de la instancia)'}`")
    lines.append(f"- Ground truth version: {gt_version_id}")
    lines.append(
        f"- Corrida reusada de una anterior idéntica: {'sí' if reused else 'no'}"
    )
    lines.append("")

    lines.append("## Extracción (cantidad de destinatarios)")
    lines.append("")
    lines.append(
        f"- Documentos evaluados: {metrics.n_con_extraccion} / {metrics.n_documentos}"
    )
    lines.append(f"- Errores de extracción: {metrics.n_errores}")
    lines.append(
        f"- % con cantidad correcta de destinatarios: {metrics.conteo_correcto_pct:.1f}%"
    )
    if metrics.conteo_discrepancias:
        lines.append("")
        lines.append("| Resolución | Esperado | Extraído |")
        lines.append("|---|---|---|")
        for d in metrics.conteo_discrepancias:
            lines.append(f"| {d['resolucion']} | {d['esperado']} | {d['extraido']} |")
    lines.append("")

    lines.append(
        "## Sector macro (GCBA / Organismos Nacionales / Obra Social / Empresa)"
    )
    lines.append("")
    lines.append(f"- Destinatarios evaluados: {metrics.macro_evaluados}")
    lines.append(f"- Accuracy: {metrics.macro_correcto_pct:.1f}%")
    lines.append("")
    lines.append("| Esperado → Obtenido | Conteo |")
    lines.append("|---|---|")
    for (esperado, obtenido), n in sorted(metrics.macro_confusion.items()):
        lines.append(f"| {esperado} → {obtenido} | {n} |")
    lines.append("")

    lines.append("## Sector fino (sólo destinatarios GCBA)")
    lines.append("")
    lines.append(f"- Destinatarios evaluados: {metrics.fino_evaluados}")
    lines.append(f"- Top-1: {metrics.fino_top1_pct:.1f}%")
    lines.append(f"- Top-3: {metrics.fino_top3_pct:.1f}%")
    lines.append(f"- Top-5: {metrics.fino_top5_pct:.1f}%")
    lines.append("")

    lines.append("## Historial de corridas")
    lines.append("")
    lines.append("| Run | Fecha | Modelo | Prompt hash | GT version |")
    lines.append("|---|---|---|---|---|")
    for row in _history_rows(conn):
        marca = " (esta corrida)" if row["id"] == run_id else ""
        lines.append(
            f"| {row['id']}{marca} | {row['run_at']} | {row['model'] or '-'} | "
            f"{row['prompt_hash'][:10]} | {row['ground_truth_version_id']} |"
        )
    lines.append("")

    return "\n".join(lines)


# -- CLI ----------------------------------------------------------------


@app.command()
def run(
    ground_truth: Path = typer.Option(
        DEFAULT_GROUND_TRUTH, help="Ruta al .xlsx de ground truth"
    ),
    pdf_root: Path = typer.Option(
        DEFAULT_PDF_ROOT, help="Carpeta raíz donde buscar los PDFs (recursivo)"
    ),
    api_base_url: str = typer.Option(
        "http://localhost:8001", help="Instancia de benchmark"
    ),
    organigram_db: Path = typer.Option(
        Path(".tmp/benchmark.db"),
        help="DB de la app que sirve esa instancia (para leer acronym/name del organigrama)",
    ),
    model: str | None = typer.Option(
        None, help="Override de modelo para /llm/data-extraction"
    ),
    force_rerun: bool = typer.Option(
        False, help="Ignora una corrida idéntica ya guardada"
    ),
):
    if not ground_truth.exists():
        raise typer.BadParameter(
            f"No se encontró {ground_truth} -- copiá tu .xlsx ahí (ver README.md)"
        )
    if not pdf_root.exists():
        raise typer.BadParameter(
            f"No se encontró {pdf_root} -- copiá tus PDFs ahí (ver README.md)"
        )

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(TRACKING_DB_PATH)
    ensure_tracking_tables(conn)

    gt_version_id = load_ground_truth(conn, ground_truth)
    gt_rows = read_ground_truth_rows(conn, gt_version_id)
    resoluciones = sorted({r.resolucion for r in gt_rows})

    doc_by_name = {
        p.name: p
        for p in pdf_root.rglob("*")
        if p.is_file() and p.suffix.lower() in (".pdf", ".docx")
    }
    sin_pdf = [r for r in resoluciones if r not in doc_by_name]
    if sin_pdf:
        typer.echo(f"AVISO: {len(sin_pdf)} resoluciones sin PDF en {pdf_root}:")
        for r in sin_pdf:
            typer.echo(f"  {r}")

    run_id, reused = find_or_create_run(conn, model, gt_version_id, force_rerun)
    if reused:
        typer.echo(f"Reusando corrida #{run_id} idéntica ya guardada.")
    else:
        typer.echo(f"Corrida nueva #{run_id}.")
        run_extractions(conn, run_id, resoluciones, doc_by_name, api_base_url, model)

    extractions = read_extractions(conn, run_id)

    app_conn = sqlite3.connect(organigram_db)
    unit_labels = _unit_labels(app_conn)
    app_conn.close()

    metrics = compute_metrics(unit_labels, gt_rows, extractions)
    report = render_report(conn, run_id, reused, model, gt_version_id, metrics)

    out_path = REPORTS_DIR / f"run-{run_id}.md"
    out_path.write_text(report, encoding="utf-8")
    typer.echo(f"\nReporte guardado en {out_path}")
    conn.close()


if __name__ == "__main__":
    app()
