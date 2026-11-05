import json
import uuid
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from aymurai.database.crud.organigram.holder import (
    holder_history,
    holder_set_current,
    holder_update,
)
from aymurai.database.crud.organigram.sector import (
    is_sector_ancestor_of,
    resolve_sector,
)
from aymurai.database.crud.organigram.unit import unit_children, unit_list
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

    return select(OrganigramHolder).where(OrganigramHolder.is_current)


def _inactive_sector_tree(session):
    """raiz (active sector) -> viejo (inactive sector) -> unidad (plain unit)."""
    raiz = OrganigramUnit(id=uuid.uuid4(), name="Raíz", is_sector=True)
    session.add(raiz)
    viejo = OrganigramUnit(
        id=uuid.uuid4(),
        name="Sector Discontinuado",
        parent_id=raiz.id,
        is_sector=True,
        active=False,
    )
    session.add(viejo)
    unidad = OrganigramUnit(
        id=uuid.uuid4(), name="Dirección General", parent_id=viejo.id
    )
    session.add(unidad)
    session.commit()
    return raiz, viejo, unidad


def test_resolve_sector_skips_deactivated_sector(session):
    """A deactivated sector must not be suggested: resolution walks past it
    to the next active sector ancestor, matching every other organigram
    query, all of which filter on `active`."""
    raiz, _viejo, unidad = _inactive_sector_tree(session)

    assert resolve_sector(unidad, session).id == raiz.id


def test_sector_ancestor_membership_accepts_any_sector_ancestor(session):
    """Validation checks membership, not identity -- so BOTH the active
    ancestor a suggestion now proposes and the deactivated one a human
    confirmed earlier are accepted."""
    raiz, viejo, unidad = _inactive_sector_tree(session)

    assert is_sector_ancestor_of(raiz, unidad, session)
    assert is_sector_ancestor_of(viejo, unidad, session)


def test_sector_ancestor_membership_rejects_a_non_ancestor(session):
    """An unrelated sector is still not `unidad`'s sector."""
    _raiz, _viejo, unidad = _inactive_sector_tree(session)
    otro = OrganigramUnit(id=uuid.uuid4(), name="Otro Sector", is_sector=True)
    session.add(otro)
    session.commit()

    assert not is_sector_ancestor_of(otro, unidad, session)


def test_sector_ancestor_membership_rejects_a_non_sector_ancestor(session):
    """An ancestor that isn't flagged `is_sector` is not a sector (ADR-0001)."""
    _raiz, _viejo, unidad = _inactive_sector_tree(session)
    hoja = OrganigramUnit(id=uuid.uuid4(), name="Subdirección", parent_id=unidad.id)
    session.add(hoja)
    session.commit()

    # `unidad` is `hoja`'s ancestor, but is_sector=False.
    assert not is_sector_ancestor_of(unidad, hoja, session)


def test_unit_list_returns_the_whole_tree_not_just_one_level(synthetic_seed):
    """
    `unit_children` answers one level at a time, which costs one request per
    parent node (124 on the real organigram). `unit_list` is what the ABM
    screen reads instead, so it must return every unit in one pass.
    """
    session = synthetic_seed

    roots = unit_children(None, session)
    every_unit = unit_list(session)

    assert len(roots) == 1
    assert len(every_unit) == 5
    assert {u.name for u in every_unit} == {
        "Jefe de Gobierno",
        "Ministerio de Test",
        "Agencia Autónoma Test",
        "Subsecretaría de Test",
        "Subsecretaría Huérfana",
    }


def test_unit_list_hides_deactivated_units_unless_asked(synthetic_seed):
    session = synthetic_seed
    orphan = _unit_by_cargo(session, "Subsecretaría Huérfana")
    orphan.active = False
    session.add(orphan)
    session.commit()

    assert len(unit_list(session)) == 4
    assert len(unit_list(session, include_inactive=True)) == 5


def test_unit_create_assigns_an_id_when_not_seeded(session):
    """
    The seed passes an explicit uuid5, but a unit added through the ABM has no
    path to derive one from — without a default the insert fails on the NOT
    NULL primary key, which is what `POST /organigram/units` used to do.
    """
    from aymurai.database.crud.organigram.unit import unit_create
    from aymurai.database.schema import OrganigramUnitCreate

    unit = unit_create(
        OrganigramUnitCreate(parent_id=None, name="Unidad Nueva"), session
    )

    assert unit.id is not None
    assert _unit_by_cargo(session, "Unidad Nueva").id == unit.id


def test_unit_create_keeps_an_explicitly_given_id(session):
    """The seed's uuid5 must still win over the default factory."""
    from aymurai.database.crud.organigram.unit import unit_create
    from aymurai.database.schema import OrganigramUnitCreate

    seeded_id = uuid.uuid5(uuid.NAMESPACE_URL, "unidad-semilla")
    unit = unit_create(
        OrganigramUnitCreate(parent_id=None, name="Unidad Semilla"), session
    )
    unit.id = seeded_id
    session.add(unit)
    session.commit()

    assert _unit_by_cargo(session, "Unidad Semilla").id == seeded_id


def _unit(session, name="Unidad de prueba"):
    unit = OrganigramUnit(id=uuid.uuid4(), name=name, is_sector=False)
    session.add(unit)
    session.commit()
    session.refresh(unit)
    return unit


def test_appointing_a_holder_dates_the_term_today_by_default(session):
    unit = _unit(session)

    holder = holder_set_current(unit.id, "Primero", session)

    assert holder.start_date == date.today()


def test_a_term_that_began_earlier_is_recorded_as_such(session):
    """The point of the column: seeding a real organigram in 2026 records
    people who took office years before the row was written."""
    unit = _unit(session)

    holder = holder_set_current(
        unit.id, "Primero", session, start_date=date(2024, 3, 11)
    )

    assert holder.start_date == date(2024, 3, 11)
    assert holder.created_at.date() == date.today()


def test_correcting_the_date_leaves_the_name_and_currency_alone(session):
    unit = _unit(session)
    holder = holder_set_current(unit.id, "Primero", session)

    corrected = holder_update(holder.id, session, start_date=date(2024, 3, 11))

    assert corrected.id == holder.id
    assert corrected.name == "Primero"
    assert corrected.start_date == date(2024, 3, 11)
    assert corrected.is_current is True


def test_correcting_a_past_holder_never_makes_it_current_again(session):
    unit = _unit(session)
    first = holder_set_current(unit.id, "Primero", session)
    holder_set_current(unit.id, "Segundo", session)

    corrected = holder_update(
        first.id, session, name="Primera", start_date=date(2020, 1, 1)
    )

    assert corrected.is_current is False


def test_history_follows_term_dates_not_the_order_rows_were_entered(session):
    """A history typed in after the fact arrives in whatever order the user
    worked through it, so insert order says nothing about the succession."""
    unit = _unit(session)
    older = holder_set_current(unit.id, "Antiguo", session, start_date=date(2018, 5, 1))
    newer = holder_set_current(
        unit.id, "Reciente", session, start_date=date(2024, 3, 11)
    )
    # Entered last, but the earliest term of the three.
    oldest = holder_set_current(
        unit.id, "El primero de todos", session, start_date=date(2010, 1, 1)
    )

    history = holder_history(unit.id, session)

    assert [h.id for h in history] == [newer.id, older.id, oldest.id]
