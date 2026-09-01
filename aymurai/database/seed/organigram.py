import csv
import json
import uuid
from pathlib import Path

from sqlmodel import Session, select
from unidecode import unidecode

from aymurai.database.crud.organigram.holder import holder_set_current
from aymurai.database.schema import OrganigramHolder, OrganigramUnit
from aymurai.logger import get_logger

logger = get_logger(__name__)

# Fixed at first seed, never regenerated: every unit id is
# uuid5(_NAMESPACE, f"{ruta_cargos}#{sibling_index}"). Recomputing this after
# a rename would break every reference already extracted.
_NAMESPACE = uuid.UUID("e2e9bd81-f12a-45e0-8aa4-32d01e52558b")

# Rule 1: these override their administrative parent regardless of nesting depth.
_AUTONOMOUS_SIGLAS = {"AGC", "AGIP", "IVC", "COPIDIS"}
# Rule 5: segments that never count as "the first non-generic segment" on their own.
_GENERIC_ROOT_LABELS = {"jefe de gobierno", "jefatura de gabinete de ministros"}


def _norm(text: str) -> str:
    return unidecode(text or "").strip().lower()


def _resolve_sector_index(path_nodes: list[dict]) -> int | None:
    """
    The historical hardcoded rules, in priority order. Runs once per titled
    node at seed time; the request-time path only ever reads the `is_sector`
    flag this produces (see `aymurai.database.crud.organigram.sector`).

    Args:
        path_nodes (list[dict]): Root-to-self path, each a raw JSON node with
            'cargo'/'sigla'.

    Returns:
        int | None: Index into `path_nodes` of the sector node, or None if no
            rule matches (e.g. the tree root itself, which sits above every
            sector and isn't one).
    """
    for i, node in enumerate(path_nodes):
        if node.get("sigla") in _AUTONOMOUS_SIGLAS:
            return i
    for i, node in enumerate(path_nodes):
        if _norm(node.get("cargo", "")).startswith("ministerio"):
            return i
    for i, node in enumerate(path_nodes):
        cargo = _norm(node.get("cargo", ""))
        if cargo.startswith("secretaria") and not cargo.startswith("subsecretaria"):
            return i
    for i, node in enumerate(path_nodes):
        if _norm(node.get("cargo", "")) == "jefatura de gabinete de ministros":
            return i
    for i, node in enumerate(path_nodes):
        if _norm(node.get("cargo", "")) not in _GENERIC_ROOT_LABELS:
            return i
    return None


def _load_short_labels(csv_path: Path) -> set[str]:
    with csv_path.open(newline="", encoding="utf-8") as f:
        return {row["Destinatario por sector"].strip() for row in csv.DictReader(f)}


def _short_name_override(
    cargo: str, sigla: str | None, short_labels: set[str]
) -> str | None:
    """
    The CSV is otherwise discarded -- this is its one remaining use. Of the
    autonomous-body/root nodes, 3 have a `cargo` longer than the short label
    people actually use (AGC, AGIP, Jefatura de Gabinete); IVC and COPIDIS are
    also autonomous bodies but their `cargo` is already that short.

    Args:
        cargo (str): The node's `cargo` (long form).
        sigla (str | None): The node's `sigla`.
        short_labels (set[str]): Distinct "Destinatario por sector" values
            from the CSV.

    Returns:
        str | None: The short label to use as `short_name`, or None if the
            node's own `cargo` is already short enough.
    """
    candidates = []
    if sigla in _AUTONOMOUS_SIGLAS:
        candidates.append(sigla)
    if _norm(cargo) == "jefatura de gabinete de ministros":
        candidates.append("Jefatura de Gabinete")

    for candidate in candidates:
        if candidate in short_labels and candidate != cargo:
            return candidate
    return None


