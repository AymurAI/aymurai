"""Committed end-to-end regression check for the zero-width-character
misalignment bug.

Runs the real extract -> predict -> disambiguate -> anonymize-document flow
(real model, real LibreOffice conversion) against a synthetic DOCX that
reproduces the bug topology (a U+FEFF mid-paragraph, before entity spans) and
asserts the original symptom is gone: no U+FEFF survives, and no replacement
token is left glued to residual entity characters (the exact signature of the
offset-shift bug, e.g. `<NUM_EXPEDIENTE_3>1`).
"""

import io
import json
import re
import shutil
import zipfile

import docx
import pytest

MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# Unique anchor for the paragraph carrying the mid-paragraph U+FEFF; the names
# in that paragraph appear nowhere else in the synthetic document so leftover
# entity text can be attributed unambiguously.
FEFF_PARAGRAPH_MARKER = "manifestó encontrarse en situación de vulnerabilidad"

FEFF_PARAGRAPH = (
    "A mayor abundamiento,\ufeff a fs. 123/456 de la causa 999/2020, "
    "la Sra. Rosalía Ejemplar, DNI 12.345.678, "
    f"{FEFF_PARAGRAPH_MARKER} frente al Sr. Casimiro Ficticio."
)

SYNTHETIC_PARAGRAPHS = [
    "Ciudad Autónoma de Buenos Aires, 15 de marzo de 2023.",
    (
        "En la causa NUM 123/2023, el Sr. Juan Pérez fue imputado por el "
        "delito de lesiones graves."
    ),
    FEFF_PARAGRAPH,
    ("La víctima, María González, declaró en el Juzgado Civil de Buenos Aires."),
]

# A replacement token immediately glued (no separating whitespace/punctuation)
# to a residual word character -- the exact signature the offset-shift bug
# left behind (e.g. `<NUM_EXPEDIENTE_3>1`).
_MANGLED_TOKEN_RE = re.compile(r"<[A-Z_]+(?:_\d+)?>\w")


def _build_repro_docx_bytes() -> bytes:
    document = docx.Document()
    for paragraph in SYNTHETIC_PARAGRAPHS:
        document.add_paragraph(paragraph)
    stream = io.BytesIO()
    document.save(stream)
    return stream.getvalue()


def _strip_odt_markup(fragment: str) -> str:
    fragment = re.sub(r"<text:s/>", " ", fragment)
    fragment = re.sub(
        r'<text:s text:c="(\d+)"/>', lambda m: " " * int(m.group(1)), fragment
    )
    fragment = re.sub(r"<text:tab/>", "\t", fragment)
    fragment = re.sub(r"<[^>]+>", "", fragment)
    return (
        fragment.replace("&apos;", "'")
        .replace("&quot;", '"')
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
    )


def _odt_text(odt_bytes: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(odt_bytes)) as archive:
        content = archive.read("content.xml").decode("utf-8")

    raw_paragraphs = re.findall(r"<text:p[^>]*>(.*?)</text:p>", content, flags=re.S)
    return "\n".join(_strip_odt_markup(p) for p in raw_paragraphs)


@pytest.mark.integration
@pytest.mark.slow
@pytest.mark.external
def test_full_flow_leaves_no_zero_width_residue_for_repro_document(client):
    if shutil.which("libreoffice") is None:
        pytest.skip("LibreOffice binary is required for real compile integration test")

    docx_bytes = _build_repro_docx_bytes()

    # Repro precondition: the *raw* document carries a U+FEFF. The extract
    # endpoint must strip it (its paragraphs are the frontend's source of
    # truth for label-offset validation).
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as archive:
        raw_document_xml = archive.read("word/document.xml").decode("utf-8")
    assert "\ufeff" in raw_document_xml, (
        "Expected the synthetic repro document to contain a U+FEFF character"
    )

    extract_response = client.post(
        "/api/misc/document-extract",
        files={"file": ("repro.docx", docx_bytes, MIME)},
    )
    assert extract_response.status_code == 200
    paragraphs = extract_response.json()["document"]
    assert not any("\ufeff" in paragraph for paragraph in paragraphs), (
        "document-extract must strip zero-width characters so /predict "
        "offsets stay valid against the frontend-stored paragraph text"
    )

    predictions = []
    for paragraph in paragraphs:
        predict_response = client.post(
            "/api/anonymizer/predict", json={"text": paragraph}
        )
        assert predict_response.status_code == 200
        predictions.append(predict_response.json())

    disambiguate_response = client.post(
        "/api/anonymizer/disambiguate", json={"paragraphs": predictions}
    )
    assert disambiguate_response.status_code == 200
    annotations = disambiguate_response.json()

    compile_response = client.post(
        "/api/anonymizer/anonymize-document",
        data={"annotations": json.dumps(annotations)},
        files={"file": ("repro.docx", docx_bytes, MIME)},
    )
    assert compile_response.status_code == 200

    output_text = _odt_text(compile_response.content)

    assert "\ufeff" not in output_text

    mangled_tokens = _MANGLED_TOKEN_RE.findall(output_text)
    assert not mangled_tokens, (
        f"Found replacement tokens glued to residual text: {mangled_tokens}"
    )

    # The paragraph containing the mid-paragraph U+FEFF (whose entities after
    # it were all shifted one character left under the bug) must not leak any
    # of its own entity text verbatim into the compiled output.
    repro_paragraph = next(
        (
            paragraph
            for paragraph in annotations["data"]
            if FEFF_PARAGRAPH_MARKER in paragraph["document"]
        ),
        None,
    )
    assert repro_paragraph is not None, (
        "Expected to find the U+FEFF paragraph among the compiled annotations"
    )
    labels = repro_paragraph.get("labels") or []
    assert labels, "Expected the model to tag entities in the U+FEFF paragraph"
    for label in labels:
        text = label["text"].strip()
        if len(text) < 4:
            continue
        assert text not in output_text, f"Leftover entity text in output: {text!r}"
