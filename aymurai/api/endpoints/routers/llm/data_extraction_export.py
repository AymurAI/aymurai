import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import openpyxl
import pandas as pd
from openpyxl.styles import Alignment, Font
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet
from sqlmodel import Session, select

from aymurai.database.schema import (
    MacroSector,
    OrganigramUnit,
    Recipient,
    Recommendation,
    Subtopic,
    Topic,
)
from aymurai.settings import settings

# EXPEDIENTE, CONTENIDO_INICIAL, ESTADO_DE_SITUACION, ESTADO,
# SE_RESOLVIO_LA_CUESTION_EN_EL_EXPEDIENTE, PARA_PUBLICAR and LINK are filled
# in by hand after export -- this pipeline only ever writes "" for them.
RECOMENDACIONES_COLUMNS = (
    "EXPEDIENTE",
    "TEMA",
    "SUBTEMA",
    "NUMERO_RECOMENDACION",
    "FECHA_RECOMENDACION",
    "DESTINATARIO",
    "DESTINATARIO_POR_SECTOR",
    "CONTENIDO_PARA_PUBLICAR",
    "CONTENIDO_INICIAL",
    "ESTADO_DE_SITUACION",
    "ESTADO",
    "SE_RESOLVIO_LA_CUESTION_EN_EL_EXPEDIENTE",
    "PARA_PUBLICAR",
    "DATOS_PERSONALES",
    "LINK",
)

