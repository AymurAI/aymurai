import uuid

from aymurai.meta.api_interfaces import DocLabel, DocumentInformation
from aymurai.meta.entities import CanonicalEntity, EntityAttributes
from aymurai.utils.entity_disambiguation.core import map_canonical_entities_ner_preds


def _doc(text: str, labels: list[DocLabel]) -> DocumentInformation:
    return DocumentInformation(document=text, labels=labels)


def _label(label_name: str, text: str, entity_id: uuid.UUID | None = None) -> DocLabel:
    return DocLabel(
        text=text,
        start_char=0,
        end_char=len(text),
        attrs=EntityAttributes(
            aymurai_label=label_name,
            canonical_entity_id=entity_id,
        ),
    )


def test_force_labels_overrides_existing_canonical_entity_id():
    stale_id = uuid.uuid4()
    label = _label("PER", "Juan Perez", entity_id=stale_id)
    predictions = [_doc("Juan Perez fue citado.", [label])]

    entity = CanonicalEntity(
        aymurai_label="PER",
        canonical_text="PEREZ, JUAN",
        aliases=["Juan Perez"],
        attributes={"role": "Testigo"},
    )

    result = map_canonical_entities_ner_preds(
        predictions=predictions,
        canonical_entities=[entity],
        force_labels={"PER"},
    )

    resolved_label = result[0].labels[0]
    assert resolved_label.attrs.canonical_entity_id == entity.entity_id
    assert resolved_label.attrs.canonical_entity_id != stale_id
    assert "Testigo" in resolved_label.attrs.aymurai_label_subclass


def test_labels_outside_force_labels_keep_existing_canonical_entity_id():
    stale_id = uuid.uuid4()
    label = _label("DNI", "12345678", entity_id=stale_id)
    predictions = [_doc("DNI 12345678.", [label])]

    result = map_canonical_entities_ner_preds(
        predictions=predictions,
        canonical_entities=[],
        force_labels={"PER"},
    )

    assert result[0].labels[0].attrs.canonical_entity_id == stale_id


def test_non_per_label_does_not_get_role_appended_to_subclass():
    label = _label("DNI", "12345678")
    predictions = [_doc("DNI 12345678.", [label])]

    entity = CanonicalEntity(
        aymurai_label="DNI",
        canonical_text="12345678",
        aliases=["12345678"],
        attributes={"role": "should-not-appear"},
    )

    result = map_canonical_entities_ner_preds(
        predictions=predictions,
        canonical_entities=[entity],
        force_labels={"DNI"},
    )

    assert result[0].labels[0].attrs.aymurai_label_subclass == []


def test_force_labels_defaults_to_none_and_behaves_like_before():
    label = _label("PER", "Juan Perez")
    predictions = [_doc("Juan Perez fue citado.", [label])]
    entity = CanonicalEntity(
        aymurai_label="PER", canonical_text="PEREZ, JUAN", aliases=["Juan Perez"]
    )

    result = map_canonical_entities_ner_preds(
        predictions=predictions,
        canonical_entities=[entity],
    )

    assert result[0].labels[0].attrs.canonical_entity_id == entity.entity_id