def _ensure_unit(
    unit_id: uuid.UUID,
    parent_id: uuid.UUID | None,
    node: dict,
    order: int,
    short_name: str | None,
    session: Session,
) -> OrganigramUnit:
    unit = session.get(OrganigramUnit, unit_id)
    if unit is None:
        unit = OrganigramUnit(
            id=unit_id,
            parent_id=parent_id,
            name=node["cargo"],
            acronym=node.get("sigla"),
            short_name=short_name,
            is_sector=False,
            order=order,
        )
    else:
        # is_sector is intentionally left untouched here -- it's only ever
        # set True by `_mark_sector`, below, never reset on re-seed.
        unit.parent_id = parent_id
        unit.name = node["cargo"]
        unit.acronym = node.get("sigla")
        unit.short_name = short_name
        unit.order = order

    session.add(unit)
    session.commit()
    session.refresh(unit)
    return unit


def _mark_sector(unit_id: uuid.UUID, session: Session) -> None:
    unit = session.get(OrganigramUnit, unit_id)
    if unit and not unit.is_sector:
        unit.is_sector = True
        session.add(unit)
        session.commit()


def _ensure_current_holder(unit_id: uuid.UUID, name: str, session: Session) -> None:
    existing = session.exec(
        select(OrganigramHolder)
        .where(OrganigramHolder.unit_id == unit_id)
        .where(OrganigramHolder.is_current)
    ).first()
    if existing and existing.name == name:
        return
    holder_set_current(unit_id, name, session)


def _walk(
    node: dict,
    parent_id: uuid.UUID | None,
    path_nodes: list[dict],
    path_ids: list[uuid.UUID],
    order: int,
    short_labels: set[str],
    session: Session,
    counts: dict[str, int],
) -> None:
    path_nodes = [*path_nodes, node]
    ruta_cargos = " > ".join(n["cargo"] for n in path_nodes)
    unit_id = uuid.uuid5(_NAMESPACE, f"{ruta_cargos}#{order}")
    path_ids = [*path_ids, unit_id]

    short_name = _short_name_override(node["cargo"], node.get("sigla"), short_labels)
    _ensure_unit(unit_id, parent_id, node, order, short_name, session)
    counts["nodes"] += 1

    nombre = (node.get("nombre") or "").strip()
    if nombre:
        counts["holders"] += 1
        _ensure_current_holder(unit_id, nombre, session)

        sector_index = _resolve_sector_index(path_nodes)
        if sector_index is not None:
            _mark_sector(path_ids[sector_index], session)

    for child_order, child in enumerate(node.get("dependencias", []) or []):
        _walk(
            child,
            unit_id,
            path_nodes,
            path_ids,
            child_order,
            short_labels,
            session,
            counts,
        )


def seed_organigram(
    session: Session, organigram_path: Path, csv_path: Path
) -> dict[str, int]:
    """
    Seeds the organigram tree from `organigram_GCBA.json`: computes each
    unit's id once (uuid5, never recomputed after this) and runs the
    historical sector rules once per titled node to set `is_sector`.
    Idempotent -- re-running against the same file recomputes the same ids
    and only updates mutable display fields.

    Args:
        session (Session): Database session.
        organigram_path (Path): Path to `organigram_GCBA.json`.
        csv_path (Path): Path to `destinatario_por_sector.csv` (used only for
            the `short_name` overrides, see `_short_name_override`).

    Returns:
        dict[str, int]: {"nodes", "holders", "sectors"} counts after seeding.
    """
    tree = json.loads(organigram_path.read_text())
    short_labels = _load_short_labels(csv_path)

    counts = {"nodes": 0, "holders": 0}
    _walk(tree, None, [], [], 0, short_labels, session, counts)

    counts["sectors"] = len(
        session.exec(select(OrganigramUnit).where(OrganigramUnit.is_sector)).all()
    )

    logger.info(
        "Seeded organigram: %d nodes, %d holders, %d sectors",
        counts["nodes"],
        counts["holders"],
        counts["sectors"],
    )
    return counts
