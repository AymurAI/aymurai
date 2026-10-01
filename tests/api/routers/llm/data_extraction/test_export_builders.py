import csv
import uuid
from datetime import date, datetime

import openpyxl
from openpyxl.utils import get_column_letter

from aymurai.api.endpoints.routers.llm.data_extraction_export import (
    DESTINATARIOS_COLUMNS,
    RECOMENDACIONES_COLUMNS,
    _format_tri_state,
    _to_local_date,
    build_destinatarios_rows,
    build_recomendaciones_rows,
    write_xlsx,
    write_csv,
)
from aymurai.database.crud.dataset import get_or_create_default_dataset
from aymurai.database.schema import (
    MacroSector,
    OrganigramUnit,
    Recipient,
    Recommendation,
    RecommendationSituation,
    RecommendationStatus,
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
        recommendation_date=date(2024, 1, 1),
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
    # A real `date` object, never a string -- Excel must render it as a date.
    assert row["FECHA_RECOMENDACION"] == date(2024, 1, 1)
    assert row["TEMA"] == "SALUD"
    assert row["SUBTEMA"] == "Hospitales"
    assert row["DATOS_PERSONALES"] == ""  # tri-state: unanswered, not "no"
    # Template columns left unset on this recommendation -- text ones blank,
    # tri-state/closed-catalog ones "" (unanswered), never "no".
    for unset_column in (
        "EXPEDIENTE",
        "DETALLE_DE_LA_SITUACION",
        "SITUACION_DE_LA_RECOMENDACION",
        "ESTADO",
        "PARA_PUBLICAR",
        "LINK",
    ):
        assert row[unset_column] == ""


def test_recomendaciones_template_columns_export_populated_values(session):
    dataset = get_or_create_default_dataset(session)
    recommendation = Recommendation(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        document_id=uuid.uuid4(),
        publishable_content="Contenido.",
        file_number="EXP-123/2024",
        recommendation_detail="En trámite",
        recommendation_situation=RecommendationSituation.RESPUESTA_PARCIAL,
        status=RecommendationStatus.SOLUCIONADO,
        approved_for_publication=False,
        link="https://example.org/expediente/123",
    )
    session.add(recommendation)
    session.commit()

    row = build_recomendaciones_rows(session)[0]

    assert row["EXPEDIENTE"] == "EXP-123/2024"
    assert row["DETALLE_DE_LA_SITUACION"] == "En trámite"
    assert row["SITUACION_DE_LA_RECOMENDACION"] == "Respuesta parcial"
    assert row["ESTADO"] == "Solucionado"
    assert row["PARA_PUBLICAR"] == "no"
    assert row["LINK"] == "https://example.org/expediente/123"


def test_recomendaciones_destinatario_is_the_primary_recipients_unit(session):
    dataset = get_or_create_default_dataset(session)
    ministerio = OrganigramUnit(
        id=uuid.uuid4(), name="Ministerio de Salud", is_sector=True
    )
    session.add(ministerio)
    session.commit()
    session.refresh(ministerio)

    macro_sector = MacroSector(id=uuid.uuid4(), code="GCBA", name="GCBA")
    session.add(macro_sector)
    session.commit()
    session.refresh(macro_sector)

    recommendation = Recommendation(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        document_id=uuid.uuid4(),
        publishable_content="Contenido.",
    )
    session.add(recommendation)
    session.commit()
    session.refresh(recommendation)

    # A secondary (notified-only) recipient comes first by order, but the
    # primary one must still be the row's representative.
    session.add(
        Recipient(
            id=uuid.uuid4(),
            recommendation_id=recommendation.id,
            order=0,
            raw_name="Notificado",
            raw_position="Un cargo cualquiera",
            is_primary=False,
            macro_sector_id=macro_sector.id,
        )
    )
    session.add(
        Recipient(
            id=uuid.uuid4(),
            recommendation_id=recommendation.id,
            order=1,
            raw_name="Alguien",
            raw_position="Ministro de Salud",
            is_primary=True,
            macro_sector_id=macro_sector.id,
            unit_id=ministerio.id,
            sector_id=ministerio.id,
        )
    )
    session.commit()

    row = build_recomendaciones_rows(session)[0]

    assert row["DESTINATARIO"] == "Ministerio de Salud"
    assert row["DESTINATARIO_POR_SECTOR"] == "Ministerio de Salud"


def test_recomendaciones_destinatario_non_gcba_uses_cargo(session):
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
        publishable_content="Contenido.",
    )
    session.add(recommendation)
    session.commit()
    session.refresh(recommendation)

    session.add(
        Recipient(
            id=uuid.uuid4(),
            recommendation_id=recommendation.id,
            order=0,
            raw_name="Alguien",
            raw_position="Titular de un organismo nacional",
            is_primary=True,
            macro_sector_id=macro_sector.id,
        )
    )
    session.commit()

    row = build_recomendaciones_rows(session)[0]

    assert row["DESTINATARIO"] == "Titular de un organismo nacional"
    assert row["DESTINATARIO_POR_SECTOR"] == "Organismos Nacionales"


