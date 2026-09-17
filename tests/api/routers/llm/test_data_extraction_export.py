import uuid
from datetime import datetime

from aymurai.api.endpoints.routers.llm.data_extraction_export import (
    DESTINATARIOS_COLUMNS,
    RECOMENDACIONES_COLUMNS,
    _format_tri_state,
    _to_local_date,
    build_destinatarios_rows,
    build_recomendaciones_rows,
)
from aymurai.database.crud.dataset import get_or_create_default_dataset
from aymurai.database.schema import (
    MacroSector,
    OrganigramUnit,
    Recipient,
    Recommendation,
    Subtopic,
    Topic,
)


def test_format_tri_state():
    assert _format_tri_state(True) == "si"
    assert _format_tri_state(False) == "no"
    assert _format_tri_state(None) == ""


def test_to_local_date_avoids_the_utc_day_rollover_bug(monkeypatch):
    from aymurai.settings import settings

    monkeypatch.setattr(settings, "EXPORT_TIMEZONE", "America/Argentina/Buenos_Aires")

    # 01:00 UTC on Jan 2nd is 22:00 on Jan 1st in UTC-3 -- the exact
    # historical bug (`toISOString().slice(0, 10)`) would have dated this
    # "2026-01-02" instead of the correct local date, "2026-01-01".
    utc_timestamp = datetime(2026, 1, 2, 1, 0, 0)  # noqa: DTZ001 -- naive, as SQLite stores it

    assert _to_local_date(utc_timestamp) == "2026-01-01"


def test_to_local_date_none_is_empty_string():
    assert _to_local_date(None) == ""


def test_build_rows_on_empty_dataset_returns_empty_lists(session):
    assert build_recomendaciones_rows(session) == []
    assert build_destinatarios_rows(session) == []


def test_recomendaciones_columns_and_order(session):
    dataset = get_or_create_default_dataset(session)
    topic = Topic(id=uuid.uuid4(), code="SALUD", name="SALUD")
    session.add(topic)
    session.commit()
    session.refresh(topic)
    subtopic = Subtopic(
        id=uuid.uuid4(), topic_id=topic.id, code="S1", name="Hospitales"
    )
    session.add(subtopic)
    session.commit()
    session.refresh(subtopic)

    recommendation = Recommendation(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        document_id=uuid.uuid4(),
        recommendation_number="5/2024",
        recommendation_date_text="01 de enero de 2024",
        topic_id=topic.id,
        subtopic_id=subtopic.id,
        personal_data=None,
        publishable_content="Contenido.",
    )
    session.add(recommendation)
    session.commit()

    rows = build_recomendaciones_rows(session)

    assert len(rows) == 1
    row = rows[0]
    assert tuple(row.keys()) == RECOMENDACIONES_COLUMNS
    assert row["NUMERO_RECOMENDACION"] == "5/2024"
    assert row["TEMA"] == "SALUD"
    assert row["TEMA_CODIGO"] == "SALUD"
    assert row["SUBTEMA"] == "Hospitales"
    assert row["SUBTEMA_CODIGO"] == "S1"
    assert row["DATOS_PERSONALES"] == ""  # tri-state: unanswered, not "no"
    assert row["CANTIDAD_DESTINATARIOS"] == 0


