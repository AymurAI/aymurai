import uuid
from datetime import date

import pytest
from sqlmodel import select

from aymurai.database.crud.catalogs.subtopic import subtopic_create
from aymurai.database.crud.catalogs.topic import topic_create
from aymurai.database.crud.recommendation import (
    InconsistentSectorError,
    OrganigramReferenceNotFoundError,
    RecipientValidationData,
    RecommendationValidationData,
    parse_recommendation_date,
    recommendation_get_by_document,
    recommendation_list,
    recommendation_upsert,
)
from aymurai.database.schema import (
    MacroSector,
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
        # Ordinal markers: tolerate °, º, ro. after the day digit
        ("1° de marzo de 2024", date(2024, 3, 1)),
        ("1º de marzo de 2024", date(2024, 3, 1)),
        ("1ro de marzo de 2024", date(2024, 3, 1)),
        ("Buenos Aires, 1° de marzo de 2024", date(2024, 3, 1)),
        # Non-regression: prose without a day digit must return None
        (
            "enero de 2024",
            None,
        ),  # no day digit to parse; inventing one would fabricate data
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


def test_nonexistent_unit_id_is_rejected_not_silently_nulled(session):
    """A typo'd/nonexistent `unit_id` must never be swallowed into `None` --
    that would hide a real input mistake as if nothing had been provided."""
    document_id = uuid.uuid4()
    with pytest.raises(OrganigramReferenceNotFoundError):
        recommendation_upsert(
            document_id,
            _data(
                recipients=[
                    RecipientValidationData(
                        id=None,
                        name="Alguien",
                        position="Directora",
                        is_primary=True,
                        macro_sector=None,
                        unit_id=uuid.uuid4(),  # does not exist
                        sector_id=None,
                    )
                ]
            ),
            session,
        )


def test_nonexistent_sector_id_is_rejected_not_silently_nulled(session):
    document_id = uuid.uuid4()
    with pytest.raises(OrganigramReferenceNotFoundError):
        recommendation_upsert(
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
                        sector_id=uuid.uuid4(),  # does not exist
                    )
                ]
            ),
            session,
        )


def test_invalid_recipient_persists_nothing_on_create(session):
    """ADR-0009: the whole transaction is cut -- a bad recipient must not
    leave an orphan recommendation with zero recipients behind."""
    document_id = uuid.uuid4()
    bad = RecipientValidationData(
        id=None,
        name="Alguien",
        position="Directora",
        is_primary=True,
        macro_sector=None,
        unit_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
        sector_id=None,
    )

    with pytest.raises(OrganigramReferenceNotFoundError):
        recommendation_upsert(document_id, _data(recipients=[bad]), session)

    session.rollback()
    assert recommendation_get_by_document(document_id, session) is None


def test_invalid_recipient_leaves_existing_recommendation_untouched(session):
    """On update, the rejected payload's fields must not be written either."""
    document_id = uuid.uuid4()
    recommendation_upsert(document_id, _data(recommendation_number="5/2024"), session)

    bad = RecipientValidationData(
        id=None,
        name="Alguien",
        position="Directora",
        is_primary=True,
        macro_sector=None,
        unit_id=uuid.UUID("00000000-0000-0000-0000-000000000000"),
        sector_id=None,
    )
    with pytest.raises(OrganigramReferenceNotFoundError):
        recommendation_upsert(
            document_id,
            _data(recommendation_number="99/2099", recipients=[bad]),
            session,
        )

    session.rollback()
    stored = recommendation_get_by_document(document_id, session)
    assert stored is not None
    assert stored.recommendation_number == "5/2024"


