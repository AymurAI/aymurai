import uuid
from datetime import date

import pytest
from sqlmodel import select

from aymurai.database.crud.catalogs.subtopic import subtopic_create
from aymurai.database.crud.catalogs.topic import topic_create
from aymurai.database.crud.recommendation import (
    InconsistentSectorError,
    RecipientValidationData,
    RecommendationValidationData,
    parse_recommendation_date,
    recommendation_get_by_document,
    recommendation_upsert,
)
from aymurai.database.schema import (
    OrganigramUnit,
    Recipient,
    SubtopicCreate,
    TopicCreate,
)


@pytest.mark.parametrize(
    "text,expected",
    [
        ("01 de enero de 2024", date(2024, 1, 1)),
        ("Buenos Aires, 15 de Marzo del 2023.", date(2023, 3, 15)),
        ("31 de diciembre de 1999", date(1999, 12, 31)),
        (None, None),
        ("", None),
        ("fecha desconocida", None),
        ("32 de enero de 2024", None),  # invalid day
        ("15 de mesinventado de 2024", None),  # unknown month
    ],
)
def test_parse_recommendation_date(text, expected):
    assert parse_recommendation_date(text) == expected


def _data(**overrides) -> RecommendationValidationData:
    defaults = {
        "recommendation_number": "5/2024",
        "recommendation_date_text": "01 de enero de 2024",
        "topic": None,
        "subtopic": None,
        "personal_data": None,
        "publishable_content": "Resumen.",
        "recipients": [],
    }
    defaults.update(overrides)
    return RecommendationValidationData(**defaults)


def test_label_resolution_topic_and_subtopic(session):
    topic = topic_create(TopicCreate(code="SALUD", name="SALUD"), session)
    subtopic_create(
        SubtopicCreate(topic_id=topic.id, code="S1", name="Hospitales"), session
    )

    document_id = uuid.uuid4()
    recommendation = recommendation_upsert(
        document_id, _data(topic="SALUD", subtopic="Hospitales"), session
    )

    assert recommendation.topic_id == topic.id
    assert recommendation.subtopic_id is not None
    assert recommendation.recommendation_date == date(2024, 1, 1)


def test_label_that_matches_no_catalog_is_left_null(session):
    document_id = uuid.uuid4()
    recommendation = recommendation_upsert(
        document_id, _data(topic="TEMA INEXISTENTE"), session
    )

    assert recommendation.topic_id is None
    assert recommendation.subtopic_id is None


def test_unique_constraint_per_dataset_and_document(session):
    document_id = uuid.uuid4()
    recommendation_upsert(document_id, _data(), session)

    # Same document_id -> update in place, not a second row.
    second = recommendation_upsert(
        document_id, _data(recommendation_number="9/2024"), session
    )
    found = recommendation_get_by_document(document_id, session)

    assert second.id == found.id
    assert found.recommendation_number == "9/2024"


def test_recipient_id_is_stable_across_revalidation(session):
    document_id = uuid.uuid4()
    first = recommendation_upsert(
        document_id,
        _data(
            recipients=[
                RecipientValidationData(
                    id=None,
                    name="Juan Perez",
                    position="Director",
                    is_primary=True,
                    macro_sector=None,
                    unit_id=None,
                    sector_id=None,
                )
            ]
        ),
        session,
    )

    stored = session.exec(
        select(Recipient).where(Recipient.recommendation_id == first.id)
    ).all()
    assert len(stored) == 1
    recipient_id = stored[0].id

    second = recommendation_upsert(
        document_id,
        _data(
            recipients=[
                RecipientValidationData(
                    id=recipient_id,
                    name="Juan Perez",
                    position="Director Editado",
                    is_primary=True,
                    macro_sector=None,
                    unit_id=None,
                    sector_id=None,
                )
            ]
        ),
        session,
    )

    stored_after = session.exec(
        select(Recipient).where(Recipient.recommendation_id == second.id)
    ).all()
    assert len(stored_after) == 1
    assert stored_after[0].id == recipient_id
    assert stored_after[0].raw_position == "Director Editado"
    assert stored_after[0].normalized_name == "juan perez"


def test_recipient_removed_from_payload_is_deleted(session):
    document_id = uuid.uuid4()
    recommendation = recommendation_upsert(
        document_id,
        _data(
            recipients=[
                RecipientValidationData(
                    id=None,
                    name="Primero",
                    position=None,
                    is_primary=True,
                    macro_sector=None,
                    unit_id=None,
                    sector_id=None,
                ),
                RecipientValidationData(
                    id=None,
                    name="Segundo",
                    position=None,
                    is_primary=False,
                    macro_sector=None,
                    unit_id=None,
                    sector_id=None,
                ),
            ]
        ),
        session,
    )

    stored = session.exec(
        select(Recipient).where(Recipient.recommendation_id == recommendation.id)
    ).all()
    assert len(stored) == 2
    keep = next(r for r in stored if r.raw_name == "Primero")

    recommendation_upsert(
        document_id,
        _data(
            recipients=[
                RecipientValidationData(
                    id=keep.id,
                    name="Primero",
                    position=None,
                    is_primary=True,
                    macro_sector=None,
                    unit_id=None,
                    sector_id=None,
                ),
            ]
        ),
        session,
    )

    stored_after = session.exec(
        select(Recipient).where(Recipient.recommendation_id == recommendation.id)
    ).all()
    assert len(stored_after) == 1
    assert stored_after[0].id == keep.id


def test_sector_id_is_stored_without_a_unit_id(session):
    """A human can validate the sector alone, with no specific unit chosen --
    `sector_id` is a fully independent input, never computed from `unit_id`."""
    ministerio = OrganigramUnit(
        id=uuid.uuid4(), name="Ministerio de Salud", is_sector=True
    )
    session.add(ministerio)
    session.commit()

    document_id = uuid.uuid4()
    recommendation = recommendation_upsert(
        document_id,
        _data(
            recipients=[
                RecipientValidationData(
                    id=None,
                    name="Alguien",
                    position="Directora",
                    is_primary=True,
                    macro_sector=None,
                    unit_id=None,
                    sector_id=ministerio.id,
                )
            ]
        ),
        session,
    )

    stored = session.exec(
        select(Recipient).where(Recipient.recommendation_id == recommendation.id)
    ).first()
    assert stored.unit_id is None
    assert stored.sector_id == ministerio.id


def test_inconsistent_sector_and_unit_is_rejected(session):
    """A human validates `unit_id` (the "cargo normalizado") and `sector_id`
    independently -- but storing a `sector_id` that ISN'T `unit_id`'s actual
    `is_sector` ancestor must be rejected, not silently accepted."""
    ministerio = OrganigramUnit(
        id=uuid.uuid4(), name="Ministerio de Salud", is_sector=True
    )
    session.add(ministerio)
    direccion = OrganigramUnit(
        id=uuid.uuid4(),
        name="Dirección General Legal y Técnica",
        parent_id=ministerio.id,
    )
    session.add(direccion)
    otro_sector = OrganigramUnit(
        id=uuid.uuid4(), name="Secretaría General", is_sector=True
    )
    session.add(otro_sector)
    session.commit()

    document_id = uuid.uuid4()
    with pytest.raises(InconsistentSectorError):
        recommendation_upsert(
            document_id,
            _data(
                recipients=[
                    RecipientValidationData(
                        id=None,
                        name="Alguien",
                        position="Directora General Legal y Técnica",
                        is_primary=True,
                        macro_sector=None,
                        unit_id=direccion.id,
                        sector_id=otro_sector.id,  # not ministerio.id
                    )
                ]
            ),
            session,
        )
