"""Alembic migrations, run against a real on-disk SQLite."""

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from aymurai.settings import settings

PREVIOUS_HEAD = "fc05e46561dc"
SOURCE_PARAGRAPHS_REVISION = "7d3f9a2c1b84"


@pytest.fixture
def alembic_config(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'migrations.db'}"
    # `database/env.py` reads the URL off the settings object, not the ini.
    monkeypatch.setattr(settings, "SQLALCHEMY_DATABASE_URI", url)
    config = Config(str(settings.ALEMBIC_INI_PATH))
    yield config, url


def _llm_extraction_columns(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return {c["name"] for c in inspect(engine).get_columns("llm_extraction")}
    finally:
        engine.dispose()


def test_source_paragraphs_migration_upgrades_and_downgrades(alembic_config):
    config, url = alembic_config
    command.upgrade(config, PREVIOUS_HEAD)
    assert "source_paragraphs" not in _llm_extraction_columns(url)

    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO llm_extraction (id, source_text, prediction, config) "
                "VALUES ('a' || hex(randomblob(15)), 'texto legacy', '{}', '{}')"
            )
        )

    command.upgrade(config, SOURCE_PARAGRAPHS_REVISION)
    assert "source_paragraphs" in _llm_extraction_columns(url)
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT source_text, source_paragraphs FROM llm_extraction")
        ).one()
    # A row extracted before the column existed has no paragraphs to offer.
    assert row == ("texto legacy", None)

    command.downgrade(config, PREVIOUS_HEAD)
    assert "source_paragraphs" not in _llm_extraction_columns(url)
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT source_text FROM llm_extraction")
        ).scalar_one() == ("texto legacy")
    engine.dispose()


def test_migrations_reach_a_single_head(alembic_config):
    config, url = alembic_config
    command.upgrade(config, "head")
    assert "source_paragraphs" in _llm_extraction_columns(url)