DESTINATARIOS_COLUMNS = (
    "NUMERO_RECOMENDACION",
    "NOMBRE",
    "CARGO",
    "DESTINATARIO_POR_SECTOR",
    "DESTINATARIO_PRINCIPAL",
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


def _destinatario_por_sector(
    sector: OrganigramUnit | None, macro_sector: MacroSector | None
) -> str:
    """
    The sector a human explicitly validated -- never derived from a plain
    `unit_id`, and never falls back to it. A GCBA recipient with a unit but
    no validated sector exports blank here on purpose: this column reports
    what was confirmed as *the sector*, not the best available guess.

    Args:
        sector (OrganigramUnit | None): The recipient's validated `sector_id`
            row, if any.
        macro_sector (MacroSector | None): The recipient's macro sector.

    Returns:
        str: The sector's name (GCBA), the macro sector's name (non-GCBA),
            or "" when neither is resolved.
    """
    if sector is not None:
        return sector.name
    if macro_sector is not None and macro_sector.code != "GCBA":
        return macro_sector.name
    return ""


def _destinatario(
    unit: OrganigramUnit | None,
    macro_sector: MacroSector | None,
    raw_position: str | None,
) -> str:
    """
    The validated organigram unit's name for a GCBA recipient, or the cargo
    as extracted for everyone else -- and for a GCBA recipient with no
    validated unit either, since there's nothing more specific to show.

    Args:
        unit (OrganigramUnit | None): The recipient's validated `unit_id`
            row, if any.
        macro_sector (MacroSector | None): The recipient's macro sector.
        raw_position (str | None): The cargo as extracted, used as a
            fallback whenever there's no validated GCBA unit to name.

    Returns:
        str: The unit's name, the raw cargo, or "" if neither is available.
    """
    is_gcba = macro_sector is not None and macro_sector.code == "GCBA"
    if is_gcba and unit is not None:
        return unit.name
    return raw_position or ""


def _representative_recipient(session: Session, recommendation_id) -> Recipient | None:
    """
    The recipient that stands in for a recommendation on the one-row-per-
    recommendation `recomendaciones` sheet: the one marked `is_primary`, or
    (if none is) the first by `order` -- never an error when there are zero.

    Args:
        session (Session): Database session.
        recommendation_id: The recommendation's id.

    Returns:
        Recipient | None: The representative recipient, or None if the
            recommendation has no recipients at all.
    """
    recipients = session.exec(
        select(Recipient)
        .where(Recipient.recommendation_id == recommendation_id)
        .order_by(Recipient.is_primary.desc(), Recipient.order)
    ).all()
    return recipients[0] if recipients else None


def build_recomendaciones_rows(session: Session) -> list[dict[str, Any]]:
    """
    Builds one row per recommendation, ready to write to the `recomendaciones`
    sheet/CSV. Empty dataset -> empty list, never an error.

    `DESTINATARIO`/`DESTINATARIO_POR_SECTOR` summarize the recommendation's
    *representative* recipient (see `_representative_recipient`) -- a
    recommendation with several recipients still gets exactly one row here;
    the full per-recipient detail lives in the `destinatarios` sheet.

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

        representative = _representative_recipient(session, recommendation.id)
        destinatario = ""
        destinatario_por_sector = ""
        if representative is not None:
            macro_sector = (
                session.get(MacroSector, representative.macro_sector_id)
                if representative.macro_sector_id
                else None
            )
            unit = (
                session.get(OrganigramUnit, representative.unit_id)
                if representative.unit_id
                else None
            )
            sector = (
                session.get(OrganigramUnit, representative.sector_id)
                if representative.sector_id
                else None
            )
            destinatario = _destinatario(
                unit, macro_sector, representative.raw_position
            )
            destinatario_por_sector = _destinatario_por_sector(sector, macro_sector)

        rows.append(
            {
                "EXPEDIENTE": "",
                "TEMA": topic.name if topic else "",
                "SUBTEMA": subtopic.name if subtopic else "",
                "NUMERO_RECOMENDACION": recommendation.recommendation_number or "",
                "FECHA_RECOMENDACION": recommendation.recommendation_date,
                "DESTINATARIO": destinatario,
                "DESTINATARIO_POR_SECTOR": destinatario_por_sector,
                "CONTENIDO_PARA_PUBLICAR": recommendation.publishable_content,
                "CONTENIDO_INICIAL": "",
                "ESTADO_DE_SITUACION": "",
                "ESTADO": "",
                "SE_RESOLVIO_LA_CUESTION_EN_EL_EXPEDIENTE": "",
                "PARA_PUBLICAR": "",
                "DATOS_PERSONALES": _format_tri_state(recommendation.personal_data),
                "LINK": "",
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

        rows.append(
            {
                "NUMERO_RECOMENDACION": recommendation.recommendation_number or "",
                "NOMBRE": recipient.raw_name or "",
                "CARGO": _destinatario(unit, macro_sector, recipient.raw_position),
                "DESTINATARIO_POR_SECTOR": _destinatario_por_sector(
                    sector, macro_sector
                ),
                "DESTINATARIO_PRINCIPAL": _format_tri_state(recipient.is_primary),
            }
        )
    return rows


_MIN_COLUMN_WIDTH = 10
_MAX_COLUMN_WIDTH = 60


def _style_sheet(
    sheet: Worksheet, columns: tuple[str, ...], *, wrap_columns: tuple[str, ...] = ()
) -> None:
    """
    Bolds the header row, freezes it so it stays visible while scrolling,
    sizes each column to its widest cell (header or content) so the sheet
    opens already readable instead of every column the same default width,
    and wraps text in `wrap_columns` so a long value grows the row instead of
    spilling past the column's (capped) width.

    Args:
        sheet (Worksheet): The sheet to style, header already written.
        columns (tuple[str, ...]): Column names, in the order they were
            written -- used to size each one independently.
        wrap_columns (tuple[str, ...]): Columns whose data cells (never the
            header) get `wrap_text` -- Excel/LibreOffice auto-fit the row
            height for a wrapped cell on open, since no explicit row height
            was set here to override that.
    """
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    sheet.freeze_panes = "A2"

    wrap_alignment = Alignment(wrap_text=True, vertical="top")
    for col_idx, column in enumerate(columns, start=1):
        widest = len(column)
        wraps = column in wrap_columns
        for (cell,) in sheet.iter_rows(min_row=2, min_col=col_idx, max_col=col_idx):
            if wraps:
                cell.alignment = wrap_alignment
            if cell.value is not None:
                widest = max(widest, len(str(cell.value)))
        letter = get_column_letter(col_idx)
        sheet.column_dimensions[letter].width = min(
            max(widest + 2, _MIN_COLUMN_WIDTH), _MAX_COLUMN_WIDTH
        )


def write_xlsx(
    recomendaciones: list[dict[str, Any]], destinatarios: list[dict[str, Any]]
) -> Path:
    """
    Writes the two-sheet workbook to a fresh temp file.

    `FECHA_RECOMENDACION` is written as a native `date` (never a string), so
    the column opens in Excel as an actual, sortable/filterable date -- the
    date-formatted cell is what `openpyxl` produces for a Python `date`
    written directly, no explicit `number_format` needed.

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
    _style_sheet(
        recomendaciones_sheet,
        RECOMENDACIONES_COLUMNS,
        wrap_columns=("CONTENIDO_PARA_PUBLICAR", "CONTENIDO_INICIAL"),
    )

    destinatarios_sheet = workbook.create_sheet("destinatarios")
    destinatarios_sheet.append(DESTINATARIOS_COLUMNS)
    for row in destinatarios:
        destinatarios_sheet.append([row[column] for column in DESTINATARIOS_COLUMNS])
    _style_sheet(destinatarios_sheet, DESTINATARIOS_COLUMNS)

    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    workbook.save(path)
    return Path(path)


def write_csv(recomendaciones: list[dict[str, Any]]) -> Path:
    """
    Writes just the `recomendaciones` rows to a fresh temp CSV file -- a CSV
    can't hold two sheets, so `destinatarios` isn't part of this format.

    `FECHA_RECOMENDACION` (a `date`/`None` column) serializes through pandas
    as plain ISO text in the CSV -- CSV has no native date type regardless.

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