def test_sector_id_must_name_an_actual_sector(session):
    """ADR-0001: `is_sector` is the only thing that makes a unit a sector.
    A plain unit passed as `sector_id` must be rejected, not stored and then
    exported as SECTOR_FINAL."""
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
    session.commit()

    with pytest.raises(InconsistentSectorError):
        recommendation_upsert(
            uuid.uuid4(),
            _data(
                recipients=[
                    RecipientValidationData(
                        id=None,
                        name="Alguien",
                        position="Directora",
                        is_primary=True,
                        macro_sector=None,
                        unit_id=None,
                        sector_id=direccion.id,  # exists, but is_sector=False
                    )
                ]
            ),
            session,
        )


def test_non_gcba_macro_sector_nulls_stale_unit_and_sector_id(session):
    """A recipient's ámbito can be implicitly-suggested as GCBA, get a unit
    picked while it looks GCBA, and then be explicitly corrected to a
    non-GCBA ámbito -- the frontend's unit picker hides (never clears) the
    stale pick when this happens (recipient-fields.tsx's documented
    hide-not-clear design), so `toPayload` still sends the stale unit_id/
    sector_id. `_reconcile_recipients` must null them out rather than store a
    non-GCBA recipient with a GCBA unit/sector, and must not reject the save
    -- the picker that would let the human clear them is exactly the one now
    hidden."""
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
    macro_sector = MacroSector(
        id=uuid.uuid4(), code="ORGANISMOS_NACIONALES", name="Organismos Nacionales"
    )
    session.add(macro_sector)
    session.commit()

    document_id = uuid.uuid4()
    recommendation = recommendation_upsert(
        document_id,
        _data(
            recipients=[
                RecipientValidationData(
                    id=None,
                    name="Alguien",
                    position="Titular de un organismo nacional",
                    is_primary=True,
                    macro_sector="Organismos Nacionales",
                    unit_id=direccion.id,  # stale GCBA pick, hidden not cleared
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
    assert stored.sector_id is None


def test_suggested_pair_with_a_deactivated_nearer_sector_is_accepted(session):
    """The suggestion path skips a deactivated sector and proposes the next
    ACTIVE ancestor. Saving that exact pair must not 422 -- validation checks
    that sector_id is *an* is_sector ancestor, not the nearest one."""
    raiz = OrganigramUnit(id=uuid.uuid4(), name="Raíz", is_sector=True)
    session.add(raiz)
    viejo = OrganigramUnit(
        id=uuid.uuid4(),
        name="Sector Discontinuado",
        parent_id=raiz.id,
        is_sector=True,
        active=False,
    )
    session.add(viejo)
    unidad = OrganigramUnit(
        id=uuid.uuid4(), name="Dirección General", parent_id=viejo.id
    )
    session.add(unidad)
    session.commit()

    recommendation = recommendation_upsert(
        uuid.uuid4(),
        _data(
            recipients=[
                RecipientValidationData(
                    id=None,
                    name="Alguien",
                    position="Directora General",
                    is_primary=True,
                    macro_sector=None,
                    unit_id=unidad.id,
                    sector_id=raiz.id,  # what the suggestion path now proposes
                )
            ]
        ),
        session,
    )

    stored = session.exec(
        select(Recipient).where(Recipient.recommendation_id == recommendation.id)
    ).first()
    # macro_sector is None here (never explicitly confirmed) -- unit_id must
    # still be trusted unchanged, unlike the explicitly-non-GCBA case above.
    assert stored.unit_id == unidad.id
    assert stored.sector_id == raiz.id


def test_q_search_treats_wildcards_as_literal_text(session):
    """`q` is a substring search over publishable_content, so LIKE
    metacharacters in the user's text must match themselves."""
    recommendation_upsert(
        uuid.uuid4(), _data(publishable_content="Sin comodines."), session
    )
    recommendation_upsert(
        uuid.uuid4(), _data(publishable_content="Contiene 50% de algo."), session
    )

    assert len(recommendation_list(session, q="%")[0]) == 1
    assert len(recommendation_list(session, q="50%")[0]) == 1
    assert len(recommendation_list(session, q="_")[0]) == 0


def test_source_index_survives_deleting_an_earlier_recipient(session):
    """Deleting a recipient must not shift what the survivors point at.

    This is the historical index-pairing bug: suggestions were re-paired to the
    prediction by array position, so removing an earlier recipient
    misattributed every later one. `source_index` pins the link explicitly.
    """
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
                    source_index=0,
                ),
                RecipientValidationData(
                    id=None,
                    name="Segundo",
                    position=None,
                    is_primary=False,
                    macro_sector=None,
                    unit_id=None,
                    sector_id=None,
                    source_index=1,
                ),
            ]
        ),
        session,
    )
    saved = sorted(
        session.exec(
            select(Recipient).where(Recipient.recommendation_id == recommendation.id)
        ).all(),
        key=lambda r: r.order,
    )
    second_id = saved[1].id

    # Drop the first recipient and re-save, exactly as the form does.
    recommendation_upsert(
        document_id,
        _data(
            recipients=[
                RecipientValidationData(
                    id=second_id,
                    name="Segundo",
                    position=None,
                    is_primary=False,
                    macro_sector=None,
                    unit_id=None,
                    sector_id=None,
                    source_index=1,
                ),
            ]
        ),
        session,
    )

    survivors = session.exec(
        select(Recipient).where(Recipient.recommendation_id == recommendation.id)
    ).all()
    assert len(survivors) == 1
    assert survivors[0].id == second_id
    assert survivors[0].order == 0, "order compacts, it is a display position"
    assert survivors[0].source_index == 1, (
        "source_index must keep pointing at prediction.recipients[1] even though "
        "the row is now first"
    )


