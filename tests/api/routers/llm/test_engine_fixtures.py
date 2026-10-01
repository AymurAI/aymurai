"""
Every SQLite engine a test client runs against must carry the same
per-connection setup as production (`_configure_sqlite_connection`): the
recommendation search calls the `normalize_text` SQL function, so a client
whose engine lacks it fails with "no such function" instead of searching.
"""

import pytest
from sqlmodel import text


@pytest.mark.parametrize("fixture_name", ["db_engine", "llm_engine"])
def test_engine_fixture_registers_normalize_text(request, fixture_name):
    engine = request.getfixturevalue(fixture_name)

    with engine.connect() as connection:
        folded = connection.execute(text("SELECT normalize_text('ÁREA')")).scalar()

    assert folded == "area"


def test_llm_engine_gets_the_full_production_setup(llm_engine):
    with llm_engine.connect() as connection:
        foreign_keys = connection.execute(text("PRAGMA foreign_keys")).scalar()

    assert foreign_keys == 1
