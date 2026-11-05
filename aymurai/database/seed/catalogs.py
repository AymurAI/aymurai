import json
from pathlib import Path

from sqlmodel import Session, select

from aymurai.database.schema import MacroSector, Subtopic, Topic
from aymurai.logger import get_logger

logger = get_logger(__name__)

# The four macro sectors hardcoded in the historical prompt. `code` governs
# behavior (only "GCBA" triggers the organigram cross-check); `name` is the
# editable display label.
_MACRO_SECTORS = [
    {"code": "GCBA", "name": "GCBA", "order": 0},
    {"code": "ORGANISMOS_NACIONALES", "name": "Organismos Nacionales", "order": 1},
    {"code": "OBRA_SOCIAL_PREPAGA", "name": "Obra Social / Prepaga", "order": 2},
    {"code": "EMPRESA", "name": "Empresa", "order": 3},
]


def seed_macro_sectors(session: Session) -> int:
    """
    Seeds the 4 fixed macro sectors, idempotently (upsert by `code`).

    Args:
        session (Session): Database session.

    Returns:
        int: Number of macro sectors present after seeding.
    """
    for entry in _MACRO_SECTORS:
        existing = session.exec(
            select(MacroSector).where(MacroSector.code == entry["code"])
        ).first()
        if existing:
            continue
        session.add(MacroSector(**entry))

    session.commit()
    return len(session.exec(select(MacroSector)).all())


def seed_catalogs(session: Session, taxonomy_path: Path) -> tuple[int, int]:
    """
    Seeds `topic`/`subtopic` from the Defensoría's taxonomy JSON, verbatim
    (typos included -- it isn't our data to correct; fix it from the ABM
    instead, which is safe now that references are by ID). Idempotent: upsert
    by `code` (`area`/`codigo` in the source JSON).

    Args:
        session (Session): Database session.
        taxonomy_path (Path): Path to `defensoria_taxonomy.json`.

    Returns:
        tuple[int, int]: (topic count, subtopic count) present after seeding.
    """
    taxonomy = json.loads(taxonomy_path.read_text())

    for order, entry in enumerate(taxonomy):
        topic_code = entry["area"]
        topic = session.exec(select(Topic).where(Topic.code == topic_code)).first()
        if not topic:
            topic = Topic(code=topic_code, name=entry["tema"], order=order)
            session.add(topic)
            session.commit()
            session.refresh(topic)

        for sub_order, sub in enumerate(entry["subtemas"]):
            subtopic_code = sub["codigo"]
            existing = session.exec(
                select(Subtopic).where(Subtopic.code == subtopic_code)
            ).first()
            if existing:
                continue
            session.add(
                Subtopic(
                    topic_id=topic.id,
                    code=subtopic_code,
                    name=sub["descripcion"],
                    order=sub_order,
                )
            )

    session.commit()
    topic_count = len(session.exec(select(Topic)).all())
    subtopic_count = len(session.exec(select(Subtopic)).all())
    logger.info("Seeded catalogs: %d topics, %d subtopics", topic_count, subtopic_count)
    return topic_count, subtopic_count
