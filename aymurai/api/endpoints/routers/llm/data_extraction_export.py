import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import openpyxl
import pandas as pd
from sqlmodel import Session, select

from aymurai.database.crud.organigram.unit import ruta_organigrama
from aymurai.database.schema import (
    MacroSector,
    OrganigramUnit,
    Recipient,
    Recommendation,
    Subtopic,
    Topic,
)
from aymurai.settings import settings

RECOMENDACIONES_COLUMNS = (
    "RECOMENDACION_ID",
    "DOCUMENT_ID",
    "NUMERO_RECOMENDACION",
    "FECHA_RECOMENDACION",
    "TEMA",
    "TEMA_CODIGO",
    "SUBTEMA",
    "SUBTEMA_CODIGO",
    "DATOS_PERSONALES",
    "CONTENIDO_PARA_PUBLICAR",
    "CANTIDAD_DESTINATARIOS",
    "FECHA_CREACION",
    "FECHA_VALIDACION",
)

DESTINATARIOS_COLUMNS = (
    "RECOMENDACION_ID",
    "DOCUMENT_ID",
    "NUMERO_RECOMENDACION",
    "NOMBRE",
    "CARGO",
    "DESTINATARIO_PRINCIPAL",
    "MACRO_SECTOR",
    "SECTOR_FINAL",
    "RUTA_ORGANIGRAMA",
)


def _format_tri_state(value: bool | None) -> str:
    """
    Formats a tri-state boolean for a spreadsheet cell.

    `None` ("unanswered") must render as an empty string, never as `"no"` --
    the two mean different things and losing that distinction here would be
    silent and irreversible once exported.

    Args:
        value (bool | None): Tri-state value.

    Returns:
        str: "si", "no", or "" for None.
    """
    if value is None:
        return ""
    return "si" if value else "no"


def _to_local_date(dt: datetime | None) -> str:
    """
    Formats a naive-UTC timestamp (as SQLite's `CURRENT_TIMESTAMP` stores it)
    as a `YYYY-MM-DD` date in `settings.EXPORT_TIMEZONE`.

    Never uses the process's own local time/`utcnow().isoformat()` directly --
    doing that in UTC would date anything validated after 21:00 in Argentina
    (UTC-3) as the following day.

    Args:
        dt (datetime | None): Naive UTC timestamp, or None.

    Returns:
        str: Local date, or "" if `dt` is None.
    """
    if dt is None:
        return ""
    local = dt.replace(tzinfo=UTC).astimezone(ZoneInfo(settings.EXPORT_TIMEZONE))
    return local.strftime("%Y-%m-%d")


def build_recomendaciones_rows(session: Session) -> list[dict[str, Any]]:
    """
    Builds one row per recommendation, ready to write to the `recomendaciones`
    sheet/CSV. Empty dataset -> empty list, never an error.

    Args:
        session (Session): Database session.

    Returns:
        list[dict[str, Any]]: Rows keyed by `RECOMENDACIONES_COLUMNS`.
    """
    recommendations = session.exec(
        select(Recommendation).order_by(Recommendation.created_at)
    ).all()

    rows = []
    for recommendation in recommendations:
        topic = (
            session.get(Topic, recommendation.topic_id)
            if recommendation.topic_id
            else None
        )
        subtopic = (
            session.get(Subtopic, recommendation.subtopic_id)
            if recommendation.subtopic_id
            else None
        )
        recipient_count = len(
            session.exec(
                select(Recipient).where(
                    Recipient.recommendation_id == recommendation.id
                )
            ).all()
        )

        rows.append(
            {
                "RECOMENDACION_ID": str(recommendation.id),
                "DOCUMENT_ID": str(recommendation.document_id),
                "NUMERO_RECOMENDACION": recommendation.recommendation_number or "",
                "FECHA_RECOMENDACION": recommendation.recommendation_date_text or "",
                "TEMA": topic.name if topic else "",
                "TEMA_CODIGO": (topic.code or "") if topic else "",
                "SUBTEMA": subtopic.name if subtopic else "",
                "SUBTEMA_CODIGO": (subtopic.code or "") if subtopic else "",
                "DATOS_PERSONALES": _format_tri_state(recommendation.personal_data),
                "CONTENIDO_PARA_PUBLICAR": recommendation.publishable_content,
                "CANTIDAD_DESTINATARIOS": recipient_count,
                "FECHA_CREACION": _to_local_date(recommendation.created_at),
                "FECHA_VALIDACION": _to_local_date(
                    recommendation.updated_at or recommendation.created_at
                ),
            }
        )
    return rows


