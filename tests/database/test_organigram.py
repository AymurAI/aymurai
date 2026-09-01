import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from aymurai.database.crud.organigram.sector import resolve_sector
from aymurai.database.schema import OrganigramHolder, OrganigramUnit
from aymurai.database.seed.organigram import seed_organigram

REPO_ROOT = Path(__file__).resolve().parents[2]
ORGANIGRAM_PATH = (
    REPO_ROOT
    / "resources"
    / "data"
    / "restricted"
    / "defensoria"
    / "organigram_GCBA.json"
)
CSV_PATH = (
    REPO_ROOT
    / "resources"
    / "data"
    / "restricted"
    / "defensoria"
    / "destinatario_por_sector.csv"
)

_SYNTHETIC_TREE = {
    "cargo": "Jefe de Gobierno",
    "sigla": "JG",
    "nombre": "Alguien",
    "dependencias": [
        {
            "cargo": "Ministerio de Test",
            "sigla": "MTEST",
            "nombre": "Ministro Test",
            "dependencias": [
                {
                    "cargo": "Agencia Autónoma Test",
                    "sigla": "AGC",
                    "nombre": "Titular AGC",
                },
                {
                    "cargo": "Subsecretaría de Test",
                    "sigla": "SSTEST",
                    "nombre": "Subsecretario Test",
                },
            ],
        },
        {
            "cargo": "Subsecretaría Huérfana",
            "sigla": "SSH",
            "nombre": "Fulano",
        },
    ],
}


@pytest.fixture
def synthetic_seed(session, tmp_path):
    organigram_path = tmp_path / "organigram.json"
    organigram_path.write_text(json.dumps(_SYNTHETIC_TREE))
    csv_path = tmp_path / "destinatario_por_sector.csv"
    csv_path.write_text("Destinatario,Destinatario por sector\n")

    seed_organigram(session, organigram_path, csv_path)
    return session


def _unit_by_cargo(session, cargo: str) -> OrganigramUnit:
    from sqlmodel import select

    return session.exec(
        select(OrganigramUnit).where(OrganigramUnit.name == cargo)
    ).one()


def test_autonomous_body_sector_is_itself_despite_ministry_nesting(synthetic_seed):
    agc = _unit_by_cargo(synthetic_seed, "Agencia Autónoma Test")
    sector = resolve_sector(agc, synthetic_seed)
    assert sector is not None
    assert sector.id == agc.id


def test_subsecretaria_under_ministerio_resolves_to_ministerio_two_levels_up(
    synthetic_seed,
):
    subsecretaria = _unit_by_cargo(synthetic_seed, "Subsecretaría de Test")
    ministerio = _unit_by_cargo(synthetic_seed, "Ministerio de Test")

    sector = resolve_sector(subsecretaria, synthetic_seed)

    assert sector is not None
    assert sector.id == ministerio.id


def test_lone_subsecretaria_with_no_secretaria_above_resolves_to_itself(
    synthetic_seed,
):
    huerfana = _unit_by_cargo(synthetic_seed, "Subsecretaría Huérfana")
    sector = resolve_sector(huerfana, synthetic_seed)
    assert sector is not None
    assert sector.id == huerfana.id


def test_root_has_no_sector(synthetic_seed):
    root = _unit_by_cargo(synthetic_seed, "Jefe de Gobierno")
    assert resolve_sector(root, synthetic_seed) is None


def test_reseeding_synthetic_tree_keeps_the_same_ids(session, tmp_path):
    organigram_path = tmp_path / "organigram.json"
    organigram_path.write_text(json.dumps(_SYNTHETIC_TREE))
    csv_path = tmp_path / "destinatario_por_sector.csv"
    csv_path.write_text("Destinatario,Destinatario por sector\n")

    seed_organigram(session, organigram_path, csv_path)
    ids_first = {u.name: u.id for u in _all_units(session)}

    seed_organigram(session, organigram_path, csv_path)
    ids_second = {u.name: u.id for u in _all_units(session)}

    assert ids_first == ids_second


def _all_units(session):
    from sqlmodel import select

    return session.exec(select(OrganigramUnit)).all()


def test_is_current_unique_index_rejects_second_current_holder(session):
    unit = OrganigramUnit(id=uuid.uuid4(), name="Unidad de prueba", is_sector=False)
    session.add(unit)
    session.commit()
    session.refresh(unit)

    session.add(OrganigramHolder(unit_id=unit.id, name="Primero", is_current=True))
    session.commit()

    session.add(OrganigramHolder(unit_id=unit.id, name="Segundo", is_current=True))
    with pytest.raises(IntegrityError):
        session.commit()


@pytest.mark.integration
def test_seed_organigram_reproduces_real_file_counts(session):
    if not ORGANIGRAM_PATH.exists() or not CSV_PATH.exists():
        pytest.skip("organigram_GCBA.json / destinatario_por_sector.csv not present")

    counts = seed_organigram(session, ORGANIGRAM_PATH, CSV_PATH)

    assert counts == {"nodes": 520, "holders": 489, "sectors": 33}


@pytest.mark.integration
def test_seed_organigram_resolves_sector_for_488_of_489_holders(session):
    if not ORGANIGRAM_PATH.exists() or not CSV_PATH.exists():
        pytest.skip("organigram_GCBA.json / destinatario_por_sector.csv not present")

    seed_organigram(session, ORGANIGRAM_PATH, CSV_PATH)

    holder_unit_ids = {h.unit_id for h in session.exec(_holder_select()).all()}
    resolved = 0
    unresolved_names = []
    for unit_id in holder_unit_ids:
        unit = session.get(OrganigramUnit, unit_id)
        sector = resolve_sector(unit, session)
        if sector is not None:
            resolved += 1
        else:
            unresolved_names.append(unit.name)

    assert resolved == 488
    assert unresolved_names == ["Jefe de Gobierno"]


def _holder_select():
    from sqlmodel import select

    return select(OrganigramHolder).where(OrganigramHolder.is_current == True)