def test_destinatarios_columns_order_and_ruta_organigrama(session):
    dataset = get_or_create_default_dataset(session)
    ministerio = OrganigramUnit(
        id=uuid.uuid4(), name="Ministerio de Salud", is_sector=True
    )
    session.add(ministerio)
    session.commit()
    session.refresh(ministerio)
    direccion = OrganigramUnit(
        id=uuid.uuid4(),
        name="Dirección General Legal y Técnica",
        parent_id=ministerio.id,
    )
    session.add(direccion)
    session.commit()
    session.refresh(direccion)

    macro_sector = MacroSector(id=uuid.uuid4(), code="GCBA", name="GCBA")
    session.add(macro_sector)
    session.commit()
    session.refresh(macro_sector)

    recommendation = Recommendation(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        document_id=uuid.uuid4(),
        recommendation_number="5/2024",
        publishable_content="Contenido.",
    )
    session.add(recommendation)
    session.commit()
    session.refresh(recommendation)

    recipient = Recipient(
        id=uuid.uuid4(),
        recommendation_id=recommendation.id,
        order=0,
        raw_name="Alguien",
        raw_position="Directora General Legal y Técnica",
        is_primary=True,
        macro_sector_id=macro_sector.id,
        unit_id=direccion.id,
        sector_id=ministerio.id,
    )
    session.add(recipient)
    session.commit()

    rows = build_destinatarios_rows(session)

    assert len(rows) == 1
    row = rows[0]
    assert tuple(row.keys()) == DESTINATARIOS_COLUMNS
    assert row["NOMBRE"] == "Alguien"
    assert row["DESTINATARIO_PRINCIPAL"] == "si"
    assert row["CARGO_FINAL"] == "Dirección General Legal y Técnica"
    assert row["MACRO_SECTOR"] == "GCBA"
    # SECTOR_FINAL is the human-validated `sector_id`, independent of
    # `unit_id` -- never derived from it.
    assert row["SECTOR_FINAL"] == "Ministerio de Salud"
    assert row["RUTA_ORGANIGRAMA"] == (
        "Ministerio de Salud > Dirección General Legal y Técnica"
    )


def test_destinatarios_non_gcba_falls_back_sector_final_to_macro_sector(
    session,
):
    dataset = get_or_create_default_dataset(session)
    macro_sector = MacroSector(
        id=uuid.uuid4(), code="ORGANISMOS_NACIONALES", name="Organismos Nacionales"
    )
    session.add(macro_sector)
    session.commit()
    session.refresh(macro_sector)

    recommendation = Recommendation(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        document_id=uuid.uuid4(),
        recommendation_number="6/2024",
        publishable_content="Contenido.",
    )
    session.add(recommendation)
    session.commit()
    session.refresh(recommendation)

    recipient = Recipient(
        id=uuid.uuid4(),
        recommendation_id=recommendation.id,
        order=0,
        raw_name="Alguien",
        raw_position="Titular de un organismo nacional",
        is_primary=True,
        macro_sector_id=macro_sector.id,
    )
    session.add(recipient)
    session.commit()

    row = build_destinatarios_rows(session)[0]

    assert row["CARGO_FINAL"] == ""  # no unit -- nothing to show
    assert row["MACRO_SECTOR"] == "Organismos Nacionales"
    assert row["SECTOR_FINAL"] == "Organismos Nacionales"
    assert row["RUTA_ORGANIGRAMA"] == ""


def test_destinatarios_gcba_falls_back_sector_final_to_unit_when_sector_id_unset(
    session,
):
    dataset = get_or_create_default_dataset(session)
    ivc = OrganigramUnit(id=uuid.uuid4(), name="IVC", is_sector=False)
    session.add(ivc)
    session.commit()
    session.refresh(ivc)

    macro_sector = MacroSector(id=uuid.uuid4(), code="GCBA", name="GCBA")
    session.add(macro_sector)
    session.commit()
    session.refresh(macro_sector)

    recommendation = Recommendation(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        document_id=uuid.uuid4(),
        recommendation_number="7/2024",
        publishable_content="Contenido.",
    )
    session.add(recommendation)
    session.commit()
    session.refresh(recommendation)

    recipient = Recipient(
        id=uuid.uuid4(),
        recommendation_id=recommendation.id,
        order=0,
        raw_name="Alguien",
        raw_position="Titular del IVC",
        is_primary=True,
        macro_sector_id=macro_sector.id,
        unit_id=ivc.id,
        sector_id=None,
    )
    session.add(recipient)
    session.commit()

    rows = build_destinatarios_rows(session)

    assert len(rows) == 1
    # SECTOR_FINAL falls back to the validated unit's own name when no
    # sector-level reference was resolved/promoted -- never blank while a
    # validated organigram unit exists.
    assert rows[0]["SECTOR_FINAL"] == "IVC"
