"""
Ordering guarantees of `recommendation_list`, checked straight against the
CRUD (timestamps are set with a core UPDATE so `updated_at`'s `onupdate`
never fires behind the test's back).
"""

import uuid
from datetime import datetime, timedelta
from typing import get_args

import pytest
from sqlmodel import col, update

from aymurai.database.crud.recommendation import (
    RecommendationOrderColumn,
    RecommendationValidationData,
    recommendation_list,
    recommendation_upsert,
)
from aymurai.database.schema import Recommendation

_BASE = datetime(2024, 6, 1, 12, 0, 0)


def _data(**overrides) -> RecommendationValidationData:
    defaults = {
        "recommendation_number": "5/2024",
        "recommendation_date_text": "01 de enero de 2024",
        "topic": None,
        "subtopic": None,
        "personal_data": None,
        "publishable_content": "Resumen.",
        "recipients": [],
    }
    defaults.update(overrides)
    return RecommendationValidationData(**defaults)


def _seed(session, *, created_at: datetime, updated_at: datetime | None) -> uuid.UUID:
    recommendation = recommendation_upsert(uuid.uuid4(), _data(), session)
    session.exec(
        update(Recommendation)
        .where(col(Recommendation.id) == recommendation.id)
        .values(created_at=created_at, updated_at=updated_at)
    )
    session.commit()
    assert recommendation.id is not None
    return recommendation.id


@pytest.mark.parametrize("order_by", get_args(RecommendationOrderColumn))
@pytest.mark.parametrize("order_dir", ["asc", "desc"])
def test_pages_never_overlap_when_the_sort_key_ties(session, order_by, order_dir):
    """Every row ties on every sort column, so only the `id` tie-breaker can
    make page N of one request agree with page N+1 of the next."""
    seeded = {_seed(session, created_at=_BASE, updated_at=None) for _ in range(13)}

    seen: list[uuid.UUID] = []
    for page in range(1, 6):
        items, total = recommendation_list(
            session,
            order_by=order_by,
            order_dir=order_dir,
            page=page,
            page_size=3,
        )
        assert total == len(seeded)
        seen.extend(item.id for item in items if item.id is not None)

    assert len(seen) == len(set(seen)) == len(seeded)
    assert set(seen) == seeded
    # The tie-break is the id itself, ascending in both directions -- not the
    # insertion order SQLite would otherwise happen to scan in.
    assert seen == sorted(seeded)


def test_default_order_breaks_ties_by_id(session):
    seeded = {_seed(session, created_at=_BASE, updated_at=None) for _ in range(6)}

    items, _ = recommendation_list(session)

    assert [item.id for item in items] == sorted(seeded)


@pytest.mark.parametrize("order_dir", ["asc", "desc"])
def test_order_by_last_edited_uses_updated_at_or_else_created_at(session, order_dir):
    """`last_edited` is what the grilla's "Última edición" shows:
    `updated_at` once the row was touched, `created_at` otherwise. Ordering
    by `created_at` alone would put the oldest-registered row last even when
    it was edited a minute ago."""
    hour = timedelta(hours=1)
    edited_recently = _seed(session, created_at=_BASE, updated_at=_BASE + 5 * hour)
    never_edited = _seed(session, created_at=_BASE + 3 * hour, updated_at=None)
    edited_early = _seed(
        session, created_at=_BASE + 1 * hour, updated_at=_BASE + 2 * hour
    )

    items, _ = recommendation_list(session, order_by="last_edited", order_dir=order_dir)

    expected = [edited_early, never_edited, edited_recently]
    if order_dir == "desc":
        expected.reverse()
    assert [item.id for item in items] == expected