def test_destinatarios_columns_order(session):
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
    # CARGO is the validated unit's name for a GCBA recipient, not the raw
    # extracted text -- "Directora General..." (a person's title) never
    # appears once a unit ("Dirección General...", the office) is validated.
    assert row["CARGO"] == "Dirección General Legal y Técnica"
    assert row["DESTINATARIO_PRINCIPAL"] == "si"
    # DESTINATARIO_POR_SECTOR is the human-validated `sector_id`, independent
    # of `unit_id` -- never derived from it.
    assert row["DESTINATARIO_POR_SECTOR"] == "Ministerio de Salud"


def test_destinatarios_non_gcba_cargo_is_raw_position(session):
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

    assert row["CARGO"] == "Titular de un organismo nacional"
    assert row["DESTINATARIO_POR_SECTOR"] == "Organismos Nacionales"


def test_destinatarios_gcba_stays_blank_when_no_sector_validated(session):
    """A validated `unit_id` alone is not enough -- DESTINATARIO_POR_SECTOR
    reports only what a human confirmed *as the sector*, never a fallback to
    the unit. Unlike the old SECTOR_FINAL column, this must stay blank."""
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
    assert rows[0]["DESTINATARIO_POR_SECTOR"] == ""


def test_destinatarios_gcba_unit_without_macro_sector_uses_unit_name(session):
    """A validated `unit_id` with `macro_sector_id = NULL` should still use
    the unit's name in CARGO, not the raw extracted position. The organigram
    is GCBA-only, so a `unit_id` already implies GCBA."""
    dataset = get_or_create_default_dataset(session)
    ivc = OrganigramUnit(id=uuid.uuid4(), name="IVC", is_sector=False)
    session.add(ivc)
    session.commit()
    session.refresh(ivc)

    recommendation = Recommendation(
        id=uuid.uuid4(),
        dataset_id=dataset.id,
        document_id=uuid.uuid4(),
        recommendation_number="8/2024",
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
        macro_sector_id=None,  # NULL macro_sector_id
        unit_id=ivc.id,
        sector_id=None,
    )
    session.add(recipient)
    session.commit()

    rows = build_destinatarios_rows(session)

    assert len(rows) == 1
    # CARGO should be the unit's name, not the raw position
    assert rows[0]["CARGO"] == "IVC"
    assert rows[0]["DESTINATARIO_POR_SECTOR"] == ""

    # Same invariant on the `recomendaciones` sheet's DESTINATARIO column --
    # the actual defect this fix wave targeted (see commit "fix(export): stop
    # gating DESTINATARIO on macro_sector code").
    assert build_recomendaciones_rows(session)[0]["DESTINATARIO"] == "IVC"


def test_write_xlsx_styles_the_header_and_sizes_columns():
    long_content = "x" * 100  # wider than a sheet's default column width
    recomendaciones = [
        {
            column: long_content if column == "CONTENIDO_PARA_PUBLICAR" else ""
            for column in RECOMENDACIONES_COLUMNS
        }
    ]
    destinatarios: list = []

    path = write_xlsx(recomendaciones, destinatarios)
    try:
        workbook = openpyxl.load_workbook(path)
        sheet = workbook["recomendaciones"]

        assert all(cell.font.bold for cell in sheet[1])
        assert sheet.freeze_panes == "A2"

        contenido_idx = RECOMENDACIONES_COLUMNS.index("CONTENIDO_PARA_PUBLICAR") + 1
        letter = get_column_letter(contenido_idx)
        # Capped, not left to grow with the content -- a long summary must
        # not blow the sheet out sideways.
        assert sheet.column_dimensions[letter].width == 60
        # Wrapped instead: the row grows taller, the column doesn't grow wider.
        data_cell = sheet.cell(row=2, column=contenido_idx)
        assert data_cell.alignment.wrap_text is True
        header_cell = sheet.cell(row=1, column=contenido_idx)
        assert header_cell.alignment.wrap_text is not True

        expediente_idx = RECOMENDACIONES_COLUMNS.index("EXPEDIENTE") + 1
        expediente_letter = get_column_letter(expediente_idx)
        assert sheet.column_dimensions[expediente_letter].width >= 10
    finally:
        path.unlink()


def test_exported_files_use_situation_detail_header(session):
    dataset = get_or_create_default_dataset(session)
    session.add(
        Recommendation(
            dataset_id=dataset.id,
            document_id=uuid.uuid4(),
            publishable_content="Contenido",
            recommendation_detail="En trámite",
        )
    )
    session.commit()
    rows = build_recomendaciones_rows(session)
    csv_path = write_csv(rows)
    xlsx_path = write_xlsx(rows, [])
    try:
        with csv_path.open(encoding="utf-8", newline="") as handle:
            csv_row = next(csv.DictReader(handle))
        assert csv_row["DETALLE_DE_LA_SITUACION"] == "En trámite"
        assert "DETALLE_DE_LA_RECOMENDACION" not in csv_row
        workbook = openpyxl.load_workbook(xlsx_path)
        try:
            records = list(workbook["recomendaciones"].values)
            headers = records[0]
            assert "DETALLE_DE_LA_RECOMENDACION" not in headers
            assert records[1][headers.index("DETALLE_DE_LA_SITUACION")] == "En trámite"
        finally:
            workbook.close()
    finally:
        csv_path.unlink()
        xlsx_path.unlink()
