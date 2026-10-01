"""
The grilla makes `link`, `file_number` and `recommendation_detail` free text,
and the workbook is opened in Excel/LibreOffice: a value that starts like a
formula must land as the literal text somebody typed, never as a formula.
"""

import csv
from datetime import date

import openpyxl
import pytest

from aymurai.api.endpoints.routers.llm.data_extraction_export import (
    DESTINATARIOS_COLUMNS,
    RECOMENDACIONES_COLUMNS,
    write_csv,
    write_xlsx,
)

PAYLOADS = [
    '=HYPERLINK("https://evil.example","clic")',
    "+1",
    "-2+3",
    "@SUM(A1:A2)",
    "\t=1+1",
    "\r=1+1",
]


def _recomendacion(**values):
    row: dict = {column: "" for column in RECOMENDACIONES_COLUMNS}
    row.update(values)
    return row


def _destinatario(**values):
    row: dict = {column: "" for column in DESTINATARIOS_COLUMNS}
    row.update(values)
    return row


def _cell(sheet, column: str, columns: tuple[str, ...], row: int = 2):
    return sheet.cell(row=row, column=columns.index(column) + 1)


@pytest.mark.parametrize("payload", PAYLOADS)
def test_xlsx_writes_formula_like_values_as_literal_text(payload):
    recomendaciones = [
        _recomendacion(
            LINK=payload,
            DETALLE_DE_LA_RECOMENDACION=payload,
            EXPEDIENTE=payload,
        )
    ]
    destinatarios = [_destinatario(NOMBRE=payload)]

    path = write_xlsx(recomendaciones, destinatarios)
    try:
        workbook = openpyxl.load_workbook(path)
        recomendaciones_sheet = workbook["recomendaciones"]
        for column in ("LINK", "DETALLE_DE_LA_RECOMENDACION", "EXPEDIENTE"):
            cell = _cell(recomendaciones_sheet, column, RECOMENDACIONES_COLUMNS)
            assert cell.data_type == "s"
            # The visible value is exactly what was typed -- no added quote.
            assert cell.value == payload
            # Excel's own "typed with a leading '" marker: re-editing the
            # cell keeps it text instead of turning it into a formula.
            assert cell.quotePrefix is True

        nombre = _cell(workbook["destinatarios"], "NOMBRE", DESTINATARIOS_COLUMNS)
        assert nombre.data_type == "s"
        assert nombre.value == payload
    finally:
        path.unlink()


def test_xlsx_leaves_ordinary_values_alone():
    recomendaciones = [
        _recomendacion(
            LINK="https://example.org/recomendacion",
            FECHA_RECOMENDACION=date(2024, 1, 2),
            EXPEDIENTE="EX-2024-1",
        )
    ]

    path = write_xlsx(recomendaciones, [])
    try:
        sheet = openpyxl.load_workbook(path)["recomendaciones"]
        link = _cell(sheet, "LINK", RECOMENDACIONES_COLUMNS)
        assert link.value == "https://example.org/recomendacion"
        assert link.quotePrefix is False
        # Dates are not strings: still a native, sortable date cell.
        fecha = _cell(sheet, "FECHA_RECOMENDACION", RECOMENDACIONES_COLUMNS)
        assert fecha.is_date
        assert fecha.value.date() == date(2024, 1, 2)
    finally:
        path.unlink()


@pytest.mark.parametrize("payload", PAYLOADS)
def test_csv_prefixes_formula_like_values_with_a_quote(payload):
    path = write_csv(
        [_recomendacion(LINK=payload, DETALLE_DE_LA_RECOMENDACION=payload)]
    )
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            [row] = list(csv.DictReader(handle))
    finally:
        path.unlink()

    # OWASP's CSV-injection advice: a leading `'` makes the spreadsheet read
    # the field as text. CSV has no cell type to carry that otherwise.
    assert row["LINK"] == f"'{payload}"
    assert row["DETALLE_DE_LA_RECOMENDACION"] == f"'{payload}"


def test_csv_leaves_ordinary_values_alone():
    path = write_csv(
        [
            _recomendacion(
                LINK="https://example.org/r",
                FECHA_RECOMENDACION=date(2024, 1, 2),
                EXPEDIENTE="EX-1",
            )
        ]
    )
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            [row] = list(csv.DictReader(handle))
    finally:
        path.unlink()

    assert row["LINK"] == "https://example.org/r"
    assert row["EXPEDIENTE"] == "EX-1"
    assert row["FECHA_RECOMENDACION"] == "2024-01-02"
