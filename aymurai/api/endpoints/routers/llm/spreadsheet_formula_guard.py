"""
Keeps free text from being read as a formula by a spreadsheet program.

The exported workbook carries text people typed in the grilla (`link`,
`file_number`, `recommendation_detail`) and text the model read from a
document. Excel and LibreOffice evaluate a cell that starts with `=`, `+`,
`-` or `@` (and some leading whitespace variants of those), which turns a
value such as `=HYPERLINK(...)` into a live formula on whoever opens the file
-- OWASP's "CSV injection".

The two formats are protected differently, on purpose:

- `.xlsx` is the faithful format: the cell is typed as text, so its value
  stays exactly what was typed (`- Se solicita...` included).
- `.csv` has no cell types, so a formula-like value gets a leading `'`. This
  visibly alters legitimate text starting with `-`/`+` (bullets, signs); it
  is accepted because the UI only downloads the xlsx and an unescaped CSV
  would evaluate it (`-2+3`) or show `#NAME?`.
"""

from typing import Any

from openpyxl.cell.cell import Cell
from openpyxl.worksheet.worksheet import Worksheet

# Leading characters a spreadsheet may treat as the start of a formula.
FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")


def is_formula_like(value: Any) -> bool:
    """
    Whether a cell value would be read as a formula.

    Only strings: dates and numbers never carry a formula, and a negative
    number must stay a number.

    Args:
        value (Any): The cell value.

    Returns:
        bool: True for a string starting with one of `FORMULA_TRIGGERS`.
    """
    return isinstance(value, str) and value.startswith(FORMULA_TRIGGERS)


def append_literal_row(sheet: Worksheet, values: list[Any]) -> None:
    """
    Appends a row, storing every formula-like string as plain text.

    openpyxl turns any string starting with `=` into a formula cell. Setting
    the cell's type back to string writes the value as text, unchanged on
    screen; `quotePrefix` is the marker Excel/LibreOffice set themselves when
    somebody types a leading `'`, so re-editing the cell keeps it text too.
    This beats prefixing a `'` into the value, which would show up in the
    cell and in any sort or filter.

    Args:
        sheet (Worksheet): The sheet to append to.
        values (list[Any]): The row's cell values, in column order.
    """
    sheet.append(values)
    for cell in sheet[sheet.max_row]:
        # A freshly appended row has no merged cells; the check narrows the
        # type (a `MergedCell` has no writable `data_type`).
        if isinstance(cell, Cell) and is_formula_like(cell.value):
            cell.data_type = "s"
            cell.quotePrefix = True


def escape_csv_value(value: Any) -> Any:
    """
    Prefixes a formula-like string with `'`, per OWASP's CSV-injection
    guidance. A CSV has no cell types, so the quote is the only way to tell
    the spreadsheet the field is text -- at the cost of showing it on
    legitimate text too (e.g. a `- ` bullet); see the module docstring.

    Args:
        value (Any): The field value.

    Returns:
        Any: The value, `'`-prefixed when formula-like; untouched otherwise.
    """
    if is_formula_like(value):
        return f"'{value}"
    return value
