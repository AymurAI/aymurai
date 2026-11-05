import pytest
from pydantic import ValidationError

from aymurai.api.endpoints.routers.llm.data_extraction_engine import (
    RawExtraction,
    RawRecipient,
    build_response_schema,
    catalogs_hash,
)


def _walk_no_type_array(node, path=""):
    """
    Recursively asserts no schema node uses `type` as a list -- the
    idiomatic-but-broken way to write a nullable field, which llama.cpp's
    GBNF converter silently ignores (verified against a real server; this
    test only guards the schema shape we send, not the server's behavior).
    """
    if isinstance(node, dict):
        assert not isinstance(node.get("type"), list), f"type-array at {path}"
        for key, value in node.items():
            _walk_no_type_array(value, f"{path}.{key}")
    elif isinstance(node, list):
        for i, value in enumerate(node):
            _walk_no_type_array(value, f"{path}[{i}]")


def test_response_schema_never_uses_type_array_for_nullable_fields():
    schema = build_response_schema(["SALUD", "VIVIENDA"], ["GCBA", "Empresa"])
    _walk_no_type_array(schema)


def test_response_schema_nullable_enum_uses_flat_enum_with_null():
    schema = build_response_schema(["SALUD"], ["GCBA"])
    assert schema["properties"]["topic"] == {"enum": ["SALUD", None]}
    assert schema["properties"]["personal_data"] == {"enum": [True, False, None]}


def test_raw_extraction_accepts_valid_topic_subtopic_pair():
    extraction = RawExtraction.model_validate(
        {
            "recommendation_number": None,
            "recommendation_date": None,
            "recipients": [],
            "topic": "SALUD",
            "subtopic": "Hospitales",
            "personal_data": None,
            "publishable_content": "resumen",
        },
        context={"topics": {"SALUD": ["Hospitales"]}},
    )
    assert extraction.topic == "SALUD"


def test_raw_extraction_rejects_subtopic_outside_its_topic():
    with pytest.raises(ValidationError, match="no pertenece"):
        RawExtraction.model_validate(
            {
                "recommendation_number": None,
                "recommendation_date": None,
                "recipients": [],
                "topic": "SALUD",
                "subtopic": "Desalojos",
                "personal_data": None,
                "publishable_content": "resumen",
            },
            context={"topics": {"SALUD": ["Hospitales"], "VIVIENDA": ["Desalojos"]}},
        )


def test_catalogs_hash_is_deterministic_and_order_independent():
    a = catalogs_hash({"SALUD": ["Hospitales", "Medicamentos"]}, ["GCBA", "Empresa"])
    b = catalogs_hash({"SALUD": ["Medicamentos", "Hospitales"]}, ["Empresa", "GCBA"])
    assert a == b


def test_catalogs_hash_changes_when_catalogs_change():
    a = catalogs_hash({"SALUD": ["Hospitales"]}, ["GCBA"])
    b = catalogs_hash({"SALUD": ["Hospitales", "Medicamentos"]}, ["GCBA"])
    assert a != b


@pytest.mark.parametrize("literal", ["null", "None", "none", "NULL"])
def test_raw_recipient_treats_literal_null_strings_as_none(literal):
    recipient = RawRecipient(name=literal, position=literal, is_primary=False)
    assert recipient.name is None
    assert recipient.position is None


def test_raw_extraction_treats_literal_null_strings_as_none():
    extraction = RawExtraction(
        recommendation_number="null",
        recommendation_date="none",
        publishable_content="contenido real",
    )
    assert extraction.recommendation_number is None
    assert extraction.recommendation_date is None
    assert extraction.publishable_content == "contenido real"
