import threading
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from aymurai.database.crud.recommendation import (
    RecommendationValidationData,
    recommendation_upsert,
)
from aymurai.database.crud.recommendation_correction import (
    RecommendationNotFoundError,
    StaleRecommendationError,
    recommendation_correct,
    recommendation_lock_current,
    recommendation_version,
)
from aymurai.database.schema import Recommendation
from aymurai.database.session import _configure_sqlite_connection


def _data(publishable_content: str) -> RecommendationValidationData:
    return RecommendationValidationData(
        recommendation_number=None,
        recommendation_date_text=None,
        topic=None,
        subtopic=None,
        personal_data=None,
        publishable_content=publishable_content,
    )


@pytest.fixture
def file_engine(tmp_path):
    """A real on-disk SQLite in WAL mode, the production configuration --
    the in-memory `StaticPool` engine shares one connection between sessions
    and so cannot exhibit two writers racing."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'race.db'}",
        connect_args={"check_same_thread": False},
    )
    event.listen(engine, "connect", _configure_sqlite_connection)
    SQLModel.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def stored(file_engine) -> Recommendation:
    with Session(file_engine) as session:
        recommendation = recommendation_upsert(
            uuid.uuid4(), _data("Original."), session
        )
        session.expunge(recommendation)
        return recommendation


def test_second_concurrent_correction_waits_then_fails_as_stale(file_engine, stored):
    version = recommendation_version(stored)
    outcome: list[str] = []

    def second_writer() -> None:
        with Session(file_engine) as session:
            try:
                recommendation_correct(stored.id, version, _data("B."), session)
                outcome.append("written")
            except StaleRecommendationError:
                outcome.append("stale")

    with Session(file_engine) as first:
        # The first correction has checked the version and holds the lock,
        # but has not written yet -- the window the old read/compare/write
        # sequence left open.
        recommendation_lock_current(stored.id, version, first)

        racer = threading.Thread(target=second_writer)
        racer.start()
        racer.join(timeout=0.5)
        assert racer.is_alive(), "the second writer must wait for the lock"

        recommendation_upsert(stored.document_id, _data("A."), first)

    racer.join(timeout=10)
    assert outcome == ["stale"]

    with Session(file_engine) as session:
        final = session.get(Recommendation, stored.id)
        assert final is not None
        assert final.publishable_content == "A."


def test_correct_at_the_current_version_writes_and_moves_it(file_engine, stored):
    with Session(file_engine) as session:
        corrected = recommendation_correct(
            stored.id, recommendation_version(stored), _data("Nuevo."), session
        )
        assert corrected.publishable_content == "Nuevo."
        assert recommendation_version(corrected) != recommendation_version(stored)


def test_stale_check_leaves_the_row_and_its_version_untouched(file_engine, stored):
    with Session(file_engine) as session:
        with pytest.raises(StaleRecommendationError):
            recommendation_correct(
                stored.id,
                recommendation_version(stored) - timedelta(seconds=1),
                _data("No."),
                session,
            )
        # Rolled back: the session is usable and nothing was written.
        unchanged = session.get(Recommendation, stored.id, populate_existing=True)
        assert unchanged is not None
        assert unchanged.publishable_content == "Original."
        assert unchanged.updated_at is None


def test_correct_missing_recommendation_raises_not_found(file_engine, stored):
    with Session(file_engine) as session:
        with pytest.raises(RecommendationNotFoundError):
            recommendation_correct(
                uuid.uuid4(), recommendation_version(stored), _data("X."), session
            )
