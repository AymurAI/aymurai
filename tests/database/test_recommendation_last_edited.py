"""`last_edited` sort precision, checked straight against the CRUD."""

import uuid
from datetime import datetime
from sqlmodel import col, update

from aymurai.database.crud.recommendation import (
    RecommendationValidationData,
    recommendation_upsert,
)
from aymurai.database.crud.recommendation_listing import recommendation_list
from aymurai.database.schema import Recommendation


def _seed(session, *, updated_at: datetime) -> uuid.UUID:
    recommendation = recommendation_upsert(
        uuid.uuid4(),
        RecommendationValidationData(
            recommendation_number=None,
            recommendation_date_text=None,
            topic=None,
            subtopic=None,
            personal_data=None,
            publishable_content="Resumen.",
        ),
        session,
    )
    # Core UPDATE so the column's `onupdate` doesn't overwrite the value.
    session.exec(
        update(Recommendation)
        .where(col(Recommendation.id) == recommendation.id)
        .values(created_at=datetime(2024, 1, 1), updated_at=updated_at)
    )
    session.commit()
    assert recommendation.id is not None
    return recommendation.id


def test_last_edited_sort_keeps_sub_second_order(session):
    # Same second, different fraction: truncated to whole seconds these tie,
    # and the `id` tie-breaker -- ascending in both directions -- can then
    # satisfy at most one of the two directions, whatever the random ids are.
    earlier = _seed(session, updated_at=datetime(2024, 6, 1, 12, 0, 0, 200_000))
    later = _seed(session, updated_at=datetime(2024, 6, 1, 12, 0, 0, 700_000))

    def ordered(order_dir: str) -> list[uuid.UUID | None]:
        items, _ = recommendation_list(
            session, order_by="last_edited", order_dir=order_dir
        )
        return [item.id for item in items]

    assert ordered("asc") == [earlier, later]
    assert ordered("desc") == [later, earlier]