def test_source_index_is_none_for_a_human_added_recipient(session):
    """A recipient the person typed in did not come from any prediction entry."""
    document_id = uuid.uuid4()
    recommendation = recommendation_upsert(
        document_id,
        _data(
            recipients=[
                RecipientValidationData(
                    id=None,
                    name="Agregado a mano",
                    position=None,
                    is_primary=False,
                    macro_sector=None,
                    unit_id=None,
                    sector_id=None,
                    source_index=None,
                ),
            ]
        ),
        session,
    )
    saved = session.exec(
        select(Recipient).where(Recipient.recommendation_id == recommendation.id)
    ).one()
    assert saved.source_index is None


def test_q_search_treats_a_backslash_as_literal_text(session):
    """`_like_escape` escapes the backslash first; getting that order wrong
    would double-escape the sentinels it adds afterwards."""
    recommendation_upsert(
        uuid.uuid4(), _data(publishable_content=r"Ruta C:\temp de algo."), session
    )
    recommendation_upsert(
        uuid.uuid4(), _data(publishable_content="Sin barra."), session
    )

    assert len(recommendation_list(session, q="\\")[0]) == 1
    assert len(recommendation_list(session, q=r"c:\temp")[0]) == 1
    assert len(recommendation_list(session, q=r"c:\%")[0]) == 0


def test_recommendation_upsert_uses_explicit_date_over_auto_parse(session):
    document_id = uuid.uuid4()
    data = RecommendationValidationData(
        recommendation_number="123",
        recommendation_date_text="10 de julio de 2024",
        recommendation_date=date(2024, 7, 11),  # human-corrected, off by a day
        topic=None,
        subtopic=None,
        personal_data=None,
        publishable_content="contenido",
    )
    recommendation = recommendation_upsert(document_id, data, session)
    assert recommendation.recommendation_date == date(2024, 7, 11)


def test_recommendation_upsert_falls_back_to_auto_parse_when_date_omitted(session):
    document_id = uuid.uuid4()
    data = RecommendationValidationData(
        recommendation_number="123",
        recommendation_date_text="10 de julio de 2024",
        recommendation_date=None,
        topic=None,
        subtopic=None,
        personal_data=None,
        publishable_content="contenido",
    )
    recommendation = recommendation_upsert(document_id, data, session)
    assert recommendation.recommendation_date == date(2024, 7, 10)