def build_destinatarios_rows(session: Session) -> list[dict[str, Any]]:
    """
    Builds one row per recipient, ready to write to the `destinatarios`
    sheet. Empty dataset -> empty list, never an error.

    Args:
        session (Session): Database session.

    Returns:
        list[dict[str, Any]]: Rows keyed by `DESTINATARIOS_COLUMNS`.
    """
    recipients = session.exec(
        select(Recipient, Recommendation)
        .where(Recipient.recommendation_id == Recommendation.id)
        .order_by(Recommendation.created_at, Recipient.order)
    ).all()

    rows = []
    for recipient, recommendation in recipients:
        macro_sector = (
            session.get(MacroSector, recipient.macro_sector_id)
            if recipient.macro_sector_id
            else None
        )
        unit = (
            session.get(OrganigramUnit, recipient.unit_id)
            if recipient.unit_id
            else None
        )
        sector = (
            session.get(OrganigramUnit, recipient.sector_id)
            if recipient.sector_id
            else None
        )

        # `sector_id` is a human-validated choice, independent of `unit_id`
        # (never derived from it) -- organigram matching only ever runs for
        # GCBA recipients (everything else is gated out before it starts),
        # so a non-GCBA recipient never has one; falling back to the macro
        # sector keeps the column from reading as an unexplained blank.
        if sector is not None:
            sector_final = sector.name
        elif macro_sector is not None and macro_sector.code != "GCBA":
            sector_final = macro_sector.name
        else:
            sector_final = ""

        rows.append(
            {
                "RECOMENDACION_ID": str(recommendation.id),
                "DOCUMENT_ID": str(recommendation.document_id),
                "NUMERO_RECOMENDACION": recommendation.recommendation_number or "",
                "NOMBRE": recipient.raw_name or "",
                "CARGO": recipient.raw_position or "",
                "DESTINATARIO_PRINCIPAL": _format_tri_state(recipient.is_primary),
                "MACRO_SECTOR": macro_sector.name if macro_sector else "",
                "SECTOR_FINAL": sector_final,
                "RUTA_ORGANIGRAMA": ruta_organigrama(unit, session) if unit else "",
            }
        )
    return rows


def write_xlsx(
    recomendaciones: list[dict[str, Any]], destinatarios: list[dict[str, Any]]
) -> Path:
    """
    Writes the two-sheet workbook to a fresh temp file.

    Args:
        recomendaciones (list[dict[str, Any]]): Rows for the `recomendaciones` sheet.
        destinatarios (list[dict[str, Any]]): Rows for the `destinatarios` sheet.

    Returns:
        Path: Path to the written `.xlsx` temp file. Caller owns deleting it.
    """
    workbook = openpyxl.Workbook()

    recomendaciones_sheet = workbook.active
    recomendaciones_sheet.title = "recomendaciones"
    recomendaciones_sheet.append(RECOMENDACIONES_COLUMNS)
    for row in recomendaciones:
        recomendaciones_sheet.append(
            [row[column] for column in RECOMENDACIONES_COLUMNS]
        )

    destinatarios_sheet = workbook.create_sheet("destinatarios")
    destinatarios_sheet.append(DESTINATARIOS_COLUMNS)
    for row in destinatarios:
        destinatarios_sheet.append([row[column] for column in DESTINATARIOS_COLUMNS])

    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    workbook.save(path)
    return Path(path)


def write_csv(recomendaciones: list[dict[str, Any]]) -> Path:
    """
    Writes just the `recomendaciones` rows to a fresh temp CSV file -- a CSV
    can't hold two sheets, so `destinatarios` isn't part of this format.

    Args:
        recomendaciones (list[dict[str, Any]]): Rows for the `recomendaciones` table.

    Returns:
        Path: Path to the written `.csv` temp file. Caller owns deleting it.
    """
    frame = pd.DataFrame(recomendaciones, columns=RECOMENDACIONES_COLUMNS)
    fd, path = tempfile.mkstemp(suffix=".csv")
    os.close(fd)
    frame.to_csv(path, index=False)
    return Path(path)
