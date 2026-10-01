import io
import json
import re
from datetime import datetime

import openpyxl

from aymurai.database.utils import text_to_uuid

from .conftest import FakeProvider, patched_provider


def _document(text: str) -> dict:
    return {"document": [text], "document_id": str(text_to_uuid(text))}


def _extraction_payload(**overrides) -> str:
    payload = {
        "recommendation_number": "5/2024",
        "recommendation_date": "01 de enero de 2024",
        "recipients": [
            {
                "name": "Alguien",
                "position": "Ministerio de Salud",
                "is_primary": True,
                "macro_sector": "GCBA",
            }
        ],
        "topic": "SALUD",
        "subtopic": "Hospitales",
        "personal_data": False,
        "publishable_content": "Resumen original.",
    }
    payload.update(overrides)
    return json.dumps(payload)


def test_export_empty_dataset_returns_headers_not_404(extraction_client):
    response = extraction_client.get(
        "/llm/data-extraction/export", params={"format": "xlsx"}
    )

    assert response.status_code == 200
    workbook = openpyxl.load_workbook(io.BytesIO(response.content))
    assert workbook.sheetnames == ["recomendaciones", "destinatarios"]
    assert [c.value for c in workbook["recomendaciones"][1]][:3] == [
        "EXPEDIENTE",
        "TEMA",
        "SUBTEMA",
    ]
    assert workbook["recomendaciones"].max_row == 1  # header only


def test_export_reflects_a_correction_made_via_api(
    extraction_client, seeded_catalogs, seeded_organigram_unit
):
    provider = FakeProvider([_extraction_payload()])
    with patched_provider(provider):
        extraction = extraction_client.post(
            "/llm/data-extraction",
            json={"document": _document("Documento de exportación.")},
        )
    document_id = extraction.json()["document_id"]

    extraction_client.put(
        f"/llm/data-extraction/{document_id}/validate",
        json={
            "recommendation_number": "5/2024",
            "recommendation_date_text": "01 de enero de 2024",
            "topic": "SALUD",
            "subtopic": "Hospitales",
            "personal_data": True,
            "publishable_content": "Resumen corregido por un humano.",
            "recipients": [
                {
                    "name": "Alguien",
                    "position": "Ministerio de Salud",
                    "is_primary": True,
                    "macro_sector": "GCBA",
                    "unit_id": str(seeded_organigram_unit.id),
                    "sector_id": str(seeded_organigram_unit.id),
                }
            ],
        },
    )

    response = extraction_client.get(
        "/llm/data-extraction/export", params={"format": "xlsx"}
    )
    assert response.status_code == 200

    workbook = openpyxl.load_workbook(io.BytesIO(response.content))
    recomendaciones = workbook["recomendaciones"]
    headers = [c.value for c in recomendaciones[1]]
    row = dict(zip(headers, [c.value for c in recomendaciones[2]]))
    assert row["NUMERO_RECOMENDACION"] == "5/2024"
    # openpyxl round-trips an empty string cell back as None -- this just
    # confirms the pipeline never wrote a value into a hand-filled column.
    assert row["EXPEDIENTE"] is None
    assert row["CONTENIDO_PARA_PUBLICAR"] == "Resumen corregido por un humano."
    assert row["DATOS_PERSONALES"] == "si"
    # A real date cell (openpyxl round-trips it back as `datetime`), not text.
    assert row["FECHA_RECOMENDACION"] == datetime(2024, 1, 1)
    assert row["DESTINATARIO"] == "Ministerio de Salud"
    assert row["DESTINATARIO_POR_SECTOR"] == "Ministerio de Salud"

    destinatarios = workbook["destinatarios"]
    dest_headers = [c.value for c in destinatarios[1]]
    dest_row = dict(zip(dest_headers, [c.value for c in destinatarios[2]]))
    assert dest_row["DESTINATARIO_POR_SECTOR"] == "Ministerio de Salud"


def test_export_csv_format_has_only_recomendaciones(
    extraction_client, seeded_catalogs, seeded_organigram_unit
):
    provider = FakeProvider([_extraction_payload()])
    with patched_provider(provider):
        extraction = extraction_client.post(
            "/llm/data-extraction",
            json={"document": _document("Documento csv.")},
        )
    document_id = extraction.json()["document_id"]

    extraction_client.put(
        f"/llm/data-extraction/{document_id}/validate",
        json={
            "recommendation_number": "5/2024",
            "recommendation_date_text": None,
            "topic": None,
            "subtopic": None,
            "personal_data": None,
            "publishable_content": "Contenido csv.",
            "recipients": [],
        },
    )

    response = extraction_client.get(
        "/llm/data-extraction/export", params={"format": "csv"}
    )

    assert response.status_code == 200
    text = response.content.decode("utf-8")
    assert "NUMERO_RECOMENDACION" in text
    assert "Contenido csv." in text
    # destinatarios-only column -- csv never carries that sheet at all.
    assert "DESTINATARIO_PRINCIPAL" not in text


def test_export_filename_carries_a_timestamp_suffix(extraction_client):
    response = extraction_client.get(
        "/llm/data-extraction/export", params={"format": "xlsx"}
    )

    disposition = response.headers["content-disposition"]
    assert re.search(r'filename="recomendaciones_\d{14}\.xlsx"', disposition)
