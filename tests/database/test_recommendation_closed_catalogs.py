import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from aymurai.database.crud.dataset import get_or_create_default_dataset
from aymurai.database.schema import Recommendation


def test_recommendation_situation_rejects_values_outside_the_closed_catalog(session):
    """`SITUACION_DE_LA_RECOMENDACION` only admits Respuesta / Respuesta
    parcial / Notificado. SQLModel `table=True` classes don't validate on
    plain construction the way a plain pydantic model does, so the actual
    guardrail here is the DB-level CHECK constraint, which fires on commit."""
    dataset = get_or_create_default_dataset(session)
    session.add(
        Recommendation(
            dataset_id=dataset.id,
            document_id=uuid.uuid4(),
            publishable_content="Contenido.",
            recommendation_situation="Abierto",
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()


def test_status_rejects_values_outside_the_closed_catalog(session):
    """`ESTADO` only admits Solucionado / No solucionado -- including a
    value that used to be valid for the old free-text field."""
    dataset = get_or_create_default_dataset(session)
    session.add(
        Recommendation(
            dataset_id=dataset.id,
            document_id=uuid.uuid4(),
            publishable_content="Contenido.",
            status="En trámite",
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()
