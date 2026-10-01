"""Seguimiento list filters and recipient search through the public HTTP seam."""

import uuid
from dataclasses import dataclass
from datetime import datetime

import pytest
from sqlalchemy import text
from sqlmodel import Session

from aymurai.database.crud.dataset import get_or_create_default_dataset
from aymurai.database.schema import (
    MacroSector,
    OrganigramUnit,
    Recipient,
    Recommendation,
    Subtopic,
    Topic,
)
from aymurai.settings import settings


@dataclass
class FilterRows:
    approved: str
    rejected: str
    unanswered: str
    macro: str
    sector: str
    topic: str
    subtopic: str


@pytest.fixture
def filter_rows(extraction_engine):
    with Session(extraction_engine) as session:
        dataset = get_or_create_default_dataset(session)
        macro = MacroSector(code="EXT", name="Organismos Nacionales")
        sector = OrganigramUnit(name="Sector Vivienda", is_sector=True)
        unit = OrganigramUnit(name="Oficina Territorial")
        topic = Topic(code="SALUD", name="Salud")
        session.add_all([macro, sector, unit, topic])
        session.flush()
        subtopic = Subtopic(topic_id=topic.id, code="HOSP", name="Hospitales")
        session.add(subtopic)
        session.flush()
        rows = [
            Recommendation(
                dataset_id=dataset.id,
                document_id=uuid.uuid4(),
                publishable_content="Compartido",
                recommendation_number=str(i),
                topic_id=topic.id if i == 0 else None,
                subtopic_id=subtopic.id if i == 0 else None,
                link="https://defensoria.test/respuesta" if i == 0 else None,
                created_at=datetime(2026, 1, i + 1, 12, 0),
                updated_at=datetime(2026, 2, 10, 12, 0) if i == 0 else None,
                approved_for_publication=approval,
                recommendation_situation=situation,
                status=status,
            )
            for i, (approval, situation, status) in enumerate(
                [
                    (True, "Respuesta", "Solucionado"),
                    (False, "Notificado", "No solucionado"),
                    (None, None, None),
                ]
            )
        ]
        session.add_all(rows)
        session.flush()
        # Matching secondary recipients must not duplicate results or totals.
        session.add(
            Recipient(
                recommendation_id=rows[0].id, is_primary=True, raw_name="Principal"
            )
        )
        for order in [1, 2]:
            session.add(
                Recipient(
                    recommendation_id=rows[0].id,
                    order=order,
                    raw_name="Secundario 50%_\\",
                    raw_position="Coordinador",
                    macro_sector_id=macro.id,
                    sector_id=sector.id,
                    unit_id=unit.id,
                )
            )
        session.commit()
        return FilterRows(
            *(str(row.id) for row in rows),
            str(macro.id),
            str(sector.id),
            str(topic.id),
            str(subtopic.id),
        )


def _page(client, **params):
    response = client.get("/llm/data-extraction/recommendations", params=params)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(
    ("filters", "expected"),
    [
        ({"approved_for_publication": "true"}, ["approved"]),
        ({"approved_for_publication": "false"}, ["rejected"]),
        ({"publication_unanswered": "true"}, ["unanswered"]),
        ({"publication_unanswered": "false"}, ["approved", "rejected", "unanswered"]),
        ({"recommendation_situation": "Respuesta"}, ["approved"]),
        ({"status": "No solucionado"}, ["rejected"]),
        ({"status": "Solucionado", "approved_for_publication": "false"}, []),
    ],
)
def test_seguimiento_filters(extraction_client, filter_rows, filters, expected):
    page = _page(extraction_client, **filters)
    assert {row["id"] for row in page["items"]} == {
        getattr(filter_rows, key) for key in expected
    }
    assert page["total"] == len(expected)


def test_macro_sector_filter_combines_with_search_and_pagination(
    extraction_client, filter_rows
):
    page = _page(
        extraction_client,
        macro_sector_id=filter_rows.macro,
        sector_id=filter_rows.sector,
        q="secundario",
        page_size=1,
    )
    assert [row["id"] for row in page["items"]] == [filter_rows.approved]
    assert page["total"] == 1
    assert (
        _page(
            extraction_client, macro_sector_id=filter_rows.macro, page=2, page_size=1
        )["items"]
        == []
    )
    assert _page(extraction_client, macro_sector_id=str(uuid.uuid4()))["total"] == 0


@pytest.mark.parametrize(
    "needle",
    ["SECUNDARIO", "coordinador", "territorial", "vivienda", "nacionales", "50%_\\"],
)
def test_search_all_recipient_fields(extraction_client, filter_rows, needle):
    page = _page(extraction_client, q=needle)
    assert [row["id"] for row in page["items"]] == [filter_rows.approved]
    assert page["total"] == 1


@pytest.mark.parametrize("needle", ["Salud", "Hospitales", "defensoria.test"])
def test_search_also_matches_table_text_fields(extraction_client, filter_rows, needle):
    page = _page(extraction_client, q=needle)
    assert [row["id"] for row in page["items"]] == [filter_rows.approved]


def test_topic_subtopic_and_last_edited_filters(extraction_client, filter_rows):
    page = _page(
        extraction_client,
        topic_id=filter_rows.topic,
        subtopic_id=filter_rows.subtopic,
        edited_from="2026-02-10",
        edited_to="2026-02-10",
    )
    assert [row["id"] for row in page["items"]] == [filter_rows.approved]
    assert page["total"] == 1

    assert _page(extraction_client, edited_from="2026-02-11")["total"] == 0


@pytest.mark.parametrize("needle", ["51%", "50__", "50%_\\\\"])
def test_recipient_search_escapes_like_metacharacters(
    extraction_client, filter_rows, needle
):
    assert _page(extraction_client, q=needle)["total"] == 0


@pytest.mark.parametrize(
    "params",
    [
        {"recommendation_situation": "invalid"},
        {"status": "invalid"},
        {"macro_sector_id": "invalid"},
        {"subtopic_id": "invalid"},
        {"edited_from": "invalid"},
        {"approved_for_publication": "invalid"},
        {"publication_unanswered": "invalid"},
        {"publication_unanswered": "true", "approved_for_publication": "true"},
        {"publication_unanswered": "true", "approved_for_publication": "false"},
    ],
)
def test_invalid_filters_return_422(extraction_client, params):
    response = extraction_client.get(
        "/llm/data-extraction/recommendations", params=params
    )
    assert response.status_code == 422


@pytest.fixture
def late_edit_rows(extraction_engine, monkeypatch):
    """One row last edited at 23:30 in Buenos Aires (02:30 UTC the next day),
    and one never-edited row whose `created_at` is in the legacy
    `CURRENT_TIMESTAMP` spelling (no fractional seconds)."""
    monkeypatch.setattr(settings, "EXPORT_TIMEZONE", "America/Argentina/Buenos_Aires")
    with Session(extraction_engine) as session:
        dataset = get_or_create_default_dataset(session)
        late = Recommendation(
            dataset_id=dataset.id,
            document_id=uuid.uuid4(),
            publishable_content="Tarde",
            created_at=datetime(2026, 3, 1, 12, 0),
            updated_at=datetime(2026, 3, 11, 2, 30),
        )
        legacy = Recommendation(
            dataset_id=dataset.id,
            document_id=uuid.uuid4(),
            publishable_content="Legacy",
        )
        session.add_all([late, legacy])
        session.commit()
        session.execute(
            text("UPDATE recommendation SET created_at = :ts WHERE id = :id"),
            {"ts": "2026-03-10 12:00:00", "id": legacy.id.hex},
        )
        session.commit()
        return str(late.id), str(legacy.id)


def test_last_edited_filters_use_the_local_calendar_day(
    extraction_client, late_edit_rows
):
    late, legacy = late_edit_rows

    def ids(**params) -> set[str]:
        return {row["id"] for row in _page(extraction_client, **params)["items"]}

    assert ids(edited_from="2026-03-10", edited_to="2026-03-10") == {late, legacy}
    assert ids(edited_to="2026-03-10") == {late, legacy}
    assert ids(edited_from="2026-03-11") == set()
    assert ids(edited_to="2026-03-09") == set()
